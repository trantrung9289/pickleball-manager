# ── Stage 1: Build React frontend ─────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python backend + bot + static files ───────────
FROM python:3.11-slim
WORKDIR /app

# Backend dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=frontend-builder /app/backend/static ./static

# Bot dependencies
WORKDIR /bot
COPY bot/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY bot/ ./

# Tạo thư mục data để lưu SQLite db
RUN mkdir -p /data

# Entrypoint script
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV DATABASE_URL=sqlite:////data/clb.db
ENV PORT=8000
# BACKEND_URL trỏ đến chính nó (bot gọi nội bộ)
ENV BACKEND_URL=http://localhost:8000

EXPOSE 8000

CMD ["/entrypoint.sh"]
