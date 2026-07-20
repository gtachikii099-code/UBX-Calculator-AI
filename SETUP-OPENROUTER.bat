@echo off
title UBX OpenRouter Setup
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
echo Put your OpenRouter API key after OPENROUTER_API_KEY=
notepad .env
pause
