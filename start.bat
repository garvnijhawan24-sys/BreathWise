@echo off
setlocal
cd /d "%~dp0"
echo.
echo  ===========================================
echo   BREATHEWISE - LOCAL ONE-CLICK LAUNCHER
echo  ===========================================
echo  Starting FastAPI backend and React/Vite UI.
echo.

where py >nul 2>nul
if %errorlevel% neq 0 (
  where python >nul 2>nul
  if %errorlevel% neq 0 (
    echo ERROR: Python not found on PATH. Install Python 3.11+ and try again.
    pause
    exit /b 1
  )
  set "PY_CMD=python"
) else (
  set "PY_CMD=py -3"
)

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo ERROR: Node.js not found on PATH. Install Node.js 18+ and try again.
  pause
  exit /b 1
)

if not exist "backend\.venv\Scripts\python.exe" (
  echo Creating Python virtual environment in backend\.venv...
  %PY_CMD% -m venv backend\.venv
  if %errorlevel% neq 0 goto fail
)

echo Installing backend dependencies...
backend\.venv\Scripts\python.exe -m pip install --disable-pip-version-check -q -r backend\requirements.txt
if %errorlevel% neq 0 goto fail

if not exist "backend\.env" (
  if exist ".env.example" copy ".env.example" "backend\.env" >nul
)

if not exist "frontend\node_modules" (
  echo Installing frontend npm packages...
  pushd frontend
  call npm install
  if %errorlevel% neq 0 (popd & goto fail)
  popd
)

echo.
echo Launching FastAPI backend on http://127.0.0.1:8000 ...
start "BreatheWise Backend API" /D "%~dp0backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

timeout /t 2 /nobreak >nul

echo Launching Vite frontend on http://localhost:5173 ...
start "BreatheWise Frontend UI" /D "%~dp0frontend" cmd /k "npm run dev"

timeout /t 3 /nobreak >nul
start "" "http://localhost:5173"

echo.
echo BreatheWise is running!
echo   Frontend:  http://localhost:5173
echo   API Docs:  http://127.0.0.1:8000/docs
echo   Health:    http://127.0.0.1:8000/api/health
echo.
pause
exit /b 0

:fail
echo.
echo Startup failed. Check the error message above or follow manual steps in README.md.
pause
exit /b 1
