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
  # `$!` here would capture the setsid wrapper, not the service: setsid forks
  # when its caller is already a process-group leader, so the recorded pid was
  # consistently off by one and stop.sh silently killed nothing — leaving stale
  # copies holding :4020/:4021 and the next start failing with EADDRINUSE.
  # Instead the child records its OWN pid and then execs, so the pidfile always
  # names the real process.
  ( cd "$dir" && setsid bash -c 'echo $$ >"$0"; exec "$@"' "$pidfile" "$@" \
      >>"$log" 2>&1 < /dev/null & )

  for _ in $(seq 1 50); do
    [ -s "$pidfile" ] && break
    sleep 0.1
  done
  if [ ! -s "$pidfile" ]; then
    echo "$name FAILED to start — see $log" >&2
    return 1
  fi
  echo "$name started (pid $(cat "$pidfile")) -> $log"
}

# Gateway and worker first (web depends on the gateway for connections).
start_svc gateway "$ROOT/apps/gateway" node dist/server.js
start_svc worker  "$ROOT/apps/worker"  node dist/index.js
start_svc web     "$ROOT/apps/web"     node_modules/.bin/next start -p "${WEB_PORT:-4000}"

echo "done. web on :${WEB_PORT:-4000}, gateway :4020, worker health :4021"
