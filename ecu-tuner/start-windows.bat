@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo [!] ติดตั้ง Node.js ก่อน: https://nodejs.org & pause & exit /b)
start "" msedge http://localhost:5555 2>nul || start "" http://localhost:5555
node serve.js
