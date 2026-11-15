@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "GIT_EXE=git"
where git >nul 2>&1
if errorlevel 1 (
  for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if exist "%%D\resources\app\git\cmd\git.exe" set "GIT_EXE=%%D\resources\app\git\cmd\git.exe"
  )
)

echo [1/2] Building static Shoko-san voice MP3s...
python build_static_voices.py
if errorlevel 1 (
  echo Failed to build static voices.
  pause
  exit /b 1
)

echo [2/2] Publishing update to GitHub Pages (https://mattuuuuuuuuu75.github.io/workout-flow/)...
"%GIT_EXE%" add -A
"%GIT_EXE%" commit -m "Update workout-flow content"
"%GIT_EXE%" push origin main

echo Done! GitHub Pages will reflect the update within ~30-60 seconds.
pause
