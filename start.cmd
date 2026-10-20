@echo off
chcp 65001 >nul
title 本地地球 Local Earth
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
if errorlevel 1 pause
