.PHONY: setup infra db seed dev typecheck test down

# One-time local bootstrap.
setup:
	pnpm install
	cp -n .env.example .env || true
	docker compose up -d postgres redis
	pnpm db:generate
	pnpm --filter @kesher/db migrate --name init
	pnpm --filter @kesher/db seed

infra:
	docker compose up -d postgres redis

db:
	pnpm db:generate

seed:
	pnpm --filter @kesher/db seed

dev:
	pnpm dev

typecheck:
	pnpm db:generate && pnpm typecheck

test:
	pnpm test

down:
	docker compose down
