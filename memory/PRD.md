# PericL — Personal Voice Journal
© Giridhar Alwar

## What it is
A personal **mirror, not an assistant**. PericL helps the user convert thoughts into clear action, track real progress toward their goals, and gently confront gaps between intention and behavior.

The chat must always feel like the user's own voice — slightly calmer, slightly more honest, slightly more disciplined.

## The Mirror system prompt (iter 5)
Always executes 4 steps and ends with EXACTLY ONE 🎯 Next Move (<15 min, specific, aligned to a top goal):
1. **Clarify** — sharpen what the user actually means
2. **Mirror** — match tone, sentence length; remove confusion, reduce excuses
3. **Reality check** — compare goals vs actual behavior; call out drift calmly
4. **Direct** — single Next Move at the end

Other rules: drift detection ("You're drifting from what you said matters"), time-reality engine for 90-day windows, mood-aware tone (low → softer/smaller; high → push harder), no markdown headings, no multiple steps, no coach/therapist voice, never "as an AI".

### Context inputs the prompt consumes
- Top 3 goals (parsed from `profile.goals`, deduped)
- Identity (`profile.aspirations`)
- MBTI + strengths/growth
- Behavior signals (last 7-14 days):
  `voice_text_entries_7d`, `tasks_completed_7d`, `open_tasks`,
  `missed_or_overdue_reminders`, `overdue_titles`,
  `days_since_last_entry`, `top_moods_7d`
- Recent moods + current_input mood (cheap regex heuristic, avoids extra LLM call)

## Architecture
- Backend (FastAPI + Motor + MongoDB): /app/backend/server.py
  - Auth (Emergent Google) + auto super_admin for `alwargiridhar@gmail.com`
  - Cloud user-content endpoints (mode=cloud)
  - Stateless AI endpoints (mode=local/never): `/ai/transcribe`, `/categorize`, `/chat-stateless`, `/recap-stateless`, `/personality-analyze`, `/daily-prompt-pick`
  - Privacy: `/storage/pref` (GET/PUT), `/storage/prompt-shown`
  - Admin: `/admin/users`, `/admin/users/{id}/role`, `/admin/users/{id}` DELETE, `/admin/stats`
  - Pydantic-typed `MbtiScores`
  - Mirror prompt builder + `_parse_top_goals` + `_compute_behavior_signals_from_items` + `_infer_mood_quick`

- Frontend (React + CRA + Tailwind + shadcn/ui)
  - Pages: Login · Journal · AiChat · Profile · PersonalityAssessment · PersonalityResult · DailyPrompt · Privacy · Admin
  - StorageContext routes via `lib/storage.js` (cloud or local)
  - `lib/storage.js` chat.send (local) computes behavior signals + mood client-side and posts to /ai/chat-stateless
  - MoodEmojiBurst on Chat — privacy-aware, supportive emojis even for sad/stressed
  - Header tagline 'Personal Voice Journal'; admin entry for admin/super_admin; manage-password → Google security
  - Footer 'Personal Voice Journal · © Giridhar Alwar' on every page

## Roles
- `super_admin` — only `alwargiridhar@gmail.com`. Manages admins, deletes users, grants authority. Cannot be demoted.
- `admin` — granted by super admin. Reads all users, demotes regular users.
- `user` — default.

## Personas
- Solo voice journaler who needs structure
- Self-developer using daily prompts + MBTI growth
- Privacy-conscious user keeping data on device
- Super admin / admin moderating

## Implemented (cumulative)
- 2026-04-28 — Iter 1: Auth + voice/text journal + Whisper + GPT-5.2 categorize + timeline + reminders + recap (Gemini 3 Flash) + theme.
- 2026-04-28 — Iter 2: Profile builder, MBTI test, AI-personalized result analyzer, AI chat, daily reflection + history.
- 2026-04-28 — Iter 3: Identity rewrite (no AI mentions, mirror voice), privacy-first storage abstraction (local + IDB audio), monthly cloud-sync modal, stateless AI endpoints, Privacy page, © Giridhar Alwar.
- 2026-04-28 — Iter 4: Floating mood emoji burst (privacy-aware), 'Personal Voice Journal' tagline, super admin auto-promote, Admin dashboard, Manage-password (Google), Pydantic-typed MbtiScores.
- 2026-04-28 — Iter 5: Strict Mirror system prompt (clarify → mirror → reality-check → 🎯 Next Move). Behavior signals fed from journal items (entries / completed / open / overdue / days-since / top moods). Top-3-goal parsing. Reality-engine + drift detection. Mood-aware tone shift. Cheap regex mood inference (no extra LLM round-trip).

## Backlog
- P1: Streaming chat replies; search across journal+chat; native push reminders; admin audit log
- P2: Big Five v2; mood-over-time chart; reminder snooze; bidirectional local↔cloud sync
- P2: Move Mirror prompt to /app/backend/prompts/mirror_chat.md for cleaner diffs
- P2: Mongo $facet aggregation for behavior signals once user content scales
- P2: Subscription / premium tier
