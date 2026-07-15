# Architecture Decision Records (ADRs)

## ADR-001 — WhatsApp via Baileys now, Cloud API later (behind an interface)
**Decision:** Ship on **Baileys** (unofficial) for speed and zero Meta onboarding, but access it
only through a `WhatsAppProvider` interface so the official **WhatsApp Business Cloud API** can be
dropped in without touching the flow engine, worker, or dashboard.
**Why:** Baileys lets any user connect a personal/business number via QR in seconds — ideal for a
fast MVP and demos. Trade-off accepted knowingly.
**Risks / mitigations:**
- *Account bans* — WhatsApp actively bans automation on unofficial libraries. Mitigate with send
  throttling, jittered delays, daily caps, and warm-up; never bulk-blast.
- *Fragility* — sessions drop; mitigate with persistent auth-state + auto-reconnect + clear
  re-pair UX.
- *Not compliant for paid scale* — the Cloud API is the production endgame (ADR-001 exit ramp).

## ADR-002 — Native scheduling engine, not Cal.com
**Decision:** Build our **own** availability + booking engine (`packages/scheduling`) with optional
**Google Calendar** sync. Do not embed/host Cal.com.
**Why:** Booking must live *inside* the WhatsApp conversation and on branded pages, share the tenant
data model, and be themeable. Cal.com is a heavy external service to run and skin; owning the logic
(a well-bounded problem) keeps the product cohesive and the data ours.

## ADR-003 — Own dashboard/CRM, not Airtable
**Decision:** Store leads/answers in our **own Postgres model** and build the dashboard, rather than
pushing data to Airtable.
**Why:** Multi-tenant isolation, custom lead/conversation/appointment views, and analytics need an
owned schema. Airtable was considered as a shortcut but rejected — we're building the dashboard
anyway, so the data belongs in our DB. (An Airtable/Sheets *export* connector can be a later add-on.)

## ADR-004 — Queue-driven, stateful gateway split from stateless web
**Decision:** WhatsApp sessions run in a dedicated always-on **gateway** service; message processing
runs in **BullMQ workers**; the Next.js web tier stays stateless.
**Why:** Baileys can't run serverless. Splitting the one stateful concern out lets the web and worker
tiers scale horizontally and keeps the flow runtime resilient across restarts.

## ADR-005 — Monorepo with logic in packages, I/O in apps
**Decision:** Turborepo; `flow-engine` and `scheduling` are pure, I/O-free, fully unit-tested
packages; only `apps/*` touch WhatsApp, DB, and network.
**Why:** Maximizes reuse and testability (the stated goals) and keeps the bot brain independent of
any channel or framework.
