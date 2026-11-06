#!/bin/zsh
PROJECT_DIR="/Users/user2/Desktop/Paginas web demo/medicalabs - distribucion de medicamentos"
PORT=8214
URL="http://127.0.0.1:${PORT}/"
cd "$PROJECT_DIR" || exit 1
if ! curl -fsS -o /dev/null --max-time 2 "${URL}api/yo" 2>/dev/null; then
  pids=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
    sleep 0.4
  fi
  python3 server.py >> /tmp/medicalabs.log 2>&1 &
  for i in {1..40}; do
    curl -fsS -o /dev/null --max-time 1 "${URL}api/yo" && break
    sleep 0.25
  done
fi
open -a "Google Chrome" "$URL"
