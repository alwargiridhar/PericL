"""PericL backend — Personal Voice Journal with AI categorization.

Stack: FastAPI + MongoDB. Auth via Emergent Managed Google.
Transcription: OpenAI Whisper. Categorization: GPT-5.2. Daily recap: Gemini 3 Flash.
"""
import asyncio
import base64
import io
import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

import httpx
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.llm.openai import OpenAISpeechToText
from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")

# Mongo
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("pericl")

app = FastAPI(title="PericL API")
api = APIRouter(prefix="/api")


SUPER_ADMIN_EMAIL = "alwargiridhar@gmail.com"

# ---------------------------- Models ----------------------------
class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: str | None = None
    role: str = "user"  # "user" | "admin" | "super_admin"
    created_at: datetime


ItemType = Literal["voice", "text", "task", "reminder", "idea"]
Priority = Literal["low", "medium", "high"]


class JournalItem(BaseModel):
    id: str
    user_id: str
    type: ItemType
    title: str
    detail: str | None = None
    audio_id: str | None = None
    duration: float | None = None
    transcription: str | None = None
    summary: str | None = None
    priority: Priority | None = None
    due_at: datetime | None = None
    completed: bool = False
    parent_id: str | None = None  # links extracted item to source note
    mood: str | None = None
    created_at: datetime


class TextNoteIn(BaseModel):
    text: str


class MbtiScores(BaseModel):
    E: int = Field(ge=0, default=0)
    I: int = Field(ge=0, default=0)  # noqa: E741 — MBTI letter
    S: int = Field(ge=0, default=0)
    N: int = Field(ge=0, default=0)
    T: int = Field(ge=0, default=0)
    F: int = Field(ge=0, default=0)
    J: int = Field(ge=0, default=0)
    P: int = Field(ge=0, default=0)


class RecapOut(BaseModel):
    id: str
    user_id: str
    recap_date: str
    summary: str
    voice_count: int
    task_count: int
    reminder_count: int
    idea_count: int
    created_at: datetime


# ---------------------------- Auth ----------------------------
async def get_current_user(request: Request) -> User:
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=401, detail="Invalid session")

    expires_at = sess["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")

    user_doc = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    if isinstance(user_doc.get("created_at"), str):
        user_doc["created_at"] = datetime.fromisoformat(user_doc["created_at"])
    user_doc.setdefault("role", "user")

    async def _touch():
        try:
            await db.users.update_one(
                {"user_id": user_doc["user_id"]},
                {"$set": {"last_seen_at": datetime.now(timezone.utc).isoformat()}},
            )
        except Exception:
            pass
    asyncio.create_task(_touch())
    return User(**{k: user_doc[k] for k in ("user_id", "email", "name", "picture", "role", "created_at") if k in user_doc})


def _ensure_role(user: User, *, allowed: tuple[str, ...]):
    if user.role not in allowed:
        raise HTTPException(status_code=403, detail="Not authorized")


async def get_admin_user(user: User = Depends(get_current_user)) -> User:
    _ensure_role(user, allowed=("admin", "super_admin"))
    return user


async def get_super_admin_user(user: User = Depends(get_current_user)) -> User:
    _ensure_role(user, allowed=("super_admin",))
    return user


@api.post("/auth/process-session")
async def process_session(request: Request, response: Response):
    """Exchange session_id (from URL fragment) for a 7-day session_token cookie."""
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id")

    async with httpx.AsyncClient(timeout=10.0) as http:
        r = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Failed to verify session")
    data = r.json()
    email = data["email"]
    name = data["name"]
    picture = data.get("picture")
    session_token = data["session_token"]

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    role = "super_admin" if email.lower() == SUPER_ADMIN_EMAIL.lower() else (existing or {}).get("role", "user")
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture, "role": role}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
                "role": role,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    expires = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one(
        {
            "user_id": user_id,
            "session_token": session_token,
            "expires_at": expires.isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )

    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 3600,
        path="/",
        httponly=True,
        secure=True,
        samesite="none",
    )
    return {
        "user_id": user_id,
        "email": email,
        "name": name,
        "picture": picture,
        "role": role,
    }


@api.get("/auth/me")
async def auth_me(user: User = Depends(get_current_user)):
    return user.model_dump(mode="json")


@api.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ---------------------------- AI helpers ----------------------------
CATEGORIZATION_SYSTEM = (
    "You are the user's quiet inner voice — their private mirror. They just spoke or typed a thought to themselves. "
    "Read it as if it were your own thought. Return ONLY a JSON object with this shape: "
    '{"summary": str (1 short sentence summarizing what they said, written second-person warmly), '
    '"mood": one of ["calm","happy","stressed","sad","excited","focused","neutral"], '
    '"items": [ { "type": "task" | "reminder" | "idea" | "note", "title": str, '
    '"priority": "low"|"medium"|"high", "due_at": ISO8601 or null } ] } . '
    "Rules: extract distinct actionable units. A 'reminder' has a date/time the user wants to be reminded. "
    "A 'task' is a TODO with no specific time. An 'idea' is a thought worth saving. "
    "If the message is purely emotional/reflective, return items=[] (it remains a journal note). "
    "If they say 'tomorrow at 6pm', resolve to ISO8601 in UTC based on the provided current_time. "
    "Keep titles concise (max 80 chars). NEVER include text outside JSON. NEVER mention being an assistant or AI."
)


async def categorize(text: str) -> dict:
    if not text or not text.strip():
        return {"summary": None, "mood": "neutral", "items": []}
    now_iso = datetime.now(timezone.utc).isoformat()
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"cat-{uuid.uuid4().hex[:8]}",
        system_message=CATEGORIZATION_SYSTEM,
    ).with_model("openai", "gpt-5.2")
    msg = UserMessage(text=f"current_time: {now_iso}\n\nUser said: {text}")
    try:
        raw = await chat.send_message(msg)
    except Exception as e:
        logger.warning("categorize llm error: %s", e)
        return {"summary": None, "mood": "neutral", "items": []}

    # Extract JSON robustly
    raw = raw.strip()
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return {"summary": None, "mood": "neutral", "items": []}
    try:
        data = json.loads(m.group(0))
    except Exception:
        return {"summary": None, "mood": "neutral", "items": []}
    return data


async def transcribe_audio(audio_bytes: bytes, filename: str) -> str:
    stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
    bio = io.BytesIO(audio_bytes)
    bio.name = filename or "audio.webm"
    try:
        resp = await stt.transcribe(file=bio, model="whisper-1", response_format="json")
        return (resp.text or "").strip()
    except Exception as e:
        logger.warning("whisper error: %s", e)
        return ""


# ---------------------------- Helpers ----------------------------
def parse_dt(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except Exception:
            return None
    return None


def serialize_item(doc: dict) -> dict:
    out = {
        "id": doc["id"],
        "user_id": doc["user_id"],
        "type": doc["type"],
        "title": doc.get("title"),
        "detail": doc.get("detail"),
        "audio_id": doc.get("audio_id"),
        "duration": doc.get("duration"),
        "transcription": doc.get("transcription"),
        "summary": doc.get("summary"),
        "priority": doc.get("priority"),
        "due_at": doc.get("due_at"),
        "completed": doc.get("completed", False),
        "parent_id": doc.get("parent_id"),
        "mood": doc.get("mood"),
        "created_at": doc.get("created_at"),
    }
    return out


async def persist_extracted(parent_id: str, user_id: str, ai: dict) -> list[dict]:
    """Save AI-extracted items as standalone JournalItems. Returns inserted docs."""
    inserted: list[dict] = []
    for it in (ai or {}).get("items", []) or []:
        t = it.get("type")
        if t not in ("task", "reminder", "idea"):
            continue
        title = (it.get("title") or "").strip()
        if not title:
            continue
        due = parse_dt(it.get("due_at"))
        doc = {
            "id": f"item_{uuid.uuid4().hex[:12]}",
            "user_id": user_id,
            "type": t,
            "title": title[:200],
            "priority": it.get("priority") if it.get("priority") in ("low", "medium", "high") else None,
            "due_at": due.isoformat() if due else None,
            "completed": False,
            "parent_id": parent_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.journal_items.insert_one(doc)
        inserted.append(doc)
    return inserted


# ---------------------------- Notes endpoints ----------------------------
@api.post("/notes/voice")
async def create_voice_note(
    audio: UploadFile = File(...),
    duration: float = Form(0.0),
    transcription: str = Form(""),
    user: User = Depends(get_current_user),
):
    audio_bytes = await audio.read()
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty audio")

    # Save audio (base64 in mongo - fine for short voice notes)
    audio_id = f"aud_{uuid.uuid4().hex[:12]}"
    await db.audio_blobs.insert_one(
        {
            "audio_id": audio_id,
            "user_id": user.user_id,
            "content_type": audio.content_type or "audio/webm",
            "data_b64": base64.b64encode(audio_bytes).decode(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )

    # Transcribe (use client transcription as fallback)
    text = transcription.strip()
    if not text:
        text = await transcribe_audio(audio_bytes, audio.filename or "audio.webm")

    ai = await categorize(text)

    note_id = f"note_{uuid.uuid4().hex[:12]}"
    note_doc = {
        "id": note_id,
        "user_id": user.user_id,
        "type": "voice",
        "title": (ai.get("summary") or text[:80]) if text else "Voice note",
        "audio_id": audio_id,
        "duration": float(duration or 0),
        "transcription": text,
        "summary": ai.get("summary"),
        "mood": ai.get("mood"),
        "completed": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.journal_items.insert_one(note_doc)

    extracted = await persist_extracted(note_id, user.user_id, ai)

    return {
        "note": serialize_item(note_doc),
        "extracted": [serialize_item(e) for e in extracted],
    }


@api.post("/notes/text")
async def create_text_note(payload: TextNoteIn, user: User = Depends(get_current_user)):
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    ai = await categorize(text)

    note_id = f"note_{uuid.uuid4().hex[:12]}"
    note_doc = {
        "id": note_id,
        "user_id": user.user_id,
        "type": "text",
        "title": ai.get("summary") or text[:80],
        "detail": text,
        "summary": ai.get("summary"),
        "mood": ai.get("mood"),
        "completed": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.journal_items.insert_one(note_doc)
    extracted = await persist_extracted(note_id, user.user_id, ai)

    return {
        "note": serialize_item(note_doc),
        "extracted": [serialize_item(e) for e in extracted],
    }


@api.get("/timeline")
async def get_timeline(user: User = Depends(get_current_user)):
    cursor = db.journal_items.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).limit(500)
    items = await cursor.to_list(length=500)
    return [serialize_item(i) for i in items]


@api.patch("/items/{item_id}")
async def update_item(item_id: str, payload: dict, user: User = Depends(get_current_user)):
    allowed = {k: v for k, v in payload.items() if k in {"completed", "title", "due_at", "priority"}}
    if not allowed:
        raise HTTPException(status_code=400, detail="No valid fields")
    if "due_at" in allowed and allowed["due_at"]:
        d = parse_dt(allowed["due_at"])
        allowed["due_at"] = d.isoformat() if d else None
    res = await db.journal_items.update_one(
        {"id": item_id, "user_id": user.user_id}, {"$set": allowed}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    doc = await db.journal_items.find_one({"id": item_id, "user_id": user.user_id}, {"_id": 0})
    return serialize_item(doc)


@api.delete("/items/{item_id}")
async def delete_item(item_id: str, user: User = Depends(get_current_user)):
    await db.journal_items.delete_one({"id": item_id, "user_id": user.user_id})
    return {"ok": True}


@api.get("/audio/{audio_id}")
async def get_audio(audio_id: str, user: User = Depends(get_current_user)):
    blob = await db.audio_blobs.find_one(
        {"audio_id": audio_id, "user_id": user.user_id}, {"_id": 0}
    )
    if not blob:
        raise HTTPException(status_code=404, detail="Not found")
    raw = base64.b64decode(blob["data_b64"])
    return StreamingResponse(io.BytesIO(raw), media_type=blob.get("content_type", "audio/webm"))


# ---------------------------- Daily recap ----------------------------
@api.post("/recap/today")
async def make_recap(user: User = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    cursor = db.journal_items.find(
        {"user_id": user.user_id, "created_at": {"$gte": day_start.isoformat()}},
        {"_id": 0},
    )
    items = await cursor.to_list(length=500)
    if not items:
        raise HTTPException(status_code=400, detail="No entries today yet")

    voices = [i for i in items if i["type"] in ("voice", "text")]
    tasks = [i for i in items if i["type"] == "task"]
    reminders = [i for i in items if i["type"] == "reminder"]
    ideas = [i for i in items if i["type"] == "idea"]

    bullet_lines = []
    for v in voices[:30]:
        line = v.get("transcription") or v.get("detail") or v.get("title") or ""
        if line:
            bullet_lines.append(f"- {line[:240]}")
    transcript_blob = "\n".join(bullet_lines) or "(no detailed entries)"

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"recap-{user.user_id}-{day_start.date().isoformat()}",
        system_message=(
            "You are the user's own reflective voice — read their day's notes and write a 4-6 sentence recap "
            "speaking AS them, TO them. Warm, second-person, specific. No bullet points. Plain text. "
            "Never mention being an AI or assistant."
        ),
    ).with_model("gemini", "gemini-3-flash-preview")
    try:
        summary = await chat.send_message(UserMessage(text=transcript_blob))
        summary = summary.strip()
    except Exception as e:
        logger.warning("recap error: %s", e)
        summary = "Today you captured a few thoughts. Keep going — small entries compound into a clearer mind."

    recap = {
        "id": f"recap_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "recap_date": day_start.date().isoformat(),
        "summary": summary,
        "voice_count": len(voices),
        "task_count": len(tasks),
        "reminder_count": len(reminders),
        "idea_count": len(ideas),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.daily_recaps.insert_one(dict(recap))
    return recap


@api.get("/recap")
async def list_recaps(user: User = Depends(get_current_user)):
    cursor = db.daily_recaps.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).limit(30)
    return await cursor.to_list(length=30)


# ---------------------------- Profile (Personality Builder) ----------------------------
PROFILE_FIELDS = [
    "name", "age", "occupation", "goals", "challenges",
    "personality_traits", "communication_style", "energy_level",
    "motivation_triggers", "core_values", "aspirations",
]


@api.get("/profile")
async def get_profile(user: User = Depends(get_current_user)):
    doc = await db.user_profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    if not doc:
        return {"user_id": user.user_id, **{f: None for f in PROFILE_FIELDS}, "onboarding_completed": False}
    doc.pop("created_at", None)
    return doc


@api.put("/profile")
async def update_profile(payload: dict, user: User = Depends(get_current_user)):
    update = {k: v for k, v in payload.items() if k in PROFILE_FIELDS}
    existing = await db.user_profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    merged = {**(existing or {}), **update}
    completed = bool(existing and existing.get("onboarding_completed")) or any(
        merged.get(f) for f in ("name", "goals", "core_values", "aspirations")
    )
    update["onboarding_completed"] = completed
    update["user_id"] = user.user_id
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.user_profiles.update_one(
        {"user_id": user.user_id},
        {"$set": update, "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    doc = await db.user_profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    return doc


# ---------------------------- Personality (MBTI) ----------------------------
MBTI_NAMES = {
    "ISTJ": "The Inspector", "ISFJ": "The Protector", "INFJ": "The Counselor",
    "INTJ": "The Mastermind", "ISTP": "The Craftsperson", "ISFP": "The Composer",
    "INFP": "The Healer", "INTP": "The Architect", "ESTP": "The Dynamo",
    "ESFP": "The Performer", "ENFP": "The Champion", "ENTP": "The Visionary",
    "ESTJ": "The Supervisor", "ESFJ": "The Provider", "ENFJ": "The Teacher",
    "ENTJ": "The Commander",
}


def compute_mbti(scores: dict) -> str:
    s = {k: int(scores.get(k, 0)) for k in "EISNTFJP"}
    return (
        ("E" if s["E"] >= s["I"] else "I")
        + ("S" if s["S"] >= s["N"] else "N")
        + ("T" if s["T"] >= s["F"] else "F")
        + ("J" if s["J"] >= s["P"] else "P")
    )


async def ai_personality_analysis(mbti_type: str, profile: dict | None) -> dict:
    """Use GPT-5.2 to generate a personalized description + strengths + growth areas as JSON."""
    name = (profile or {}).get("name") or "this person"
    goals = (profile or {}).get("goals") or "(not provided)"
    challenges = (profile or {}).get("challenges") or "(not provided)"
    sys = (
        "You are the user's own reflective voice writing back to them. Given a personality type and (optional) profile, "
        "return ONLY JSON: {\"description\": str (2-3 sentences in second-person warm voice, as if they are reading their own self-portrait), "
        "\"strengths\": [str, str, str, str] (concise, framed as 'You are...' qualities), "
        "\"growth_areas\": [str, str, str, str] (concise, framed as gentle pushes from yourself, NOT criticisms) }. "
        "Never mention being an AI or assistant."
    )
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"mbti-{uuid.uuid4().hex[:8]}", system_message=sys).with_model("openai", "gpt-5.2")
    msg = UserMessage(text=f"MBTI: {mbti_type} ({MBTI_NAMES.get(mbti_type, '')})\nName: {name}\nGoals: {goals}\nChallenges: {challenges}")
    try:
        raw = (await chat.send_message(msg)).strip()
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            return json.loads(m.group(0))
    except Exception as e:
        logger.warning("mbti analysis fallback: %s", e)
    return {
        "description": f"You are {mbti_type} — {MBTI_NAMES.get(mbti_type, 'a unique mix of traits')}.",
        "strengths": [],
        "growth_areas": [],
    }


@api.post("/personality/assess")
async def submit_assessment(payload: dict, user: User = Depends(get_current_user)):
    try:
        scores = MbtiScores(**(payload.get("scores") or {})).model_dump()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid scores: {e}")
    mbti = compute_mbti(scores)
    profile = await db.user_profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    analysis = await ai_personality_analysis(mbti, profile)
    rec = {
        "id": f"pa_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "personality_type": mbti,
        "type_name": MBTI_NAMES.get(mbti, ""),
        "description": analysis.get("description", ""),
        "strengths": analysis.get("strengths", []),
        "growth_areas": analysis.get("growth_areas", []),
        "scores": {k: int(scores.get(k, 0)) for k in "EISNTFJP"},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.personality_assessments.insert_one(dict(rec))
    return rec


@api.get("/personality/latest")
async def latest_assessment(user: User = Depends(get_current_user)):
    doc = await db.personality_assessments.find_one(
        {"user_id": user.user_id}, {"_id": 0}, sort=[("created_at", -1)]
    )
    if not doc:
        return {"hasAssessment": False}
    return {"hasAssessment": True, "assessment": doc}


@api.get("/personality/result/{assessment_id}")
async def get_assessment(assessment_id: str, user: User = Depends(get_current_user)):
    doc = await db.personality_assessments.find_one(
        {"id": assessment_id, "user_id": user.user_id}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return doc


# ---------------------------- AI Chat (the Mirror) ----------------------------
def _parse_top_goals(goals_text: str | None) -> list[str]:
    """Best-effort extract up to 3 distinct top goals from the user's free-text goals field."""
    if not goals_text:
        return []
    # Split by newlines, then by bullets / numbered prefixes / sentence breaks
    lines = [ln.strip() for ln in re.split(r"[\n;]+", goals_text) if ln.strip()]
    if len(lines) < 2:
        # try splitting by sentence
        lines = [s.strip() for s in re.split(r"(?<=[.!?])\s+", goals_text) if s.strip()]
    cleaned: list[str] = []
    for ln in lines:
        ln = re.sub(r"^[\-•\*\d\.\)\s]+", "", ln).strip()
        if ln:
            cleaned.append(ln[:160])
        if len(cleaned) >= 3:
            break
    return cleaned


def _compute_behavior_signals_from_items(items: list[dict]) -> dict:
    """Compute drift/effort signals from journal items (any mode)."""
    now = datetime.now(timezone.utc)
    seven_days_ago = now - timedelta(days=7)
    voice_text_7d = 0
    completed_7d = 0
    missed_overdue = 0
    open_tasks = 0
    open_reminders_overdue: list[dict] = []
    moods: list[str] = []
    last_entry_at: datetime | None = None

    for it in items or []:
        ca = parse_dt(it.get("created_at"))
        if not ca:
            continue
        t = it.get("type")
        if t in ("voice", "text"):
            if ca >= seven_days_ago:
                voice_text_7d += 1
            if not last_entry_at or ca > last_entry_at:
                last_entry_at = ca
            m = it.get("mood")
            if m:
                moods.append(m)
        if t == "task":
            if it.get("completed"):
                if ca >= seven_days_ago:
                    completed_7d += 1
            else:
                open_tasks += 1
        if t == "reminder" and not it.get("completed"):
            due = parse_dt(it.get("due_at"))
            if due and due < now:
                missed_overdue += 1
                open_reminders_overdue.append({
                    "title": it.get("title"),
                    "due_at": it.get("due_at"),
                })

    days_since_last = None
    if last_entry_at:
        days_since_last = (now - last_entry_at).days

    # Top moods (most common)
    mood_counts: dict[str, int] = {}
    for m in moods:
        mood_counts[m] = mood_counts.get(m, 0) + 1
    sorted_moods = sorted(mood_counts.items(), key=lambda x: -x[1])
    top_moods = [m for m, _ in sorted_moods[:3]]

    return {
        "voice_text_entries_7d": voice_text_7d,
        "tasks_completed_7d": completed_7d,
        "open_tasks": open_tasks,
        "missed_or_overdue_reminders": missed_overdue,
        "overdue_titles": [o["title"] for o in open_reminders_overdue[:5]],
        "days_since_last_entry": days_since_last,
        "top_moods_7d": top_moods,
    }


def _build_chat_system_message(
    profile: dict | None,
    personality: dict | None,
    recent_moods: list[str],
    behavior: dict | None = None,
    current_mood: str | None = None,
) -> str:
    top_goals = _parse_top_goals((profile or {}).get("goals"))
    identity = (profile or {}).get("aspirations") or ""
    name = (profile or {}).get("name") or ""

    # Core identity prompt — verbatim mirror spec from the user.
    parts = [
        "You are PericL — a personal mirror, not an assistant.",
        "Your role is to help the user convert thoughts into clear action, track their real progress toward their goals, "
        "and gently but honestly confront gaps between intention and behavior.",
        "You must always feel like: the user's own voice, slightly calmer, slightly more honest, slightly more disciplined. "
        "Never sound like a generic AI. Never say 'as an AI' or 'as an assistant'.",
        "",
        "## YOUR JOB (always 4 steps)",
        "1) CLARIFY — sharpen what the user actually means, not just what they say.",
        "2) MIRROR — match their tone, sentence length, and style; remove confusion, reduce excuses, increase clarity.",
        "3) REALITY CHECK — compare goals vs actual behavior. If mismatch, point it out calmly: 'You said this matters, but you haven't worked on it in days.' Never harsh. Never fake-positive.",
        "4) DIRECT — end with EXACTLY ONE next move, < 15 minutes, specific, aligned to a top goal.",
        "",
        "## DRIFT DETECTION",
        "If repeated avoidance, low-effort, inconsistency: say 'You're drifting from what you said matters.' Then guide back with a small action.",
        "",
        "## TIME REALITY ENGINE",
        "If the current effort rate cannot reach a goal in 90 days, say so plainly. Offer: increase effort OR reduce scope.",
        "",
        "## MOOD-AWARE TONE",
        "If LOW mood (sad/stressed): softer tone, smaller next step.",
        "If HIGH energy (excited/happy/focused): push slightly harder, slightly more challenging action.",
        "",
        "## NEVER",
        "- No long lectures, no multiple action steps, no coach/therapist voice, no over-motivation, no ignoring inconsistencies, no markdown headings, no bullet lists in the body.",
        "",
        "## RESPONSE STRUCTURE (mandatory, in this exact order)",
        "1. A short reflection (1-2 sentences mirroring their thought).",
        "2. A reality insight (only if needed — 1 sentence calling out drift, mismatch, or pace).",
        "3. A direction sentence (where they should go next).",
        "4. A blank line, then exactly: '🎯 Next Move: <one specific action under 15 minutes>'.",
        "Keep total length tight — under ~100 words.",
    ]

    # Structured context inputs
    ctx = ["", "## CONTEXT INPUTS"]
    if name:
        ctx.append(f"- name: {name}")
    if identity:
        ctx.append(f"- identity (who they want to become): {identity}")
    if top_goals:
        ctx.append("- top goals (use these to anchor the next move):")
        for i, g in enumerate(top_goals, 1):
            ctx.append(f"    {i}. {g}")
    # other helpful profile bits
    if profile:
        for f in ("occupation", "challenges", "core_values",
                  "communication_style", "energy_level", "motivation_triggers", "personality_traits"):
            v = profile.get(f)
            if v:
                ctx.append(f"- {f}: {v}")
    if personality:
        pt = personality.get("personality_type")
        if pt:
            ctx.append(
                f"- MBTI: {pt} ({personality.get('type_name','')}); "
                f"strengths: {', '.join(personality.get('strengths') or [])[:240]}; "
                f"growth areas: {', '.join(personality.get('growth_areas') or [])[:240]}."
            )

    # Behavior signals (last 7 days)
    if behavior:
        b = behavior
        ctx.append("- behavior (last 7 days):")
        ctx.append(f"    journal entries: {b.get('voice_text_entries_7d', 0)}")
        ctx.append(f"    tasks completed: {b.get('tasks_completed_7d', 0)}")
        ctx.append(f"    tasks still open: {b.get('open_tasks', 0)}")
        ctx.append(f"    overdue reminders: {b.get('missed_or_overdue_reminders', 0)}")
        if b.get("overdue_titles"):
            ctx.append(f"    overdue titles: {', '.join(b['overdue_titles'])}")
        dsle = b.get("days_since_last_entry")
        if dsle is not None:
            ctx.append(f"    days since last entry: {dsle}")
        if b.get("top_moods_7d"):
            ctx.append(f"    top moods (7d): {', '.join(b['top_moods_7d'])}")

    if recent_moods:
        ctx.append(f"- recent moods (most recent first): {', '.join(recent_moods[:5])}")
    if current_mood:
        ctx.append(f"- current input mood: {current_mood}")

    return "\n".join(parts) + "\n" + "\n".join(ctx)


@api.get("/ai/messages")
async def get_chat_messages(user: User = Depends(get_current_user)):
    cursor = db.ai_messages.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", 1).limit(500)
    return await cursor.to_list(length=500)


@api.post("/ai/chat")
async def chat_send(payload: dict, user: User = Depends(get_current_user)):
    message = (payload.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Empty message")

    # Persist user message
    user_msg = {
        "id": f"m_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "role": "user",
        "content": message,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ai_messages.insert_one(dict(user_msg))

    # Build context
    profile = await db.user_profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    personality_doc = await db.personality_assessments.find_one(
        {"user_id": user.user_id}, {"_id": 0}, sort=[("created_at", -1)]
    )
    recent_journal = await db.journal_items.find(
        {"user_id": user.user_id, "type": {"$in": ["voice", "text"]}},
        {"_id": 0, "mood": 1},
    ).sort("created_at", -1).limit(8).to_list(length=8)
    moods = [j.get("mood") for j in recent_journal if j.get("mood")]

    # Behavior signals from last 14 days of items (covers "missed in last 7d" + slightly older context)
    fourteen_days_ago = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    items_for_signals = await db.journal_items.find(
        {"user_id": user.user_id, "created_at": {"$gte": fourteen_days_ago}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(length=400)
    behavior = _compute_behavior_signals_from_items(items_for_signals)

    # Detect current mood from this message (best-effort, JSON output already)
    current_mood = None
    try:
        ai_quick = await categorize(message)
        current_mood = (ai_quick or {}).get("mood")
    except Exception:
        pass

    sys_msg = _build_chat_system_message(
        profile, personality_doc, moods, behavior=behavior, current_mood=current_mood
    )

    # History — keep last 16 turns for context
    history_cursor = db.ai_messages.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).limit(16)
    hist = list(reversed(await history_cursor.to_list(length=16)))
    convo = ""
    for m in hist[:-1]:  # exclude the user msg we just inserted (it's last)
        prefix = "User" if m["role"] == "user" else "PericL"
        convo += f"{prefix}: {m['content']}\n"
    convo += f"User: {message}"

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"chat-{user.user_id}",
        system_message=sys_msg,
    ).with_model("openai", "gpt-5.2")
    try:
        reply = (await chat.send_message(UserMessage(text=convo))).strip()
    except Exception as e:
        logger.warning("chat error: %s", e)
        reply = "Take a breath. Try that again in a moment.\n\n🎯 Next Move: Write one sentence about what's actually on your mind."

    asst_msg = {
        "id": f"m_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "role": "assistant",
        "content": reply,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ai_messages.insert_one(dict(asst_msg))
    return {"user_message": user_msg, "assistant_message": asst_msg}


@api.delete("/ai/messages")
async def clear_chat(user: User = Depends(get_current_user)):
    await db.ai_messages.delete_many({"user_id": user.user_id})
    return {"ok": True}


@api.delete("/ai/messages/{msg_id}")
async def delete_chat_msg(msg_id: str, user: User = Depends(get_current_user)):
    await db.ai_messages.delete_one({"id": msg_id, "user_id": user.user_id})
    return {"ok": True}


# ---------------------------- Daily Reflection (Personality Developer) ----------------------------
DAILY_PROMPTS = {
    "reflection": [
        "What's one thing you learned about yourself today?",
        "What moment today made you feel most alive?",
        "What challenge did you face today and how did you respond?",
        "What are you grateful for right now?",
        "What pattern in your behavior did you notice today?",
        "What small win can you celebrate today?",
    ],
    "growth": [
        "What's one fear you could face today?",
        "What skill are you working on and what's your next small step?",
        "What's holding you back from your goals right now?",
        "What would you attempt if you knew you couldn't fail?",
        "What's one habit you want to build? What's the smallest version of it?",
    ],
    "values": [
        "What matters most to you right now?",
        "How did you show up as the person you want to be today?",
        "What's a value you hold that you haven't acted on lately?",
        "What's your definition of success right now?",
    ],
    "mindfulness": [
        "What thoughts keep repeating in your mind?",
        "What emotion are you experiencing and where do you feel it?",
        "What would self-compassion look like for you right now?",
    ],
    "action": [
        "What's one action you can take today toward your biggest goal?",
        "What would make today feel like a win?",
        "What procrastination are you ready to address?",
    ],
    "relationships": [
        "Who could you show appreciation for today?",
        "What relationship needs more attention from you?",
        "What do you need to communicate that you've been holding back?",
    ],
}

PERSONALITY_PROMPTS = {
    "I": ["What insights came from your alone time today?", "How did you protect your energy today?"],
    "E": ["How did your interactions energize you today?", "What conversation sparked new ideas?"],
    "S": ["What practical step did you take toward your goals?", "What worked well that you can replicate?"],
    "N": ["What patterns or possibilities did you notice today?", "How does today connect to your bigger vision?"],
    "T": ["What logical problem did you solve today?", "What objective analysis led to a good decision?"],
    "F": ["How did you honor your values today?", "What emotional impact did your actions have?"],
    "J": ["What did you complete today?", "How did your planning pay off?"],
    "P": ["What opportunity did you seize by staying flexible?", "Where did you adapt successfully?"],
}


def _select_prompt(personality_type: str | None) -> dict:
    import random
    if personality_type and random.random() < 0.3:
        all_pp = []
        for ch in personality_type:
            all_pp.extend(PERSONALITY_PROMPTS.get(ch, []))
        if all_pp:
            return {"text": random.choice(all_pp), "type": "personality"}
    cat = random.choice(list(DAILY_PROMPTS.keys()))
    return {"text": random.choice(DAILY_PROMPTS[cat]), "type": cat}


@api.get("/daily-prompt")
async def get_daily_prompt(user: User = Depends(get_current_user)):
    today = datetime.now(timezone.utc).date().isoformat()
    existing = await db.daily_prompts.find_one(
        {"user_id": user.user_id, "prompt_date": today}, {"_id": 0}
    )
    if existing:
        return existing
    pa = await db.personality_assessments.find_one(
        {"user_id": user.user_id}, {"_id": 0}, sort=[("created_at", -1)]
    )
    pt = (pa or {}).get("personality_type")
    pick = _select_prompt(pt)
    doc = {
        "id": f"dp_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "prompt_date": today,
        "prompt_text": pick["text"],
        "prompt_type": pick["type"],
        "response_text": None,
        "is_completed": False,
        "completed_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.daily_prompts.insert_one(dict(doc))
    return doc


@api.post("/daily-prompt/respond")
async def respond_daily_prompt(payload: dict, user: User = Depends(get_current_user)):
    today = datetime.now(timezone.utc).date().isoformat()
    response_text = (payload.get("response") or "").strip()
    if not response_text:
        raise HTTPException(status_code=400, detail="Empty response")
    res = await db.daily_prompts.update_one(
        {"user_id": user.user_id, "prompt_date": today},
        {
            "$set": {
                "response_text": response_text,
                "is_completed": True,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="No prompt for today")
    doc = await db.daily_prompts.find_one(
        {"user_id": user.user_id, "prompt_date": today}, {"_id": 0}
    )
    return doc


@api.get("/daily-prompts/history")
async def daily_prompt_history(user: User = Depends(get_current_user)):
    cursor = db.daily_prompts.find({"user_id": user.user_id}, {"_id": 0}).sort("prompt_date", -1).limit(180)
    return await cursor.to_list(length=180)


@api.delete("/daily-prompts/{prompt_id}")
async def delete_daily_prompt(prompt_id: str, user: User = Depends(get_current_user)):
    await db.daily_prompts.delete_one({"id": prompt_id, "user_id": user.user_id})
    return {"ok": True}


# ---------------------------- Stateless AI (for local-first / private mode) ----------------------------
# These endpoints run AI without persisting any user content server-side.
# Caller passes everything; server returns AI output only.

@api.post("/ai/transcribe")
async def stateless_transcribe(
    audio: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio")
    text = await transcribe_audio(audio_bytes, audio.filename or "audio.webm")
    return {"text": text}


@api.post("/ai/categorize")
async def stateless_categorize(payload: dict, user: User = Depends(get_current_user)):
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")
    ai = await categorize(text)
    return ai


@api.post("/ai/personality-analyze")
async def stateless_personality_analyze(payload: dict, user: User = Depends(get_current_user)):
    try:
        scores = MbtiScores(**(payload.get("scores") or {})).model_dump()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid scores: {e}")
    profile = payload.get("profile") or {}
    mbti = compute_mbti(scores)
    analysis = await ai_personality_analysis(mbti, profile)
    return {
        "personality_type": mbti,
        "type_name": MBTI_NAMES.get(mbti, ""),
        "description": analysis.get("description", ""),
        "strengths": analysis.get("strengths", []),
        "growth_areas": analysis.get("growth_areas", []),
        "scores": {k: int(scores.get(k, 0)) for k in "EISNTFJP"},
    }


@api.post("/ai/chat-stateless")
async def stateless_chat(payload: dict, user: User = Depends(get_current_user)):
    """Caller passes full context: history, profile, personality, recent_moods, behavior, current_mood, message."""
    message = (payload.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Empty message")
    history = payload.get("history") or []  # list of {role,content}
    profile = payload.get("profile") or None
    personality = payload.get("personality") or None
    moods = payload.get("recent_moods") or []
    behavior = payload.get("behavior") or None
    current_mood = payload.get("current_mood") or None

    sys_msg = _build_chat_system_message(
        profile, personality, moods, behavior=behavior, current_mood=current_mood
    )
    convo = ""
    for m in history[-16:]:
        prefix = "User" if m.get("role") == "user" else "PericL"
        convo += f"{prefix}: {m.get('content','')}\n"
    convo += f"User: {message}"

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"chat-stateless-{uuid.uuid4().hex[:8]}",
        system_message=sys_msg,
    ).with_model("openai", "gpt-5.2")
    try:
        reply = (await chat.send_message(UserMessage(text=convo))).strip()
    except Exception as e:
        logger.warning("stateless chat error: %s", e)
        reply = "Take a breath. Try that again in a moment.\n\n🎯 Next Move: Write one sentence about what's actually on your mind."
    return {"reply": reply}


@api.post("/ai/recap-stateless")
async def stateless_recap(payload: dict, user: User = Depends(get_current_user)):
    items = payload.get("items") or []
    # Sort newest-first then take 30 most recent so long days don't lose recency
    try:
        items = sorted(items, key=lambda i: i.get("created_at") or "", reverse=True)
    except Exception:
        pass
    bullet_lines = []
    for v in items[:30]:
        line = v.get("transcription") or v.get("detail") or v.get("title") or ""
        if line:
            bullet_lines.append(f"- {line[:240]}")
    transcript_blob = "\n".join(bullet_lines) or "(no detailed entries)"

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"recap-stateless-{uuid.uuid4().hex[:8]}",
        system_message=(
            "You are the user's own reflective voice — read their day's notes and write a 4-6 sentence recap "
            "speaking AS them, TO them. Warm, second-person, specific. No bullet points. Plain text. "
            "Never mention being an AI or assistant."
        ),
    ).with_model("gemini", "gemini-3-flash-preview")
    try:
        summary = (await chat.send_message(UserMessage(text=transcript_blob))).strip()
    except Exception as e:
        logger.warning("stateless recap error: %s", e)
        summary = "Today you captured a few thoughts. Keep going — small entries compound into a clearer mind."
    return {"summary": summary}


@api.get("/ai/daily-prompt-pick")
async def stateless_pick_prompt(personality_type: str | None = None, user: User = Depends(get_current_user)):
    return _select_prompt(personality_type)


# ---------------------------- Storage Preference (Privacy mode) ----------------------------
# Per-user setting that controls whether we persist user CONTENT server-side.
# Modes: "local" (default — server only stores identity + this pref), "cloud" (full sync), "never" (no monthly nudge).

DEFAULT_STORAGE_MODE = "local"
PROMPT_INTERVAL_DAYS = 30


@api.get("/storage/pref")
async def get_storage_pref(user: User = Depends(get_current_user)):
    doc = await db.storage_prefs.find_one({"user_id": user.user_id}, {"_id": 0})
    if not doc:
        now = datetime.now(timezone.utc)
        doc = {
            "user_id": user.user_id,
            "mode": DEFAULT_STORAGE_MODE,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "last_prompt_at": None,
            "next_prompt_at": (now + timedelta(days=PROMPT_INTERVAL_DAYS)).isoformat(),
        }
        await db.storage_prefs.insert_one(dict(doc))
        doc.pop("_id", None)
    # decide if we should show the monthly modal now
    show_now = False
    if doc.get("mode") in ("local",):
        npa = parse_dt(doc.get("next_prompt_at"))
        if not npa or npa <= datetime.now(timezone.utc):
            show_now = True
    return {**doc, "should_prompt_now": show_now}


@api.put("/storage/pref")
async def set_storage_pref(payload: dict, user: User = Depends(get_current_user)):
    mode = payload.get("mode")
    if mode not in ("local", "cloud", "never"):
        raise HTTPException(status_code=400, detail="Invalid mode")
    now = datetime.now(timezone.utc)
    update = {
        "user_id": user.user_id,
        "mode": mode,
        "updated_at": now.isoformat(),
        "last_prompt_at": now.isoformat() if payload.get("from_prompt") else None,
    }
    if mode == "never":
        update["next_prompt_at"] = None
    elif mode == "local":
        update["next_prompt_at"] = (now + timedelta(days=PROMPT_INTERVAL_DAYS)).isoformat()
    else:  # cloud — no monthly nudge needed
        update["next_prompt_at"] = None
    await db.storage_prefs.update_one(
        {"user_id": user.user_id},
        {"$set": update, "$setOnInsert": {"created_at": now.isoformat()}},
        upsert=True,
    )
    doc = await db.storage_prefs.find_one({"user_id": user.user_id}, {"_id": 0})
    return doc


@api.post("/storage/prompt-shown")
async def storage_prompt_shown(user: User = Depends(get_current_user)):
    """Called when the monthly modal was shown but user dismissed (snoozed) it."""
    now = datetime.now(timezone.utc)
    await db.storage_prefs.update_one(
        {"user_id": user.user_id},
        {"$set": {
            "last_prompt_at": now.isoformat(),
            "next_prompt_at": (now + timedelta(days=PROMPT_INTERVAL_DAYS)).isoformat(),
            "updated_at": now.isoformat(),
        }, "$setOnInsert": {"user_id": user.user_id, "mode": "local", "created_at": now.isoformat()}},
        upsert=True,
    )
    return {"ok": True}


# ---------------------------- Admin (Super admin / admin / user) ----------------------------
@api.get("/admin/users")
async def admin_list_users(admin: User = Depends(get_admin_user)):
    cursor = db.users.find({}, {"_id": 0}).sort("created_at", -1).limit(500)
    users = await cursor.to_list(length=500)
    # Attach storage mode for transparency
    pref_map = {}
    pref_cursor = db.storage_prefs.find({}, {"_id": 0, "user_id": 1, "mode": 1})
    async for p in pref_cursor:
        pref_map[p.get("user_id")] = p.get("mode", "local")
    out = []
    for u in users:
        out.append({
            "user_id": u.get("user_id"),
            "email": u.get("email"),
            "name": u.get("name"),
            "picture": u.get("picture"),
            "role": u.get("role", "user"),
            "created_at": u.get("created_at"),
            "last_seen_at": u.get("last_seen_at"),
            "storage_mode": pref_map.get(u.get("user_id"), "local"),
        })
    return out


@api.put("/admin/users/{target_user_id}/role")
async def admin_set_role(target_user_id: str, payload: dict, admin: User = Depends(get_admin_user)):
    new_role = payload.get("role")
    if new_role not in ("user", "admin", "super_admin"):
        raise HTTPException(status_code=400, detail="Invalid role")
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    # Authority rules:
    # - Only super_admin can grant or revoke "admin" / "super_admin"
    # - admin role can demote user→user but cannot touch admins/super_admins
    if admin.role != "super_admin":
        if target.get("role") in ("admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Only the super admin can modify admins")
        if new_role in ("admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Only the super admin can grant admin")
    # Never let anyone strip the super admin email from super_admin
    if target.get("email", "").lower() == SUPER_ADMIN_EMAIL.lower() and new_role != "super_admin":
        raise HTTPException(status_code=403, detail="Cannot demote the super admin")
    await db.users.update_one(
        {"user_id": target_user_id},
        {"$set": {"role": new_role, "role_updated_at": datetime.now(timezone.utc).isoformat(),
                   "role_updated_by": admin.user_id}},
    )
    doc = await db.users.find_one({"user_id": target_user_id}, {"_id": 0})
    return {
        "user_id": doc["user_id"],
        "email": doc["email"],
        "name": doc["name"],
        "role": doc.get("role", "user"),
    }


@api.delete("/admin/users/{target_user_id}")
async def admin_delete_user(target_user_id: str, admin: User = Depends(get_super_admin_user)):
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("email", "").lower() == SUPER_ADMIN_EMAIL.lower():
        raise HTTPException(status_code=403, detail="Cannot delete the super admin")
    # Cascade-delete this user's content (cloud-mode data)
    for col in ("user_sessions", "user_profiles", "personality_assessments",
                "ai_messages", "daily_prompts", "daily_recaps",
                "journal_items", "audio_blobs", "storage_prefs"):
        await db[col].delete_many({"user_id": target_user_id})
    await db.users.delete_one({"user_id": target_user_id})
    return {"ok": True}


@api.get("/admin/stats")
async def admin_stats(admin: User = Depends(get_admin_user)):
    total_users = await db.users.count_documents({})
    admins = await db.users.count_documents({"role": {"$in": ["admin", "super_admin"]}})
    cloud_users = await db.storage_prefs.count_documents({"mode": "cloud"})
    seven_days_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    active_7d = await db.users.count_documents({"last_seen_at": {"$gte": seven_days_ago}})
    return {
        "total_users": total_users,
        "admins": admins,
        "cloud_users": cloud_users,
        "active_7d": active_7d,
    }


# ---------------------------- Health ----------------------------
@api.get("/")
async def root():
    return {"service": "pericl", "status": "ok"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _seed_super_admin():
    """Backfill super admin role for the configured email (if a user with that email already exists)."""
    try:
        await db.users.update_one(
            {"email": SUPER_ADMIN_EMAIL},
            {"$set": {"role": "super_admin"}},
        )
    except Exception as e:
        logger.warning("super admin backfill failed: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
