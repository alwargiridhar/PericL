# PericL — Personal Voice Journal + Personal AI Companion

## Original problem statement
> https://github.com/alwargiridhar/PericL — get the code from this link, its my new app called PericL, personal voice journal designed to record personal notes and mark them as reminders, action items, alarms and etc, now i want to groom this app, check the existing flow and preview the app
>
> Iteration 2: check all the additional features it has, i have added personal assistant, chat based friend, personality test, result analyser, personality builder, personality developer, check for existing set up and keep them as is and modify things on top of it

The original repo was on Cloudflare Workers + Hono + SQLite (incompatible). We re-implemented on React + FastAPI + MongoDB while preserving the user's intended feature set.

## User choices
- Voice/AI: OpenAI Whisper + GPT-5.2 + Gemini 3 Flash via Emergent Universal Key
- Auth: Emergent Managed Google Auth (one-tap)
- Reminders: in-app notifications only
- Theme: user-controlled light/dark toggle

## Architecture
- Backend (FastAPI + Motor + MongoDB): /app/backend/server.py
  - Existing journal: `/api/notes/voice`, `/api/notes/text`, `/api/timeline`, `/api/items/{id}`, `/api/audio/{id}`, `/api/recap/today`, `/api/recap`
  - Auth: `/api/auth/process-session`, `/api/auth/me`, `/api/auth/logout`
  - **NEW** Profile: `/api/profile` (GET, PUT)
  - **NEW** Personality: `/api/personality/assess` (POST), `/api/personality/latest`, `/api/personality/result/{id}`
  - **NEW** AI Chat: `/api/ai/chat` (POST), `/api/ai/messages` (GET, DELETE), `/api/ai/messages/{id}` (DELETE)
  - **NEW** Daily Prompt: `/api/daily-prompt` (GET), `/api/daily-prompt/respond` (POST), `/api/daily-prompts/history`, `/api/daily-prompts/{id}` (DELETE)

- Frontend (React + CRA + Tailwind + shadcn/ui)
  - Pages: Login, Journal (timeline + voice/text dock), AiChat, Profile, PersonalityAssessment, PersonalityResult, DailyPrompt
  - Header: nav to Chat / Daily prompt / Recap; user menu → Profile / Personality test / Sign out
  - Design: Cabinet Grotesk + Satoshi, Organic & Earthy palette (Sand/Moss + Deep Forest/Pale Moss)

## Implemented
- 2026-04-28 (Iteration 1): Auth, Voice/Text journaling, Whisper, GPT-5.2 categorization, Timeline, Reminder polling, Daily Recap (Gemini 3 Flash), Light/Dark theme.
- 2026-04-28 (Iteration 2): **Personality Builder (Profile)**, **Personality Test (32-q MBTI)**, **Result Analyzer (AI-personalized strengths + growth via GPT-5.2)**, **AI Chat (personal assistant + friend, context-aware)**, **Personality Developer (Daily Reflection prompt — randomized + personality-aware + history)**.
- Polished server idempotency: profile PUT no longer downgrades `onboarding_completed` once true.

## Personas
- Solo journaler who thinks out loud and forgets actions
- Idea hoarder who needs gentle structure
- Self-development seeker doing daily reflection + MBTI growth
- Anyone wanting a thoughtful AI friend that knows them

## Backlog
- P1: Filter chips on timeline (only tasks/reminders/ideas), search across journal
- P1: Streaming AI chat (currently non-streaming; ~3-6s per turn)
- P1: Native browser/PWA push reminder notifications
- P1: Unique compound index on daily_prompts (user_id, prompt_date)
- P2: Mood-over-time chart
- P2: Voice playback waveform scrub
- P2: Reminder snooze
- P2: Personality assessment v2 with more nuance (Big Five)
- P2: Subscription paywall (Stripe) for premium AI features
