# Architecture

## 1. Guiding principles

- **Modular**: every capability is a package with a clean interface; apps are thin wiring.
- **Reusable**: the flow engine, WhatsApp layer, and scheduling logic are provider- and
  framework-agnostic packages you could lift into another product.
- **Scalable**: stateless web tier scales horizontally; stateful WhatsApp sessions live in
  a dedicated gateway; all heavy/async work runs through a queue.
- **Multi-tenant**: one deployment serves many businesses; hard row-level isolation.
- **Swappable providers**: WhatsApp and Calendar are behind adapter interfaces.

## 2. Why not "just Next.js"

Baileys keeps a **live, stateful socket** to WhatsApp per connected number and must run in
an **always-on process** — it cannot live in serverless Next.js route handlers. This single
fact drives the topology: WhatsApp lives in its own long-running **gateway** service, and
message processing is **queue-driven** so the web tier stays stateless and cheap to scale.

## 3. Topology (monorepo — Turborepo + pnpm workspaces)

```
kesher/
├─ apps/
│  ├─ web        Next.js 15 (App Router, TS) — dashboard, auth, tenant admin, flow builder,
│  │             booking pages, marketing site. Stateless. Server actions + a thin REST API.
│  ├─ gateway    Always-on Node (Fastify) service. Hosts one Baileys session per WhatsApp
│  │             connection (multi-tenant). Handles QR pairing, reconnect, auth-state
│  │             persistence. Publishes inbound messages to a queue; consumes outbound.
│  └─ worker     BullMQ workers. The runtime brain: runs inbound messages through the flow
│                engine, persists answers, schedules reminders, runs calendar-sync jobs.
├─ packages/
│  ├─ core       Shared types, config, tenant context, auth (jose JWT + argon2), RBAC, logger.
│  ├─ db         Prisma schema + generated client + migrations. Single source of DB truth.
│  ├─ flow-engine  Pure TS bot runtime. (flowDef + convoState + inboundMsg) → actions[].
│  │              No I/O, no WhatsApp, no DB. Fully unit-testable. THE crown jewel.
│  ├─ whatsapp   Provider abstraction. WhatsAppProvider interface + BaileysProvider impl
│  │              (+ CloudApiProvider later). Normalizes inbound/outbound message shapes.
│  ├─ scheduling Availability rules → open slots; booking logic; GoogleCalendar adapter.
│  └─ ui         shadcn/ui-based component library shared by web (and future apps).
└─ infra/        docker-compose, Dockerfiles, nginx snippet, migration/seed scripts.
```

Boundary rule: **only `apps/*` do I/O and wiring; `packages/*` hold logic.** `flow-engine`
and `scheduling` never import WhatsApp or Prisma directly — they take data in, return
decisions out. That is what makes them reusable and trivially testable.

## 4. End-to-end data flow (a lead messages the business)

```
Lead's WhatsApp
   │  inbound message
   ▼
apps/gateway ──(Baileys socket)── receives, normalizes to InboundMessage
   │  enqueue → Redis "inbound" queue  {orgId, connectionId, from, text, ...}
   ▼
apps/worker (BullMQ inbound processor)
   │  1. resolve/create Contact (by phone, scoped to org)
   │  2. load or start Conversation + its flow-run state
   │  3. flow-engine.step(flowDef, state, message) → { actions, nextState }
   │  4. persist Answers, tags, updated state (Postgres via packages/db)
   │  5. for each action → enqueue outbound / schedule job
   ▼
Redis "outbound" queue  {orgId, connectionId, to, message}
   ▼
apps/gateway (outbound consumer) ── rate-limited send via Baileys ── Lead's WhatsApp
```

Booking branch: when the flow hits a `book_appointment` node, the worker generates open
slots (packages/scheduling) and sends them in-chat (or a short booking link). The reply /
booking creates an `Appointment`, optionally writes a Google Calendar event, and schedules
delayed BullMQ reminder jobs (e.g. −24h, −1h) that fan back out over WhatsApp.

Everything the lead answers is a row in Postgres → the dashboard is just reads over that.

## 5. The flow engine (bot brain)

A flow is a **directed graph of nodes**, stored as JSON per org (versioned). Node types:

- `message` — send text/media, no wait.
- `question` — send a prompt, **wait** for a reply; validate & coerce (text | number | email |
  phone | choice | date); save into a named field on the contact/lead.
- `condition` — branch on collected data (`answers.budget > 1000`, tag present, etc.).
- `action` — `save_field`, `add_tag`, `notify_agent`, `assign_owner`, `book_appointment`,
  `webhook`, `handoff_to_human`, `end`.

The engine is a **pure reducer**: `step(flow, state, event) → { actions, state }`. State
(current node, collected answers, retries) is persisted per conversation, so it survives
restarts and is horizontally scalable — any worker can resume any conversation. MVP ships
JSON-authored flows + a couple of templates; the **visual builder** (React Flow) comes in a
later phase and only writes the same JSON.

## 6. WhatsApp gateway details

- One `WhatsAppConnection` row per tenant number; the gateway holds an in-memory session map.
- **Auth-state persistence**: Baileys creds stored in Postgres/Redis (not just files) so a
  gateway restart or redeploy re-hydrates sessions without re-scanning QR. Volume-backed
  fallback for the file store.
- **Pairing UX**: dashboard requests a connection → gateway starts a session → streams the
  QR to the web app (SSE/websocket) → user scans → status flips to `connected`.
- **Resilience**: auto-reconnect with backoff; surface `disconnected`/`logged_out` states to
  the dashboard so the user can re-pair.
- **Rate limiting & anti-ban hygiene**: per-number send throttling, jittered delays, respect
  daily caps. (Baileys carries real ban risk — see ADR-001; the provider interface is our
  exit ramp to the Cloud API.)

## 7. Multi-tenancy, auth & security

- **Tenant model**: `Organization` is the tenant. Every domain table carries `organizationId`;
  all queries go through a tenant-scoped Prisma helper so a missing scope is a code smell,
  not a silent leak. (Consider Postgres RLS later as defense-in-depth.)
- **Auth**: hand-rolled JWT — `jose` + `argon2` (same proven approach as the Kursim app), no
  NextAuth. Sessions in Redis.
- **RBAC**: roles `owner | admin | agent`; agents see assigned leads/appointments.
- **Secrets**: Google OAuth tokens and Baileys creds encrypted at rest.

## 8. Scheduling

- Per-agent/org **availability rules**: weekly windows, slot length, buffers, min-notice,
  timezone. Engine computes free slots and subtracts existing appointments + (if synced)
  Google Calendar busy blocks (freebusy).
- **Booking**: creates `Appointment`, optional Google Calendar event (two-way sync via
  OAuth), sends WhatsApp confirmation, schedules reminders as delayed BullMQ jobs.
- Booking is deliverable **inside the WhatsApp chat** (offer slots) and via a **hosted
  booking page** — both hit the same scheduling package.

## 9. Infrastructure & deploy

- **Docker Compose**: `web`, `gateway`, `worker`, `postgres`, `redis`. `gateway` and
  `worker` are always-on; `gateway` needs a persistent volume for session state.
- Behind an nginx reverse proxy (same pattern already used on this server).
- **Scaling path**: web scales horizontally behind the proxy; workers scale by queue depth;
  gateway is the one stateful tier — start single-instance, later shard connections across
  gateway instances by `connectionId` (consistent hashing) when one box can't hold all
  sessions.
- **Observability**: structured logs, BullMQ dashboard (bull-board), health endpoints per
  service, Sentry later.

## 10. Tech stack summary

| Concern            | Choice                                             |
|--------------------|----------------------------------------------------|
| Monorepo           | Turborepo + pnpm workspaces                         |
| Web/dashboard      | Next.js 15 (App Router, TS), Tailwind, shadcn/ui    |
| Gateway/worker     | Node 22, Fastify (gateway), BullMQ (worker)         |
| DB                 | Postgres 16 + Prisma                                |
| Cache/queue/state  | Redis 7 + BullMQ                                    |
| WhatsApp           | Baileys → WhatsApp Cloud API (behind an interface)  |
| Calendar           | Native engine + Google Calendar API                 |
| Auth               | jose JWT + argon2, Redis sessions                   |
| Flow builder (later)| React Flow                                         |
| Deploy             | Docker Compose + nginx                              |
| Billing (later)    | Stripe or Paddle                                    |
