# PericL — Personal Voice Journal
© Giridhar Alwar

## Original problem statements (cumulative)
1. Iter 1 — port the existing PericL flow from the Cloudflare/Hono repo onto the supported stack and preview.
2. Iter 2 — restore additional features: personal assistant, AI chat-friend, personality test, result analyzer, personality builder, personality developer.
3. Iter 3 — make PericL feel like a replica of the user (not an AI). Privacy-first storage on device by default; once-a-month cloud-sync nudge. Copyright Giridhar Alwar.
4. Iter 4 — mood-driven floating emojis on chat (positivity enhancers). 'Personal Voice Journal' tagline. alwargiridhar@gmail.com is super admin (creates admins, checks users, grants authority). Password reset via Google. Pydantic-typed scores.

## Architecture
- Backend (FastAPI + Motor + MongoDB): /app/backend/server.py
  - Auth (Emergent Google) + auto-promote `alwargiridhar@gmail.com` → super_admin
  - Cloud user-content endpoints (used when storage_mode=cloud)
  - Stateless AI endpoints (used when storage_mode=local/never): /api/ai/{categorize,chat-stateless,recap-stateless,personality-analyze,daily-prompt-pick,transcribe}
  - Storage prefs: /api/storage/{pref,prompt-shown}
  - Admin: /api/admin/{users, stats, users/{id}/role, users/{id}}
  - Pydantic-typed MbtiScores model for fail-fast validation

- Frontend (React + CRA + Tailwind + shadcn/ui)
  - Pages: Login · Journal · AiChat · Profile · PersonalityAssessment · PersonalityResult · DailyPrompt · Privacy · Admin
  - StorageContext routes every read/write through `lib/storage.js` (local+IDB or cloud)
  - MoodEmojiBurst on Chat — emojis float upward based on detected mood. In `cloud` mode, uses /api/ai/categorize; in `local`/`never` mode, uses a small client-side keyword heuristic so user text never leaves the device just for emojis.
  - Header shows tagline 'Personal Voice Journal', admin entry for admin/super_admin, manage-password link to Google security
  - Footer 'Personal Voice Journal · © Giridhar Alwar' on every page
  - Cabinet Grotesk + Satoshi · Sand/Moss + Deep Forest/Pale Moss

## Roles
- `super_admin` — only `alwargiridhar@gmail.com`. Can manage admins, delete users, grant authority. Cannot be demoted.
- `admin` — granted by super admin. Can view users + demote regular users. Cannot promote anyone or delete.
- `user` — default.

## Personas
- Solo voice journaler who needs structure
- Reflective self-developer using daily prompts + MBTI growth + monetization-aware push
- Privacy-conscious user keeping data on device
- Super admin / admin moderating + maintaining

## Implemented
- 2026-04-28 — Iter 1: Auth, voice/text journal, Whisper, GPT-5.2 categorize, timeline, reminders, recap (Gemini 3 Flash), light/dark theme.
- 2026-04-28 — Iter 2: Profile builder, MBTI test, AI-personalized result analyzer, AI chat, daily reflection + history.
- 2026-04-28 — Iter 3: Identity rewrite (no AI mentions, second-person mirror), privacy-first storage abstraction (local + IndexedDB audio), monthly cloud-sync modal, stateless AI endpoints, Privacy page, © Giridhar Alwar.
- 2026-04-28 — Iter 4: Floating mood emoji burst on chat (privacy-aware), 'Personal Voice Journal' tagline everywhere, super admin auto-promote, full Admin dashboard (stats, search, role badges, promote/demote/delete), Manage password (Google), Pydantic-typed MbtiScores.

## Backlog
- P1: Streaming chat replies; search across journal+chat; native push reminders
- P2: Big Five personality v2; mood-over-time chart; reminder snooze; bidirectional local↔cloud sync
- P2: Audit log for admin actions
- P2: Cascade-delete via user_data tag/index instead of hard-coded collection list
- P2: Subscription / premium tier
