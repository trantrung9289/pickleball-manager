# HANDOFF – CLB Pickleball Manager

**Cập nhật lần cuối:** 2026-06-30
**Phiên làm việc:** #4
**Trạng thái:** ✅ Ổn định, đang chạy trên production

> ⚠️ File này chỉ lưu cục bộ — KHÔNG commit lên git, KHÔNG deploy lên Fly.io.
> Thêm `handoff.md` vào `.gitignore` nếu chưa có.

---

## 📋 TỔNG QUAN

### Mục tiêu dự án
Hệ thống quản lý câu lạc bộ Pickleball đa CLB: backend FastAPI + SQLite, frontend React + Ant Design, Telegram Bot tích hợp AI. Deploy trên Fly.io tại https://pickleball-manager.fly.dev

### Trạng thái các module
| Module | Trạng thái | Ghi chú |
|---|---|---|
| Backend FastAPI | ✅ Hoàn chỉnh | Chạy ổn định |
| Frontend React | ✅ Hoàn chỉnh | Tất cả trang đã xây dựng |
| Telegram Bot | ⚠️ Không hoạt động | AI provider bị block — xem phần dưới |
| Giải đấu (Tournament) | ✅ Hoàn chỉnh | Có cả khách mời + hạng |

---

## 🗓️ PHIÊN LÀM VIỆC #4 — 2026-06-30

### 1. Báo cáo tài chính: Số dư đầu kỳ / cuối kỳ
**Commit:** `93f8394`

- `GET /api/reports/monthly-detail` tính thêm `opening_balance` (lũy kế trước kỳ) và `closing_balance`
- Frontend `Reports.jsx`: khung "Cân đối quỹ" 4 ô với màu sắc phân biệt
- Số dư **không lưu DB** — tính động để luôn đúng khi sửa/xóa giao dịch cũ

### 2. Fix bug: Giao dịch ngày 1 tháng bị tính nhầm vào tháng trước
**Commit:** `ce47e03`

- **Root cause:** SQLite so sánh chuỗi → `"2026-07-01" < "2026-07-01 00:00:00"` = True
- **Fix:** Dùng `datetime.date` thay `datetime` khi filter cột `Date` trong SQLAlchemy
- **Quy tắc:** Luôn dùng `date(y,m,d)` KHÔNG dùng `datetime(y,m,d)` với cột SQLite Date

### 3. Tích hợp khách mời vào giải đấu
**Commit:** `041ba4b`

- Bảng mới `players` (member_id=NULL → khách mời)
- `tournament_participants`: member_id nullable + cột mới `player_id`, `partner_player_id`
- API: `GET/POST/PUT/DELETE /api/players`
- Wizard tạo giải: Tab "Thành viên CLB" + Tab "Khách mời" (form nhập tên/SĐT/hạng)
- Migration idempotent chạy tự động khi container start

### 4. Hạng (rank) cho khách mời
**Commit:** `bf8a389`

- `Player` model: cột `rank VARCHAR(50) DEFAULT 'Chưa xếp hạng'`
- Migration: `ALTER TABLE players ADD COLUMN rank` (idempotent)
- Form khách mời: dropdown A/B/C/D/Hạt giống 1,2,3/Chưa xếp hạng
- Bảng danh sách: Tag màu (A=đỏ, B=vàng, C=xanh, D=xanh lá, Hạt giống=tím)
- Ghép đội theo rank áp dụng cho cả member lẫn guest

### 5. Mặc định phương thức thanh toán = "Chuyển khoản"
**Commit:** `4aa5913`

- `backend/schemas.py`: `TransactionBase.payment_method = "Chuyển khoản"` (thay "Tiền mặt")
- `frontend/Transactions.jsx`: `initialValue="Chuyển khoản"` + `setFieldsValue({payment_method: "Chuyển khoản"})` khi mở form tạo mới
- Khi sửa giao dịch cũ: giữ nguyên giá trị đã lưu

### 6. Xóa handoff.md khỏi git
**Commit:** `eb7afc0`

- File này KHÔNG nên ở trên GitHub/Fly.io (chứa thông tin nhạy cảm về hạ tầng)
- Đã `git rm handoff.md` + push
- Nên thêm vào `.gitignore` để tránh vô tình commit lại

---

## 📝 TRẠNG THÁI DB PRODUCTION (`/data/clb.db`)

```
clubs, users, club_memberships
members, fee_types, transactions
tournaments, tournament_participants, tournament_matches
players                   ← MỚI phiên #4
```

**Columns mới trong `tournament_participants`:**
- `member_id` — đã thành nullable
- `player_id` — FK → players (người 1, khách mời)
- `partner_player_id` — FK → players (người 2, khách mời đôi)

**Backup:** `/data/clb.db.bak` — snapshot trước deploy phiên #4

---

## 🚧 VẤN ĐỀ TỒN ĐỌNG

### Telegram Bot không hoạt động
| Provider | Vấn đề |
|---|---|
| Anthropic Claude | Hết credits — cần nạp $5 |
| Groq (Llama 3.3 70B) | Cloudflare block IP Fly.io Singapore |
| Google Gemini 2.0 Flash | Quota = 0 (free tier không khả dụng) |

**Fix nhanh nhất:** Nạp Anthropic $5 → `flyctl secrets set ANTHROPIC_API_KEY="sk-ant-..."` → sửa `bot/bot.py` dùng `anthropic` SDK, model `claude-haiku-4-5`

---

## ✅ VIỆC CẦN LÀM TIẾP THEO

- [ ] Fix Telegram Bot (AI provider)
- [ ] Thêm `handoff.md` vào `.gitignore`
- [ ] Export PDF báo cáo tháng
- [ ] Push notification giao dịch mới

---

## 🔧 THÔNG TIN KỸ THUẬT

### Infrastructure
- **App:** `pickleball-manager` — Fly.io region `sin` (Singapore)
- **Machine ID:** `18514d5c250398`
- **DB:** SQLite `/data/clb.db` (volume `clb_data`)
- **URL:** https://pickleball-manager.fly.dev

### Fly.io Secrets (xem qua `flyctl secrets list`)
```
TELEGRAM_BOT_TOKEN  — bot token
ANTHROPIC_API_KEY   — hết credits
GROQ_API_KEY        — bị block từ Singapore
GEMINI_API_KEY      — quota = 0
BOT_USERNAME        = "telegrambot"
BOT_PASSWORD        — password tài khoản bot
BACKEND_URL         = "http://localhost:8000"
```

### Git
- **Repo:** https://github.com/trantrung9289/pickleball-manager (`main`)
- **Commit cuối phiên #4:** `4aa5913`

### Docker entrypoint (thứ tự bắt buộc)
1. `python migrations/add_players_tables.py` — migration
2. `uvicorn main:app` — backend
3. `python bot.py` — bot (chỉ nếu có đủ secrets)

---

## 📌 QUY TẮC KỸ THUẬT ĐÃ ĐÚC KẾT

1. **SQLite Date filter:** Dùng `datetime.date`, KHÔNG dùng `datetime` — tránh bug so sánh chuỗi
2. **Số dư:** Tính động từ `SUM(amount)`, không lưu vào DB
3. **Migration:** Luôn idempotent (`IF NOT EXISTS` / check column trước khi ALTER)
4. **Backup:** `flyctl ssh console -C "sh -c 'cp /data/clb.db /data/clb.db.bak'"` trước deploy schema
5. **Secrets:** Chỉ set qua `flyctl secrets set`, không bao giờ commit vào code
6. **Frontend cache:** Hard refresh (`Cmd+Shift+R`) hoặc tab ẩn danh sau deploy nếu UI cũ vẫn hiện
