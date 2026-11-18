#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "ยังไม่ได้ติดตั้ง Node.js — ดาวน์โหลดที่ https://nodejs.org"; read; exit 1; }
[ -d node_modules ] || npm install
(sleep 1; open http://localhost:3000) &
node server.js
