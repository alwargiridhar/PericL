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
    doc = await db.journal_items.find_one({"id": item_id}, {"_id": 0})
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
