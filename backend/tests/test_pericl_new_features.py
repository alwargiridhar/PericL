"""Backend tests for newly added PericL features.

Covers:
- Profile (Personality Builder): GET/PUT /api/profile
- Personality (MBTI): POST /api/personality/assess, GET /api/personality/latest, GET /api/personality/result/{id}
- AI Chat: POST /api/ai/chat, GET/DELETE /api/ai/messages, DELETE /api/ai/messages/{id}
- Daily Prompt: GET /api/daily-prompt (idempotent), POST /api/daily-prompt/respond, GET /api/daily-prompts/history, DELETE
"""
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://pericl-staging.preview.emergentagent.com").rstrip("/")
TOKEN = os.environ.get("PERICL_TEST_TOKEN", "test_sess_1777379746360")
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(scope="session")
def state():
    return {}


# Sanity check token works
def test_auth_me_works():
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=HEADERS, timeout=15)
    assert r.status_code == 200, f"Auth check failed: {r.status_code} {r.text}"
    assert r.json()["email"]


# ---------------------------- Profile ----------------------------
class TestProfile:
    def test_get_default_profile(self, state):
        # Reset by deleting via mongo? no — endpoint upserts. Just ensure GET returns shape.
        r = requests.get(f"{BASE_URL}/api/profile", headers=HEADERS, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "user_id" in data
        # All known fields present (None or value)
        for f in ("name", "age", "goals", "challenges", "core_values", "aspirations"):
            assert f in data

    def test_put_profile_persists(self, state):
        payload = {
            "name": "TEST_Alwar",
            "age": 30,
            "occupation": "Engineer",
            "goals": "Ship PericL features",
            "challenges": "Time management",
            "core_values": "Curiosity, kindness",
            "aspirations": "Build calm tech",
            "personality_traits": "Reflective",
            "communication_style": "Direct",
            "energy_level": "Medium",
            "motivation_triggers": "Progress",
        }
        r = requests.put(f"{BASE_URL}/api/profile", json=payload, headers=HEADERS, timeout=20)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["name"] == "TEST_Alwar"
        assert doc["goals"] == "Ship PericL features"
        assert doc["onboarding_completed"] is True

        # GET to verify persistence
        r2 = requests.get(f"{BASE_URL}/api/profile", headers=HEADERS, timeout=15)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["name"] == "TEST_Alwar"
        assert d2["age"] == 30
        assert d2["core_values"] == "Curiosity, kindness"
        assert d2["onboarding_completed"] is True


# ---------------------------- Personality (MBTI) ----------------------------
class TestPersonality:
    def test_assess_returns_mbti(self, state):
        scores = {"E": 3, "I": 5, "S": 2, "N": 6, "T": 6, "F": 2, "J": 5, "P": 3}
        # I>E, N>S, T>F, J>P -> INTJ
        r = requests.post(
            f"{BASE_URL}/api/personality/assess",
            json={"scores": scores},
            headers=HEADERS,
            timeout=120,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["personality_type"] == "INTJ", f"Expected INTJ, got {data['personality_type']}"
        assert data["type_name"] == "The Mastermind"
        assert isinstance(data.get("description"), str)
        assert len(data["description"]) > 0
        assert isinstance(data.get("strengths"), list)
        assert isinstance(data.get("growth_areas"), list)
        assert data["id"].startswith("pa_")
        state["assessment_id"] = data["id"]

    def test_personality_latest(self, state):
        r = requests.get(f"{BASE_URL}/api/personality/latest", headers=HEADERS, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["hasAssessment"] is True
        assert data["assessment"]["personality_type"] == "INTJ"

    def test_personality_result_by_id(self, state):
        aid = state.get("assessment_id")
        if not aid:
            pytest.skip("no assessment id")
        r = requests.get(f"{BASE_URL}/api/personality/result/{aid}", headers=HEADERS, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == aid
        assert data["personality_type"] == "INTJ"

    def test_personality_result_not_found(self):
        r = requests.get(f"{BASE_URL}/api/personality/result/pa_doesnotexist", headers=HEADERS, timeout=15)
        assert r.status_code == 404


# ---------------------------- AI Chat ----------------------------
class TestAiChat:
    def test_clear_chat_first(self):
        r = requests.delete(f"{BASE_URL}/api/ai/messages", headers=HEADERS, timeout=15)
        assert r.status_code == 200

    def test_messages_initially_empty(self):
        r = requests.get(f"{BASE_URL}/api/ai/messages", headers=HEADERS, timeout=15)
        assert r.status_code == 200
        assert r.json() == []

    def test_chat_send(self, state):
        r = requests.post(
            f"{BASE_URL}/api/ai/chat",
            json={"message": "Help me focus today"},
            headers=HEADERS,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "user_message" in data and "assistant_message" in data
        um, am = data["user_message"], data["assistant_message"]
        for m in (um, am):
            assert m["id"].startswith("m_")
            assert m["content"]
            assert m["created_at"]
        assert um["role"] == "user"
        assert am["role"] == "assistant"
        assert um["content"] == "Help me focus today"
        assert isinstance(am["content"], str) and len(am["content"]) > 0
        state["msg_id"] = um["id"]
        state["asst_id"] = am["id"]

    def test_messages_persist_chronological(self, state):
        r = requests.get(f"{BASE_URL}/api/ai/messages", headers=HEADERS, timeout=15)
        assert r.status_code == 200
        msgs = r.json()
        assert len(msgs) >= 2
        ts = [m["created_at"] for m in msgs]
        assert ts == sorted(ts), "Messages not chronological"
        # First should be user 'Help me focus today'
        assert msgs[0]["role"] == "user"
        assert msgs[0]["content"] == "Help me focus today"

    def test_delete_single_message(self, state):
        msg_id = state.get("msg_id")
        if not msg_id:
            pytest.skip("no msg_id")
        r = requests.delete(f"{BASE_URL}/api/ai/messages/{msg_id}", headers=HEADERS, timeout=15)
        assert r.status_code == 200
        # Verify gone
        msgs = requests.get(f"{BASE_URL}/api/ai/messages", headers=HEADERS, timeout=15).json()
        assert msg_id not in {m["id"] for m in msgs}

    def test_clear_all_messages(self):
        r = requests.delete(f"{BASE_URL}/api/ai/messages", headers=HEADERS, timeout=15)
        assert r.status_code == 200
        msgs = requests.get(f"{BASE_URL}/api/ai/messages", headers=HEADERS, timeout=15).json()
        assert msgs == []

    def test_chat_empty_message_rejected(self):
        r = requests.post(
            f"{BASE_URL}/api/ai/chat",
            json={"message": "  "},
            headers=HEADERS,
            timeout=15,
        )
        assert r.status_code == 400


# ---------------------------- Daily Prompt ----------------------------
class TestDailyPrompt:
    def test_get_creates_today_prompt(self, state):
        r = requests.get(f"{BASE_URL}/api/daily-prompt", headers=HEADERS, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["id"].startswith("dp_")
        assert data["prompt_text"]
        assert data["prompt_date"]
        state["prompt_id"] = data["id"]
        state["prompt_text"] = data["prompt_text"]
        state["prompt_date"] = data["prompt_date"]

    def test_get_idempotent(self, state):
        # Second call same day → same prompt
        r = requests.get(f"{BASE_URL}/api/daily-prompt", headers=HEADERS, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == state["prompt_id"]
        assert data["prompt_text"] == state["prompt_text"]

    def test_respond_marks_completed(self, state):
        r = requests.post(
            f"{BASE_URL}/api/daily-prompt/respond",
            json={"response": "I rested in the morning"},
            headers=HEADERS,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["is_completed"] is True
        assert data["completed_at"]
        assert data["response_text"] == "I rested in the morning"

    def test_respond_empty_rejected(self):
        r = requests.post(
            f"{BASE_URL}/api/daily-prompt/respond",
            json={"response": ""},
            headers=HEADERS,
            timeout=15,
        )
        assert r.status_code == 400

    def test_history_contains_today(self, state):
        r = requests.get(f"{BASE_URL}/api/daily-prompts/history", headers=HEADERS, timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert any(i["id"] == state["prompt_id"] for i in items)

    def test_delete_prompt(self, state):
        pid = state.get("prompt_id")
        if not pid:
            pytest.skip("no prompt id")
        r = requests.delete(f"{BASE_URL}/api/daily-prompts/{pid}", headers=HEADERS, timeout=15)
        assert r.status_code == 200
        items = requests.get(f"{BASE_URL}/api/daily-prompts/history", headers=HEADERS, timeout=15).json()
        assert pid not in {i["id"] for i in items}


# ---------------------------- Auth gate on new endpoints ----------------------------
def test_unauthenticated_profile():
    r = requests.get(f"{BASE_URL}/api/profile", timeout=15)
    assert r.status_code == 401


def test_unauthenticated_chat():
    r = requests.post(f"{BASE_URL}/api/ai/chat", json={"message": "hi"}, timeout=15)
    assert r.status_code == 401
