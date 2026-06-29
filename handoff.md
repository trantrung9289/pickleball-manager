# HANDOFF – CLB Pickleball Manager

**Cập nhật lần cuối:** 2026-06-30
**Phiên làm việc:** #4
**Trạng thái:** ✅ Ổn định, đang chạy trên production

---

## 📋 TỔNG QUAN

### Mục tiêu dự án
Hệ thống quản lý câu lạc bộ Pickleball đa CLB, gồm backend FastAPI + SQLite, frontend React + Ant Design, và Telegram Bot tích hợp AI. Deploy trên Fly.io tại https://pickleball-manager.fly.dev

### Trạng thái các module
| Module | Trạng thái | Ghi chú |
|---|---|---|
| Backend FastAPI | ✅ Hoàn chỉnh | Chạy ổn định |
| Frontend React | ✅ Hoàn chỉnh | Tất cả trang đã xây dựng |
| Telegram Bot | ⚠️ Không hoạt động | AI provider bị block — xem phần dưới |
| Giải đấu (Tournament) | ✅ Hoàn chỉnh | Có cả khách mời ngoài CLB + hạng |

---

## 🗓️ PHIÊN LÀM VIỆC #4 — 2026-06-30 (Hôm nay)

### 1. Báo cáo tài chính: Thêm số dư đầu kỳ / cuối kỳ

**Commit:** `93f8394`

**Vấn đề:** Báo cáo tháng chỉ hiện tổng thu/chi trong kỳ, không có tồn quỹ tích lũy từ các tháng trước.

**Đã làm:**
- `backend/main.py`: Endpoint `GET /api/reports/monthly-detail` tính thêm:
  - `opening_balance` = tổng thu - tổng chi của tất cả giao dịch **trước** tháng đang xem (lũy kế từ đầu)
  - `closing_balance` = `opening_balance + total_income - total_expense`
  - Giữ nguyên `balance` cũ (số dư trong kỳ) để backward-compat
- `frontend/src/pages/Reports.jsx`: Thêm khung "Cân đối quỹ tháng X/YYYY" với 4 ô:
  - Tồn quỹ đầu kỳ (xanh dương — chuyển từ tháng trước)
  - Tổng thu trong kỳ (xanh lá)
  - Tổng chi trong kỳ (đỏ)
  - Tồn quỹ cuối kỳ (xanh dương đậm, viền nổi — chuyển sang tháng sau)

**Nguyên tắc quan trọng:** Số dư **không lưu vào DB** — tính toán động từ lịch sử giao dịch để tránh sai lệch khi sửa/xóa giao dịch cũ.

---

### 2. Fix bug: Giao dịch ngày 1 tháng bị tính nhầm vào tháng trước

**Commit:** `ce47e03`

**Root cause:** SQLite lưu cột `Date` dạng chuỗi `"YYYY-MM-DD"`. Khi so sánh với `datetime(year, month, 1)` Python (chuỗi `"YYYY-MM-DD 00:00:00"`), SQLite so sánh lexicographically → `"2026-07-01" < "2026-07-01 00:00:00"` = **True** → giao dịch ngày đầu tháng bị lọt vào `opening_balance` thay vì `total_income`.

**Fix:** Thay `datetime(year, month, 1)` thành `date(year, month, 1)` (Python `datetime.date`) trong tất cả filter range của `report_monthly_detail`.

**Triệu chứng trước fix:** Tháng 7 hiển thị `opening_balance = 500.000đ`, `total_income = 0đ` dù có giao dịch ngày 01/07.

---

### 3. Xác nhận: Tính năng chọn ngày ghi nhận giao dịch đã có sẵn

**Không cần thay đổi code.** Sau khi khảo sát:
- `Transaction.transaction_date` (cột `Date`, NOT NULL) — đã có
- Form giao dịch đã có `DatePicker` với `format="DD/MM/YYYY"`, mặc định ngày hôm nay
- Khi sửa giao dịch, ngày được load đúng vào `DatePicker`
- Submit gửi `YYYY-MM-DD` lên backend

---

### 4. Tích hợp khách mời (người chơi ngoài CLB) vào giải đấu

**Commit:** `041ba4b`

**Files thay đổi:** `backend/models.py`, `backend/schemas.py`, `backend/main.py`, `backend/migrations/add_players_tables.py`, `docker-entrypoint.sh`, `Dockerfile`, `frontend/src/api.js`, `frontend/src/pages/Tournament.jsx`

**Database — 2 thay đổi an toàn:**
- Tạo bảng mới `players`: đại diện mọi người tham gia giải (member_id=NULL → khách mời, member_id!=NULL → thành viên CLB)
- Tái tạo `tournament_participants` (migration an toàn, copy data): `member_id` thành nullable + thêm `player_id`, `partner_player_id`

**Backend — Model & API:**
```python
class Player(Base):
    id, name, phone, email, rank, member_id, club_id
    # UniqueConstraint("club_id", "member_id") — 1 member 1 player/CLB
```
- `GET /api/players` — list với filter `?type=member|guest`
- `POST /api/players` — tạo player (member hoặc guest)
- `PUT /api/players/{id}`, `DELETE /api/players/{id}`
- `TournamentCreate` nhận thêm `player_ids: List[int]` (singles) + `player_id`/`partner_player_id` trong teams (doubles)

**Frontend — Wizard tạo giải đấu:**
- Bước 1 "Chọn người chơi" nay có 2 tabs:
  - **Thành viên CLB**: chọn từ bảng (như cũ)
  - **Khách mời**: form nhập Tên + SĐT + Hạng → gọi `POST /api/players` ngay, lưu vào list
- Bước 2 "Ghép đội đôi": dropdown pick1/pick2 gộp cả member lẫn guest
- Ghép theo rank: hoạt động cho cả hai loại

**Migration:** `backend/migrations/add_players_tables.py` — idempotent, chạy tự động qua `docker-entrypoint.sh` trước khi start app.

---

### 5. Thêm Hạng (rank) cho khách mời

**Commit:** `bf8a389`

**Files thay đổi:** `backend/models.py`, `backend/schemas.py`, `backend/main.py`, `backend/migrations/add_players_tables.py`, `frontend/src/pages/Tournament.jsx`

**Backend:**
- `Player` model: thêm `rank = Column(String(50), default="Chưa xếp hạng")`
- Migration: `ALTER TABLE players ADD COLUMN rank VARCHAR(50) DEFAULT 'Chưa xếp hạng'` (idempotent)
- `PlayerCreate`: thêm `rank: Optional[str] = "Chưa xếp hạng"`
- `PlayerOut`: trả về `rank`; `create/update/list` đều xử lý rank

**Frontend:**
- Form thêm khách mời: dropdown chọn hạng `A / B / C / D / Hạt giống 1,2,3 / Chưa xếp hạng`
- Bảng danh sách khách mời: hiển thị Tag màu (A=đỏ, B=vàng, C=xanh dương, D=xanh lá, Hạt giống=tím, mặc định=xám)
- Ghép đội theo rank: pool gộp cả member + guest (đều có rank)

---

## 📝 TRẠNG THÁI HIỆN TẠI SAU PHIÊN #4

### Cấu trúc DB (production `/data/clb.db`)
```
clubs, users, club_memberships
members, fee_types, transactions
tournaments, tournament_participants, tournament_matches
players                   ← MỚI (phiên #4)
```

### Các cột mới trong tournament_participants (so với phiên #3)
```
member_id         — thay đổi: nullable (trước: NOT NULL)
player_id         — MỚI: FK → players (người 1 nếu là khách mời)
partner_member_id — không đổi
partner_player_id — MỚI: FK → players (người 2 nếu là khách mời, chỉ đôi)
```

### Backup production
- `/data/clb.db.bak` — snapshot trước khi deploy phiên #4 (2026-06-30)

---

## 🚧 VẤN ĐỀ TỒN ĐỌNG

### Telegram Bot không hoạt động — AI provider bị block

Bot **không xử lý được message** vì không có AI provider hoạt động từ Fly.io Singapore.

| Provider | Vấn đề |
|---|---|
| Anthropic Claude | Hết credits (cần nạp tối thiểu $5) |
| Groq (Llama 3.3 70B) | Cloudflare block IP Fly.io Singapore → HTTP 403 |
| Google Gemini 2.0 Flash | Quota = 0 (free tier không khả dụng cho project) |

**Cách fix nhanh nhất:** Nạp Anthropic $5 → dùng `claude-haiku-4-5` (~$0.01-0.05/tháng)
- Cập nhật `ANTHROPIC_API_KEY` mới: `flyctl secrets set ANTHROPIC_API_KEY="sk-ant-api03-..."`
- Sửa `bot/bot.py` để dùng `anthropic` SDK thay `google-genai`

---

## ✅ VIỆC CẦN LÀM TIẾP THEO

### Ưu tiên cao
- [ ] Fix Telegram Bot: nạp Anthropic credit hoặc tìm provider khác hoạt động từ Singapore

### Ưu tiên trung bình
- [ ] Export PDF cho báo cáo tháng
- [ ] Push notification khi giao dịch mới

### Ưu tiên thấp
- [ ] Voice message support cho Telegram Bot (Whisper API)

---

## 🔧 THÔNG TIN KỸ THUẬT

### Infrastructure
- **App:** `pickleball-manager` trên Fly.io
- **Region:** `sin` (Singapore)
- **Machine ID:** `18514d5c250398`
- **Database:** SQLite tại `/data/clb.db` (persistent volume `clb_data`)
- **URL:** https://pickleball-manager.fly.dev

### Fly.io Secrets
```
TELEGRAM_BOT_TOKEN = <xem trong flyctl secrets list>  (bot đang set)
ANTHROPIC_API_KEY  = <hết credits — cần nạp $5>
GROQ_API_KEY       = <bị block từ Singapore>
GEMINI_API_KEY     = <quota = 0>
BOT_USERNAME       = "telegrambot"
BOT_PASSWORD       = <xem trong flyctl secrets list>
BACKEND_URL        = "http://localhost:8000"
```

### Git
- **Repo:** https://github.com/trantrung9289/pickleball-manager
- **Branch:** `main`
- **Commits phiên #4:**
  - `bf8a389` feat: thêm hạng (rank) cho khách mời
  - `041ba4b` feat: tích hợp khách mời ngoài CLB vào giải đấu
  - `ce47e03` fix: dùng date thay datetime — SQLite comparison bug
  - `93f8394` feat: số dư đầu kỳ/cuối kỳ trong báo cáo tháng
- **Commits phiên #3 và trước:**
  - `c8bba99` fix: nâng httpx cho google-genai
  - `b64c857` feat: chuyển sang Google Gemini
  - `328310a` fix: tool_choice auto
  - ...

### Bot account
- Username: `telegrambot` (password xem trong Fly.io secrets `BOT_PASSWORD`)
- Tự động tạo khi deploy qua `_setup_bot_user()` trong `backend/main.py`

---

## 📌 GHI CHÚ KỸ THUẬT QUAN TRỌNG

1. **SQLite + Date comparison:** Luôn dùng `date(y,m,d)` (Python `datetime.date`), KHÔNG dùng `datetime(y,m,d)` khi filter cột `Date` — khác biệt do string comparison lexicographic gây ra bug âm thầm.
2. **Số dư quỹ = tính động:** Không lưu `balance` vào DB. Tính từ `SUM(amount)` theo điều kiện ngày.
3. **Migration idempotent:** `add_players_tables.py` kiểm tra column/table tồn tại trước mọi thao tác — chạy nhiều lần không lỗi.
4. **Backup trước deploy schema:** `flyctl ssh console -C "sh -c 'cp /data/clb.db /data/clb.db.bak'"` trước mỗi thay đổi DB.
5. **API keys KHÔNG lưu trong code** — chỉ set qua `flyctl secrets set`.
6. **Docker entrypoint thứ tự:** Migration → Backend khởi động → Bot khởi động (bất di bất dịch).
7. **Frontend cache:** Sau deploy, dùng hard refresh (`Cmd+Shift+R`) hoặc tab ẩn danh nếu UI cũ vẫn hiện.
