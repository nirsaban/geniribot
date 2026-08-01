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

## This specific deploy (Products / Cloudinary / Grow-static-links)

Everything schema-related is additive and safe (see the two migrations
`grow_payment_urls_per_plan` and `products` — already audited; the first
backfills your old Grow link into Starter/Monthly instead of dropping it).
Two things need manual action and aren't part of the automated steps above:

- **Before this deploy**: create 4 static hosted payment links in Grow's own
  dashboard (Starter/Pro × Monthly/Annual). Have the URLs ready.
- **Right after this deploy**: go to `/admin` and paste all 4 in (the old
  single link auto-carries into Starter/Monthly; Pro and Annual will show
  "not configured" until you fill them in — checkout for those is down until
  then).
- Add `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
  to the server's `.env` (`/home/debian/kesher/.env`) before `./start.sh` —
  without them, product image upload just shows "not configured", nothing
  else breaks.
- The super-admin "charge saved card" feature (`/admin`, per-org) is gone —
  it depended on the removed Make.com integration. No data lost, the button
  is just no longer there.

## Rolling back

Every migration in `packages/db/prisma/migrations/` is forward-only (no
`down.sql` — that's normal for Prisma). To roll back:
1. `./stop.sh`, restore from the pre-deploy `pg_dump` backup.
2. `git checkout <previous-tag-or-commit>`, `pnpm install`, `pnpm build`.
3. `./start.sh`.

There is currently no CI/CD deploy automation (`.github/workflows/ci.yml` is
test-only) — every deploy is manual via the steps above.
