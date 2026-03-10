#!/bin/bash
PID_FILE="/tmp/lobster-guardian.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  kill $PID && echo "Stopped Guardian (PID: $PID)"
  rm -f "$PID_FILE"
else
  echo "Guardian is not running."
fi
