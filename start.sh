#!/bin/bash
# Starts the Foodos frontend dev server in the background.
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
PID_FILE="$ROOT_DIR/.frontend.pid"
LOG_FILE="$ROOT_DIR/frontend.log"
PORT=5173

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Frontend is already running (PID $(cat "$PID_FILE"))."
  exit 0
fi

cd "$FRONTEND_DIR"

if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies..."
  npm install
fi

echo "Starting Foodos frontend..."
# Call vite's node binary directly instead of "npm run dev" — avoids the
# npm.cmd wrapper process on Windows/Git Bash losing track of the real PID.
nohup node node_modules/vite/bin/vite.js --port "$PORT" > "$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"

# Wait for the server to actually come up before declaring success.
for i in $(seq 1 20); do
  if curl -s -o /dev/null "http://localhost:$PORT"; then
    echo "Frontend started (PID $PID)."
    echo "Open: http://localhost:$PORT"
    exit 0
  fi
  sleep 0.5
done

echo "Frontend did not respond in time. Last 20 log lines:"
tail -n 20 "$LOG_FILE"
exit 1
