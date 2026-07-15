# Roadmap

Phases are shippable increments. **MVP = Phases 0–4** (a business can connect WhatsApp, run a
lead-collection bot, see leads in a dashboard, and let leads book a call). Everything after is
scale & polish.

### Phase 0 — Foundation (scaffold) ✅ DONE (2026-07-15)
- [x] Turborepo + pnpm workspaces; `apps/{web,gateway,worker}`, `packages/{core,db,flow-engine,whatsapp,scheduling}`.
- [x] Prisma schema (from DATA-MODEL.md) + first migration; Postgres + Redis via docker-compose (Postgres host port 55432 on this box).
- [x] Auth: signup/login server actions (jose JWT + argon2), Organization created on signup, tenant-scoped Prisma helper (`forOrg`).
- [x] Shared config (zod-validated env), pino logger, CI (typecheck + test), health endpoints on all three services.
- [x] Bonus (pulled forward): pure `flow-engine` reducer + tests, `scheduling` slot generator + tests, `whatsapp` provider interface + `MockProvider`, worker inbound processor wiring the loop.
- **Verified:** 12/12 typecheck, 15/15 tests, DB migrated + seeded, dashboard boots, route protection (307) + authed render of live tenant data confirmed.
- **Exit:** ✅ a user can register an org / log in and see the dashboard shell.

### Phase 1 — WhatsApp gateway (connect a number) ✅ DONE (2026-07-15)
- [x] `packages/whatsapp` `BaileysProvider` (baileys 6.7.18): multi-connection, QR events, inbound normalization, reconnect w/ backoff, logout.
- [x] Postgres auth-state persistence (`PrismaAuthStore`, single JSON blob per connection via BufferJSON) — survives restart; initial creds persisted immediately.
- [x] `apps/gateway`: `SessionManager` (status + latest-QR cache, org resolution), token-guarded internal REST API (connect/disconnect/logout/send/state), boot `resumeAll`, BullMQ outbound consumer.
- [x] Gateway publishes normalized inbound to the Redis `wa-inbound` queue (idempotent jobId); worker's flow-engine loop consumes it (built Phase 0).
- [x] Dashboard "Connections" page: create connection → server-proxied QR polling (`/api/connections/[id]/state`, QR rendered to a data-URL image, internal token stays server-side) → live status; reconnect/logout actions; tenant-guarded.
- **Verified:** gateway boots, connect → Baileys emits a real QR in ~1s, QR rendered in dashboard, auth-state (creds w/ Buffer serialization) persisted to Postgres, **gateway restart rehydrates the same identity** (registrationId stable), API route 401s without session. 12/12 typecheck, 15/15 tests.
- **Remaining manual step (needs a physical phone):** scan the QR to pair, then message the number to see the seeded flow reply — the send/receive plumbing (Baileys ↔ queues ↔ flow-engine) is all wired and unit-tested.

> **Deployed 2026-07-15:** live at https://wabot.miltech.cloud (own cert + nginx reverse proxy).
> Committed to git. See docs/DECISIONS.md / kesher-app memory for deploy details.

### Phase 2 — Flow engine + runtime (the bot works)
- `packages/flow-engine`: pure `step()` reducer, node types (message/question/condition/action), validators, full unit tests.
- `apps/worker` inbound processor: resolve Contact, load/persist Conversation state, run the engine, enqueue outbound, save Answers + Messages.
- One seeded JSON lead-collection flow (name → need → contact info).
- **Exit:** a lead completes the flow over real WhatsApp; every answer is a row in Postgres.

### Phase 3 — Dashboard / CRM (see the data) ✅ DONE (2026-07-15)
- [x] Leads/contacts table (`/dashboard/leads`) with name/phone search, tags, collected-fields summary.
- [x] Lead detail (`/dashboard/leads/[id]`): collected fields, tags, appointments, full WhatsApp-style conversation transcript.
- [x] Flows list (`/dashboard/flows`): name, active/inactive, version, step count.
- [x] Dashboard nav to Connections / Leads / Flows; KPI cards already live.
- [x] Demo-data seed (`packages/db/prisma/demo-leads.ts`) so the CRM is populated pre-pairing.
- **Verified live** on https://wabot.miltech.cloud (leads list, lead detail + transcript, flows all 200 + rendering real data).
- Still to do (Phase 3.1, later): assign-owner/add-tag/notes UI, conversations list view, completion-rate KPIs.
- **Exit:** ✅ the business can browse leads, read transcripts, and see flows from the dashboard.

### Phase 4 — Scheduling (book the call) → **MVP COMPLETE** ✅ DONE (2026-07-15)
- [x] `packages/scheduling`: availability rules → open slots (minus booked), min-notice, buffers (built+tested P0).
- [x] Interactive booking pause in the flow-engine (`book_appointment` pauses → `resumeBooking()` continues); pure engine, no slot I/O.
- [x] Worker booking loop: offers a numbered slot menu in-chat, captures the pick, creates the Appointment, sends a WhatsApp confirmation, resumes the flow (closing message). No-availability fallback message.
- [x] AvailabilityRule seed (Sun–Thu 09:00–17:00 IL, 30-min); Appointments dashboard (`/dashboard/appointments`, upcoming/past).
- **Verified end-to-end:** simulated lead conversation → bot offered 5 real slots → lead picked → Appointment created (BOOKED) + confirmation + closing message + conversation COMPLETED; appointment shows live in the dashboard. 13/13 typecheck, 16/16 tests.
- Still to do (later): hosted booking page (public link, same engine), reschedule/cancel.
- **Exit:** ✅ a lead books a sales call end-to-end from a WhatsApp conversation. **MVP (Phases 0–4) complete.**

### Phase 5 — Google Calendar sync + reminders
- Google OAuth per user; two-way sync (write events, read freebusy to block slots).
- Delayed BullMQ reminder jobs (−24h / −1h) over WhatsApp; cancel/reschedule handling.

### Phase 6 — Visual flow builder
- React Flow drag-and-drop editor that reads/writes the same `Flow.definition` JSON.
- Flow templates library; versioning + activate/rollback; test-run mode.

### Phase 7 — SaaS-ready
- Billing (Stripe/Paddle): plans cap connections / contacts / monthly messages; usage metering.
- Onboarding wizard, team invites + RBAC UI, per-org settings, audit log.
- Hebrew/RTL polish + a `he.ts` copy dictionary; marketing/landing site.

### Phase 8 — Scale & hardening
- **Official WhatsApp Cloud API provider** (the strategic upgrade off Baileys' ban risk).
- Shard WhatsApp sessions across multiple gateway instances (consistent hashing by connectionId).
- Postgres RLS as defense-in-depth; secrets encryption review; Sentry + metrics dashboards; load tests.
- Optional: more channels (Instagram/Telegram) via the same provider interface; webhooks/Zapier; public API.

## Immediate next step
Approve/adjust the plan, then I scaffold **Phase 0** (monorepo + db + auth + docker-compose)
so there's a running skeleton to build on.
