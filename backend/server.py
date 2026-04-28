"""PericL backend — Personal Voice Journal with AI categorization.

Stack: FastAPI + MongoDB. Auth via Emergent Managed Google.
Transcription: OpenAI Whisper. Categorization: GPT-5.2. Daily recap: Gemini 3 Flash.
"""
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


# ---------------------------- Models ----------------------------
class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: str | None = None
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
    return User(**user_doc)


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
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
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
    "You are PericL, a personal voice-journal AI. The user just spoke or typed a thought. "
    "Read it carefully and extract structured items. Return ONLY a JSON object with this shape: "
    '{"summary": str (1 short sentence summarizing what the user said), '
    '"mood": one of ["calm","happy","stressed","sad","excited","focused","neutral"], '
    '"items": [ { "type": "task" | "reminder" | "idea" | "note", "title": str, '
    '"priority": "low"|"medium"|"high", "due_at": ISO8601 or null } ] } . '
    "Rules: extract distinct actionable units. A 'reminder' has a date/time the user wants to be reminded. "
    "A 'task' is a TODO with no specific time. An 'idea' is a thought worth saving. "
    "If the message is purely emotional/reflective, return items=[] (it remains a journal note). "
    "If user says 'tomorrow at 6pm', resolve to ISO8601 in UTC based on the provided current_time. "
    "Keep titles concise (max 80 chars). NEVER include text outside JSON."
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
            "You are PericL's reflective daily-recap voice. Read the user's day notes "
            "and produce a warm, 4-6 sentence recap summarizing themes, mood and key intents. "
            "Be specific, kind, and second-person ('you'). No bullet points. Plain text."
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
        "You are a warm, evidence-based MBTI coach. Given a personality type and (optional) profile, "
        "return ONLY JSON: {\"description\": str (2-3 sentences, second-person warm voice), "
        "\"strengths\": [str, str, str, str] (concise), "
        "\"growth_areas\": [str, str, str, str] (concise, framed positively) }"
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
    scores = payload.get("scores") or {}
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


# ---------------------------- AI Chat (Personal Assistant + Friend) ----------------------------
def _build_chat_system_message(profile: dict | None, personality: dict | None, recent_moods: list[str]) -> str:
    parts = [
        "You are PericL — a warm, perceptive personal assistant + thoughtful friend, all in one.",
        "Be direct yet kind, curious, never preachy. Match the user's energy and reading level.",
        "Use short paragraphs, no markdown headings. Avoid emojis unless the user uses them first.",
        "When useful, ask one focused follow-up question. Help users reflect, plan, or just feel heard.",
    ]
    if profile:
        bits = []
        for f in ("name", "age", "occupation", "goals", "challenges", "core_values", "aspirations"):
            v = profile.get(f)
            if v:
                bits.append(f"{f}: {v}")
        if bits:
            parts.append("\nUser profile snapshot:\n- " + "\n- ".join(bits))
    if personality:
        pt = personality.get("personality_type")
        if pt:
            parts.append(
                f"\nMBTI type: {pt} ({personality.get('type_name','')}). "
                f"Mirror their communication style. Strengths: {', '.join(personality.get('strengths') or [])[:300]}. "
                f"Growth areas (be gentle): {', '.join(personality.get('growth_areas') or [])[:300]}."
            )
    if recent_moods:
        parts.append("\nRecent moods (most recent first): " + ", ".join(recent_moods[:5]))
    return "\n".join(parts)


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

    sys_msg = _build_chat_system_message(profile, personality_doc, moods)

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
        reply = "Sorry, I had a tiny hiccup just now. Want to try that again?"

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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
