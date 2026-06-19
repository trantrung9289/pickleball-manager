#!/bin/bash
set -e

echo "=== Khởi động CLB Management System ==="

# Dọn dẹp các process cũ nếu còn
echo ">> Dọn dẹp process cũ..."
lsof -ti :8000 | xargs kill -9 2>/dev/null || true
lsof -ti :5173 | xargs kill -9 2>/dev/null || true
sleep 1

# Backend
cd "$(dirname "$0")/backend"
source venv/bin/activate

# Seed nếu DB chưa tồn tại
if [ ! -f clb.db ]; then
  echo ">> Tạo dữ liệu mẫu..."
  python seed.py
fi

echo ">> Khởi động backend trên http://localhost:8000"
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Frontend
cd "$(dirname "$0")/frontend"
echo ">> Khởi động frontend trên http://localhost:5173"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "✅ Ứng dụng đang chạy:"
echo "   Frontend: http://localhost:5173"
echo "   Backend API: http://localhost:8000"
echo "   API Docs: http://localhost:8000/docs"
echo ""
echo "Nhấn Ctrl+C để dừng..."
wait
