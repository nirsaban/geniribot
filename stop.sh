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
