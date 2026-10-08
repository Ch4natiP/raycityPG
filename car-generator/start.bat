@echo off
rem Serve this folder only (localhost) and open the generator in the browser.
cd /d "%~dp0"
start "" http://localhost:8000
python -m http.server 8000 --bind 127.0.0.1
if errorlevel 1 py -m http.server 8000 --bind 127.0.0.1
pause
