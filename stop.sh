#!/bin/bash
# Stops the Foodos frontend dev server started by start.sh.
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.frontend.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "No running frontend found (no PID file)."
  exit 0
fi

PID="$(cat "$PID_FILE")"

if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "Stopped frontend (PID $PID)."
else
  echo "Frontend process (PID $PID) was not running."
fi

rm -f "$PID_FILE"
