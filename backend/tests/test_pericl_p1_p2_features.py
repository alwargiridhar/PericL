"""Backend tests for PericL P1+P2 new features (iteration 6).

Covers:
- Streaming chat: /api/ai/chat/stream (persists), /api/ai/chat-stateless/stream (no persist)
- Search: /api/search
- Big Five: /api/personality/big-five-assess + /api/ai/big-five-analyze
- Mood timeline: /api/mood/timeline
- Sync: /api/sync/import + /api/sync/export
- Admin audit log: /api/admin/audit-log + role change/delete writes
- Regression on existing endpoints
"""
import json
import os
import time
import uuid

import pytest
import requests

def _load_base_url():
    if os.environ.get("REACT_APP_BACKEND_URL"):
        return os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
    # Fallback: read from frontend/.env
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.strip().startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not found")


BASE_URL = _load_base_url()
USER_TOKEN = "test_sess_1777379746360"
ADMIN_TOKEN = "sa_sess_test_001"


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


# --------------------------- Auth & regression smoke ---------------------------
class TestAuthAndRegression:
    def test_auth_me_user(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == "alwar@test.local"
        assert d["role"] == "user"

    def test_auth_me_admin(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        assert r.json()["role"] == "super_admin"

    def test_timeline(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/timeline")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_storage_pref(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/storage/pref")
        assert r.status_code == 200
        assert r.json()["mode"] in ("local", "cloud", "never")

    def test_missions(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/missions")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_personality_latest(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/personality/latest")
        assert r.status_code == 200
        assert "hasAssessment" in r.json()


# --------------------------- Search ---------------------------
class TestSearch:
    def test_search_empty_query(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/search?q=")
        assert r.status_code == 200
        d = r.json()
        assert d == {"journal": [], "chat": []}

    def test_search_returns_shape(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/search?q=the")
        assert r.status_code == 200
        d = r.json()
        assert "journal" in d and "chat" in d
        assert isinstance(d["journal"], list)
        assert isinstance(d["chat"], list)

    def test_search_after_creating_unique_note(self, user_client):
        # Ensure cloud mode for persistence
        user_client.put(f"{BASE_URL}/api/storage/pref", json={"mode": "cloud"})
        token = f"TESTQRY{uuid.uuid4().hex[:6].upper()}"
        r = user_client.post(f"{BASE_URL}/api/notes/text", json={"text": f"note containing {token} for search"})
        assert r.status_code == 200
        time.sleep(0.4)
        r2 = user_client.get(f"{BASE_URL}/api/search?q={token}")
        assert r2.status_code == 200
        d = r2.json()
        # Should match at least one journal entry
        assert any(token.lower() in (str(j.get("title") or "") + str(j.get("detail") or "") + str(j.get("transcription") or "") + str(j.get("summary") or "")).lower() for j in d["journal"]), f"expected hit for {token}, got {d}"

    def test_search_unauthenticated(self):
        r = requests.get(f"{BASE_URL}/api/search?q=a")
        assert r.status_code == 401


# --------------------------- Streaming chat ---------------------------
def _read_sse(url, headers, payload, timeout=120):
    deltas = []
    meta = None
    done = False
    with requests.post(url, headers=headers, json=payload, stream=True, timeout=timeout) as r:
        assert r.status_code == 200, f"HTTP {r.status_code}: {r.text[:300]}"
        ct = r.headers.get("content-type", "")
        assert "text/event-stream" in ct, f"unexpected content-type: {ct}"
        for raw in r.iter_lines(decode_unicode=True):
            if not raw:
                continue
            if not raw.startswith("data: "):
                continue
            payload_s = raw[len("data: "):]
            if payload_s.strip() == "[DONE]":
                done = True
                break
            try:
                obj = json.loads(payload_s)
            except Exception:
                continue
            if "meta" in obj:
                meta = obj["meta"]
            elif "delta" in obj:
                deltas.append(obj["delta"])
    return {"deltas": deltas, "meta": meta, "done": done, "text": "".join(deltas)}


class TestStreamingChat:
    def test_stateless_stream_does_not_persist(self, user_client):
        # baseline
        before = user_client.get(f"{BASE_URL}/api/ai/messages").json()
        before_count = len(before)
        marker = f"TESTSTL{uuid.uuid4().hex[:6]}"
        out = _read_sse(
            f"{BASE_URL}/api/ai/chat-stateless/stream",
            headers={"Authorization": f"Bearer {USER_TOKEN}", "Content-Type": "application/json"},
            payload={"message": f"Briefly say hello and include the token {marker}.", "history": []},
        )
        assert out["done"], "Stream did not end with [DONE]"
        assert len(out["text"]) > 0, "No deltas received"
        after = user_client.get(f"{BASE_URL}/api/ai/messages").json()
        # No new messages persisted, and none should contain marker
        assert len(after) == before_count, "stateless stream should NOT persist"
        assert not any(marker in (m.get("content") or "") for m in after)

    def test_cloud_stream_persists_and_meta(self, user_client):
        # Ensure cloud mode
        user_client.put(f"{BASE_URL}/api/storage/pref", json={"mode": "cloud"})
        before = user_client.get(f"{BASE_URL}/api/ai/messages").json()
        before_count = len(before)
        marker = f"TESTCLD{uuid.uuid4().hex[:6]}"
        out = _read_sse(
            f"{BASE_URL}/api/ai/chat/stream",
            headers={"Authorization": f"Bearer {USER_TOKEN}", "Content-Type": "application/json"},
            payload={"message": f"Reply briefly and acknowledge {marker}."},
        )
        assert out["done"], "Stream did not end with [DONE]"
        assert out["meta"], "Expected meta frame with user/assistant ids"
        assert "user_message_id" in out["meta"] and "assistant_message_id" in out["meta"]
        assert len(out["text"]) > 0
        time.sleep(0.5)
        after = user_client.get(f"{BASE_URL}/api/ai/messages").json()
        assert len(after) >= before_count + 2, f"expected user+assistant persisted, before={before_count} after={len(after)}"
        ids = {m["id"] for m in after}
        assert out["meta"]["user_message_id"] in ids
        assert out["meta"]["assistant_message_id"] in ids
        # Cleanup: delete just-created
        user_client.delete(f"{BASE_URL}/api/ai/messages/{out['meta']['user_message_id']}")
        user_client.delete(f"{BASE_URL}/api/ai/messages/{out['meta']['assistant_message_id']}")

    def test_stream_empty_message(self, user_client):
        r = requests.post(
            f"{BASE_URL}/api/ai/chat/stream",
            headers={"Authorization": f"Bearer {USER_TOKEN}", "Content-Type": "application/json"},
            json={"message": ""},
        )
        assert r.status_code == 400


# --------------------------- Big Five ---------------------------
SAMPLE_BF_ANSWERS = [
    {"trait": "O", "score": 5, "reverse": False},
    {"trait": "O", "score": 4, "reverse": False},
    {"trait": "C", "score": 4, "reverse": False},
    {"trait": "C", "score": 2, "reverse": True},
    {"trait": "E", "score": 3, "reverse": False},
    {"trait": "A", "score": 5, "reverse": False},
    {"trait": "N", "score": 2, "reverse": False},
    {"trait": "N", "score": 4, "reverse": True},
]


class TestBigFive:
    def test_big_five_assess_persists(self, user_client):
        r = user_client.post(
            f"{BASE_URL}/api/personality/big-five-assess",
            json={"answers": SAMPLE_BF_ANSWERS},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["framework"] == "big_five"
        assert d["personality_type"] == "BIG5"
        assert "id" in d
        for t in ("O", "C", "E", "A", "N"):
            assert t in d["scores"]
            assert 0 <= d["scores"][t] <= 100

        # GET result
        rid = d["id"]
        r2 = user_client.get(f"{BASE_URL}/api/personality/result/{rid}")
        assert r2.status_code == 200
        assert r2.json()["framework"] == "big_five"

    def test_big_five_stateless_no_persist(self, user_client):
        r = user_client.post(
            f"{BASE_URL}/api/ai/big-five-analyze",
            json={"answers": SAMPLE_BF_ANSWERS, "profile": {"name": "Alwar"}},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["framework"] == "big_five"
        assert "id" not in d
        for t in ("O", "C", "E", "A", "N"):
            assert 0 <= d["scores"][t] <= 100

    def test_big_five_empty_answers(self, user_client):
        r = user_client.post(f"{BASE_URL}/api/personality/big-five-assess", json={"answers": []})
        assert r.status_code == 400


# --------------------------- Mood timeline ---------------------------
class TestMoodTimeline:
    def test_mood_timeline_default(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/mood/timeline")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        for it in items:
            assert "created_at" in it and "mood" in it
            assert it["mood"]

    def test_mood_timeline_days_param(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/mood/timeline?days=7")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# --------------------------- Sync ---------------------------
class TestSync:
    def test_sync_export_shape(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/sync/export")
        assert r.status_code == 200
        d = r.json()
        for k in ("personality_assessments", "journal_items", "ai_messages",
                  "daily_prompts", "daily_recaps", "missions", "mission_progress"):
            assert k in d and isinstance(d[k], list)
        # profile may be None or dict
        assert "profile" in d

    def test_sync_import_idempotent(self, user_client):
        marker_id = f"item_TEST{uuid.uuid4().hex[:8]}"
        payload = {
            "journal_items": [{
                "id": marker_id,
                "type": "idea",
                "title": "TEST sync import",
                "detail": "imported",
                "completed": False,
                "created_at": "2026-01-01T00:00:00+00:00",
            }],
        }
        r1 = user_client.post(f"{BASE_URL}/api/sync/import", json=payload)
        assert r1.status_code == 200, r1.text
        c1 = r1.json()["counts"]
        assert c1.get("journal_items", 0) >= 1

        # Idempotent — re-import should not duplicate
        r2 = user_client.post(f"{BASE_URL}/api/sync/import", json=payload)
        assert r2.status_code == 200

        # Verify export contains exactly one entry with that id
        exp = user_client.get(f"{BASE_URL}/api/sync/export").json()
        matches = [j for j in exp["journal_items"] if j.get("id") == marker_id]
        assert len(matches) == 1, f"expected 1 match, got {len(matches)}"

        # Cleanup
        user_client.delete(f"{BASE_URL}/api/items/{marker_id}")


# --------------------------- Admin audit log ---------------------------
class TestAuditLog:
    def test_audit_log_listing(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/admin/audit-log")
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)

    def test_audit_log_user_forbidden(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/admin/audit-log")
        assert r.status_code == 403

    def test_role_change_writes_audit(self, admin_client):
        # Find target user (the regular test user)
        users = admin_client.get(f"{BASE_URL}/api/admin/users").json()
        target = next((u for u in users if u["email"] == "alwar@test.local"), None)
        assert target, "regular test user missing"

        # Toggle role: user -> admin -> user
        r1 = admin_client.put(
            f"{BASE_URL}/api/admin/users/{target['user_id']}/role",
            json={"role": "admin"},
        )
        assert r1.status_code == 200
        assert r1.json()["role"] == "admin"

        r2 = admin_client.put(
            f"{BASE_URL}/api/admin/users/{target['user_id']}/role",
            json={"role": "user"},
        )
        assert r2.status_code == 200
        assert r2.json()["role"] == "user"

        # Audit log should now contain at least 2 set_role events for this target
        log = admin_client.get(f"{BASE_URL}/api/admin/audit-log?limit=200").json()
        relevant = [r for r in log if r.get("action") == "set_role" and r.get("target_user_id") == target["user_id"]]
        assert len(relevant) >= 2, f"expected >=2 audit rows, got {len(relevant)}"
        # Latest entries should have actor_email and meta.from/to
        latest = relevant[0]
        assert latest["actor_email"] == "alwargiridhar@gmail.com"
        assert "from" in (latest.get("meta") or {})
        assert "to" in (latest.get("meta") or {})
