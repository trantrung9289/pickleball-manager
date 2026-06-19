#!/bin/sh
# Entrypoint cho container Fly.io: chạy backend + bot cùng lúc

# Khởi động Telegram bot nếu có đủ biến môi trường
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$ANTHROPIC_API_KEY" ] && [ -n "$BOT_USERNAME" ] && [ -n "$BOT_PASSWORD" ]; then
  echo "🤖 Khởi động Telegram bot..."
  cd /bot && python bot.py &
else
  echo "⚠️  Thiếu TELEGRAM_BOT_TOKEN / ANTHROPIC_API_KEY / BOT_USERNAME / BOT_PASSWORD — bỏ qua bot."
fi

# Khởi động backend (foreground — process chính)
echo "🚀 Khởi động backend FastAPI..."
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}" --app-dir /app
