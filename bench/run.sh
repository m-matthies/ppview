#!/usr/bin/env bash
# Starts the dev server and headless Chrome, runs the profile, tears both down.
set -e
cd "$(dirname "$0")/.."
lsof -ti :3111 | xargs -r kill -9 2>/dev/null || true
lsof -ti :9222 | xargs -r kill -9 2>/dev/null || true
sleep 1
BROWSER=none PORT=3111 CI=true npx react-scripts start >/dev/null 2>&1 &
SERVER=$!
CHROME="${CHROME_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --remote-debugging-port=9222 --disable-gpu --use-gl=swiftshader \
  --enable-unsafe-swiftshader --disable-renderer-backgrounding --no-first-run \
  --user-data-dir="$(mktemp -d)" about:blank >/dev/null 2>&1 &
BROWSER_PID=$!
trap 'kill $SERVER $BROWSER_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 120); do curl -sf http://localhost:3111/ppview >/dev/null && break; sleep 1; done
for _ in $(seq 1 60); do curl -sf http://localhost:9222/json/version >/dev/null && break; sleep 0.5; done
node "${BENCH_SCRIPT:-bench/profile.js}"
