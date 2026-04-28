# PericL — Personal Voice Journal

## Original problem statement
> https://github.com/alwargiridhar/PericL — get the code from this link, its my new app called PericL, personal voice journal designed to record personal notes and mark them as reminders, action items, alarms and etc, now i want to groom this app, check the existing flow and preview the app

The user uploaded a Cloudflare Workers + Hono + SQLite repo (built on getmocha.com). Stack here is React + FastAPI + MongoDB, so we re-implemented the core PericL flow on the supported stack with a polished design.

## User choices (from `ask_human`)
- Voice transcription/AI: OpenAI Whisper + GPT-5.2 + Gemini 3 Flash
- Use Emergent Universal LLM Key
- Auth: WhatsApp-like seamless onboarding → Emergent Managed Google Auth (frictionless one-tap)
- Reminders: in-app notifications only
- Theme: user-controlled light/dark mode toggle

## Architecture
- **Backend** (FastAPI + Motor + MongoDB): /app/backend/server.py
  - Auth: `/api/auth/process-session`, `/api/auth/me`, `/api/auth/logout` (cookie-based, 7-day session)
  - Notes: `/api/notes/voice` (multipart, Whisper → GPT-5.2 categorize), `/api/notes/text`
  - Timeline: `/api/timeline`, `/api/items/{id}` PATCH/DELETE
  - Audio: `/api/audio/{id}` (base64 in Mongo)
  - Recap: `/api/recap/today` (Gemini 3 Flash), `/api/recap` list
- **Frontend** (React + CRA, Tailwind, shadcn/ui)
  - Pages: Login, Journal (chat-like timeline)
  - Components: Header, VoiceDock (record/text), TimelineItem, RecapDrawer, AuthCallback, ProtectedRoute
  - Contexts: ThemeProvider (localStorage), AuthProvider
  - Hooks: useRecorder (MediaRecorder + Web Audio analyser), useSpeechRecognition (live transcript)
  - Design: Cabinet Grotesk + Satoshi fonts, Organic & Earthy palette (Sand/Moss + Deep Forest/Pale Moss)

## Implemented (2026-04-28)
- Emergent Google Auth flow (callback handler + protected route)
- Voice recording with live waveform + on-device transcription preview
- Whisper backend transcription (with client transcript fallback)
- GPT-5.2 JSON categorization → tasks / reminders / ideas with priority + due_at
- Text-mode quick journaling
- Chat-like timeline (user notes right, extracted items left)
- In-app reminder polling + sonner toast when due
- Mark task done / dismiss / delete
- Daily recap generated via Gemini 3 Flash (drawer UI)
- Light/Dark theme toggle (header + login)
- Mobile-first layout, glass dock, organic blobs, paper grain texture

## Personas
- Solo journaler who thinks out loud and forgets actions
- Idea hoarder who needs gentle structure
- Habit reflector who likes a daily wrap-up

## Backlog
- P0: Audio playback waveform scrub
- P1: Filter chips (only tasks / reminders / ideas)
- P1: Search through journal
- P1: Reminder snooze
- P2: PWA install + offline cache
- P2: Mood timeline chart over time
- P2: Personality assessment (MBTI) + AI tone mirroring (was in original)
- P2: Native push notifications
- P2: Subscription paywall (Stripe)
