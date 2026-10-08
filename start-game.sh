#!/bin/bash
# Run with: ./start-game.sh  (Linux)
cd "$(dirname "$0")" || exit 1
echo "SCAM CALL CENTER - Kolkata Night Shift"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Opening the download page — install the LTS version, then run this again."
  xdg-open "https://nodejs.org/en/download" 2>/dev/null
  read -r -p "Press Enter to close..."
  exit 1
fi
if [ ! -d node_modules/vite ]; then
  echo "First launch: installing game files. This takes a minute..."
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --no-audit --no-fund || { read -r -p "Install failed. Press Enter to close..."; exit 1; }
fi
echo "Starting the game. Keep this window open while you play."
npm run play
