# PericL — Personal Voice Journal
© Giridhar Alwar

## What it is
A personal **mirror, not an assistant**. PericL helps the user convert thoughts into clear action, track real progress toward their goals, and gently confront gaps between intention and behavior.

The chat must always feel like the user's own voice — slightly calmer, slightly more honest, slightly more disciplined.

## Mirror system prompt (iter 5)
Always executes 4 steps and ends with EXACTLY ONE 🎯 Next Move (<15 min, specific, aligned to a top goal):
1. **Clarify**, 2. **Mirror**, 3. **Reality check**, 4. **Direct (one Next Move)**.
Inputs: top 3 goals, identity, MBTI/Big Five, behavior signals (entries/tasks/reminders/moods/last 7-14d), mood (regex inferred), active missions with stats.

## Architecture
- Backend (FastAPI + Motor + MongoDB): /app/backend/server.py (~2200 lines)
  - Auth: Emergent Google + auto super_admin for `alwargiridhar@gmail.com`
  - Cloud user-content endpoints (mode=cloud)
  - Stateless AI: `/ai/transcribe`, `/categorize`, `/chat-stateless`, `/recap-stateless`, `/personality-analyze`, `/big-five-analyze`, `/daily-prompt-pick`, `/detect-progress`
  - **Streaming SSE**: `/ai/chat/stream` (cloud, persists), `/ai/chat-stateless/stream` (local) — uses litellm.acompletion via Emergent proxy
  - **Search**: `/search?q=` across journal_items + ai_messages
  - **Mood timeline**: `/mood/timeline?days=`
  - **Big Five**: `/personality/big-five-assess`
  - **Sync**: `/sync/import` (idempotent bulk upsert), `/sync/export`
  - **Audit log**: `/admin/audit-log` (rows written on role change + delete user)
  - Privacy: `/storage/pref` GET/PUT, `/storage/prompt-shown`
  - Admin: `/admin/users`, `/admin/users/{id}/role`, `/admin/users/{id}` DELETE, `/admin/stats`
  - Missions: `/missions`, `/missions/{id}/progress`, `/ai/detect-progress`

- Frontend (React CRA + Tailwind + shadcn/ui)
  - Pages: Login · Journal · AiChat · Profile · Search · PersonalityAssessment (chooser) · MbtiAssessment · BigFiveAssessment · BigFiveResult · PersonalityResult · DailyPrompt · Privacy · Admin · Missions
  - Components: Header (search btn) · TimelineItem (snooze dropdown for reminders) · MoodChart (recharts) · MoodEmojiBurst · CloudSyncPrompt · RecapDrawer · VoiceDock · Footer
  - Hooks: useRecorder · useSpeechRecognition · usePushReminders (foreground browser Notifications)
  - StorageContext gates child rendering until mode is loaded → no more local/cloud race
  - lib/storage.js: chat.send + chat.sendStream (SSE), journal, missions, profile, personality (MBTI + Big Five), search, mood, prompt, recap, migrateLocalToCloud, migrateCloudToLocal

## Roles
- `super_admin` — `alwargiridhar@gmail.com` only. Manages admins/users.
- `admin` — granted by super admin. Reads users, demotes regular users.
- `user` — default.

## Privacy modes
- `local` (default) — content stays on device, AI calls stateless
- `cloud` — managed sync to MongoDB
- `never` — local + suppress monthly nudge

## Implemented (cumulative)
- 2026-04-28 Iter 1: auth + voice/text journal + Whisper + GPT-5.2 categorize + recap (Gemini 3 Flash)
- 2026-04-28 Iter 2: profile builder, MBTI test, AI personality analyzer, AI chat, daily reflection
- 2026-04-28 Iter 3: privacy-first abstraction (local IDB audio), monthly cloud-sync modal, stateless AI endpoints
- 2026-04-28 Iter 4: mood emoji burst, super admin auto-promote, Admin dashboard, Pydantic MbtiScores
- 2026-04-28 Iter 5: strict Mirror system prompt with drift/reality engine + missions (3 active cap, tracks, auto-detected progress, mission stats injected into chat prompt)
- 2026-04-28 **Iter 6** — P1+P2 batch:
  - **Streaming chat replies** via SSE (litellm.acompletion stream) for both cloud + stateless
  - **Search** across journal + chat (UI page /search; debounced; highlight)
  - **Native push reminders** (foreground Notifications API + permission banner)
  - **Big Five (OCEAN)** assessment + result page; chooser between MBTI and Big Five
  - **Mood-over-time chart** (recharts area chart on /profile, day-aggregated, mood-coloured dots)
  - **Reminder snooze** (10m / 1h / tomorrow / next week dropdown on TimelineItem)
  - **Bidirectional local↔cloud sync** (`/sync/import` & `/sync/export`; cloud→local download in Privacy)
  - **Admin audit log** (collection + UI section; logs role changes + user deletions)
  - StorageContext now gates children until pref loaded — fixes prior local/cloud race

## Backlog
- P2: Move Mirror prompt to /app/backend/prompts/mirror_chat.md for cleaner diffs
- P2: Mongo $facet aggregation for behavior signals once user content scales
- P2: Subscription / premium tier
- P2: Service-worker push reminders (background, even when tab closed)
- P2: Split server.py into modules (auth, journal, ai, personality, missions, admin, sync) — currently 2200+ lines
- P2: Migrate FastAPI on_event to lifespan
