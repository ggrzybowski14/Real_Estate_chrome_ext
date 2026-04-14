#!/usr/bin/env bash
# Start Google Chrome with a dedicated profile and remote debugging so Playwright can connect via CDP.
# Usage:
#   ./scripts/start-chrome-cdp.sh
#   REALTOR_CDP_PORT=9333 REALTOR_CHROME_USER_DATA_DIR=~/.my-profile ./scripts/start-chrome-cdp.sh
#
# Then in another terminal:
#   REALTOR_PW_CDP_ENDPOINT=http://127.0.0.1:${REALTOR_CDP_PORT:-9222} npm run scrape:realtor-map -- --url-file ../../map-url.txt --dry-run
set -euo pipefail

PORT="${REALTOR_CDP_PORT:-9222}"
PROFILE="${REALTOR_CHROME_USER_DATA_DIR:-$HOME/.rea-realtor-scraper-chrome}"
PROFILE="${PROFILE/#\~/$HOME}"

if [[ -n "${CHROME_PATH:-}" ]]; then
  CHROME="$CHROME_PATH"
elif [[ "$(uname)" == "Darwin" ]]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
else
  CHROME="$(command -v google-chrome-stable || command -v google-chrome || command -v chromium || true)"
fi

if [[ -z "$CHROME" || ! -x "$CHROME" ]]; then
  echo "Chrome not found. Set CHROME_PATH to your Google Chrome (or Chromium) binary." >&2
  exit 1
fi

echo "Starting Chrome with:" >&2
echo "  --remote-debugging-port=$PORT" >&2
echo "  --user-data-dir=$PROFILE" >&2
echo "Connect Playwright with: REALTOR_PW_CDP_ENDPOINT=http://127.0.0.1:$PORT" >&2
echo "" >&2

exec "$CHROME" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" "$@"
