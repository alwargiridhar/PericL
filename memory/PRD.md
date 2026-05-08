# PericL — Personal Voice Journal → Private Behavioral OS
© Giridhar Alwar

## Positioning (since iter 7)
**Stop drifting. Start becoming.** A private behavioral operating system that helps users stay aligned with who they said they wanted to become — without sacrificing privacy.

Core promise:
- **Mirror, not assistant** — never use "AI", "chatbot", "assistant"
- **Privacy-first by default** — Local Private Mode is the onboarding default; Cloud Intelligence is opt-in
- **Behavioral, not motivational** — drift detection + execution scoring + Self-Trust score
- **Premium = clarity, not tokens**

## Architecture (current)
- Backend (FastAPI + Motor + MongoDB): /app/backend/server.py (~2900 lines — flagged for split)
- Frontend (React CRA + Tailwind + shadcn/ui + framer-motion + recharts)
- PWA (manifest.json + sw.js + icons + drift-nudge timer)
- Stripe Checkout (sk_test_emergent in pod env) — region pricing US/IN

## Routes
- `/` — Home (Identity · Drift · Next Move · Scores · Missions · Quick Actions)
- `/journal` — original timeline (voice + text capture, snooze, push reminders)
- `/chat` — Mirror (streaming SSE, paywall on free quota)
- `/missions` · `/profile` · `/search` · `/admin`
- `/personality/{assessment, mbti, big-five, big-five/result/:id, result/:id}`
- `/onboarding` — mandatory privacy picker (Local Private vs Cloud Intelligence)
- `/pricing` — region toggle, Free vs Premium tiers, Stripe Checkout
- `/account` — plan + remaining limits + upgrade
- `/privacy` — mode + drift-nudge config + cloud download
- `/login` — landing page (new "Stop drifting. Start becoming." hero)

## Backend endpoints (additions in iter 7)
- `GET /api/scores`, `POST /api/scores-stateless` — Self-Trust + Execution + drift signal (deterministic)
- `GET /api/insights/today`, `POST /api/insights/today-stateless` — scores + AI-generated next move + missions
- `GET /api/personality/history` — sorted assessments for evolution chart
- `_extract_communication_style()` — wired into chat system prompt (style mirroring)
- `GET /api/billing/pricing?region=us|in` — public package list
- `POST /api/billing/checkout` — creates Stripe session, persists payment_transactions
- `GET /api/billing/status/{session_id}` — polls + flips is_premium on paid
- `POST /api/webhook/stripe` — idempotent premium grant
- `GET /api/billing/me` — subscription summary + remaining quota
- `GET /api/admin/analytics` — total/active/premium/cloud_mode/local_mode + revenue by currency
- `POST /api/ai/drift-nudge[-stateless]` — extended with personality + drift_count_today
- Free-tier 402 on `/ai/chat` and `/ai/chat/stream` after 5 daily replies
- Cascade-delete in `/admin/users/{id}` now covers missions + mission_progress + payment_transactions

## Frontend (additions in iter 7)
- `lib/encrypted_storage.js` — AES-GCM via Web Crypto, key in IndexedDB, `PCL1:` envelope, transparent fallback for legacy reads
- `lib/storage.js` — wired through encrypted_storage; `lsGet/lsSet/lsDel` use it
- `lib/behavioral_engine.js` — pure-function score computation + cloud-or-stateless `getTodayInsights`
- `pages/Home.jsx` — Identity / Drift / Next Move / Score Rings / Missions / Quick Actions
- `pages/Onboarding.jsx` — two-card privacy picker, gates first-time users
- `pages/Pricing.jsx` — region toggle, Stripe Checkout buttons
- `pages/Account.jsx` — plan summary + usage limits + upgrade + ?session_id polling
- `components/PaywallModal.jsx` — soft 402 paywall in chat
- `components/PersonalityEvolution.jsx` — recharts LineChart + delta phrases
- `contexts/AuthContext.jsx` — awaits `encryptionReady` before /auth/me
- `components/ProtectedRoute.jsx` — gates first-time users to /onboarding
- `pages/AiChat.jsx` — opens PaywallModal on 402

## Free vs Premium
- **Free**: 3 active missions, 5 mirror replies/day, all on-device features
- **Premium ($7.99/mo or ₹199/mo, $69/yr or ₹1499/yr)**: unlimited mirror, emotional memory, cloud sync, advanced reports

## Privacy enforcement
- Admins/super_admins CANNOT read journals, chats, reflections, voice — only metadata (counts, mode, role)
- Local Private Mode: AES-GCM encrypted localStorage + stateless AI calls (no server logging)
- Audit log on every role change + user delete

## Roles
- `super_admin` — `alwargiridhar@gmail.com` only. Auto-promoted on login.
- `admin` — granted by super admin
- `user` — default

## Implemented changelog
- 2026-04-28 Iter 1-6: voice/text journal, MBTI + Big Five, Mirror chat, missions w/ auto-progress, mood timeline, daily prompts, daily recap, search, push reminders, snooze, PWA, install prompt, drift nudge v1, audit log, bidirectional sync
- 2026-04-30 **Iter 7 — full repositioning to behavioral OS**:
  - Phase A: new Home page with Self-Trust + Execution scores (deterministic) + Identity Header + Drift Insight + Next Move; mandatory Onboarding privacy picker
  - Phase B: AES-GCM encrypted local storage; personality history endpoint + Evolution chart; communication-style mirroring in chat
  - Phase C: Stripe Checkout integration with US/IN region pricing; free-tier 402 limits; PaywallModal; Account page; admin analytics expansion
  - Phase D: drift nudge v2 (personality-aware + drift-count-aware tone)

## Known issues / backlog
- server.py is 2900+ lines → split into routers (auth, behavioral_engine, billing, ai, personality, missions, admin, sync) — not blocking
- Migrate FastAPI on_event → lifespan handlers
- Move Mirror prompt to /app/backend/prompts/mirror_chat.md
- Service-worker push reminders (background, when tab closed)
- Big Five v2 retake comparison report (richer than current evolution chart)
- Stripe customer portal endpoint (currently users cancel via direct Stripe email)
