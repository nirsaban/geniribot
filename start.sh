#!/usr/bin/env bash
# Start Kesher's host services (web, gateway, worker) detached & persistent.
# Postgres + Redis run separately via docker compose (restart: unless-stopped).
set -euo pipefail

ROOT="/home/debian/kesher"
cd "$ROOT"

export PATH="$HOME/.local/bin:$PATH"
export NODE_ENV=production
set -a; . "$ROOT/.env"; set +a

mkdir -p "$ROOT/data"

start_svc() {
  local name="$1"; shift
  local dir="$1"; shift
  local pidfile="$ROOT/data/$name.pid"
  local log="$ROOT/data/$name.log"

  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "$name already running (pid $(cat "$pidfile"))"
    return
  fi
  ( cd "$dir" && setsid nohup "$@" >>"$log" 2>&1 < /dev/null & echo $! >"$pidfile" )
  echo "$name started (pid $(cat "$pidfile")) -> $log"
}

# Gateway and worker first (web depends on the gateway for connections).
start_svc gateway "$ROOT/apps/gateway" node dist/server.js
start_svc worker  "$ROOT/apps/worker"  node dist/index.js
start_svc web     "$ROOT/apps/web"     node_modules/.bin/next start -p "${WEB_PORT:-4000}"

echo "done. web on :${WEB_PORT:-4000}, gateway :4020, worker health :4021"
