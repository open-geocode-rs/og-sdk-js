#!/bin/sh
set -eu

if [ "$#" -ne 4 ]; then
  echo "Usage: $0 OG_BINARY MONACO_PACK USA_PACK WORK_DIR" >&2
  exit 2
fi

og=$1
monaco=$2
usa=$3
work=$4
mkdir -p "$work"

serve() {
  name=$1
  pack=$2
  port=$3
  "$og" serve --pack "$pack" --bind "127.0.0.1:$port" --job-dir "$work/jobs-$name" \
    --hook-host 127.0.0.1 >"$work/$name.log" 2>&1 &
  server_pid=$!
  pids="$pids $server_pid"
  tries=0
  until kill -0 "$server_pid" 2>/dev/null && curl -sf "http://127.0.0.1:$port/readyz" >/dev/null; do
    tries=$((tries + 1))
    if ! kill -0 "$server_pid" 2>/dev/null || [ "$tries" -ge 30 ]; then
      cat "$work/$name.log" >&2
      return 1
    fi
    sleep 1
  done
}

pids=""
trap 'for server_pid in $pids; do kill "$server_pid" 2>/dev/null || true; done' EXIT
export OG_URL="http://127.0.0.1:${OG_MONACO_PORT:-18900}"
export OG_USA_URL="http://127.0.0.1:${OG_USA_PORT:-18901}"
export OG_TEST_ADDRESS="12 Boulevard des Moulins Monaco"
serve monaco "$monaco" "${OG_MONACO_PORT:-18900}"
serve usa "$usa" "${OG_USA_PORT:-18901}"
bun run test
