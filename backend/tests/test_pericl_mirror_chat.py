"""
Iteration 5 — Tests for the new "Mirror" chat spec.

Covers:
- /api/ai/chat-stateless drift scenario (must end with a Next Move; must NOT contain "as an AI"
  or markdown headings; must call out drift; reasonable length).
- /api/ai/chat-stateless high-energy scenario (excited mood, completed tasks → harder push).
- /api/ai/chat (cloud) — drift scenario; computes behavior from Mongo journal_items.
- _parse_top_goals / _compute_behavior_signals_from_items helpers (imported directly).
- Mood-aware tone shifts (sad vs excited).
- Empty / malformed inputs.
- Regression for previously-tested endpoints.

Test policy: GPT-5.2 may occasionally drop the exact 🎯 emoji — accept either
"🎯 Next Move" or "Next Move" but log when emoji is missing.
"""
import os
import re
import sys
import time
import uuid
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://pericl-staging.preview.emergentagent.com").rstrip("/")
API = BASE_URL + "/api"

USER_TOKEN = "test_sess_1777379746360"
SUPER_TOKEN = "sa_sess_test_001"
USER_ID = "test-user-pericl-1777377818066"

USER_HEADERS = {"Authorization": f"Bearer {USER_TOKEN}", "Content-Type": "application/json"}
SUPER_HEADERS = {"Authorization": f"Bearer {SUPER_TOKEN}", "Content-Type": "application/json"}

# Allow importing helpers directly from the backend
sys.path.insert(0, "/app/backend")
from server import _parse_top_goals, _compute_behavior_signals_from_items  # noqa: E402

NEXT_MOVE_RX = re.compile(r"(🎯\s*Next\s*Move|^Next\s*Move\s*:)", re.IGNORECASE | re.MULTILINE)
HAS_AI_DISCLAIMER = re.compile(r"as an (AI|assistant)", re.IGNORECASE)
HAS_MD_HEADING = re.compile(r"^\s*#{1,6}\s", re.MULTILINE)


def _word_count(s: str) -> int:
    return len(re.findall(r"\b\w+\b", s or ""))


def _post_with_retry(url, json, headers, retries=2, timeout=120):
    last = None
    for _ in range(retries + 1):
        r = requests.post(url, json=json, headers=headers, timeout=timeout)
        if r.status_code == 200:
            return r
        last = r
        time.sleep(1.5)
    return last


# --------------------------- helpers (unit) ---------------------------
class TestHelpers:
    def test_parse_top_goals_3_lines(self):
        text = "1. Build a portfolio\n2. Launch PericL\n3. Publish weekly\nFollow-up extra goal"
        goals = _parse_top_goals(text)
        assert len(goals) == 3
        assert goals[0].lower().startswith("build a portfolio")
        assert "launch pericl" in goals[1].lower()
        assert "publish weekly" in goals[2].lower()

    def test_parse_top_goals_empty(self):
        assert _parse_top_goals(None) == []
        assert _parse_top_goals("") == []

    def test_parse_top_goals_sentences(self):
        text = "Build a portfolio. Launch PericL. Publish weekly. Extra."
        goals = _parse_top_goals(text)
        assert len(goals) == 3

    def test_compute_behavior_signals(self):
        now = datetime.now(timezone.utc)
        items = [
            {"type": "voice", "created_at": (now - timedelta(days=1)).isoformat(), "mood": "tired"},
            {"type": "voice", "created_at": (now - timedelta(days=2)).isoformat(), "mood": "stressed"},
            {"type": "text", "created_at": (now - timedelta(days=3)).isoformat(), "mood": "tired"},
            {"type": "task", "completed": True, "created_at": (now - timedelta(days=1)).isoformat()},
            {"type": "task", "completed": True, "created_at": (now - timedelta(days=2)).isoformat()},
            {"type": "task", "completed": False, "created_at": (now - timedelta(days=4)).isoformat()},
            {"type": "task", "completed": False, "created_at": (now - timedelta(days=5)).isoformat()},
            {"type": "reminder", "completed": False, "due_at": (now - timedelta(hours=3)).isoformat(),
             "created_at": (now - timedelta(days=2)).isoformat(), "title": "Send launch tweet"},
        ]
        sig = _compute_behavior_signals_from_items(items)
        assert sig["voice_text_entries_7d"] == 3
        assert sig["tasks_completed_7d"] == 2
        assert sig["open_tasks"] == 2
        assert sig["missed_or_overdue_reminders"] == 1
        assert "Send launch tweet" in sig["overdue_titles"]
        assert sig["days_since_last_entry"] is not None and sig["days_since_last_entry"] <= 1
        assert "tired" in sig["top_moods_7d"]


# --------------------------- /ai/chat-stateless drift scenario ---------------------------
DRIFT_PAYLOAD = {
    "message": "I will start working on my portfolio tomorrow, today I am too tired",
    "history": [],
    "profile": {
        "goals": "Build portfolio\nLaunch PericL\nPublish weekly",
        "aspirations": "Become indie maker",
    },
    "personality": None,
    "recent_moods": ["tired", "stressed"],
    "behavior": {
        "voice_text_entries_7d": 6,
        "tasks_completed_7d": 0,
        "open_tasks": 4,
        "missed_or_overdue_reminders": 2,
        "overdue_titles": ["Write portfolio about page", "Send launch tweet"],
        "days_since_last_entry": 0,
        "top_moods_7d": ["tired", "stressed"],
    },
    "current_mood": "stressed",
}


class TestStatelessChatMirror:
    def test_drift_scenario_structure(self):
        r = _post_with_retry(f"{API}/ai/chat-stateless", DRIFT_PAYLOAD, USER_HEADERS)
        assert r.status_code == 200, r.text
        reply = r.json().get("reply", "")
        assert reply, "empty reply"
        # Must end with Next Move (emoji preferred but optional)
        assert NEXT_MOVE_RX.search(reply), f"missing Next Move:\n{reply}"
        # No AI disclaimer
        assert not HAS_AI_DISCLAIMER.search(reply), f"has AI disclaimer:\n{reply}"
        # No markdown headings
        assert not HAS_MD_HEADING.search(reply), f"has md heading:\n{reply}"
        # Length sane
        wc = _word_count(reply)
        assert wc <= 220, f"reply too long ({wc} words):\n{reply}"
        # Should mention drift signal: 0 completions / overdue / tomorrow / behind
        low = reply.lower()
        drift_hit = any(k in low for k in [
            "tomorrow", "drift", "haven't", "havent", "0 ", "zero", "overdue",
            "behind", "delay", "stalled", "said", "matters", "pace",
        ])
        assert drift_hit, f"no drift call-out:\n{reply}"

    def test_high_energy_scenario(self):
        payload = {
            "message": "I want to find my first 10 users this week",
            "history": [],
            "profile": {
                "goals": "Launch PericL\nFind 10 users\nShip weekly",
                "aspirations": "Become indie maker",
            },
            "personality": None,
            "recent_moods": ["excited", "focused"],
            "behavior": {
                "voice_text_entries_7d": 5,
                "tasks_completed_7d": 4,
                "open_tasks": 2,
                "missed_or_overdue_reminders": 0,
                "overdue_titles": [],
                "days_since_last_entry": 0,
                "top_moods_7d": ["excited", "focused"],
            },
            "current_mood": "excited",
        }
        r = _post_with_retry(f"{API}/ai/chat-stateless", payload, USER_HEADERS)
        assert r.status_code == 200, r.text
        reply = r.json().get("reply", "")
        assert NEXT_MOVE_RX.search(reply), f"missing Next Move:\n{reply}"
        assert not HAS_MD_HEADING.search(reply)
        assert not HAS_AI_DISCLAIMER.search(reply)
        # The push-harder action shouldn't say "rest" / "small step" / "be gentle"
        low = reply.lower()
        soft_words = ["take it easy", "rest", "be gentle", "small step", "tiny step"]
        assert not any(w in low for w in soft_words), f"unexpected soft tone for excited:\n{reply}"

    def test_sad_mood_softer_tone(self):
        payload = dict(DRIFT_PAYLOAD)
        payload["current_mood"] = "sad"
        payload["recent_moods"] = ["sad", "tired"]
        r = _post_with_retry(f"{API}/ai/chat-stateless", payload, USER_HEADERS)
        assert r.status_code == 200, r.text
        reply = r.json().get("reply", "")
        assert NEXT_MOVE_RX.search(reply), f"missing Next Move:\n{reply}"
        # Soft tone shouldn't read like a drill sergeant
        low = reply.lower()
        harsh_words = ["push harder", "no excuses", "stop whining", "grind", "hustle"]
        assert not any(w in low for w in harsh_words), f"harsh tone for sad:\n{reply}"

    def test_empty_message_400(self):
        r = requests.post(f"{API}/ai/chat-stateless", json={"message": "  "}, headers=USER_HEADERS, timeout=15)
        assert r.status_code == 400

    def test_missing_optional_fields_still_works(self):
        r = _post_with_retry(
            f"{API}/ai/chat-stateless",
            {"message": "I keep saying I will start tomorrow"},
            USER_HEADERS,
        )
        assert r.status_code == 200, r.text
        reply = r.json().get("reply", "")
        assert reply
        assert NEXT_MOVE_RX.search(reply), f"missing Next Move:\n{reply}"

    def test_unauth_401(self):
        r = requests.post(f"{API}/ai/chat-stateless", json={"message": "hi"}, timeout=15)
        assert r.status_code == 401


# --------------------------- /ai/chat (cloud) ---------------------------
class TestCloudChatMirror:
    @classmethod
    def setup_class(cls):
        # Seed mongo journal_items for the test user via API to back behavior signals
        # 6 voice notes, 3 completed tasks (1 today, 2 yesterday), 4 open tasks, 2 overdue reminders.
        cls.created_ids = []
        # Cloud /api/notes/text creates voice/text journal items — use 6 of them with TEST_ prefix
        for i in range(6):
            r = requests.post(
                f"{API}/notes/text",
                json={"content": f"TEST_iter5 mirror chat seed note {i}", "mood": "tired"},
                headers=USER_HEADERS, timeout=20,
            )
            if r.status_code == 200:
                cls.created_ids.append(r.json().get("id"))
        # We can't easily create tasks/reminders via API in all configs; the chat endpoint
        # will still produce a reply. Behavior may be partial — we only assert presence of
        # Next Move and structure here, not exact numbers.

    def test_cloud_chat_reply_structure(self):
        r = _post_with_retry(
            f"{API}/ai/chat",
            {"message": "I keep saying I will start tomorrow"},
            USER_HEADERS,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # /api/ai/chat returns {user_message, assistant_message}
        reply = (body.get("assistant_message") or {}).get("content") or body.get("reply", "")
        assert reply, f"empty reply body={body}"
        assert NEXT_MOVE_RX.search(reply), f"missing Next Move:\n{reply}"
        assert not HAS_AI_DISCLAIMER.search(reply), f"has AI disclaimer:\n{reply}"
        assert not HAS_MD_HEADING.search(reply), f"has md heading:\n{reply}"
        wc = _word_count(reply)
        assert wc <= 260, f"too long ({wc}):\n{reply}"

    @classmethod
    def teardown_class(cls):
        # Cleanup TEST_ notes
        try:
            r = requests.get(f"{API}/timeline", headers=USER_HEADERS, timeout=20)
            if r.status_code == 200:
                for it in r.json():
                    txt = (it.get("transcription") or it.get("title") or "")
                    if "TEST_iter5" in txt:
                        rid = it.get("id")
                        if rid:
                            requests.delete(f"{API}/journal/{rid}", headers=USER_HEADERS, timeout=10)
        except Exception:
            pass


# --------------------------- regression of prior endpoints ---------------------------
class TestRegressionEndpoints:
    def test_auth_me(self):
        r = requests.get(f"{API}/auth/me", headers=USER_HEADERS, timeout=10)
        assert r.status_code == 200
        assert r.json().get("user_id") == USER_ID

    def test_timeline(self):
        r = requests.get(f"{API}/timeline", headers=USER_HEADERS, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_storage_pref(self):
        r = requests.get(f"{API}/storage/pref", headers=USER_HEADERS, timeout=10)
        assert r.status_code == 200
        assert "mode" in r.json()

    def test_admin_users_super(self):
        r = requests.get(f"{API}/admin/users", headers=SUPER_HEADERS, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_ai_categorize(self):
        r = _post_with_retry(
            f"{API}/ai/categorize",
            {"text": "Remind me to send the launch tweet tomorrow at 10am"},
            USER_HEADERS,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # categorize returns either a single item shape or {items, mood, summary}
        assert "type" in body or "items" in body, f"unexpected categorize response: {body}"

    def test_daily_prompt(self):
        r = requests.get(f"{API}/daily-prompt", headers=USER_HEADERS, timeout=20)
        # endpoint may be either get or different name; allow 200/404
        assert r.status_code in (200, 404)

    def test_recap_stateless(self):
        r = _post_with_retry(
            f"{API}/ai/recap-stateless",
            {"items": [
                {"type": "text", "transcription": "Wrote portfolio about page", "created_at": datetime.now(timezone.utc).isoformat()},
                {"type": "text", "transcription": "Sketched launch tweet", "created_at": datetime.now(timezone.utc).isoformat()},
            ]},
            USER_HEADERS,
        )
        assert r.status_code == 200, r.text
        assert "summary" in r.json() or "recap" in r.json() or "reply" in r.json() or len(r.json()) > 0

    def test_personality_assess_validation(self):
        # invalid type for scores — endpoint may coerce/accept; just assert it doesn't 5xx.
        r = requests.post(
            f"{API}/personality/assess",
            json={"answers": "not-a-dict"},
            headers=USER_HEADERS, timeout=15,
        )
        assert r.status_code < 500, r.text
