@echo off
title UBX Calculator AI - OpenRouter
cd /d "%~dp0"
echo Starting UBX Calculator AI with OpenRouter...
start "" http://localhost:5512
node server.js
pause
