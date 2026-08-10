# Deploying to production

Production runs bare-metal on the Debian host at `/home/debian/kesher` — no
Docker for the apps (Postgres/Redis are Docker, apps are not), no PM2,
started/stopped via `start.sh` / `stop.sh` (plain `node` / `next start`
processes tracked by pidfile). Domain `wabot.miltech.cloud` is nginx
reverse-proxied to host port 4000 (see `infra/deploy-public.sh`).

## Every deploy

1. **Backup first.** Non-negotiable — this is a live DB with real client data.
   ```bash
   docker exec <postgres-container> pg_dump -U kesher kesher > backup-$(date +%Y%m%d-%H%M).sql
   ```
2. `git pull`
3. `pnpm install`
4. `pnpm db:generate`
5. **Stop before migrating.** The running app's code may reference columns a
   pending migration is about to drop/rename — migrating while it's still up
   risks it erroring on every request until restart.
   ```bash
   ./stop.sh
   ```
6. Apply pending migrations — **`migrate deploy`, never `migrate dev`** in
   production. `migrate dev` is interactive, can prompt for a destructive
   reset, and can generate new migrations from schema drift; `migrate deploy`
   only applies what's already committed, non-interactively.
   ```bash
   pnpm db:migrate:deploy
   ```
7. `pnpm build`
8. `./start.sh`
9. Smoke-test: load the site, send yourself a real WhatsApp message to a
   connected bot and confirm it responds, check `/admin` loads.

## This specific deploy (one Grow link + הוראת קבע)

Payment-link generation is gone. There is now a single hosted Grow page for
the whole platform; the payer picks their plan's product and how many monthly
payments (1–12) of a הוראת קבע they want, and the callback opens the plan for
exactly that many months. **Two migrations here are destructive** — take the
backup in step 1 seriously:

- `single_grow_link_direct_debit` drops the four per-plan link columns (the Pro
  monthly link is carried over into the new single column, then overwritten
  with the live GeniriBot link), drops the `BillingInterval` enum and both
  `interval` columns (`ANNUAL` rows become `paymentsCount = 12`), drops
  `PlanConfig.annualIls`, widens every money column to `DECIMAL(10,2)`, and
  resets plan prices to the Grow product prices (₪49.56 / ₪89).
- `grow_callback_log` adds a table, purely additive.

Manual steps around the deploy:

- **In Grow's dashboard**, point the payment link's notifyUrl at
  `https://wabot.miltech.cloud/api/billing/grow/webhook` and its success/return
  URL at `https://wabot.miltech.cloud/thank-you`. Without the notifyUrl nothing
  activates — the callback is the entire integration now.
- Keep the Grow product names **`מנוי מתקדם`** (→ בסיסי/STARTER) and
  **`מנוי פרימיום`** (→ מקצועי/PRO). That name is how a callback is matched to
  a plan; the charged amount is only a fallback. Renaming a product in Grow
  without updating `PLANS[...].growProductName` breaks plan detection.
- **Right after the deploy**: put through one real הוראת קבע (any plan, 2+
  payments), then open `/admin` → "Callbacks אחרונים מ-Grow" and confirm which
  key Grow used for the payments count. `growPayments` tries `paymentsNum`,
  `paymentNum`, `payment_num`, `numOfPayments` and a few more; if the real key
  isn't among them the grant silently falls back to **one month**. Add the key
  to `PAYMENTS_NUM_KEYS` in `packages/billing/src/grow.ts` if needed.
- Existing paying tenants are unaffected: their subscription rows keep their
  plan, status and period end; annual ones simply read as 12 payments.

## Rolling back

Every migration in `packages/db/prisma/migrations/` is forward-only (no
`down.sql` — that's normal for Prisma). To roll back:
1. `./stop.sh`, restore from the pre-deploy `pg_dump` backup.
2. `git checkout <previous-tag-or-commit>`, `pnpm install`, `pnpm build`.
3. `./start.sh`.

There is currently no CI/CD deploy automation (`.github/workflows/ci.yml` is
test-only) — every deploy is manual via the steps above.
