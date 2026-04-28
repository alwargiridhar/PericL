"""End-to-end backend tests for PericL backend (FastAPI + Mongo).

Covers:
- Health: GET /api/
- Auth gate: GET /api/auth/me (401 without, 200 with Bearer)
- Text note creation + AI categorization
- Timeline retrieval & sort order
- Item PATCH/DELETE
- Daily recap
- Voice note upload + audio retrieval
"""
import io
import os
import time
import wave

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://pericl-staging.preview.emergentagent.com").rstrip("/")
TOKEN = os.environ.get("PERICL_TEST_TOKEN", "test_sess_1777379746360")
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(scope="session")
def created_state():
    """Shared mutable state across tests."""
    return {}


# ---------------------------- Health ----------------------------
def test_health_root():
    r = requests.get(f"{BASE_URL}/api/", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "ok"
    assert body.get("service") == "pericl"


# ---------------------------- Auth ----------------------------
def test_auth_me_unauthenticated():
    r = requests.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 401


def test_auth_me_with_bearer():
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=HEADERS, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["user_id"] == "test-user-pericl-1777377818066"
    assert data["email"] == "alwar@test.local"
    assert data["name"] == "Alwar Test"


# ---------------------------- Text note ----------------------------
def test_create_text_note_with_extracted(created_state):
    payload = {
        "text": "Remind me to call mom tomorrow at 6pm. Pick up groceries: milk, eggs. Idea: balcony garden."
    }
    r = requests.post(
        f"{BASE_URL}/api/notes/text", json=payload, headers=HEADERS, timeout=120
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "note" in data and "extracted" in data
    note = data["note"]
    assert note["type"] == "text"
    assert note["id"].startswith("note_")
    assert note["detail"] == payload["text"]

    extracted = data["extracted"]
    assert isinstance(extracted, list)
    # Expect at least one of each type — but be lenient: at least 1 extracted
    assert len(extracted) >= 1, f"Expected extracted items, got: {extracted}"
    types = {it["type"] for it in extracted}
    # At minimum, model should produce reminder/task/idea — log for debugging
    print(f"Extracted types: {types}")
    # We assert at least one is reminder OR task OR idea
    assert types & {"reminder", "task", "idea"}, f"Missing structured types: {types}"

    created_state["note_id"] = note["id"]
    created_state["extracted_ids"] = [e["id"] for e in extracted]
    # Find a task or reminder for PATCH/DELETE test
    task_like = next((e for e in extracted if e["type"] in ("task", "reminder")), None)
    if task_like:
        created_state["task_id"] = task_like["id"]


# ---------------------------- Timeline ----------------------------
def test_timeline_returns_items(created_state):
    r = requests.get(f"{BASE_URL}/api/timeline", headers=HEADERS, timeout=30)
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list)
    assert len(items) >= 1

    # Sorted desc by created_at
    timestamps = [i["created_at"] for i in items if i.get("created_at")]
    assert timestamps == sorted(timestamps, reverse=True), "Timeline not sorted desc"

    # Must contain the just-created note
    note_id = created_state.get("note_id")
    if note_id:
        ids = {i["id"] for i in items}
        assert note_id in ids, f"Created note {note_id} missing from timeline"


# ---------------------------- PATCH item ----------------------------
def test_patch_item_complete(created_state):
    task_id = created_state.get("task_id")
    if not task_id:
        # Fall back: pick any extracted id
        eids = created_state.get("extracted_ids", [])
        if not eids:
            pytest.skip("No extracted item available")
        task_id = eids[0]

    r = requests.patch(
        f"{BASE_URL}/api/items/{task_id}",
        json={"completed": True},
        headers=HEADERS,
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["completed"] is True
    assert data["id"] == task_id


def test_patch_item_invalid_field():
    r = requests.patch(
        f"{BASE_URL}/api/items/nonexistent",
        json={"foo": "bar"},
        headers=HEADERS,
        timeout=15,
    )
    assert r.status_code == 400


def test_patch_item_not_found():
    r = requests.patch(
        f"{BASE_URL}/api/items/nonexistent_id_xyz",
        json={"completed": True},
        headers=HEADERS,
        timeout=15,
    )
    assert r.status_code == 404


# ---------------------------- DELETE item ----------------------------
def test_delete_extracted_item(created_state):
    eids = created_state.get("extracted_ids", [])
    if not eids:
        pytest.skip("Nothing to delete")
    # Delete the last extracted (avoid the one we just patched)
    target = eids[-1]
    r = requests.delete(
        f"{BASE_URL}/api/items/{target}", headers=HEADERS, timeout=15
    )
    assert r.status_code == 200
    # Verify removed from timeline
    tl = requests.get(f"{BASE_URL}/api/timeline", headers=HEADERS, timeout=15).json()
    assert target not in {i["id"] for i in tl}


# ---------------------------- Recap ----------------------------
def test_recap_today():
    r = requests.post(f"{BASE_URL}/api/recap/today", headers=HEADERS, timeout=120)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data.get("summary"), str)
    assert len(data["summary"]) > 0
    assert data["voice_count"] >= 0
    assert data["task_count"] >= 0
    assert data["reminder_count"] >= 0
    assert data["idea_count"] >= 0
    assert data["recap_date"]
    assert data["id"].startswith("recap_")


# ---------------------------- Voice note + audio ----------------------------
def _make_silent_wav(seconds: float = 1.0, sample_rate: int = 16000) -> bytes:
    bio = io.BytesIO()
    n = int(seconds * sample_rate)
    with wave.open(bio, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x00" * n)
    return bio.getvalue()


def test_voice_note_upload_and_audio_stream(created_state):
    wav_bytes = _make_silent_wav(1.0)
    files = {"audio": ("test.wav", wav_bytes, "audio/wav")}
    data = {"duration": "1.0", "transcription": "I'm feeling pretty focused today."}
    r = requests.post(
        f"{BASE_URL}/api/notes/voice",
        files=files,
        data=data,
        headers=HEADERS,
        timeout=120,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    note = body["note"]
    assert note["type"] == "voice"
    assert note["audio_id"], "No audio_id returned"
    assert note["transcription"] == "I'm feeling pretty focused today."

    audio_id = note["audio_id"]
    created_state["audio_id"] = audio_id

    # Stream audio back
    r2 = requests.get(
        f"{BASE_URL}/api/audio/{audio_id}", headers=HEADERS, timeout=30
    )
    assert r2.status_code == 200
    assert len(r2.content) == len(wav_bytes)


def test_voice_note_empty_audio_rejected():
    files = {"audio": ("empty.wav", b"", "audio/wav")}
    data = {"duration": "0.0", "transcription": ""}
    r = requests.post(
        f"{BASE_URL}/api/notes/voice",
        files=files,
        data=data,
        headers=HEADERS,
        timeout=15,
    )
    assert r.status_code == 400


def test_text_note_empty_rejected():
    r = requests.post(
        f"{BASE_URL}/api/notes/text",
        json={"text": "  "},
        headers=HEADERS,
        timeout=15,
    )
    assert r.status_code == 400


def test_audio_not_found():
    r = requests.get(
        f"{BASE_URL}/api/audio/aud_doesnotexist", headers=HEADERS, timeout=15
    )
    assert r.status_code == 404
