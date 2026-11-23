#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "ติดตั้ง Node.js ก่อน: https://nodejs.org"; read -n1; exit 1; }
(sleep 1; open "http://localhost:5555") &
node serve.js
