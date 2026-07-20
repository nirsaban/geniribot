#!/usr/bin/env bash
# Stop Kesher host services.
set -uo pipefail
ROOT="/home/debian/kesher"
for name in web worker gateway; do
  pidfile="$ROOT/data/$name.pid"
  if [ -f "$pidfile" ]; then
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && echo "stopped $name (pid $pid)"
    fi
    rm -f "$pidfile"
  else
    echo "$name: no pidfile"
  fi
done

# Sweep leftovers the pidfiles never tracked — stale copies from before the
# start.sh pid fix, and `tsx watch` runs from dev sessions. Scoped to node
# processes we own whose cwd is inside this repo, so other projects on the box
# (which run identically-named `node dist/server.js`) are never touched.
# Matched on the full command line, since `next start` renames itself to
# "next-server" and would escape a plain `pgrep node`.
for pid in $(pgrep -u "$(id -u)" -f 'node|next-server|tsx' 2>/dev/null); do
  [ "$pid" = "$$" ] && continue
  cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null)" || continue
  case "$cwd" in
    "$ROOT" | "$ROOT"/*)
      kill "$pid" 2>/dev/null && echo "swept stale pid $pid ($cwd)"
      # tsx watch ignores SIGTERM; escalate if it is still there.
      ( sleep 3; kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null ) &
      ;;
  esac
done
wait
