#!/usr/bin/env bash
# Все браузерные проверки подряд (Playwright). Запуск из корня проекта: bash tools/run-e2e.sh
# Поднимает сайт на localhost:8766, прогоняет наборы и возвращает ошибку, если упал хоть один.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8766}"
(cd "$ROOT/site" && python3 -m http.server "$PORT" >/dev/null 2>&1) &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
status=0
for suite in group admin template import; do
  echo "== $suite"
  SITE="http://localhost:$PORT" ROOT="$ROOT" node "$ROOT/tests/e2e/$suite.e2e.cjs" || status=1
done
echo "== pwa"
ROOT="$ROOT" node "$ROOT/tests/e2e/pwa.e2e.cjs" || status=1   # свой сервер с сайтом в подпапке /repo/
exit $status
