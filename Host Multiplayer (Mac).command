#!/bin/bash
cd "$(dirname "$0")" || exit 1
echo "Hosting a LAN co-op game. Teammates on the same Wi-Fi can join."
command -v node >/dev/null 2>&1 || { echo "Node.js required."; open "https://nodejs.org/en/download"; read -r -p "Press Enter..."; exit 1; }
[ -d node_modules/vite ] || npm install --no-audit --no-fund
npm run host
