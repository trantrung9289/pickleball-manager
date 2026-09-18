#!/bin/sh
# Entrypoint: backup → migration → backend → (bot có tự khởi động lại) → cron
# Tiến trình chính là backend; backend thoát → container thoát → Fly khởi động lại máy.
set -u

PORT="${PORT:-8000}"
BACKEND_URL="${BACKEND_URL:-http://localhost:${PORT}}"
ENTRY_PID=$$
# stdout của cron job đổ về stdout của entrypoint để hiện trong `fly logs`
CRON_LOG="/proc/${ENTRY_PID}/fd/1"

log() { echo "[entrypoint] $*"; }

# ── 0. Backup trước khi migration (bảo hiểm nếu migration làm hỏng DB) ──────
cd /app
if ! python backup_db.py --tag pre-migrate --no-telegram; then
  log "⚠️  Backup trước migration thất bại — vẫn tiếp tục"
fi

# ── 1. Migration (idempotent) ───────────────────────────────────────────────
log "🔄 Chạy database migration..."
if ! python migrations/add_players_tables.py || ! python migrations/add_fee_reminder.py; then
  log "❌ Migration thất bại — dừng khởi động"
  exit 1
fi
log "✅ Migration hoàn tất"

# ── 2. Backend ──────────────────────────────────────────────────────────────
log "🚀 Khởi động backend FastAPI (port ${PORT})..."
uvicorn main:app --host 0.0.0.0 --port "${PORT}" --app-dir /app &
BACKEND_PID=$!
BOT_LOOP_PID=""

# Tín hiệu dừng (fly deploy / docker stop): chuyển tiếp cho backend + bot để tắt êm.
# Cài ngay lúc này để dừng trong khi đang chờ health cũng không bị SIGKILL sau kill_timeout.
shutdown() {
  log "🛑 Nhận tín hiệu dừng — tắt bot và backend..."
  [ -n "$BOT_LOOP_PID" ] && kill "$BOT_LOOP_PID" 2>/dev/null
  [ -f /run/bot.pid ] && kill "$(cat /run/bot.pid)" 2>/dev/null
  kill -TERM "$BACKEND_PID" 2>/dev/null
  wait "$BACKEND_PID" 2>/dev/null
  exit 0
}
trap shutdown TERM INT

# Đợi /api/health trả 200 (tối đa 30s). Image slim không có wget/curl → dùng python.
ready=0
i=1
while [ "$i" -le 30 ]; do
  if python -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT}/api/health', timeout=2)" 2>/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    log "❌ Backend thoát sớm khi đang khởi động"
    exit 1
  fi
  sleep 1
  i=$((i + 1))
done
if [ "$ready" -ne 1 ]; then
  log "❌ Backend không sẵn sàng sau 30s — dừng"
  kill "$BACKEND_PID" 2>/dev/null
  exit 1
fi
log "✅ Backend sẵn sàng sau ${i}s"

# ── 3. Telegram bot — vòng lặp tự khởi động lại khi crash ───────────────────
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  log "🤖 Khởi động Telegram bot..."
  (
    cd /bot
    while true; do
      python bot.py &
      echo $! > /run/bot.pid
      wait $!
      rc=$?
      echo "[entrypoint] ⚠️  bot thoát (mã $rc) — khởi động lại sau 5s"
      sleep 5
    done
  ) &
  BOT_LOOP_PID=$!
else
  log "⚠️  Thiếu TELEGRAM_BOT_TOKEN — không chạy bot."
fi

# ── 4. Cron: nhắc phí (7h UTC = 14h VN) + backup hằng ngày (18h UTC = 1h VN) ──
# Secret đưa vào file env mode 0600 thay vì ghi thẳng vào dòng cron (0644, lộ qua ps).
umask 077
python - <<'PY'
import os, shlex
keys = ["BACKEND_URL", "INTERNAL_SECRET", "TELEGRAM_BOT_TOKEN", "BACKUP_TELEGRAM_CHAT_ID", "DATABASE_URL", "BACKUP_KEEP", "BACKUP_DIR"]
with open("/run/clb.env", "w") as f:
    for k in keys:
        v = os.environ.get(k)
        if v:
            f.write(f"export {k}={shlex.quote(v)}\n")
PY
umask 022

{
  echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  echo "0 18 * * * root . /run/clb.env && cd /app && python backup_db.py --tag daily > ${CRON_LOG} 2>&1"
  if [ -n "${INTERNAL_SECRET:-}" ] && [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
    echo "0 7 * * * root . /run/clb.env && cd /bot && python notify_bot.py > ${CRON_LOG} 2>&1"
  fi
} > /etc/cron.d/clb
chmod 0644 /etc/cron.d/clb
cron
log "⏰ Cron đã khởi động (backup 18h UTC$( [ -n "${INTERNAL_SECRET:-}" ] && [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && echo ', nhắc phí 7h UTC'))"

# ── 5. Chờ backend (tiến trình chính) ───────────────────────────────────────
wait "$BACKEND_PID"
rc=$?
log "Backend đã thoát (mã $rc)"
exit "$rc"
