@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo [!] ยังไม่ได้ติดตั้ง Node.js - ดาวน์โหลดที่ https://nodejs.org แล้วเปิดไฟล์นี้ใหม่ & pause & exit /b)
if not exist node_modules (echo กำลังติดตั้งครั้งแรก... & call npm install)
start "" http://localhost:3000
node server.js
pause
