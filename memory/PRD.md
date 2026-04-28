# PericL — Personal Voice Journal · Your private inner voice
© Giridhar Alwar

## Original problem statement
> https://github.com/alwargiridhar/PericL — get the code from this link, its my new app called PericL, personal voice journal designed to record personal notes and mark them as reminders, action items, alarms and etc, now i want to groom this app, check the existing flow and preview the app
>
> Iteration 2 — check all the additional features it has, i have added personal assistant, chat based friend, personality test, result analyser, personality builder, personality developer, check for existing set up and keep them as is and modify things on top of it
>
> Iteration 3 — my initial thought was to create this agent as a replica of ones self, like i support myself for my growth, i know my weeknesses and positives, push myself a bit more, understand my situations and response pattern with my chatting pattern and emotional stability, respond to my chat like i do with myself... motivate myself to grow in a way i want to, find my goals, try to monetize them with suggestions or create a strategy to build my profile, it should be more like me, rather talking to AI, remove the mention of AI in the App, Copy rights to Giridhar Alwar.
> this app information should be saved in the personal mobile, not on any cloud by default, if the user wants to save their data on cloud which will be managed by the admin, with data integrity, for future enhancements with user confirmation. once in a month the app should ask, do you want to save your personal data to app database? do you want a reminder or permanently don't want to save it? when the user keeps the data hidden, that shouldnt be tracked by the app

## Core identity
- PericL is **not an AI assistant**. It is the user's own inner voice, written down — calmer, slightly ahead of them.
- Every system prompt explicitly forbids "as an AI" or "as an assistant" and is in second-person mirror voice.
- Goal-aware: profile/aspirations push the chat toward the user's monetization & growth strategy.
- Copyright in every footer: `© <year> Giridhar Alwar · PericL`.

## Privacy model (default = local)
- `local` (default): everything in browser (localStorage + IndexedDB for audio). Server stores only identity + storage_pref.
- `cloud`: full sync to MongoDB.
- `never`: like local + suppress monthly nudge.
- Once a month, `CloudSyncPrompt` modal asks: Yes / Remind me / Never. When user picks Never, app stops asking forever.
- All AI calls (chat, transcription, categorization, recap, MBTI analysis, daily-prompt picker) have **stateless** variants that don't persist anything server-side.

## Architecture
- **Backend** (FastAPI + Motor + MongoDB): /app/backend/server.py
  - Identity: `/api/auth/process-session`, `/api/auth/me`, `/api/auth/logout`
  - Cloud (only used when mode='cloud'): `/api/notes/voice`, `/api/notes/text`, `/api/timeline`, `/api/items/{id}`, `/api/audio/{id}`, `/api/recap/today`, `/api/recap`, `/api/profile`, `/api/personality/*`, `/api/ai/messages`, `/api/ai/chat`, `/api/daily-prompt*`
  - **Stateless (always available)**: `/api/ai/transcribe`, `/api/ai/categorize`, `/api/ai/personality-analyze`, `/api/ai/chat-stateless`, `/api/ai/recap-stateless`, `/api/ai/daily-prompt-pick`
  - **Storage prefs**: `/api/storage/pref` (GET/PUT), `/api/storage/prompt-shown`

- **Frontend** (React + CRA + Tailwind + shadcn/ui)
  - Pages: Login · Journal · AiChat · Profile · PersonalityAssessment · PersonalityResult · DailyPrompt · Privacy
  - Single source of truth for user content: `/app/frontend/src/lib/storage.js` (branches on `cloud` vs `local`/`never`)
  - StorageProvider context exposes `mode`, `showPrompt`, `setMode`, `snooze`
  - CloudSyncPrompt modal auto-fires when `should_prompt_now`
  - Footer on every page: © Giridhar Alwar
  - Header shows on-device lock badge when not in cloud mode
  - Design: Cabinet Grotesk + Satoshi, Sand/Moss + Deep Forest/Pale Moss palette

## Implemented
- 2026-04-28 — Iter 1: Auth, voice/text journaling, Whisper, GPT-5.2 categorization, timeline, reminders, daily recap (Gemini 3 Flash), light/dark theme.
- 2026-04-28 — Iter 2: Profile (personality builder), 32-q MBTI test, AI-personalized result analyzer, AI Chat (context-aware), Daily reflection prompt + history.
- 2026-04-28 — Iter 3: Identity rewrite (no "AI" mentions, second-person mirror voice, Giridhar Alwar copyright), privacy-first storage abstraction (local default + IndexedDB audio), monthly cloud-sync nudge, stateless AI endpoints with proven-zero-write tests, Privacy & data settings page.

## Personas
- Solo voice-journaler who needs structure
- Reflective self-developer using daily prompts + MBTI growth + monetization-aware push
- Privacy-conscious user who wants nothing on cloud unless they choose

## Backlog
- P1: Streaming chat replies, search across journal+chat, native push reminders
- P1: Pydantic-typed scores model on `/ai/personality-analyze` for fail-fast validation
- P2: Big Five personality v2; mood-over-time chart; reminder snooze; full local↔cloud bidirectional sync (currently profile-only on opt-in)
- P2: Subscription / premium tier
