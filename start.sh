#!/usr/bin/env bash
# AS Adventurer — Linux launcher
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo ""
echo "  ============================================"
echo "   AS Adventurer - Starting (Linux)..."
echo "  ============================================"
echo ""
echo "  Open http://localhost:3000 in your browser"
echo "  to access the Control Panel."
echo ""
echo "  Press Ctrl+C to stop the server."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  ERROR: Node.js is not installed or not on PATH."
  echo "  Install Node 18+ (https://nodejs.org/) and try again."
  exit 1
fi

if [[ ! -d node_modules/express || ! -d node_modules/ws ]]; then
  echo "  Installing dependencies..."
  npm install --omit=dev
  echo ""
fi

exec node server.js
