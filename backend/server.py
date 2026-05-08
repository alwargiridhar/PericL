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
import litellm
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage, get_integration_proxy_url
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
    is_premium: bool = False
    plan: str = "free"  # "free" | "premium_monthly" | "premium_yearly"
    plan_renews_at: datetime | None = None


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
    fields = ("user_id", "email", "name", "picture", "role", "created_at", "is_premium", "plan", "plan_renews_at")
    return User(**{k: user_doc[k] for k in fields if k in user_doc})


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

    # Best-effort mission progress auto-detection (no assumptions: only if confidence high)
    progress_logged = await maybe_log_mission_progress_for_note(user.user_id, text, note_id) if text else None

    return {
        "note": serialize_item(note_doc),
        "extracted": [serialize_item(e) for e in extracted],
        "mission_progress": progress_logged,
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
    progress_logged = await maybe_log_mission_progress_for_note(user.user_id, text, note_id)

    return {
        "note": serialize_item(note_doc),
        "extracted": [serialize_item(e) for e in extracted],
        "mission_progress": progress_logged,
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
    seen: set[str] = set()
    cleaned: list[str] = []
    for ln in lines:
        ln = re.sub(r"^[\-•\*\d\.\)\s]+", "", ln).strip()
        if not ln:
            continue
        norm = re.sub(r"[^a-z0-9]+", " ", ln.lower()).strip()
        if not norm or norm in seen:
            continue
        seen.add(norm)
        cleaned.append(ln[:160])
        if len(cleaned) >= 3:
            break
    return cleaned


def _infer_mood_quick(text: str) -> str | None:
    """Cheap keyword-based mood detector (kept in sync with frontend _inferMoodLocal).
    Used to avoid a doubled LLM round-trip on every chat message."""
    if not text:
        return None
    t = text.lower()
    if re.search(r"!!|🎉|amazing|incredible|stoked|let'?s go|finally|shipped|launch", t):
        return "excited"
    if re.search(r"happy|grateful|joy|love|blessed|smile|good day|win|proud", t):
        return "happy"
    if re.search(r"stress|overwhelm|anxious|panic|deadline|too much|burn(ed|t)? out", t):
        return "stressed"
    if re.search(r"sad|down|cry|lonely|miss|hurt|alone|tired", t):
        return "sad"
    if re.search(r"calm|peaceful|breathe|quiet|still|relax", t):
        return "calm"
    if re.search(r"focus|plan|ship|build|goal|priorit|launch|strateg", t):
        return "focused"
    return None


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
    missions: list[dict] | None = None,
    style: dict | None = None,
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
        "4) DIRECT — end with EXACTLY ONE next move, < 15 minutes, specific, aligned to a top goal or active mission.",
        "",
        "## DRIFT DETECTION",
        "If repeated avoidance, low-effort, inconsistency: say 'You're drifting from what you said matters.' Then guide back with a small action.",
        "",
        "## TIME REALITY ENGINE",
        "If the current effort rate cannot reach a goal in the remaining window, say so plainly: 'At your current pace, this will not be completed in this quarter.' Offer: increase effort OR reduce scope.",
        "",
        "## MISSIONS — REAL PROGRESS, NO ASSUMPTIONS",
        "If active missions are listed below, use ONLY the numbers provided to evaluate progress. Never invent or assume progress that isn't in the data.",
        "If the user mentions a track by name (e.g., a book or module), reference it specifically: 'You've barely progressed on Atomic Habits this week.'",
        "If a mission is BEHIND, name the gap. If ON_TRACK, briefly reinforce. If AHEAD, acknowledge then push for sustainability.",
        "Tie the 🎯 Next Move to one of the active missions/tracks whenever possible.",
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
        "Keep total length tight — under ~110 words.",
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

    # Active missions (with stats)
    if missions:
        ctx.append("- ACTIVE MISSIONS (use real numbers, do NOT assume):")
        for m in missions[:3]:
            stats = m.get("stats") or {}
            ctx.append(
                f"  • {m.get('title')} — {m.get('outcome') or '(no outcome)'} "
                f"[pace={stats.get('pace','unknown')}, "
                f"{stats.get('logged_units',0):.0f}/{stats.get('target_units',0):.0f} units, "
                f"{stats.get('percent_complete',0):.0f}%, "
                f"{stats.get('days_remaining','?')}d remaining, "
                f"consistency={stats.get('consistency_pct',0):.0f}%, "
                f"days_since_last_progress={stats.get('days_since_last_progress')}]"
            )
            for tr in stats.get("tracks") or []:
                ctx.append(
                    f"      - track '{tr.get('title')}': "
                    f"{tr.get('logged_units',0):.0f}/{tr.get('target_units',0):.0f} "
                    f"{tr.get('unit_label','units')} ({tr.get('percent',0):.0f}%, "
                    f"{tr.get('entries_count',0)} entries)"
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

    # Communication-style mirror — match the user's voice subtly.
    if style:
        ctx.append("- USER STYLE (mirror this in your reply):")
        if style.get("avg_sentence_len"):
            ctx.append(f"    avg sentence length: ~{style['avg_sentence_len']} words")
        if style.get("formality"):
            ctx.append(f"    formality: {style['formality']} (write the same)")
        if style.get("uses_lowercase"):
            ctx.append("    they don't capitalise — keep your reply lowercase too")
        if style.get("uses_emoji") is False:
            ctx.append("    no emoji except the required 🎯")
        if style.get("top_phrases"):
            ctx.append(f"    phrases they use: {', '.join(style['top_phrases'][:3])}")

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

    # Free-tier daily limit on assistant replies
    if not user.is_premium:
        remaining = await _free_chat_remaining(user)
        if remaining <= 0:
            raise HTTPException(
                status_code=402,
                detail="You've reached your free mirror replies for today. Upgrade to keep going.",
            )

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

    # Active missions with stats
    mission_docs = await db.missions.find(
        {"user_id": user.user_id, "is_active": True}, {"_id": 0}
    ).sort("created_at", -1).limit(3).to_list(length=3)
    missions_with_stats = [await _serialize_mission(m) for m in mission_docs]

    # Detect current mood from this message via cheap heuristic — avoids
    # a second LLM round-trip per chat send (saves ~3-6s).
    current_mood = _infer_mood_quick(message)

    # History — keep last 16 turns for context
    history_cursor = db.ai_messages.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).limit(16)
    hist = list(reversed(await history_cursor.to_list(length=16)))
    style = _extract_communication_style(hist)
    sys_msg = _build_chat_system_message(
        profile, personality_doc, moods,
        behavior=behavior, current_mood=current_mood, missions=missions_with_stats,
        style=style,
    )
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
    missions = payload.get("missions") or None
    style = _extract_communication_style(history)

    sys_msg = _build_chat_system_message(
        profile, personality, moods,
        behavior=behavior, current_mood=current_mood, missions=missions,
        style=style,
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
    pref_cursor = db.storage_prefs.find({}, {"_id": 0, "user_id": 1, "mode": 1}).limit(500)
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
    await _audit(admin, "set_role", target_user_id, {
        "from": target.get("role", "user"), "to": new_role,
        "target_email": doc.get("email"), "target_name": doc.get("name"),
    })
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
                "journal_items", "audio_blobs", "storage_prefs",
                "missions", "mission_progress", "payment_transactions"):
        await db[col].delete_many({"user_id": target_user_id})
    res = await db.users.delete_one({"user_id": target_user_id})
    if res.deleted_count == 0:
        # Defensive: fall back to deleting by email if a stray record exists.
        await db.users.delete_one({"email": target.get("email")})
    await _audit(admin, "delete_user", target_user_id, {
        "target_email": target.get("email"), "target_name": target.get("name"),
        "target_role": target.get("role", "user"),
    })
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


# ---------------------------- Missions (Quarterly Goals) ----------------------------
MAX_ACTIVE_MISSIONS = 3
EFFORTS = {"low", "medium", "deep"}


def _compute_mission_stats(mission: dict, progress_entries: list[dict]) -> dict:
    """Pace, consistency, effort distribution. Pure function — no assumptions, only evidence."""
    now = datetime.now(timezone.utc)
    start = parse_dt(mission.get("start_at")) or parse_dt(mission.get("created_at")) or now
    target = parse_dt(mission.get("target_date"))
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if target and target.tzinfo is None:
        target = target.replace(tzinfo=timezone.utc)

    total_days = max(1, ((target - start).days)) if target else None
    elapsed_days = max(0, (now - start).days)
    days_remaining = max(0, ((target - now).days)) if target else None

    # Per-track progress
    tracks_out = []
    grand_logged = 0.0
    grand_target = 0.0
    for tr in mission.get("tracks") or []:
        tr_entries = [e for e in progress_entries if e.get("track_id") == tr.get("id")]
        logged = sum(float(e.get("units") or 0) for e in tr_entries)
        target_units = float(tr.get("target_units") or 0)
        grand_logged += logged
        grand_target += target_units
        tracks_out.append({
            "id": tr.get("id"),
            "title": tr.get("title"),
            "unit_label": tr.get("unit_label") or "units",
            "target_units": target_units,
            "logged_units": logged,
            "percent": min(100.0, (logged / target_units * 100.0) if target_units else 0.0),
            "entries_count": len(tr_entries),
            "last_logged_at": max((e.get("created_at") for e in tr_entries), default=None),
        })

    # Pace status (overall)
    if grand_target and total_days:
        expected_today = grand_target * (elapsed_days / total_days) if total_days else 0
        if grand_logged >= expected_today * 1.05:
            pace = "ahead"
        elif grand_logged >= expected_today * 0.85:
            pace = "on_track"
        else:
            pace = "behind"
    else:
        pace = "unknown"
        expected_today = 0

    # Consistency — distinct day-keys with progress / elapsed_days
    days_with = {((e.get("created_at") or "")[:10]) for e in progress_entries if e.get("created_at")}
    days_with.discard("")
    consistency_pct = (len(days_with) / max(1, elapsed_days) * 100.0) if elapsed_days else 0.0

    # Effort distribution
    effort_counts = {"low": 0, "medium": 0, "deep": 0}
    for e in progress_entries:
        eff = e.get("effort")
        if eff in effort_counts:
            effort_counts[eff] += 1

    last_logged_at = max((e.get("created_at") for e in progress_entries), default=None)
    days_since_last = None
    if last_logged_at:
        try:
            dl = parse_dt(last_logged_at)
            if dl and dl.tzinfo is None:
                dl = dl.replace(tzinfo=timezone.utc)
            if dl:
                days_since_last = (now - dl).days
        except Exception:
            pass

    return {
        "tracks": tracks_out,
        "logged_units": grand_logged,
        "target_units": grand_target,
        "expected_units_today": round(expected_today, 1),
        "percent_complete": min(100.0, (grand_logged / grand_target * 100.0) if grand_target else 0.0),
        "elapsed_days": elapsed_days,
        "days_remaining": days_remaining,
        "total_days": total_days,
        "pace": pace,
        "consistency_pct": round(consistency_pct, 1),
        "effort_counts": effort_counts,
        "days_since_last_progress": days_since_last,
        "entries_count": len(progress_entries),
    }


async def _serialize_mission(mission: dict) -> dict:
    progress = await db.mission_progress.find(
        {"mission_id": mission["id"]}, {"_id": 0}
    ).sort("created_at", -1).limit(500).to_list(length=500)
    stats = _compute_mission_stats(mission, progress)
    return {
        "id": mission["id"],
        "user_id": mission["user_id"],
        "title": mission.get("title"),
        "outcome": mission.get("outcome"),
        "target_date": mission.get("target_date"),
        "start_at": mission.get("start_at"),
        "is_active": mission.get("is_active", True),
        "tracks": mission.get("tracks") or [],
        "stats": stats,
        "created_at": mission.get("created_at"),
    }


@api.get("/missions")
async def list_missions(user: User = Depends(get_current_user)):
    cursor = db.missions.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).limit(20)
    docs = await cursor.to_list(length=20)
    return [await _serialize_mission(m) for m in docs]


@api.post("/missions")
async def create_mission(payload: dict, user: User = Depends(get_current_user)):
    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Mission title required")
    active_count = await db.missions.count_documents({"user_id": user.user_id, "is_active": True})
    if active_count >= MAX_ACTIVE_MISSIONS:
        raise HTTPException(status_code=400, detail=f"Max {MAX_ACTIVE_MISSIONS} active missions; archive one first")

    tracks_in = payload.get("tracks") or []
    tracks: list[dict] = []
    for t in tracks_in[:6]:  # cap tracks per mission
        t_title = (t.get("title") or "").strip()
        if not t_title:
            continue
        tracks.append({
            "id": f"trk_{uuid.uuid4().hex[:10]}",
            "title": t_title[:120],
            "target_units": float(t.get("target_units") or 0),
            "unit_label": (t.get("unit_label") or "units").strip()[:24],
            "is_active": True,
        })

    target_date = parse_dt(payload.get("target_date"))
    now = datetime.now(timezone.utc)
    doc = {
        "id": f"msn_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "title": title[:160],
        "outcome": (payload.get("outcome") or "")[:400],
        "target_date": target_date.isoformat() if target_date else None,
        "start_at": now.isoformat(),
        "is_active": True,
        "tracks": tracks,
        "created_at": now.isoformat(),
    }
    await db.missions.insert_one(dict(doc))
    return await _serialize_mission(doc)


@api.patch("/missions/{mission_id}")
async def update_mission(mission_id: str, payload: dict, user: User = Depends(get_current_user)):
    updates: dict = {}
    if "title" in payload:
        updates["title"] = str(payload["title"])[:160]
    if "outcome" in payload:
        updates["outcome"] = str(payload["outcome"])[:400]
    if "target_date" in payload:
        d = parse_dt(payload["target_date"])
        updates["target_date"] = d.isoformat() if d else None
    if "is_active" in payload:
        updates["is_active"] = bool(payload["is_active"])
    if "tracks" in payload:
        new_tracks = []
        for t in (payload["tracks"] or [])[:6]:
            new_tracks.append({
                "id": t.get("id") or f"trk_{uuid.uuid4().hex[:10]}",
                "title": str(t.get("title") or "").strip()[:120],
                "target_units": float(t.get("target_units") or 0),
                "unit_label": (t.get("unit_label") or "units").strip()[:24],
                "is_active": bool(t.get("is_active", True)),
            })
        updates["tracks"] = [t for t in new_tracks if t["title"]]
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields")
    res = await db.missions.update_one(
        {"id": mission_id, "user_id": user.user_id}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    doc = await db.missions.find_one({"id": mission_id, "user_id": user.user_id}, {"_id": 0})
    return await _serialize_mission(doc)


@api.delete("/missions/{mission_id}")
async def delete_mission(mission_id: str, user: User = Depends(get_current_user)):
    await db.missions.delete_one({"id": mission_id, "user_id": user.user_id})
    await db.mission_progress.delete_many({"mission_id": mission_id, "user_id": user.user_id})
    return {"ok": True}


@api.get("/missions/{mission_id}/progress")
async def list_mission_progress(mission_id: str, user: User = Depends(get_current_user)):
    cursor = db.mission_progress.find(
        {"mission_id": mission_id, "user_id": user.user_id}, {"_id": 0}
    ).sort("created_at", -1).limit(200)
    return await cursor.to_list(length=200)


@api.post("/missions/{mission_id}/progress")
async def log_mission_progress(mission_id: str, payload: dict, user: User = Depends(get_current_user)):
    mission = await db.missions.find_one({"id": mission_id, "user_id": user.user_id}, {"_id": 0})
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    track_id = payload.get("track_id")
    if track_id:
        if not any(t.get("id") == track_id for t in mission.get("tracks") or []):
            raise HTTPException(status_code=400, detail="Track not found in mission")
    units = float(payload.get("units") or 0)
    if units <= 0:
        raise HTTPException(status_code=400, detail="units must be > 0")
    effort = payload.get("effort") or "medium"
    if effort not in EFFORTS:
        raise HTTPException(status_code=400, detail="effort must be low/medium/deep")
    entry = {
        "id": f"prg_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "mission_id": mission_id,
        "track_id": track_id,
        "units": units,
        "effort": effort,
        "note": (payload.get("note") or "")[:400],
        "journal_item_id": payload.get("journal_item_id"),
        "detected": bool(payload.get("detected", False)),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.mission_progress.insert_one(dict(entry))
    return entry


@api.delete("/missions/progress/{entry_id}")
async def delete_progress(entry_id: str, user: User = Depends(get_current_user)):
    await db.mission_progress.delete_one({"id": entry_id, "user_id": user.user_id})
    return {"ok": True}


# ---------------------------- AI Mission detection ----------------------------
DETECT_PROGRESS_SYSTEM = (
    "You are a strict progress detector. Given the user's text and their active missions/tracks, "
    "return ONLY JSON of this shape: "
    '{"mission_id": <string id or null>, "track_id": <string id or null>, '
    '"units": <number, e.g. pages/problems/sessions; 0 if not stated>, '
    '"effort": "low" | "medium" | "deep", '
    '"confidence": <number 0..1>, '
    '"note": <short summary or null>}. '
    "Rules: NEVER guess. If the user did not clearly mention activity tied to one of the listed missions/tracks, "
    "return mission_id=null and confidence<=0.3. Match track titles loosely (case-insensitive, allow partial words). "
    "Effort: 'deep' = 45+ minutes of focused work or hard problems; 'medium' = 15-45 min or routine progress; "
    "'low' = under 15 min or shallow review. NEVER include text outside JSON."
)


async def detect_mission_progress(text: str, missions: list[dict]) -> dict | None:
    if not text or not missions:
        return None
    catalog_lines = []
    for m in missions:
        if not m.get("is_active", True):
            continue
        track_lines = []
        for t in m.get("tracks") or []:
            track_lines.append(f'    track {t.get("id")}: "{t.get("title")}" (target {t.get("target_units")} {t.get("unit_label")})')
        catalog_lines.append(f'  mission {m.get("id")}: "{m.get("title")}" — {m.get("outcome") or ""}')
        if track_lines:
            catalog_lines.extend(track_lines)
    catalog = "\n".join(catalog_lines) or "(no missions)"
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"detect-{uuid.uuid4().hex[:8]}",
        system_message=DETECT_PROGRESS_SYSTEM,
    ).with_model("openai", "gpt-5.2")
    msg = UserMessage(text=f"Active missions:\n{catalog}\n\nUser said: {text}")
    try:
        raw = (await chat.send_message(msg)).strip()
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            return None
        data = json.loads(m.group(0))
    except Exception as e:
        logger.warning("detect_mission_progress error: %s", e)
        return None
    # Validate
    mid = data.get("mission_id")
    if mid and not any(mm.get("id") == mid for mm in missions):
        return None
    tid = data.get("track_id")
    if tid:
        ok = False
        for mm in missions:
            if any(t.get("id") == tid for t in mm.get("tracks") or []):
                ok = True
                break
        if not ok:
            tid = None
            data["track_id"] = None
    eff = data.get("effort")
    if eff not in EFFORTS:
        data["effort"] = "medium"
    try:
        data["units"] = float(data.get("units") or 0)
    except Exception:
        data["units"] = 0
    try:
        data["confidence"] = float(data.get("confidence") or 0)
    except Exception:
        data["confidence"] = 0
    return data


async def maybe_log_mission_progress_for_note(user_id: str, text: str, journal_item_id: str) -> dict | None:
    missions = await db.missions.find(
        {"user_id": user_id, "is_active": True}, {"_id": 0}
    ).to_list(length=10)
    if not missions:
        return None
    detection = await detect_mission_progress(text, missions)
    if not detection or detection.get("confidence", 0) < 0.55:
        return None
    if not detection.get("mission_id") or float(detection.get("units") or 0) <= 0:
        return None
    entry = {
        "id": f"prg_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "mission_id": detection["mission_id"],
        "track_id": detection.get("track_id"),
        "units": float(detection["units"]),
        "effort": detection.get("effort", "medium"),
        "note": (detection.get("note") or "")[:400],
        "journal_item_id": journal_item_id,
        "detected": True,
        "confidence": detection.get("confidence"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.mission_progress.insert_one(dict(entry))
    return entry


@api.post("/ai/detect-progress")
async def stateless_detect_progress(payload: dict, user: User = Depends(get_current_user)):
    text = (payload.get("text") or "").strip()
    missions = payload.get("missions") or []
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")
    detection = await detect_mission_progress(text, missions)
    return detection or {"mission_id": None, "track_id": None, "units": 0, "effort": "medium", "confidence": 0}


async def ai_drift_nudge(profile: dict | None, missions: list[dict] | None, minutes_away: int,
                         personality: dict | None = None, drift_count_today: int = 0) -> dict:
    """Generate a short, humble nudge asking the user to put the phone down
    and take one small step back toward their stated goal. Returns:
      { "message": str (1-2 sentences, warm second person),
        "next_move": str (one specific action under 15 min) }
    """
    goals_text = ""
    if profile and profile.get("goals"):
        goals_text = profile["goals"]
    if missions:
        m_lines = []
        for m in missions[:3]:
            title = m.get("outcome") or m.get("title") or ""
            if title:
                m_lines.append(f"- {title}")
        if m_lines:
            goals_text = (goals_text + "\n" + "\n".join(m_lines)).strip()
    goals_text = (goals_text or "(no explicit goals yet)").strip()

    personality_hint = ""
    if personality:
        pt = personality.get("personality_type") or ""
        scores = personality.get("scores") or {}
        if pt == "BIG5" and scores:
            # higher-N → softer tone; higher-C → more direct.
            n = int(scores.get("N", 50))
            c = int(scores.get("C", 50))
            personality_hint = (
                f"User's Big Five: O={scores.get('O','?')}, C={c}, E={scores.get('E','?')}, "
                f"A={scores.get('A','?')}, N={n}. "
                f"{'Soften the tone — they feel things deeply.' if n > 60 else ''}"
                f"{' They respond well to direct, small commitments.' if c > 60 else ''}"
            )
        elif pt:
            personality_hint = f"User MBTI: {pt} ({personality.get('type_name','')}). Match the inferred tone."

    repeat_hint = ""
    if drift_count_today >= 2:
        repeat_hint = f"This is the {drift_count_today + 1}th drift today — name it once, gently, no shame."

    sys = (
        "You are the user's own reflective inner voice — NOT an assistant, NOT an AI. "
        "The user has been away from their journal for a long time, likely scrolling on their phone. "
        "Be humble, warm, honest, and brief — never preachy, never moralistic, never guilt-inducing. "
        "No emoji except a single 🎯 on the next-move line. "
        "Return ONLY JSON: "
        "{\"message\": str (1-2 sentences, second person, anchored to their actual goal), "
        "\"next_move\": str (one specific action under 15 minutes, concrete and small)}. "
        "Do not mention Instagram, YouTube, TikTok, or shame them. Say it like a friend would. "
        + (personality_hint + " " if personality_hint else "")
        + (repeat_hint if repeat_hint else "")
    )
    chat = (
        LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"drift-{uuid.uuid4().hex[:8]}", system_message=sys)
        .with_model("openai", "gpt-5.2")
    )
    user_msg = UserMessage(
        text=(
            f"Time away from journal: ~{minutes_away} minutes.\n"
            f"User's goals / active missions:\n{goals_text}"
        )
    )
    try:
        raw = (await chat.send_message(user_msg)).strip()
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            data = json.loads(m.group(0))
            msg = (data.get("message") or "").strip()
            nxt = (data.get("next_move") or "").strip()
            if msg and nxt:
                return {"message": msg, "next_move": nxt}
    except Exception as e:
        logger.warning("drift nudge fallback: %s", e)
    # Deterministic fallback that never blames the user.
    first_goal = (goals_text.splitlines() or ["what matters to you"])[0].lstrip("- ").strip() or "what matters to you"
    return {
        "message": (
            f"You've been away a while. "
            f"It's fine — just pick the smallest move back toward {first_goal}."
        ),
        "next_move": "Open your journal and type one honest sentence about where you actually are right now.",
    }


@api.post("/ai/drift-nudge")
async def cloud_drift_nudge(payload: dict, user: User = Depends(get_current_user)):
    minutes_away = int(payload.get("minutes_away") or 30)
    drift_count_today = int(payload.get("drift_count_today") or 0)
    profile = await db.user_profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    mission_docs = await db.missions.find(
        {"user_id": user.user_id, "is_active": True}, {"_id": 0}
    ).sort("created_at", -1).limit(3).to_list(length=3)
    personality = await db.personality_assessments.find_one(
        {"user_id": user.user_id}, {"_id": 0}, sort=[("created_at", -1)]
    )
    return await ai_drift_nudge(profile, mission_docs, minutes_away, personality, drift_count_today)


@api.post("/ai/drift-nudge-stateless")
async def stateless_drift_nudge(payload: dict):
    minutes_away = int(payload.get("minutes_away") or 30)
    drift_count_today = int(payload.get("drift_count_today") or 0)
    profile = payload.get("profile") or None
    missions = payload.get("missions") or []
    personality = payload.get("personality") or None
    return await ai_drift_nudge(profile, missions, minutes_away, personality, drift_count_today)


# ---------------------------- Health ----------------------------
@api.get("/")
async def root():
    return {"service": "pericl", "status": "ok"}


# ---------------------------- Streaming chat (SSE) ----------------------------
async def _stream_llm_chat(system_msg: str, convo: str, model: str = "gpt-5.2"):
    """Yield text deltas from an LLM call using litellm + Emergent proxy."""
    params = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": convo},
        ],
        "api_key": EMERGENT_LLM_KEY,
        "stream": True,
        "api_base": get_integration_proxy_url() + "/llm",
        "custom_llm_provider": "openai",
    }
    try:
        resp = await litellm.acompletion(**params)
        async for chunk in resp:
            try:
                delta = chunk.choices[0].delta.content or ""
            except Exception:
                delta = ""
            if delta:
                yield delta
    except Exception as e:
        logger.warning("stream error: %s", e)
        yield "\n\n🎯 Next Move: Write one sentence about what's actually on your mind."


def _sse(data: str) -> bytes:
    # Server-Sent Event line. Use 'data:' frames with newline encoding.
    safe = data.replace("\r", "")
    return f"data: {json.dumps({'delta': safe})}\n\n".encode()


@api.post("/ai/chat/stream")
async def chat_send_stream(payload: dict, user: User = Depends(get_current_user)):
    """SSE endpoint — streams the Mirror's reply token-by-token. Persists to db once complete."""
    message = (payload.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Empty message")
    if not user.is_premium:
        remaining = await _free_chat_remaining(user)
        if remaining <= 0:
            raise HTTPException(
                status_code=402,
                detail="You've reached your free mirror replies for today. Upgrade to keep going.",
            )

    user_msg = {
        "id": f"m_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "role": "user",
        "content": message,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ai_messages.insert_one(dict(user_msg))

    profile = await db.user_profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    personality_doc = await db.personality_assessments.find_one(
        {"user_id": user.user_id}, {"_id": 0}, sort=[("created_at", -1)]
    )
    recent_journal = await db.journal_items.find(
        {"user_id": user.user_id, "type": {"$in": ["voice", "text"]}}, {"_id": 0, "mood": 1}
    ).sort("created_at", -1).limit(8).to_list(length=8)
    moods = [j.get("mood") for j in recent_journal if j.get("mood")]
    fourteen_days_ago = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    items_for_signals = await db.journal_items.find(
        {"user_id": user.user_id, "created_at": {"$gte": fourteen_days_ago}}, {"_id": 0}
    ).sort("created_at", -1).to_list(length=400)
    behavior = _compute_behavior_signals_from_items(items_for_signals)
    mission_docs = await db.missions.find(
        {"user_id": user.user_id, "is_active": True}, {"_id": 0}
    ).sort("created_at", -1).limit(3).to_list(length=3)
    missions_with_stats = [await _serialize_mission(m) for m in mission_docs]
    current_mood = _infer_mood_quick(message)

    sys_msg = _build_chat_system_message(
        profile, personality_doc, moods,
        behavior=behavior, current_mood=current_mood, missions=missions_with_stats,
    )
    history_cursor = db.ai_messages.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).limit(16)
    hist = list(reversed(await history_cursor.to_list(length=16)))
    style = _extract_communication_style(hist)
    sys_msg = _build_chat_system_message(
        profile, personality_doc, moods,
        behavior=behavior, current_mood=current_mood, missions=missions_with_stats,
        style=style,
    )
    convo = ""
    for m in hist[:-1]:
        prefix = "User" if m["role"] == "user" else "PericL"
        convo += f"{prefix}: {m['content']}\n"
    convo += f"User: {message}"

    asst_id = f"m_{uuid.uuid4().hex[:12]}"

    async def gen():
        # First frame: send the user message id + assistant id so the client can reconcile
        yield f"data: {json.dumps({'meta': {'user_message_id': user_msg['id'], 'assistant_message_id': asst_id}})}\n\n".encode()
        full = []
        async for delta in _stream_llm_chat(sys_msg, convo):
            full.append(delta)
            yield _sse(delta)
        reply = ("".join(full)).strip() or "Take a breath. Try that again in a moment.\n\n🎯 Next Move: Write one sentence about what's actually on your mind."
        await db.ai_messages.insert_one({
            "id": asst_id,
            "user_id": user.user_id,
            "role": "assistant",
            "content": reply,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        yield b"data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
    })


@api.post("/ai/chat-stateless/stream")
async def stateless_chat_stream(payload: dict, user: User = Depends(get_current_user)):
    """Streaming variant of chat-stateless — caller supplies all context, server stores nothing."""
    message = (payload.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Empty message")
    history = payload.get("history") or []
    profile = payload.get("profile") or None
    personality = payload.get("personality") or None
    moods = payload.get("recent_moods") or []
    behavior = payload.get("behavior") or None
    current_mood = payload.get("current_mood") or None
    missions = payload.get("missions") or None
    style = _extract_communication_style(history)

    sys_msg = _build_chat_system_message(
        profile, personality, moods,
        behavior=behavior, current_mood=current_mood, missions=missions,
        style=style,
    )
    convo = ""
    for m in history[-16:]:
        prefix = "User" if m.get("role") == "user" else "PericL"
        convo += f"{prefix}: {m.get('content','')}\n"
    convo += f"User: {message}"

    async def gen():
        async for delta in _stream_llm_chat(sys_msg, convo):
            yield _sse(delta)
        yield b"data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
    })


# ---------------------------- Search (journal + chat) ----------------------------
@api.get("/search")
async def search_all(q: str = "", user: User = Depends(get_current_user)):
    q = (q or "").strip()
    if not q:
        return {"journal": [], "chat": []}
    rx = {"$regex": re.escape(q), "$options": "i"}
    journal_docs = await db.journal_items.find(
        {
            "user_id": user.user_id,
            "$or": [
                {"title": rx}, {"detail": rx}, {"transcription": rx}, {"summary": rx},
            ],
        },
        {"_id": 0},
    ).sort("created_at", -1).limit(50).to_list(length=50)
    chat_docs = await db.ai_messages.find(
        {"user_id": user.user_id, "content": rx}, {"_id": 0}
    ).sort("created_at", -1).limit(50).to_list(length=50)
    return {
        "journal": [serialize_item(d) for d in journal_docs],
        "chat": chat_docs,
    }


# ---------------------------- Big Five (OCEAN) ----------------------------
BIG_FIVE_TRAITS = ["O", "C", "E", "A", "N"]
BIG_FIVE_NAMES = {
    "O": "Openness",
    "C": "Conscientiousness",
    "E": "Extraversion",
    "A": "Agreeableness",
    "N": "Neuroticism",
}


def compute_big_five(answers: list[dict]) -> dict:
    """Each answer: {trait: 'O'|'C'|'E'|'A'|'N', score: 1..5, reverse: bool}.
    Returns per-trait normalized score 0..100."""
    sums: dict[str, list[int]] = {t: [] for t in BIG_FIVE_TRAITS}
    for a in answers or []:
        t = a.get("trait")
        s = a.get("score")
        if t not in sums or not isinstance(s, (int, float)):
            continue
        s = max(1, min(5, int(s)))
        if a.get("reverse"):
            s = 6 - s
        sums[t].append(s)
    out = {}
    for t, items in sums.items():
        if not items:
            out[t] = 0
        else:
            avg = sum(items) / len(items)  # 1..5
            out[t] = round((avg - 1) / 4 * 100)
    return out


async def ai_big_five_analysis(scores: dict, profile: dict | None) -> dict:
    name = (profile or {}).get("name") or "this person"
    sys = (
        "You are the user's own reflective voice writing back to them. Given Big Five scores (0-100 each), "
        "return ONLY JSON: {\"description\": str (2-3 sentences in second-person warm voice, like a self-portrait), "
        "\"strengths\": [str, str, str, str], \"growth_areas\": [str, str, str, str] }. "
        "Never mention being an AI or assistant."
    )
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"bigfive-{uuid.uuid4().hex[:8]}", system_message=sys).with_model("openai", "gpt-5.2")
    score_text = ", ".join(f"{BIG_FIVE_NAMES[t]}={scores.get(t,0)}" for t in BIG_FIVE_TRAITS)
    msg = UserMessage(text=f"Name: {name}\nScores: {score_text}")
    try:
        raw = (await chat.send_message(msg)).strip()
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            return json.loads(m.group(0))
    except Exception as e:
        logger.warning("big five analysis fallback: %s", e)
    return {
        "description": "You hold a unique blend of openness, discipline, energy, warmth and emotional weather.",
        "strengths": [],
        "growth_areas": [],
    }


@api.post("/personality/big-five-assess")
async def submit_big_five(payload: dict, user: User = Depends(get_current_user)):
    answers = payload.get("answers") or []
    if not answers:
        raise HTTPException(status_code=400, detail="No answers")
    scores = compute_big_five(answers)
    profile = await db.user_profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    analysis = await ai_big_five_analysis(scores, profile)
    rec = {
        "id": f"pa_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "framework": "big_five",
        "personality_type": "BIG5",
        "type_name": "Big Five",
        "description": analysis.get("description", ""),
        "strengths": analysis.get("strengths", []),
        "growth_areas": analysis.get("growth_areas", []),
        "scores": {t: int(scores.get(t, 0)) for t in BIG_FIVE_TRAITS},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.personality_assessments.insert_one(dict(rec))
    return rec


@api.post("/ai/big-five-analyze")
async def stateless_big_five(payload: dict, user: User = Depends(get_current_user)):
    answers = payload.get("answers") or []
    if not answers:
        raise HTTPException(status_code=400, detail="No answers")
    scores = compute_big_five(answers)
    profile = payload.get("profile") or {}
    analysis = await ai_big_five_analysis(scores, profile)
    return {
        "framework": "big_five",
        "personality_type": "BIG5",
        "type_name": "Big Five",
        "description": analysis.get("description", ""),
        "strengths": analysis.get("strengths", []),
        "growth_areas": analysis.get("growth_areas", []),
        "scores": {t: int(scores.get(t, 0)) for t in BIG_FIVE_TRAITS},
    }


# ---------------------------- Mood timeline ----------------------------
@api.get("/mood/timeline")
async def mood_timeline(days: int = 30, user: User = Depends(get_current_user)):
    days = max(1, min(180, int(days or 30)))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    cursor = db.journal_items.find(
        {
            "user_id": user.user_id,
            "type": {"$in": ["voice", "text"]},
            "created_at": {"$gte": since},
            "mood": {"$ne": None},
        },
        {"_id": 0, "mood": 1, "created_at": 1},
    ).sort("created_at", 1)
    items = await cursor.to_list(length=2000)
    return [{"created_at": i.get("created_at"), "mood": i.get("mood")} for i in items if i.get("mood")]


# ---------------------------- Bidirectional sync ----------------------------
@api.post("/sync/import")
async def sync_import(payload: dict, user: User = Depends(get_current_user)):
    """Import local data into the cloud. Idempotent on `id` per collection.
    Accepts: profile, personality_assessments, journal_items, ai_messages, daily_prompts, daily_recaps, missions, mission_progress.
    """
    counts: dict[str, int] = {}
    prof = payload.get("profile")
    if isinstance(prof, dict):
        update = {k: v for k, v in prof.items() if k in PROFILE_FIELDS}
        if update:
            update["user_id"] = user.user_id
            update["updated_at"] = datetime.now(timezone.utc).isoformat()
            await db.user_profiles.update_one(
                {"user_id": user.user_id},
                {"$set": update, "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat(), "onboarding_completed": True}},
                upsert=True,
            )
            counts["profile"] = 1

    async def _bulk(coll, docs, allow_keys):
        n = 0
        for d in docs or []:
            if not isinstance(d, dict) or not d.get("id"):
                continue
            doc = {k: d.get(k) for k in allow_keys if k in d}
            doc["id"] = d["id"]
            doc["user_id"] = user.user_id
            # created_at must only live in $setOnInsert to avoid "path conflict" on upsert
            created_at_val = doc.pop("created_at", None) or datetime.now(timezone.utc).isoformat()
            await db[coll].update_one(
                {"id": doc["id"], "user_id": user.user_id},
                {"$set": doc, "$setOnInsert": {"created_at": created_at_val}},
                upsert=True,
            )
            n += 1
        return n

    counts["personality_assessments"] = await _bulk(
        "personality_assessments", payload.get("personality_assessments"),
        ["id", "framework", "personality_type", "type_name", "description", "strengths", "growth_areas", "scores", "created_at"],
    )
    counts["journal_items"] = await _bulk(
        "journal_items", payload.get("journal_items"),
        ["id", "type", "title", "detail", "audio_id", "duration", "transcription", "summary", "priority", "due_at", "completed", "parent_id", "mood", "created_at"],
    )
    counts["ai_messages"] = await _bulk(
        "ai_messages", payload.get("ai_messages"),
        ["id", "role", "content", "created_at"],
    )
    counts["daily_prompts"] = await _bulk(
        "daily_prompts", payload.get("daily_prompts"),
        ["id", "prompt_date", "prompt_text", "prompt_type", "response_text", "is_completed", "completed_at", "created_at"],
    )
    counts["daily_recaps"] = await _bulk(
        "daily_recaps", payload.get("daily_recaps"),
        ["id", "recap_date", "summary", "voice_count", "task_count", "reminder_count", "idea_count", "created_at"],
    )
    counts["missions"] = await _bulk(
        "missions", payload.get("missions"),
        ["id", "title", "outcome", "target_date", "start_at", "is_active", "tracks", "created_at"],
    )
    counts["mission_progress"] = await _bulk(
        "mission_progress", payload.get("mission_progress"),
        ["id", "mission_id", "track_id", "units", "effort", "note", "journal_item_id", "detected", "confidence", "created_at"],
    )
    return {"ok": True, "counts": counts}


@api.get("/sync/export")
async def sync_export(user: User = Depends(get_current_user)):
    """Export all of the user's cloud data — used when switching cloud → local."""
    async def _all(coll):
        return await db[coll].find({"user_id": user.user_id}, {"_id": 0}).to_list(length=5000)

    profile = await db.user_profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    return {
        "profile": profile,
        "personality_assessments": await _all("personality_assessments"),
        "journal_items": await _all("journal_items"),
        "ai_messages": await _all("ai_messages"),
        "daily_prompts": await _all("daily_prompts"),
        "daily_recaps": await _all("daily_recaps"),
        "missions": await _all("missions"),
        "mission_progress": await _all("mission_progress"),
    }


# ---------------------------- Admin audit log ----------------------------
async def _audit(actor: User, action: str, target_user_id: str | None = None, meta: dict | None = None):
    try:
        await db.admin_audit_log.insert_one({
            "id": f"al_{uuid.uuid4().hex[:12]}",
            "actor_user_id": actor.user_id,
            "actor_email": actor.email,
            "actor_role": actor.role,
            "action": action,
            "target_user_id": target_user_id,
            "meta": meta or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        logger.warning("audit log failed: %s", e)


@api.get("/admin/audit-log")
async def admin_audit_log(limit: int = 100, admin: User = Depends(get_admin_user)):
    limit = max(1, min(500, int(limit or 100)))
    cursor = db.admin_audit_log.find({}, {"_id": 0}).sort("created_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


# ============================================================
# Phase A — Behavioral engine: Self-Trust + Execution scores
# ============================================================
def _date_key(iso: str | None) -> str | None:
    if not iso:
        return None
    try:
        return iso[:10]
    except Exception:
        return None


def _compute_scores(items: list[dict], chats: list[dict], days: int = 14) -> dict:
    """Pure-function score engine. Inputs are already-loaded dicts so we can
    reuse for both cloud and stateless variants.
    Returns:
        {
          self_trust: 0..100,
          execution: 0..100,
          consistency_days: int,
          drift_signal: str | None,
          stats: {...}
        }
    """
    now = datetime.now(timezone.utc)
    horizon = now - timedelta(days=days)
    horizon_iso = horizon.isoformat()

    voice_or_text = [i for i in items if i.get("type") in ("voice", "text") and (i.get("created_at") or "") >= horizon_iso]
    tasks = [i for i in items if i.get("type") == "task" and (i.get("created_at") or "") >= horizon_iso]
    reminders = [i for i in items if i.get("type") == "reminder" and (i.get("created_at") or "") >= horizon_iso]

    captures_per_day = len(voice_or_text) / max(1, days)
    tasks_total = len(tasks)
    tasks_done = sum(1 for t in tasks if t.get("completed"))
    reminders_total = len(reminders)
    reminders_done = sum(1 for r in reminders if r.get("completed"))

    # Active days = unique days with any capture.
    days_active = len({_date_key(i.get("created_at")) for i in voice_or_text if i.get("created_at")} - {None})
    consistency_days = days_active  # 0..days

    # --- Execution Score (do you actually do what you said you'd do?) ---
    # weight task completion + reminder completion + recent activity.
    task_rate = (tasks_done / tasks_total) if tasks_total else 0.5  # neutral if none
    rem_rate = (reminders_done / reminders_total) if reminders_total else 0.5
    activity_norm = min(1.0, captures_per_day / 1.5)  # ~1.5/day = full credit
    execution = round((task_rate * 0.45 + rem_rate * 0.20 + activity_norm * 0.35) * 100)

    # --- Self-Trust Score (consistency + intention follow-through) ---
    # weight: consistency 50%, task completion 30%, reminder completion 20%
    cons_norm = consistency_days / max(1, days)  # 0..1
    self_trust = round((cons_norm * 0.50 + task_rate * 0.30 + rem_rate * 0.20) * 100)

    # --- Drift signal (a 1-sentence pattern callout, deterministic) ---
    drift_signal = None
    last_capture_iso = max((i.get("created_at") for i in voice_or_text), default=None)
    if last_capture_iso:
        try:
            last_dt = datetime.fromisoformat(last_capture_iso.replace("Z", "+00:00"))
            hours_since = (now - last_dt).total_seconds() / 3600.0
        except Exception:
            hours_since = 0
    else:
        hours_since = days * 24

    if not voice_or_text:
        drift_signal = "Nothing captured this week — when did you last say what was actually on your mind?"
    elif hours_since > 48:
        drift_signal = f"It's been {int(hours_since/24)} days since you last wrote anything down."
    elif tasks_total >= 3 and tasks_done == 0:
        drift_signal = f"You've named {tasks_total} things to do — none done yet."
    elif reminders_total > 0 and reminders_done == 0:
        drift_signal = "You set reminders but haven't followed through on any."
    elif consistency_days < 3 and days >= 7:
        drift_signal = f"Only {consistency_days} active day(s) in the last week — momentum is thin."

    return {
        "self_trust": max(0, min(100, self_trust)),
        "execution": max(0, min(100, execution)),
        "consistency_days": consistency_days,
        "drift_signal": drift_signal,
        "stats": {
            "captures": len(voice_or_text),
            "captures_per_day": round(captures_per_day, 2),
            "tasks_total": tasks_total,
            "tasks_done": tasks_done,
            "reminders_total": reminders_total,
            "reminders_done": reminders_done,
            "hours_since_last_capture": round(hours_since, 1),
        },
    }


@api.get("/scores")
async def get_scores(days: int = 14, user: User = Depends(get_current_user)):
    days = max(7, min(60, int(days or 14)))
    horizon = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    items = await db.journal_items.find(
        {"user_id": user.user_id, "created_at": {"$gte": horizon}}, {"_id": 0}
    ).to_list(length=2000)
    return _compute_scores(items, [], days=days)


@api.post("/scores-stateless")
async def stateless_scores(payload: dict):
    days = max(7, min(60, int(payload.get("days") or 14)))
    items = payload.get("items") or []
    return _compute_scores(items, [], days=days)


# ============================================================
# Phase A — Next move (single, anchored to top mission/goal)
# ============================================================
async def ai_next_move(profile: dict | None, missions: list[dict] | None,
                       drift_signal: str | None, scores: dict | None) -> dict:
    """Return a single next move under 15 minutes that the user can take RIGHT NOW.
    Returns: { headline: str, action: str, anchor: str (which goal/mission) }
    """
    goals_text = ""
    if profile and profile.get("goals"):
        goals_text = profile["goals"]
    if missions:
        m_lines = []
        for m in missions[:3]:
            t = m.get("outcome") or m.get("title") or ""
            if t:
                m_lines.append(f"- {t}")
        if m_lines:
            goals_text = (goals_text + "\n" + "\n".join(m_lines)).strip()
    goals_text = (goals_text or "(no explicit goals yet)").strip()

    sys = (
        "You are the user's reflective inner voice. Their score data and active goals follow. "
        "Generate ONE next move under 15 minutes that they can do RIGHT NOW. "
        "Return ONLY JSON: "
        "{\"headline\": str (5-9 words, gentle, NOT motivational shouting), "
        "\"action\": str (one specific concrete action under 15 min, second person), "
        "\"anchor\": str (which goal or mission this serves)}. "
        "Never use the words 'AI', 'assistant', 'chatbot'. Never moralise. Never list multiple actions."
    )
    chat = (
        LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"nm-{uuid.uuid4().hex[:8]}", system_message=sys)
        .with_model("openai", "gpt-5.2")
    )
    user_text = (
        f"Goals/Missions:\n{goals_text}\n\n"
        f"Drift signal: {drift_signal or '(none)'}\n"
        f"Self-trust: {(scores or {}).get('self_trust','?')}/100, "
        f"Execution: {(scores or {}).get('execution','?')}/100, "
        f"Consistency: {(scores or {}).get('consistency_days','?')} days."
    )
    try:
        raw = (await chat.send_message(UserMessage(text=user_text))).strip()
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            d = json.loads(m.group(0))
            if d.get("headline") and d.get("action"):
                return {
                    "headline": d["headline"].strip(),
                    "action": d["action"].strip(),
                    "anchor": (d.get("anchor") or "").strip(),
                }
    except Exception as e:
        logger.warning("next-move fallback: %s", e)
    first_goal = (goals_text.splitlines() or ["what matters to you"])[0].lstrip("- ").strip() or "what matters to you"
    return {
        "headline": "Smallest move back to today.",
        "action": f"Open your journal and write one honest sentence about {first_goal}.",
        "anchor": first_goal,
    }


@api.get("/insights/today")
async def insights_today(user: User = Depends(get_current_user)):
    horizon = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    items = await db.journal_items.find(
        {"user_id": user.user_id, "created_at": {"$gte": horizon}}, {"_id": 0}
    ).to_list(length=2000)
    profile = await db.user_profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    missions_docs = await db.missions.find(
        {"user_id": user.user_id, "is_active": True}, {"_id": 0}
    ).sort("created_at", -1).limit(3).to_list(length=3)
    missions_with_stats = [await _serialize_mission(m) for m in missions_docs]
    scores = _compute_scores(items, [], days=14)
    next_move = await ai_next_move(profile, missions_with_stats, scores.get("drift_signal"), scores)
    return {"scores": scores, "next_move": next_move, "missions": missions_with_stats}


@api.post("/insights/today-stateless")
async def insights_today_stateless(payload: dict):
    items = payload.get("items") or []
    profile = payload.get("profile") or None
    missions = payload.get("missions") or []
    scores = _compute_scores(items, [], days=14)
    next_move = await ai_next_move(profile, missions, scores.get("drift_signal"), scores)
    return {"scores": scores, "next_move": next_move, "missions": missions}


# ============================================================
# Phase B — Personality history + Communication style mirroring
# ============================================================
@api.get("/personality/history")
async def personality_history(user: User = Depends(get_current_user)):
    docs = await db.personality_assessments.find(
        {"user_id": user.user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(length=50)
    return docs


def _extract_communication_style(messages: list[dict]) -> dict:
    """Extract shallow, on-the-fly stylistic signals from the user's recent
    messages. Used to make the Mirror sound a bit more like the user.
    Returns: { avg_sentence_len, formality, top_phrases, uses_lowercase, uses_emoji }
    """
    user_msgs = [m for m in messages if m.get("role") == "user"]
    text = " ".join(m.get("content", "") for m in user_msgs[-20:])
    if not text.strip():
        return {}
    sentences = [s.strip() for s in re.split(r"[.!?]+\s+", text) if s.strip()]
    avg_len = round(sum(len(s.split()) for s in sentences) / max(1, len(sentences)), 1)
    # crude formality: lowercase ratio + contractions
    letters = [c for c in text if c.isalpha()]
    lower_ratio = sum(1 for c in letters if c.islower()) / max(1, len(letters))
    formality = "informal" if lower_ratio > 0.92 else ("casual" if lower_ratio > 0.85 else "formal")
    uses_lowercase = lower_ratio > 0.92 and "I " not in text  # they don't capitalise
    # frequent short phrases (2-3 word n-grams)
    words = re.findall(r"[a-zA-Z']+", text.lower())
    phrases = {}
    for n in (2, 3):
        for i in range(len(words) - n + 1):
            ph = " ".join(words[i:i + n])
            if any(s in ph for s in ("the", "and", "for", "to", "of", "is", "i ", "a ", "you")) and n == 2:
                continue
            phrases[ph] = phrases.get(ph, 0) + 1
    top = sorted(phrases.items(), key=lambda x: -x[1])[:5]
    top_phrases = [p for p, c in top if c >= 2]
    uses_emoji = bool(re.search(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]", text))
    return {
        "avg_sentence_len": avg_len,
        "formality": formality,
        "uses_lowercase": uses_lowercase,
        "uses_emoji": uses_emoji,
        "top_phrases": top_phrases,
    }


# ============================================================
# Phase C — Stripe subscriptions, region pricing, free-tier limits
# ============================================================
PRICING_PACKAGES = {
    "premium_monthly_us":  {"amount": 7.99,  "currency": "usd", "interval": "month", "label": "Premium · monthly"},
    "premium_yearly_us":   {"amount": 69.00, "currency": "usd", "interval": "year",  "label": "Premium · yearly"},
    "premium_monthly_in":  {"amount": 199.0, "currency": "inr", "interval": "month", "label": "Premium · monthly"},
    "premium_yearly_in":   {"amount": 1499.0, "currency": "inr", "interval": "year",  "label": "Premium · yearly"},
}

_FREE_DAILY_MIRROR_LIMIT = 5
_FREE_MAX_ACTIVE_MISSIONS = 3


def _today_utc_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def _free_chat_remaining(user: User) -> int:
    """Returns how many mirror replies the user has left today on free tier."""
    if user.is_premium:
        return 999
    today_key = _today_utc_key()
    n = await db.ai_messages.count_documents({
        "user_id": user.user_id,
        "role": "assistant",
        "created_at": {"$gte": today_key},
    })
    return max(0, _FREE_DAILY_MIRROR_LIMIT - n)


def _stripe_checkout(http_request: Request) -> "StripeCheckout":  # type: ignore  # noqa: F821
    from emergentintegrations.payments.stripe.checkout import StripeCheckout
    api_key = os.environ.get("STRIPE_API_KEY", "sk_test_emergent")
    host = str(http_request.base_url).rstrip("/")
    webhook_url = f"{host}/api/webhook/stripe"
    return StripeCheckout(api_key=api_key, webhook_url=webhook_url)


@api.get("/billing/pricing")
async def billing_pricing(region: str = "us"):
    """Public endpoint: list packages for the requested region (us|in)."""
    region = (region or "us").lower()
    if region not in ("us", "in"):
        region = "us"
    out = []
    for pkg_id, pkg in PRICING_PACKAGES.items():
        if not pkg_id.endswith(f"_{region}"):
            continue
        out.append({"id": pkg_id, **pkg})
    return {"region": region, "packages": out}


@api.post("/billing/checkout")
async def billing_checkout(payload: dict, http_request: Request, user: User = Depends(get_current_user)):
    from emergentintegrations.payments.stripe.checkout import CheckoutSessionRequest
    pkg_id = payload.get("package_id")
    origin = (payload.get("origin") or "").rstrip("/")
    if pkg_id not in PRICING_PACKAGES:
        raise HTTPException(status_code=400, detail="Invalid package")
    if not origin:
        raise HTTPException(status_code=400, detail="Missing origin")
    pkg = PRICING_PACKAGES[pkg_id]
    success_url = f"{origin}/account?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/pricing"
    metadata = {
        "user_id": user.user_id,
        "email": user.email,
        "package_id": pkg_id,
        "interval": pkg["interval"],
    }
    sc = _stripe_checkout(http_request)
    req = CheckoutSessionRequest(
        amount=float(pkg["amount"]),
        currency=pkg["currency"],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata=metadata,
    )
    session = await sc.create_checkout_session(req)
    await db.payment_transactions.insert_one({
        "session_id": session.session_id,
        "user_id": user.user_id,
        "email": user.email,
        "package_id": pkg_id,
        "amount": float(pkg["amount"]),
        "currency": pkg["currency"],
        "interval": pkg["interval"],
        "metadata": metadata,
        "payment_status": "initiated",
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"url": session.url, "session_id": session.session_id}


@api.get("/billing/status/{session_id}")
async def billing_status(session_id: str, http_request: Request, user: User = Depends(get_current_user)):
    rec = await db.payment_transactions.find_one({"session_id": session_id, "user_id": user.user_id}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Unknown session")
    sc = _stripe_checkout(http_request)
    status_resp = await sc.get_checkout_status(session_id)
    paid = status_resp.payment_status == "paid"
    new_payment_status = status_resp.payment_status
    new_status = status_resp.status
    update = {
        "payment_status": new_payment_status,
        "status": new_status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # Idempotent premium grant — only flip the user once per session.
    if paid and rec.get("payment_status") != "paid":
        pkg_id = rec.get("package_id") or ""
        plan = "premium_yearly" if "yearly" in pkg_id else "premium_monthly"
        days = 366 if plan == "premium_yearly" else 31
        renews_at = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
        await db.users.update_one(
            {"user_id": user.user_id},
            {"$set": {
                "is_premium": True,
                "plan": plan,
                "plan_renews_at": renews_at,
                "premium_started_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        update["granted_at"] = datetime.now(timezone.utc).isoformat()
    await db.payment_transactions.update_one({"session_id": session_id}, {"$set": update})
    return {
        "session_id": session_id,
        "payment_status": new_payment_status,
        "status": new_status,
        "amount": status_resp.amount_total / 100.0,
        "currency": status_resp.currency,
    }


@api.post("/webhook/stripe")
async def stripe_webhook(http_request: Request):
    body = await http_request.body()
    sig = http_request.headers.get("Stripe-Signature", "")
    try:
        sc = _stripe_checkout(http_request)
        evt = await sc.handle_webhook(body, sig)
    except Exception as e:
        logger.warning("stripe webhook parse failed: %s", e)
        raise HTTPException(status_code=400, detail="bad webhook")
    # We only act on completed payments; checkout.session.completed
    if not evt.session_id:
        return {"ok": True}
    rec = await db.payment_transactions.find_one({"session_id": evt.session_id}, {"_id": 0})
    if not rec:
        return {"ok": True}
    update = {
        "payment_status": evt.payment_status,
        "event_type": evt.event_type,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if evt.payment_status == "paid" and rec.get("payment_status") != "paid":
        pkg_id = rec.get("package_id") or ""
        plan = "premium_yearly" if "yearly" in pkg_id else "premium_monthly"
        days = 366 if plan == "premium_yearly" else 31
        renews_at = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
        await db.users.update_one(
            {"user_id": rec["user_id"]},
            {"$set": {
                "is_premium": True,
                "plan": plan,
                "plan_renews_at": renews_at,
                "premium_started_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        update["granted_at"] = datetime.now(timezone.utc).isoformat()
    await db.payment_transactions.update_one({"session_id": evt.session_id}, {"$set": update})
    return {"ok": True}


@api.get("/billing/me")
async def billing_me(user: User = Depends(get_current_user)):
    """Subscription summary + free-tier remaining counters."""
    remaining = await _free_chat_remaining(user)
    active_missions = await db.missions.count_documents({"user_id": user.user_id, "is_active": True})
    return {
        "is_premium": user.is_premium,
        "plan": user.plan,
        "plan_renews_at": user.plan_renews_at.isoformat() if user.plan_renews_at else None,
        "limits": {
            "mirror_remaining_today": remaining if not user.is_premium else None,
            "mirror_daily_limit": _FREE_DAILY_MIRROR_LIMIT if not user.is_premium else None,
            "max_active_missions": _FREE_MAX_ACTIVE_MISSIONS if not user.is_premium else None,
            "active_missions": active_missions,
        },
    }


# ============================================================
# Phase C — Admin analytics expansion
# ============================================================
@api.get("/admin/analytics")
async def admin_analytics(admin: User = Depends(get_admin_user)):
    total_users = await db.users.count_documents({})
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    active_7d = len(await db.users.distinct("user_id", {"last_seen_at": {"$gte": week_ago}}))
    premium = await db.users.count_documents({"is_premium": True})
    monthly = await db.users.count_documents({"plan": "premium_monthly", "is_premium": True})
    yearly = await db.users.count_documents({"plan": "premium_yearly", "is_premium": True})
    cloud_users = await db.storage_prefs.count_documents({"mode": "cloud"})
    local_users = await db.storage_prefs.count_documents({"mode": {"$in": ["local", "never"]}})
    paid_count = await db.payment_transactions.count_documents({"payment_status": "paid"})
    # Revenue by currency
    pipeline = [
        {"$match": {"payment_status": "paid"}},
        {"$group": {"_id": "$currency", "amount": {"$sum": "$amount"}, "n": {"$sum": 1}}},
    ]
    revenue = []
    async for row in db.payment_transactions.aggregate(pipeline):
        revenue.append({"currency": row["_id"], "amount": float(row["amount"]), "transactions": row["n"]})
    return {
        "users": {
            "total": total_users,
            "active_7d": active_7d,
            "premium": premium,
            "premium_monthly": monthly,
            "premium_yearly": yearly,
            "cloud_mode": cloud_users,
            "local_mode": local_users,
        },
        "revenue": revenue,
        "transactions_paid": paid_count,
    }


app.include_router(api)


# CORS — allow_credentials with allow_origins=["*"] is invalid per the spec.
# Use allow_origin_regex when CORS_ORIGINS is "*" so the response echoes the
# request origin (required for cookie-based auth + SSE with credentials:'include').
_cors_origins_raw = os.environ.get("CORS_ORIGINS", "*").strip()
if _cors_origins_raw in ("*", ""):
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origin_regex=".*",
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origins=[o.strip() for o in _cors_origins_raw.split(",") if o.strip()],
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.on_event("startup")
async def _seed_super_admin():
    """Backfill super admin role for the configured email — fire-and-forget.

    Runs in the background so the readiness probe never waits on the first
    Mongo round-trip (Atlas SRV resolution can take a few seconds on cold start).
    """
    async def _run():
        try:
            await db.users.update_one(
                {"email": SUPER_ADMIN_EMAIL},
                {"$set": {"role": "super_admin"}},
            )
        except Exception as e:
            logger.warning("super admin backfill failed: %s", e)
    asyncio.create_task(_run())


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
