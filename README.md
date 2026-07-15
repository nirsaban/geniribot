# Kesher — WhatsApp Lead-Bot & Scheduling SaaS

> Working codename: **Kesher** (קשר, "contact / connection"). Rename freely.

**🌐 Live:** https://miltech.cloud/kesher  ·  demo login: `demo@kesher.local` / `demo1234`

A multi-tenant SaaS that lets any business **connect a WhatsApp number**, build a
**simple conversational bot** that collects answers from incoming leads, stores every
lead + answer in an **owned dashboard/CRM**, and lets the lead **book a sales-call
appointment** on a native calendar (with optional Google Calendar sync).

Built to be **modular, reusable, and scalable** from day one:

- **Provider-agnostic WhatsApp layer** — ships on Baileys (unofficial) today, swaps to
  the official WhatsApp Business Cloud API later with zero changes to the bot.
- **Framework-agnostic flow engine** — the bot brain is a pure, testable TS package,
  independent of WhatsApp or the web app.
- **Multi-tenant core** — every row is scoped to an organization; one platform serves
  many businesses.

## The three integrations

1. **WhatsApp** — connect a number, receive/send messages (Baileys → Cloud API later).
2. **Calendar** — native availability + booking engine, with Google Calendar two-way sync
   (Cal.com considered and rejected as a heavy external dependency; see ADR-002).
3. **Dashboard/CRM** — we build our own (originally considered Airtable — rejected; we own
   the data model and the UI instead).

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, services, data flow, multi-tenancy.
- [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) — Prisma schema draft.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phased plan from scaffold to scale.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — architecture decision records (ADRs).

## Status

**Phase 1 complete & verified** (2026-07-15). On top of Phase 0's foundation, the
**WhatsApp gateway** is live: `BaileysProvider` (baileys 6.7.18) manages one session per
tenant number, generates a real pairing QR, and persists session/auth state to Postgres so
it **survives a gateway restart** (verified: same device identity rehydrated). The dashboard
has a **Connections** page that creates a connection and shows the QR (server-proxied,
polled, rendered to an image — the gateway's internal token never reaches the browser).
Inbound messages flow gateway → Redis `wa-inbound` → worker → flow-engine; outbound flows
back through the gateway. 12/12 typecheck, 15/15 tests.

The one step that needs a human is physically **scanning the QR** to pair a phone; after
that, messaging the number triggers the seeded bot flow. Next up: **Phase 2** polish
(flow-engine already runs) then **Phase 3** dashboard CRM. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Quick start

```bash
corepack pnpm install          # or: pnpm install
cp .env.example .env           # then set JWT_SECRET (openssl rand -base64 48)
docker compose up -d postgres redis
pnpm db:generate
pnpm --filter @kesher/db migrate --name init
pnpm --filter @kesher/db seed  # demo@kesher.local / demo1234
pnpm dev                       # web on :4000, gateway :4020, worker :4021
```

Note: on this server Postgres is published on host port **55432** (5432/5433 were taken);
`.env` already points there. Docker needs `sudo` here.

## Layout

```
apps/{web,gateway,worker}   packages/{core,db,flow-engine,whatsapp,scheduling,ui}
```

- `packages/flow-engine` — pure bot reducer (`start`/`step`), fully unit-tested.
- `packages/scheduling` — availability → open slots, unit-tested.
- `packages/core` — env config, logger, auth (argon2 + jose JWT), RBAC.
- `packages/db` — Prisma schema + tenant-scoped client.
- `packages/whatsapp` — provider interface + `MockProvider` (Baileys lands in Phase 1).
