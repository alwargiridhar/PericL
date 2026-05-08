"""Backend tests for PericL Phase A-D (iteration 7).

Covers:
- Behavioral engine: /scores, /scores-stateless, /insights/today, /insights/today-stateless
- Personality history: /personality/history
- Stripe billing: /billing/pricing (public), /billing/checkout, /billing/me
- Free-tier limits: /ai/chat 402 after 5 replies
- Admin analytics: /admin/analytics
- Drift nudge v2: /ai/drift-nudge, /ai/drift-nudge-stateless
"""
import os
import time
import uuid

import pytest
import requests


def _load_base_url():
    if os.environ.get("REACT_APP_BACKEND_URL"):
        return os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.strip().startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not found")


BASE_URL = _load_base_url()
USER_TOKEN = "test_sess_pa_001"
ADMIN_TOKEN = "sa_sess_pa_001"


@pytest.fixture(scope="module")
def user_client():
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {USER_TOKEN}",
        "Content-Type": "application/json",
    })
    return s


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {ADMIN_TOKEN}",
        "Content-Type": "application/json",
    })
    return s


# --------------------------- Behavioral engine ---------------------------
class TestBehavioralEngine:
    def test_scores_shape(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/scores")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("self_trust", "execution", "consistency_days"):
            assert k in d
            assert isinstance(d[k], (int, float))
        assert 0 <= d["self_trust"] <= 100
        assert 0 <= d["execution"] <= 100
        assert "stats" in d
        # drift_signal is either None or a non-empty string
        assert "drift_signal" in d

    def test_scores_stateless_empty(self, user_client):
        r = user_client.post(f"{BASE_URL}/api/scores-stateless",
                             json={"items": [], "days": 7})
        assert r.status_code == 200, r.text
        d = r.json()
        assert 0 <= d["self_trust"] <= 100
        assert 0 <= d["execution"] <= 100
        # Empty data should trigger drift_signal
        assert d.get("drift_signal"), "empty items should trigger a drift_signal"

    def test_scores_stateless_with_items(self, user_client):
        items = [
            {"id": f"x{i}", "type": "task", "title": "t", "completed": (i % 2 == 0),
             "created_at": "2026-01-01T00:00:00+00:00"}
            for i in range(6)
        ]
        r = user_client.post(f"{BASE_URL}/api/scores-stateless",
                             json={"items": items, "days": 14})
        assert r.status_code == 200, r.text
        d = r.json()
        assert 0 <= d["self_trust"] <= 100

    def test_insights_today_authed(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/insights/today")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "scores" in d
        assert "next_move" in d
        nm = d["next_move"]
        for k in ("headline", "action", "anchor"):
            assert k in nm
            assert isinstance(nm[k], str) and len(nm[k]) > 0
        assert "missions" in d
        assert isinstance(d["missions"], list)

    def test_insights_today_stateless(self, user_client):
        r = user_client.post(
            f"{BASE_URL}/api/insights/today-stateless",
            json={"items": [], "profile": {"name": "Tester"}, "missions": []},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "scores" in d and "next_move" in d
        for k in ("headline", "action", "anchor"):
            assert k in d["next_move"]


# --------------------------- Personality history ---------------------------
class TestPersonalityHistory:
    def test_history_returns_list(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/personality/history")
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d, list)
        # We may have multiple assessments from prior tests
        if d:
            for it in d:
                assert "id" in it
                assert "framework" in it or "personality_type" in it


# --------------------------- Stripe billing ---------------------------
class TestBilling:
    def test_pricing_us_public(self):
        r = requests.get(f"{BASE_URL}/api/billing/pricing?region=us")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["region"] == "us"
        ids = [p["id"] for p in d["packages"]]
        assert "premium_monthly_us" in ids
        assert "premium_yearly_us" in ids
        for p in d["packages"]:
            assert p["currency"] == "usd"
            assert p["amount"] > 0

    def test_pricing_in_public(self):
        r = requests.get(f"{BASE_URL}/api/billing/pricing?region=in")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["region"] == "in"
        assert any(p["currency"] == "inr" for p in d["packages"])

    def test_billing_me(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/billing/me")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "is_premium" in d
        assert "plan" in d
        assert "limits" in d
        for k in ("mirror_remaining_today", "mirror_daily_limit",
                  "max_active_missions", "active_missions"):
            assert k in d["limits"]

    def test_checkout_creates_session(self, user_client):
        origin = "https://pericl-staging.preview.emergentagent.com"
        r = user_client.post(f"{BASE_URL}/api/billing/checkout",
                             json={"package_id": "premium_monthly_us",
                                   "origin": origin})
        # Could be 200 (success) or 5xx if Stripe key invalid
        assert r.status_code == 200, f"checkout failed: {r.status_code} {r.text[:300]}"
        d = r.json()
        assert "url" in d and "session_id" in d
        assert "stripe.com" in d["url"], f"Expected stripe.com URL, got {d['url']}"

    def test_checkout_invalid_package(self, user_client):
        origin = "https://pericl-staging.preview.emergentagent.com"
        r = user_client.post(f"{BASE_URL}/api/billing/checkout",
                             json={"package_id": "bogus_pkg", "origin": origin})
        assert r.status_code in (400, 404, 422), r.text


# --------------------------- Admin analytics ---------------------------
class TestAdminAnalytics:
    def test_analytics_admin(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/admin/analytics")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "users" in d
        for k in ("total", "active_7d", "premium",
                  "premium_monthly", "premium_yearly", "cloud_mode", "local_mode"):
            assert k in d["users"]
        assert "revenue" in d and isinstance(d["revenue"], list)
        assert "transactions_paid" in d

    def test_analytics_user_forbidden(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/admin/analytics")
        assert r.status_code == 403


# --------------------------- Drift nudge v2 ---------------------------
class TestDriftNudge:
    def test_drift_nudge_authed(self, user_client):
        r = user_client.post(f"{BASE_URL}/api/ai/drift-nudge", json={})
        assert r.status_code == 200, r.text
        d = r.json()
        # Expect some text content
        assert isinstance(d, dict)
        assert any(isinstance(v, str) and len(v) > 0 for v in d.values())

    def test_drift_nudge_stateless(self, user_client):
        r = user_client.post(
            f"{BASE_URL}/api/ai/drift-nudge-stateless",
            json={
                "personality": {"personality_type": "INTJ"},
                "drift_count_today": 2,
                "items": [],
            },
        )
        assert r.status_code == 200, r.text


# --------------------------- Free-tier 402 limit ---------------------------
@pytest.mark.serial
class TestFreeTierLimit:
    """Send chat messages until 402 is hit. Skips if user is premium."""

    def test_chat_402_after_quota(self, user_client):
        me = user_client.get(f"{BASE_URL}/api/billing/me").json()
        if me.get("is_premium"):
            pytest.skip("user is premium; quota not enforced")
        # Ensure cloud mode so chat persists
        user_client.put(f"{BASE_URL}/api/storage/pref", json={"mode": "cloud"})
        remaining = me["limits"]["mirror_remaining_today"]
        # Send up to remaining + 1 messages and assert the (remaining+1)th returns 402
        sent_ids = []
        last_status = None
        for i in range(remaining + 1):
            r = user_client.post(
                f"{BASE_URL}/api/ai/chat",
                json={"message": f"FT-{uuid.uuid4().hex[:5]} brief reply please"},
            )
            last_status = r.status_code
            if r.status_code == 200:
                d = r.json()
                # Track new ids for cleanup
                for k in ("user_message_id", "assistant_message_id",
                          "user_id", "assistant_id", "id"):
                    if k in d:
                        sent_ids.append(d[k])
            elif r.status_code == 402:
                break
            else:
                pytest.fail(f"unexpected status {r.status_code}: {r.text[:200]}")
            time.sleep(0.2)
        assert last_status == 402, f"expected 402 after exhausting quota, last status={last_status}"

        # Verify /billing/me reflects 0 remaining
        me2 = user_client.get(f"{BASE_URL}/api/billing/me").json()
        assert me2["limits"]["mirror_remaining_today"] == 0


# --------------------------- Regression smoke ---------------------------
class TestRegressionSmoke:
    def test_auth_me(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == "alwar@test.local"

    def test_timeline(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/timeline")
        assert r.status_code == 200

    def test_missions(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/missions")
        assert r.status_code == 200

    def test_storage_pref(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/storage/pref")
        assert r.status_code == 200

    def test_search(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/search?q=the")
        assert r.status_code == 200
