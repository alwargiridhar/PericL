"""Backend tests for PericL privacy-first refactor (iteration 3).

Covers:
- Storage preference: GET/PUT /api/storage/pref, POST /api/storage/prompt-shown
- Stateless AI endpoints (must NOT persist any user content):
  /api/ai/categorize, /api/ai/personality-analyze, /api/ai/chat-stateless,
  /api/ai/recap-stateless, /api/ai/daily-prompt-pick
- Identity check: chat-stateless reply must not mention "AI"/"assistant"
- Existing cloud endpoints still work unchanged.
"""
import io
import os
import asyncio

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://pericl-staging.preview.emergentagent.com").rstrip("/")
TOKEN = os.environ.get("PERICL_TEST_TOKEN", "test_sess_pa_001")
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


# ----------------- Mongo direct counters (no _id) -----------------
async def _count(col_name: str, user_id: str) -> int:
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    cli = AsyncIOMotorClient(mongo_url)
    try:
        return await cli[db_name][col_name].count_documents({"user_id": user_id})
    finally:
        cli.close()


def count_docs(col: str, user_id: str = "test-user-pericl-1777377818066") -> int:
    return asyncio.get_event_loop().run_until_complete(_count(col, user_id))


@pytest.fixture(scope="module")
def user_id():
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=HEADERS, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["user_id"]


# ============== Storage Preference ==============
class TestStoragePref:
    def test_get_default_pref(self, user_id):
        # Reset any existing pref first via mongo so default flow is exercised
        async def reset():
            from motor.motor_asyncio import AsyncIOMotorClient
            cli = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            await cli[os.environ.get("DB_NAME", "test_database")].storage_prefs.delete_many({"user_id": user_id})
            cli.close()
        asyncio.get_event_loop().run_until_complete(reset())

        r = requests.get(f"{BASE_URL}/api/storage/pref", headers=HEADERS, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["mode"] == "local"
        assert "should_prompt_now" in d
        assert d["should_prompt_now"] is False  # fresh pref => 30 days out
        assert d["next_prompt_at"]

    def test_put_cloud_clears_next_prompt(self):
        r = requests.put(f"{BASE_URL}/api/storage/pref", json={"mode": "cloud"}, headers=HEADERS, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["mode"] == "cloud"
        assert d.get("next_prompt_at") is None

    def test_put_never_clears_next_prompt(self):
        r = requests.put(f"{BASE_URL}/api/storage/pref", json={"mode": "never"}, headers=HEADERS, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["mode"] == "never"
        assert d["next_prompt_at"] is None

    def test_put_invalid_mode(self):
        r = requests.put(f"{BASE_URL}/api/storage/pref", json={"mode": "garbage"}, headers=HEADERS, timeout=15)
        assert r.status_code == 400

    def test_put_local_sets_next_prompt(self):
        r = requests.put(f"{BASE_URL}/api/storage/pref", json={"mode": "local"}, headers=HEADERS, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["mode"] == "local"
        assert d["next_prompt_at"]

    def test_prompt_shown_pushes_next(self, user_id):
        # Force next_prompt_at into the past so should_prompt_now=True
        async def back_date():
            from motor.motor_asyncio import AsyncIOMotorClient
            cli = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            await cli[os.environ.get("DB_NAME", "test_database")].storage_prefs.update_one(
                {"user_id": user_id}, {"$set": {"next_prompt_at": "1970-01-01T00:00:00+00:00"}}
            )
            cli.close()
        asyncio.get_event_loop().run_until_complete(back_date())

        r = requests.get(f"{BASE_URL}/api/storage/pref", headers=HEADERS, timeout=15)
        assert r.json()["should_prompt_now"] is True

        # Now POST prompt-shown → next_prompt_at should be ~30 days in future, should_prompt_now=False
        r2 = requests.post(f"{BASE_URL}/api/storage/prompt-shown", headers=HEADERS, timeout=15)
        assert r2.status_code == 200
        r3 = requests.get(f"{BASE_URL}/api/storage/pref", headers=HEADERS, timeout=15)
        assert r3.json()["should_prompt_now"] is False
        assert r3.json()["next_prompt_at"]

    def test_unauth_storage(self):
        r = requests.get(f"{BASE_URL}/api/storage/pref", timeout=15)
        assert r.status_code == 401


# ============== Stateless AI (no DB writes) ==============
COLLECTIONS_TO_WATCH = [
    "journal_items", "ai_messages", "daily_prompts", "daily_recaps",
    "personality_assessments", "user_profiles",
]


class TestStatelessNoWrites:
    def _snapshot(self, user_id):
        return {c: count_docs(c, user_id) for c in COLLECTIONS_TO_WATCH}

    def test_categorize_no_writes(self, user_id):
        before = self._snapshot(user_id)
        r = requests.post(
            f"{BASE_URL}/api/ai/categorize",
            json={"text": "Had a great walk in the park, felt calm and energised"},
            headers=HEADERS, timeout=60,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        # Response shape
        assert isinstance(d.get("summary"), str) and len(d["summary"]) > 0
        assert isinstance(d.get("mood"), str)
        assert isinstance(d.get("items"), list)
        after = self._snapshot(user_id)
        assert before == after, f"Stateless categorize wrote DB! {before} → {after}"

    def test_categorize_empty_rejected(self):
        r = requests.post(f"{BASE_URL}/api/ai/categorize", json={"text": "  "}, headers=HEADERS, timeout=15)
        assert r.status_code == 400

    def test_personality_analyze_no_writes(self, user_id):
        before = self._snapshot(user_id)
        scores = {"E": 3, "I": 5, "S": 2, "N": 6, "T": 6, "F": 2, "J": 5, "P": 3}
        r = requests.post(
            f"{BASE_URL}/api/ai/personality-analyze",
            json={"scores": scores, "profile": {"name": "Alwar"}},
            headers=HEADERS, timeout=120,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["personality_type"] == "INTJ"
        assert d["type_name"] == "The Mastermind"
        assert isinstance(d["strengths"], list)
        assert isinstance(d["growth_areas"], list)
        assert d["scores"] == {k: scores.get(k, 0) for k in "EISNTFJP"}
        after = self._snapshot(user_id)
        assert before == after, f"Stateless personality-analyze wrote DB! {before} → {after}"

    def test_chat_stateless_no_writes_and_identity(self, user_id):
        before = self._snapshot(user_id)
        r = requests.post(
            f"{BASE_URL}/api/ai/chat-stateless",
            json={
                "message": "I feel anxious about a presentation tomorrow.",
                "history": [],
                "profile": {"name": "Alwar", "goals": "calm clarity"},
                "personality": {"personality_type": "INTJ"},
                "recent_moods": ["calm", "tired"],
            },
            headers=HEADERS, timeout=60,
        )
        assert r.status_code == 200, r.text
        reply = r.json()["reply"]
        assert isinstance(reply, str) and len(reply) > 0
        # Identity check (no AI/assistant phrases)
        bad = ["as an ai", "as an assistant", "i am an ai", "i'm an ai", "language model"]
        low = reply.lower()
        for phrase in bad:
            assert phrase not in low, f"Identity leak: '{phrase}' in reply: {reply}"

        after = self._snapshot(user_id)
        assert before == after, f"chat-stateless wrote DB! {before} → {after}"

    def test_chat_stateless_empty_rejected(self):
        r = requests.post(f"{BASE_URL}/api/ai/chat-stateless", json={"message": "  "}, headers=HEADERS, timeout=15)
        assert r.status_code == 400

    def test_recap_stateless_no_writes(self, user_id):
        before = self._snapshot(user_id)
        items = [
            {"transcription": "Walked 5km in the morning, felt awake."},
            {"transcription": "Met friend for coffee, laughed a lot."},
            {"detail": "Read 20 pages of a book before bed."},
        ]
        r = requests.post(f"{BASE_URL}/api/ai/recap-stateless", json={"items": items}, headers=HEADERS, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d.get("summary"), str) and len(d["summary"]) > 0
        after = self._snapshot(user_id)
        assert before == after, f"recap-stateless wrote DB! {before} → {after}"

    def test_daily_prompt_pick_no_writes(self, user_id):
        before = self._snapshot(user_id)
        r = requests.get(f"{BASE_URL}/api/ai/daily-prompt-pick?personality_type=INTJ", headers=HEADERS, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("text")
        assert d.get("type")
        after = self._snapshot(user_id)
        assert before == after

    def test_transcribe_empty_audio_rejected(self):
        files = {"audio": ("empty.webm", b"", "audio/webm")}
        r = requests.post(f"{BASE_URL}/api/ai/transcribe", files=files, headers=HEADERS, timeout=30)
        assert r.status_code == 400

    def test_unauth_stateless(self):
        r = requests.post(f"{BASE_URL}/api/ai/categorize", json={"text": "hi"}, timeout=15)
        assert r.status_code == 401
        r2 = requests.post(f"{BASE_URL}/api/ai/chat-stateless", json={"message": "hi"}, timeout=15)
        assert r2.status_code == 401


# ============== Existing endpoints still work ==============
class TestExistingCloudEndpointsRegression:
    def test_notes_text_still_writes(self, user_id):
        before = count_docs("journal_items", user_id)
        r = requests.post(
            f"{BASE_URL}/api/notes/text",
            json={"text": "TEST_regression text note from iter3"},
            headers=HEADERS, timeout=60,
        )
        assert r.status_code == 200, r.text
        after = count_docs("journal_items", user_id)
        assert after > before

    def test_timeline_returns_list(self):
        r = requests.get(f"{BASE_URL}/api/timeline", headers=HEADERS, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_profile_get_put(self):
        r = requests.get(f"{BASE_URL}/api/profile", headers=HEADERS, timeout=15)
        assert r.status_code == 200
        r2 = requests.put(f"{BASE_URL}/api/profile", json={"name": "TEST_Alwar"}, headers=HEADERS, timeout=15)
        assert r2.status_code == 200

    def test_personality_assess_writes(self, user_id):
        before = count_docs("personality_assessments", user_id)
        scores = {"E": 5, "I": 3, "S": 6, "N": 2, "T": 3, "F": 5, "J": 3, "P": 5}
        r = requests.post(
            f"{BASE_URL}/api/personality/assess",
            json={"scores": scores}, headers=HEADERS, timeout=120,
        )
        assert r.status_code == 200
        after = count_docs("personality_assessments", user_id)
        assert after > before

    def test_ai_chat_writes(self, user_id):
        # clear first
        requests.delete(f"{BASE_URL}/api/ai/messages", headers=HEADERS, timeout=15)
        before = count_docs("ai_messages", user_id)
        r = requests.post(f"{BASE_URL}/api/ai/chat", json={"message": "TEST_iter3"}, headers=HEADERS, timeout=60)
        assert r.status_code == 200
        after = count_docs("ai_messages", user_id)
        assert after >= before + 2

    def test_daily_prompt_today(self):
        r = requests.get(f"{BASE_URL}/api/daily-prompt", headers=HEADERS, timeout=15)
        assert r.status_code == 200
        assert r.json().get("prompt_text")

    def test_recap_today(self):
        r = requests.post(f"{BASE_URL}/api/recap/today", headers=HEADERS, timeout=120)
        assert r.status_code == 200, r.text
        assert r.json().get("summary")
