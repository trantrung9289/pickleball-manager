#!/bin/sh
# Entrypoint: chạy migration → khởi động backend FastAPI → khởi động bot

# ── Database migration (idempotent, an toàn) ────────────────────────────────
echo "🔄 Chạy database migration..."
cd /app && python migrations/add_players_tables.py && python migrations/add_fee_reminder.py
if [ $? -ne 0 ]; then
  echo "❌ Migration thất bại — dừng khởi động"
  exit 1
fi
echo "✅ Migration hoàn tất"

# Khởi động backend (background tạm thời để đợi)
echo "🚀 Khởi động backend FastAPI..."
uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}" --app-dir /app &
BACKEND_PID=$!

# Đợi backend sẵn sàng (tối đa 30 giây)
echo "⏳ Đợi backend khởi động..."
for i in $(seq 1 30); do
  if wget -q -O /dev/null "http://localhost:${PORT:-8000}/api/club/status" 2>/dev/null; then
    echo "✅ Backend sẵn sàng sau ${i}s"
    break
  fi
  sleep 1
done

# Khởi động bot nếu có đủ biến môi trường
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  echo "🤖 Khởi động Telegram bot..."
  cd /bot && python bot.py &
  BOT_PID=$!

  # Cron: nhắc đóng phí mỗi ngày lúc 7h UTC = 14h UTC+7
  if [ -n "$INTERNAL_SECRET" ]; then
    echo "⏰ Cài cron nhắc đóng phí (7h UTC hàng ngày)..."
    echo "0 7 * * * cd /bot && BACKEND_URL=${BACKEND_URL:-http://localhost:8000} INTERNAL_SECRET=$INTERNAL_SECRET python notify_bot.py >> /var/log/notify_bot.log 2>&1" | crontab -
    crond -b -l 8 2>/dev/null || true
  fi
else
  echo "⚠️  Thiếu biến môi trường bot — bỏ qua."
fi

# Chờ backend (process chính)
wait $BACKEND_PID
