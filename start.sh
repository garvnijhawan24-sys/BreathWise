#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "==========================================="
echo " BREATHEWISE - LOCAL ONE-CLICK LAUNCHER"
echo "==========================================="

if ! command -v python3 &> /dev/null; then
    echo "ERROR: python3 could not be found. Install Python 3.11+."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "ERROR: npm could not be found. Install Node.js 18+."
    exit 1
fi

if [ ! -f "backend/.venv/bin/python" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv backend/.venv
fi

echo "Installing backend dependencies..."
backend/.venv/bin/python -m pip install --disable-pip-version-check -q -r backend/requirements.txt

if [ ! -f "backend/.env" ]; then
    if [ -f ".env.example" ]; then
        cp ".env.example" "backend/.env"
    fi
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "Installing frontend dependencies..."
    (cd frontend && npm install)
fi

echo "Starting FastAPI backend on port 8000..."
(cd backend && .venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!

sleep 2

echo "Starting Vite frontend on port 5173..."
(cd frontend && npm run dev) &
FRONTEND_PID=$!

echo ""
echo "BreatheWise is running!"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://127.0.0.1:8000/docs"
echo ""
echo "Press Ctrl+C to terminate both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait
