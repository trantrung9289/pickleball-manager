# Handoff — Phiên làm việc 2026-07-02 (cập nhật)

## Trạng thái hiện tại
- Deployed: https://pickleball-manager.fly.dev
- Branch: main (clean, đã push)
- DB: SQLite persistent trên Fly.io (volume)

---

## Phiên làm việc 2026-07-02 — Sửa lỗi + Cải tiến

### 37. Fix cron nhắc đóng phí không chạy

**Nguyên nhân gốc:** Image `python:3.11-slim` (Debian) không có `cron` cài sẵn. Entrypoint dùng lệnh `crond -b || true` (cú pháp Alpine/BusyBox) → fail silently, daemon không bao giờ khởi động.

**Chẩn đoán:** SSH vào container kiểm tra process list — không có `crond`. Crontab `/var/spool/cron/crontabs/root` không tồn tại.

**Fix:**
- `Dockerfile`: thêm `apt-get install -y --no-install-recommends cron`
- `docker-entrypoint.sh`: dùng `/etc/cron.d/fee-reminder` (Debian style, có trường `user`) + lệnh `cron` thay `crond -b`

**Verify sau deploy:** Process `cron` xuất hiện trong container; endpoint `POST /api/internal/send-fee-reminder` trả `sent: 1` ✅

**Cron chạy:** Mỗi ngày 7h UTC = 14h GMT+7. INTERNAL_SECRET = `pickleball-remind-2026`.

---

### 38. Tournament — Hiển thị tất cả thành viên kể cả Tạm nghỉ/Đình chỉ

**Vấn đề:** `Tournament.jsx` line 67 gọi `membersApi.list({ status: "active" })` → chỉ load thành viên Active.

**Fix (`frontend/src/pages/Tournament.jsx`):**
- Bỏ filter: `membersApi.list()` (không tham số)
- Thêm `STATUS_MEMBER_MAP` map status → badge màu
- Thêm cột **Trạng thái** vào `memberCols` với badge: xanh=Hoạt động, vàng=Tạm nghỉ, đỏ=Đình chỉ
- Mobile `mobileTitle`: hiển thị badge trạng thái nếu không phải Active
- `mobileHideColumns`: thêm `"Trạng thái"` vào danh sách ẩn trên mobile

**Xác nhận DB:** CLB 1 có "Cường" (`inactive`) — giờ hiển thị trong danh sách chọn.

---

## Còn lại (chưa làm)

| Hạng mục | Ghi chú |
|---|---|
| Reports.jsx Table.Summary | Vẫn scroll ngang mobile — chưa convert sang card |
| AdminPortal.jsx 3 bảng | Users/Clubs/Memberships chưa responsive |
| Bot: sửa giao dịch | Chưa có tính năng edit transaction |

---

## Lệnh hữu ích

```bash
fly deploy                                    # Deploy lên Fly.io
cd frontend && npm run dev                    # Dev local frontend
cd backend && uvicorn main:app --reload       # Dev local backend
cd frontend && npm run build                  # Build production
# Test cron nhắc phí thủ công:
curl -X POST "https://pickleball-manager.fly.dev/api/internal/send-fee-reminder?month=7&year=2026" -H "X-Internal-Secret: pickleball-remind-2026"
```

---

# Handoff — Phiên làm việc 2026-07-01 (cập nhật)

## Trạng thái hiện tại
- Deployed: https://pickleball-manager.fly.dev
- Branch: main (clean, đã push)
- DB: SQLite persistent trên Fly.io (volume)

---

## Công việc đã hoàn thành trong phiên này

### 1. Responsive Design toàn bộ (đầu phiên)
- `useResponsive.js`: detect thiết bị qua User-Agent + window resize
- `ViewModeContext.jsx`: quản lý mode Auto/Desktop/Mobile, lưu localStorage
- `ViewModeSwitcher.jsx`: nút chọn mode trong header
- `ResponsiveTable.jsx`: bảng responsive — desktop = antd Table, mobile = Card list
  - Props: `mobileTitle`, `mobileHideColumns`, `mobileSummary`, `rowSelection`
- `MobileBottomNav.jsx`: bottom navigation 5 tab cho mobile
- App.jsx: tích hợp ViewModeProvider, detect mobile bằng `isMobile` (screen width) cho nav, `isMobileView` (effective) cho content

### 2. Các trang đã convert sang ResponsiveTable
- `Members.jsx`: mobileTitle = tên + hạng
- `Transactions.jsx`: mobileTitle = tag Thu/Chi + khoản
- `FeeTypes.jsx`: mobileTitle = tên khoản; toolbar Space wrap fix overflow
- `Tournament.jsx`: mobileTitle cho tất cả bảng; checkbox "Chọn tất cả thành viên CLB"

### 3. Public Report (Chia sẻ báo cáo công khai)
**Backend:**
- Model PublicReportToken: token, slug, club_id, label, expires_at, is_active, view_count
- Migration tự động thêm cột slug vào bảng public_report_tokens
- _make_slug(): tên CLB bỏ dấu + 8 ký tự token → URL đẹp
- _validate_token(): lookup theo slug (mới) hoặc token đầy đủ (backward compat)
- Rate limiting: slowapi (30 req/min cho meta, 60/min cho sub-endpoints)
- CRUD endpoints (auth): POST/GET /api/report-links, PATCH toggle, DELETE
- Public endpoints (no auth): /api/public/report/{slug} + 6 sub-endpoints

**Frontend:**
- ReportContent.jsx: tách 4 sub-component báo cáo nhận api prop — dùng chung Admin + Public
- Reports.jsx: refactored + tab "Link công khai" với PublicLinksManager
- PublicReport.jsx: trang xem công khai READ-ONLY, header tên CLB, page title = tên CLB
- api.js: reportLinksApi (CRUD) + createPublicReportApi(slug) factory
- App.jsx: detect /public/report/{slug} → render PublicReport ngoài auth wrapper

**URL format:** https://pickleball-manager.fly.dev/public/report/clb-pickleball-ha-noi-xEo37Jzd

### 4. Theme System (3 giao diện)
- ThemeContext.jsx: Sport Blue (#1677ff), Dark Pro (#7c3aed/dark), Nature Green (#059669)
- ThemeSwitcher.jsx: nút chọn theme trong header, lưu localStorage
- main.jsx: ConfigProvider bọc ThemedApp → áp dụng toàn bộ Ant Design
- App.jsx: sidebar + avatar màu theo theme

---

## Kiến trúc quan trọng

### Navigation
- isMobile (screen < 768px): dùng MobileBottomNav thay Sider
- isMobileView (effective = isMobile OR forced mobile): dùng Card thay Table trong content

### Public Report auto-sync
ReportContent.jsx chứa 4 sub-component nhận api prop.
- Reports.jsx truyền: api = { reports: reportsApi, transactions: transactionsApi, feeTypes: feeTypesApi }
- PublicReport.jsx truyền: api = createPublicReportApi(slug) → gọi /api/public/report/{slug}/...
- Thay đổi UI báo cáo ở ReportContent.jsx tự động sync cả admin lẫn public

### Theme
- Chọn theme → lưu localStorage "appTheme"
- main.jsx đọc ThemeContext → ConfigProvider với algorithm + token tương ứng
- Sidebar bg và avatar color lấy từ themeConfig.sidebar / themeConfig.avatar

---

## Còn lại (chưa làm)

| Hạng mục | Ghi chú |
|---|---|
| Reports.jsx bảng Table.Summary | Vẫn scroll ngang mobile — chưa convert sang card |
| AdminPortal.jsx | 3 bảng Users/Clubs/Memberships chưa responsive |
| Tournament detail bảng điểm | Bảng trong chi tiết giải đấu chưa responsive |
| ThemeSwitcher trên mobile | Hiện chỉ desktop header; mobile thêm vào Drawer "Thêm" |

---

## Lệnh hữu ích

```bash
fly deploy                                    # Deploy lên Fly.io
cd frontend && npm run dev                    # Dev local frontend
cd backend && uvicorn main:app --reload       # Dev local backend
cd frontend && npm run build                  # Build production
```

---

## Phiên làm việc 2026-06-30 (tiếp theo)

### 4. Hệ thống Theme hoàn chỉnh

**Kiến trúc:**
- `ThemeContext.jsx`: mỗi theme có đầy đủ `menuTheme`, `sidebarText`, `sidebarSubText`, `sidebarBorder` để xử lý sidebar sáng/tối
- `ThemeProvider` đặt tại `main.jsx`, bao toàn bộ app → theme đồng bộ qua tất cả mode
- Default fallback: `"ai-minimalist"` (đã đổi từ `"sport-blue"`)

**2 theme cuối cùng (đã xoá 4 theme cũ):**
- `ai-minimalist` (✨): Sáng nhạt, mint green, `defaultAlgorithm`, sidebar `#EEF4F1`, `menuTheme="light"`
- `ai-inspired` (🔮): Tối nhạt, teal cyan, `darkAlgorithm`, sidebar `#111419`, `menuTheme="dark"`

**Theme bị xoá (không còn trong code):** Sport Blue, Dark Pro, Nature Green, AI MAX

**Files đã cập nhật cho theme:**
- `ThemeContext.jsx`: chỉ còn 2 theme; thêm `menuTheme/sidebarText/sidebarSubText/sidebarBorder`
- `App.jsx`: sidebar dùng `themeConfig.menuTheme`, `themeConfig.sidebarText/SubText/Border`; xoá code cứng `ai-max`
- `AdminPortal.jsx`: sidebar dùng các property theme thay vì hardcode màu
- `Login.jsx`: gradient map chỉ còn 2 entry; fallback = `ai-minimalist`
- `ThemeSwitcher.jsx`: `dark` prop → `darkStyle` vs `lightStyle`; dùng trong header + mobile Drawer

### 5. Card ô dữ liệu dùng Ant Design semantic tokens
- `ReportContent.jsx` (MonthlyStats): thêm `theme.useToken()`, thay toàn bộ màu cứng (`#e6f4ff`, `#f6ffed`, `#fff2f0`) → `colorPrimaryBg`, `colorSuccessBg`, `colorErrorBg` + viền `colorPrimaryBorder`, `colorSuccessBorder`, `colorErrorBorder`
- Kết quả: card tự đổi màu nền + viền theo theme, hoạt động cho cả admin lẫn public report

### 6. Public Report — đồng bộ theme
- `PublicReport.jsx`: thêm `useAppTheme()` + `theme.useToken()`, dùng `antToken.colorBgContainer/Layout/Text` thay màu cứng
- Header bar, label bar, card nền đều theo theme
- `ThemeSwitcher dark={isDark}` tự chuyển style theo theme đang dùng

### 7. Đăng nhập — Ghi nhớ tài khoản & mật khẩu
- Checkbox "Ghi nhớ tài khoản": lưu username vào localStorage key `rememberedUsername`
- Checkbox "Ghi nhớ mật khẩu": lưu password vào localStorage key `rememberedPassword`
- Bỏ tích "Ghi nhớ mật khẩu" → xoá ngay lập tức (không chờ login)
- Tích "Ghi nhớ mật khẩu" → hiện cảnh báo bảo mật màu vàng
- Pre-fill cả hai trường khi mở trang nếu đã lưu
- `autoComplete="on"` trên form để trình duyệt cũng tự gợi ý

---

## Trạng thái file quan trọng

| File | Trạng thái |
|---|---|
| `frontend/src/contexts/ThemeContext.jsx` | 2 theme: ai-minimalist, ai-inspired |
| `frontend/src/components/ThemeSwitcher.jsx` | Prop `dark` để đổi style |
| `frontend/src/components/ReportContent.jsx` | Dùng `theme.useToken()` cho card màu |
| `frontend/src/pages/Login.jsx` | 2 checkbox ghi nhớ + gradient theo theme |
| `frontend/src/pages/PublicReport.jsx` | Full theme-aware |
| `frontend/src/App.jsx` | Sidebar dùng themeConfig properties |
| `frontend/src/pages/AdminPortal.jsx` | Sidebar dùng themeConfig properties |

## Công việc còn lại (từ phiên trước)
- ~~Tournament bracket/score responsive~~ ✅ Đã fix (phiên 2026-07-01)

---

## Phiên làm việc 2026-06-30 (tiếp theo — Telegram Bot)

### 8. Khôi phục Telegram Bot với Groq free tier

**Vấn đề cũ:** Bot bị tắt vì Gemini 2.0 Flash hết quota free tier (limit: 0).

**Hành trình fix:**
- Gemini 2.0 Flash → limit 0 → thử 1.5 Flash → deprecated → thử 2.0 Flash Lite → limit 0
- Nguyên nhân gốc: Google AI Studio free tier không khả dụng cho region Singapore
- Giải pháp cuối: **quay lại Groq** + đổi Fly.io region từ `sin` → `iad` (Washington DC)

**Thay đổi code:**
- `docker-entrypoint.sh`: điều kiện khởi động bot từ `GROQ_API_KEY` thay `GEMINI_API_KEY` (bot đã dùng Gemini nhưng entrypoint vẫn check Groq)
- `bot/bot.py`: chuyển toàn bộ từ `google-genai` SDK → `groq` SDK (AsyncGroq)
- `bot/requirements.txt`: thay `google-genai==1.16.0` → `groq>=0.9.0`
- `fly.toml`: `primary_region = "iad"` (từ `"sin"`)

**TOOLS format:** chuyển từ Gemini `gtypes.Tool(function_declarations=[...])` sang OpenAI/Groq format `[{"type": "function", "function": {...}}]`

**Model hiện tại:** `llama-3.1-8b-instant` (tiết kiệm token hơn `llama-3.3-70b-versatile`)

### 9. Fix bot hallucinate / làm sai lệnh

**Vấn đề:**
- Bot truyền `member_code` (string "TV0003") vào `member_id` (integer) → Groq 400 schema error
- Bot đôi khi báo thành công dù tool trả về lỗi
- Bot thêm thành viên thay vì xóa (nhầm lệnh)

**Fix:**
- `delete_member` tool: thêm param `member_code` (string) song song `member_id` (integer)
- `execute_tool`: tự resolve `member_code → member_id` bằng cách gọi list_members + filter
- System prompt: rút ngắn + nhấn mạnh "báo đúng kết quả tool, XÓA→delete_*, THÊM→add_*"
- `MAX_HISTORY`: giảm từ 20 → 6 để tránh context lẫn lộn

### 10. Giới hạn Groq free tier

**Quota:** 100,000 token/ngày cho `llama-3.3-70b-versatile` và `llama-3.1-8b-instant`
- Trong phiên test nặng → hết quota trong ngày
- Sử dụng thực tế (CLB nhỏ, 10-30 tin/ngày) → ổn

**Models đã thử và trạng thái:**
| Model | Trạng thái |
|---|---|
| `llama-3.3-70b-versatile` | ✅ Hoạt động, nhiều token hơn |
| `llama-3.1-8b-instant` | ✅ Hoạt động, tiết kiệm token — đang dùng |
| `mixtral-8x7b-32768` | ❌ Decommissioned |
| `gemini-2.0-flash` | ❌ Free tier limit 0 (Singapore) |
| `gemini-1.5-flash` | ❌ Deprecated |
| `gemini-2.0-flash-lite` | ❌ Free tier limit 0 (Singapore) |

### Fly.io secrets hiện tại

| Secret | Trạng thái |
|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ |
| `GROQ_API_KEY` | ✅ |
| `GEMINI_API_KEY` | ✅ (không dùng nữa) |
| `ANTHROPIC_API_KEY` | ✅ (không dùng nữa) |

### Công việc còn lại cho bot
- Test toàn bộ tính năng sau khi quota reset: thêm/xóa thành viên, ghi giao dịch, báo cáo
- Xem xét xóa `GEMINI_API_KEY` và `ANTHROPIC_API_KEY` khỏi Fly.io secrets (không dùng)

---

## Phiên làm việc 2026-07-01 — Bot menu-driven + Fixes

### 11. Bot chuyển sang menu-driven (không AI, không Groq)

**Lý do:** Bot AI (Groq) không ổn định, hallucinate, hết quota. Chuyển hoàn toàn sang Inline Buttons.

**Kiến trúc mới (`bot/bot.py`):**
- Không còn AI/LLM — toàn bộ điều hướng bằng `InlineKeyboardButton` + `CallbackQueryHandler`
- `ConversationHandler` chỉ dùng cho login (WAIT_USERNAME → WAIT_PASSWORD)
- Wizard engine: `_wizard[user_id] = {name, step, data}` — dẫn qua từng bước nhập liệu
- Per-user state: `_sessions`, `_user_club`, `_user_club_name`, `_wizard`, `_ft_name_cache`, `_tx_cache`, `_menu_cfg`, `_welcomed`
- Một `handle_callback` duy nhất xử lý tất cả callback data

**Các tính năng bot đã có:**
- Đăng nhập (ConversationHandler) → chọn CLB
- Menu chính (cấu hình được bật/tắt từ BotConfigPanel)
- Thành viên: danh sách, thêm, cập nhật hạng/trạng thái, xóa (wizard)
- Thu tiền / Chi tiền (wizard)
- Báo cáo: tổng quan, theo tháng, trạng thái phí
- Giao dịch: xem theo kỳ (tháng trước/này/sau), lọc thu/chi, xóa (button + confirm)
- Danh mục: xem, thêm khoản, xóa khoản
- Hướng dẫn
- Welcome message (1 lần/session, nội dung từ BotConfigPanel)

### 12. BotConfigPanel (frontend)

- Tab "Bot Config" trong AdminPortal (chỉ Superuser)
- File: `frontend/src/components/BotConfigPanel.jsx`
- Cấu hình: Tree checkable bật/tắt từng chức năng + Tin nhắn chào mừng (hỗ trợ `{club_name}`)
- Lưu vào bảng `bot_config` (key-value) trong DB

**Backend endpoints:**
- `GET /api/bot-config` — member của CLB có thể đọc (cho bot)
- `PUT /api/bot-config` — chỉ superuser

### 13. Timezone Việt Nam (GMT+7)

- Thêm `ZoneInfo("Asia/Ho_Chi_Minh")` vào `backend/main.py` và `bot/bot.py`
- Hàm `_now_vn()` thay thế tất cả `datetime.now()`
- ⚠️ Không dùng `datetime.now()` trực tiếp — server Fly.io chạy UTC

### 14. Mã thành viên không trùng

- `auto_member_code()` trong `backend/main.py`: scan mã `TV####` hiện có, lấy số nguyên nhỏ nhất chưa dùng
- Tránh tạo mã trùng khi xóa thành viên giữa chừng

### 15. Mobile Bottom Nav cải thiện

- Icon size: 20px → 24px; màu inactive: `#8c8c8c` → `#434343`
- Active indicator bar (3px xanh ở đầu tab)
- "Thêm" icon: `MoreOutlined` → `AppstoreOutlined`
- File: `frontend/src/components/mobile/MobileBottomNav.jsx`

### 16. Xóa giao dịch thiết kế lại

**Flow mới (button-based, có confirm):**
1. Xem GD → `🗑 Xóa GD`
2. Danh sách GD dạng button chọn
3. Màn hình confirm (icon + tên + số tiền + ngày + cảnh báo)
4. `✅ Xác nhận xóa` / `❌ Hủy`

**Kỹ thuật:** Dùng `_tx_cache[user_id]` thay vì gọi `GET /api/transactions/{id}` (endpoint này **không tồn tại**).

### Fly.io secrets hiện tại

| Secret | Trạng thái |
|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ Đang dùng |
| `GROQ_API_KEY` | ✅ Còn lưu nhưng không dùng nữa |
| `GEMINI_API_KEY` | ✅ Còn lưu nhưng không dùng nữa |
| `ANTHROPIC_API_KEY` | ✅ Còn lưu nhưng không dùng nữa |

### Callback data patterns (bot)

| Pattern | Ý nghĩa |
|---|---|
| `gdlist:{m}:{y}` | Xem danh sách GD |
| `gdlist:{m}:{y}:income/expense` | Lọc loại GD |
| `gdlist_del:{m}:{y}` | Picker chọn GD để xóa |
| `deltx_confirm:{tx_id}:{m}:{y}` | Màn hình confirm xóa |
| `deltx:{tx_id}:{m}:{y}` | Thực hiện xóa |
| `rpt_monthly:{m}:{y}` | Báo cáo theo tháng |
| `rpt_fee:{m}:{y}` | Chọn loại phí |
| `rpt_fee_ft:{m}:{y}:{ft_id}` | Báo cáo trạng thái phí |

### Known issues / còn lại
- Bot: chưa có tính năng sửa giao dịch
- Frontend bundle ~1.9MB → đã fix bằng code-split (mục 18)

---

## Phiên làm việc 2026-07-01 (tiếp theo)

### 17. Bot: Phân trang picker xóa GD
- `bot/bot.py` handler `gdlist_del`: thêm param `page` vào callback data (`gdlist_del:{m}:{y}:{page}`)
- Mỗi trang 10 GD, nút `◀ Trang X` / `Trang X ▶` hiện khi cần
- Header hiển thị `Trang 1/3 — 25 GD` khi có nhiều trang
- Không còn giới hạn 20 GD/tháng

### 18. Code-split frontend
- `App.jsx`: tất cả pages/components dùng `lazy(() => import(...))` + `<Suspense>`
- `vite.config.js`: `manualChunks` (function) tách `vendor-react` và `vendor-antd`
- Kết quả build: bundle chính `index.js` giảm từ ~1.9MB → **69KB**; vendor-antd cache riêng 1.36MB
- Lần tải đầu user chỉ cần ~600-700KB thay vì toàn bộ 1.9MB

### 20. Tournament responsive (mobile)
- `KnockoutBracket`: mobile → dùng `Collapse` theo vòng (dọc), desktop giữ bố cục ngang
- `StandingsTable`: `mobileTitle` dùng emoji huy chương 🥇🥈🥉, ẩn cột `#` và `Đội`
- `matchTableCols`: thêm `matchTableMobileProps` với `mobileTitle` = "Đội 1 vs Đội 2 tỉ-số", ẩn 4 cột chi tiết
- Áp dụng cho cả 4 loại format: round_robin, knockout, combined (vòng bảng + knockout)

### 19. Xóa Fly.io secrets thừa
- Đã unset: `GROQ_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`
- Chỉ còn `TELEGRAM_BOT_TOKEN` (đang dùng)

---

## Phiên làm việc 2026-07-01 (tiếp theo — Frontend nâng cấp)

### 21. Giao dịch — sắp xếp mới nhất + sorter/filter cột

- Mặc định sort `transaction_date` descending (mới nhất lên đầu) ngay sau khi load
- Cột **Ngày**: sorter tăng/giảm, `defaultSortOrder: "descend"`
- Cột **Loại**: filter dropdown Thu / Chi
- Cột **Khoản**: sorter A→Z + filter dropdown (tự động từ data)
- Cột **Thành viên**: sorter A→Z + filter dropdown (tự động từ data)
- Cột **Số tiền**: sorter nhỏ→lớn
- File: `frontend/src/pages/Transactions.jsx`

### 22. Báo cáo — Đóng góp thành viên: lọc tháng + sorter/filter đầy đủ

**Bộ lọc toolbar:**
- Select **Tháng** (1–12, allowClear)
- Select **Khoản thu** (từ API fee-types)
- Input **Tìm kiếm** mã TV / họ tên (client-side)

**Sorter cột:**
- Mã TV, Họ và tên, Khoản đóng (A→Z)
- Số lần (ít→nhiều)
- Tổng tiền (ít→nhiều, mặc định nhiều nhất lên đầu)

**Filter inline cột:** Khoản đóng (dropdown tự động từ data)

**Backend:** thêm param `month` cho cả `/api/reports/member-contributions` và `/api/public/report/{slug}/member-contributions`

- File: `frontend/src/components/ReportContent.jsx`, `backend/main.py`

### 23. Báo cáo — Theo dõi phí: sorter/filter + tìm kiếm đầy đủ

**Bộ lọc toolbar:** thêm Input tìm kiếm mã TV / họ tên

**Sorter cột:** Mã TV, Họ và tên, SĐT, Hạng, Trạng thái (Chưa đóng lên trên mặc định)

**Filter inline cột:** Hạng (dropdown tự động từ data), Trạng thái (Đã đóng / Chưa đóng)

- File: `frontend/src/components/ReportContent.jsx`

### 24. Phân quyền CLB — Modal mới + bảng grouped by CLB

**Modal tạo/sửa quyền:**
- Bước 1: Chọn CLB
- Bước 2: Chọn tài khoản (multi-select, tối đa 3, `mode="multiple"`)
- Bước 3: Checkbox quyền — Xem / Tạo / Sửa / Xóa (có thể tích 1 hoặc nhiều)
- Khi tạo mới: tạo đồng thời cho nhiều user, bỏ qua user đã có quyền CLB đó
- Khi sửa: chỉ cập nhật quyền, CLB và user bị lock

**Bảng phân quyền — grouped by CLB:**
- Mỗi CLB = 1 dòng, các user xếp dọc trong ô Tài khoản
- Quyền hiển thị thực tế từ DB (không hardcode), quyền không có thì tag mờ (opacity 0.35)
- Căn hàng 3 cột (Tài khoản / Quyền / Thao tác) bằng `height: ROW_H = 52px`
- Header thống kê: "X câu lạc bộ · Y tài khoản được gán quyền"

- File: `frontend/src/pages/AdminPortal.jsx`

### 25. Tài khoản — thêm cột CLB đang quản lý

- Cột mới sau "Loại tài khoản": hiển thị danh sách CLB user đang quản lý
- Format mỗi dòng: `<Tag cyan>{club.id}</Tag> {club.name}`
- Cross-reference từ state `memberships` + `clubs` (không gọi thêm API)
- Superuser không có CLB → hiển thị "—"

- File: `frontend/src/pages/AdminPortal.jsx`

---

## Phiên làm việc 2026-07-01 (tiếp theo — UI Redesign + Bot Menu)

### 26. UI Redesign — Gói 1: Font + Brand Color + Cleanup

**Thay đổi:**
- Font: Inter → **Outfit** (Google Fonts, load qua `<link>` trong `index.html`)
- Accent color: thống nhất **1 màu duy nhất `#27A063`** (xanh lá) cho cả 2 theme
  - Trước: ai-minimalist `#2BA56C`, ai-inspired `#2DD4BF` (teal)
  - Landing page: `#faad14` + `#1677ff` → đều `#27A063`
  - Dashboard: `#1677ff` hardcode → `#27A063`
- Border radius: 16/20/10 → **8/12/6** (compact hơn)
- Box shadow: black thuần → green-tinted `rgba(0,60,30,0.08)`
- Xóa ~200 dòng Vite scaffold CSS khỏi `index.css` (`.hero`, `.counter`, `:root` variables không dùng)
- Thêm `font-variant-numeric: tabular-nums` cho statistic + table
- Theme labels: "AI Minimalist"/"AI Inspired" → **"Sáng"/"Tối"** (icon ☀️/🌙)
- `scroll-behavior: smooth` global

**Files:** `frontend/index.html`, `frontend/src/index.css`, `frontend/src/contexts/ThemeContext.jsx`, `frontend/src/pages/Landing.jsx`, `frontend/src/pages/Dashboard.jsx`

### 27. UI Redesign — Public Report: Gói 1 + Bug fix

**Bug fix critical:** `isDark = themeName === "dark-pro"` → `"ai-inspired"` (tên theme sai, dark mode label bar không hoạt động)

**Brand color:** Label bar `#e6f4ff`/`#0958d9` (Ant blue) → `rgba(39,160,99,...)` xanh lá. Tag lượt xem `color="blue"` → `"green"`.

**File:** `frontend/src/pages/PublicReport.jsx`

### 28. UI Redesign — Gói 2: Component Polish

- Card hover: `translateY(-2px)` + green-tinted shadow
- Button active/press: `scale(0.97) translateY(1px)`
- Button transition `0.18s ease`
- Focus ring `#27A063` cho keyboard nav

### 29. UI Redesign — Gói 3: Loading States

- Dashboard: `<Spin>` → **Skeleton layout-aware** (4 KPI card + monthly card + chart)
- Monthly card: `<Spin size="small">` → `<Skeleton paragraph rows=1>`

**File:** `frontend/src/pages/Dashboard.jsx`

### 30. Bot Telegram: Nút 🏠 Menu toàn bộ flow (29 vị trí)

**Logic `menu:exit`:** đang wizard → confirm dialog; không có wizard → main menu trực tiếp.

**Màn hình đã thêm nút (trước không có):**
- Wizard confirm screen (del_member)
- Nhập ngày thủ công (trước: không có button nào)
- `member_list` + empty state
- `_period_menu` (chọn tháng)
- `report_overview`, `report_monthly`, `report_fee_status`, `report_fee_status_select_ft`
- `category_delete_menu`, `del_confirm`, `del_exec`
- `deltx_confirm`, error states
- Wizard submit success/error (tất cả wizard)

**File:** `bot/bot.py`

---

---

## Phiên làm việc 2026-07-02 — Hệ thống Nhắc Đóng Phí Telegram

### 31. Migration DB (add_fee_reminder.py)

File: `backend/migrations/add_fee_reminder.py` — idempotent (an toàn chạy nhiều lần)

- `club_memberships.telegram_chat_id` INTEGER NULL — lưu Telegram user_id của admin CLB
- `fee_types.remind_enabled` INTEGER DEFAULT 0 — bật/tắt nhắc cho từng khoản thu
- Bảng `reminder_log` với UNIQUE(club_id, fee_type_id, month, year, send_date) — chỉ dùng cho cron

### 32. Backend endpoints mới (backend/main.py)

**CLB admin endpoints (dùng `get_club_permission`):**
- `PATCH /api/my-memberships/telegram-chat-id` — bot lưu chat_id sau khi admin đăng nhập
- `GET /api/fee-reminders/preview?month=M&year=Y` — xem trước danh sách chưa đóng
- `POST /api/fee-reminders/send?month=M&year=Y` — **gửi thủ công, không giới hạn, không anti-spam**

**Internal endpoints (dùng `_check_internal_secret` via `X-Internal-Secret` header):**
- `GET /api/internal/fee-reminders` — cron hỏi danh sách cần nhắc
- `POST /api/internal/send-fee-reminder` — cron gửi (có check reminder_log)

**Helper `_build_reminder_data(month, year, db)`:** trả list mỗi fee_type có `remind_enabled=True` kèm `admin_chat_ids`, `unpaid_count`, `unpaid_members`.

### 33. Bot lưu telegram_chat_id (bot/bot.py)

- Thêm `_save_telegram_chat_id(token, club_id, chat_id)` — fire-and-forget, gọi `PATCH /api/my-memberships/telegram-chat-id`
- Gọi trong `_after_login` (1 CLB) và `club:` callback (chọn CLB)

### 34. Cron nhắc phí (bot/notify_bot.py + docker-entrypoint.sh)

- `notify_bot.py` — script standalone, logic `_determine_reminder_month(today)`:
  - 5 ngày cuối tháng M → nhắc M+1
  - 5 ngày đầu tháng M → nhắc M
  - Ngoài ra → bỏ qua
- `docker-entrypoint.sh` — thêm crontab `0 7 * * *` (7h UTC = 14h GMT+7) + `crond -b`
- Env vars: `BACKEND_URL`, `INTERNAL_SECRET`

### 35. BotConfigPanel di chuyển sang CLB admin (quyết định kiến trúc quan trọng)

**Trước:** BotConfigPanel ở AdminPortal, chỉ superuser dùng được, cần `/api/admin/*` endpoints riêng.

**Sau:** BotConfigPanel mở từ dropdown avatar → "Cài đặt Telegram Bot" (Drawer bên phải), dùng permission hệ thống chuẩn.

**Lợi ích:**
- Admin CLB tự cấu hình không cần qua superuser
- Dùng `get_club_permission` bình thường, không cần endpoint admin đặc biệt
- `PUT /api/fee-types/{id}` (standard) thay cho `/api/admin/fee-types/{id}`

**Files thay đổi:**
- `frontend/src/App.jsx` — thêm Drawer + lazy BotConfigPanel, nút trong userMenu
- `frontend/src/pages/AdminPortal.jsx` — xóa toàn bộ BotConfigPanel và tab "Telegram Bot"
- `frontend/src/components/BotConfigPanel.jsx` — xóa club selector, dùng `authHeaders()` với `selectedClubId`

### 36. Gửi ngay không giới hạn (quyết định thiết kế)

Nút "Gửi ngay" trong BotConfigPanel **không** có anti-spam:
- Không check `reminder_log`
- Không skip khi `unpaid_count == 0` — thay vào đó gửi "✅ Tất cả đã đóng phí!"
- Admin CLB gửi bao nhiêu lần/ngày tuỳ ý

Chỉ cron tự động mới có `reminder_log` (lịch chạy chính là cơ chế kiểm soát).

### Bugs đã fix trong phiên này

| Lỗi | Nguyên nhân | Fix |
|---|---|---|
| 403 khi preview/send | `get_club_permission` block superuser đúng — cần chuyển context | Chuyển BotConfigPanel sang CLB admin |
| AttributeError `perms.user_id` | `ClubPermissions` không có attr `user_id` | Đổi thành `perms.membership.user_id` |
| 500 khi gửi Telegram | `BOT_TOKEN` không tồn tại trên Fly.io — secret đúng là `TELEGRAM_BOT_TOKEN` | Dùng `_os.environ.get("TELEGRAM_BOT_TOKEN") or _os.environ.get("BOT_TOKEN", "")` |
| 422 preview + "Lỗi lưu cấu hình" | `localStorage.getItem("clubId")` không tồn tại — đúng là `"selectedClubId"` | Fix `getClubId()` trong BotConfigPanel |
| Tag "Admin chưa đăng nhập Bot" không mất | Do bug `perms.user_id` → chat_id không bao giờ được lưu | Fix AttributeError + admin re-login bot |

### Fly.io secrets hiện tại

| Secret | Trạng thái |
|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ Bot Telegram |
| `INTERNAL_SECRET` | ✅ Cron nhắc phí (X-Internal-Secret header) |
| `BACKEND_URL` | ✅ URL backend cho notify_bot.py |
| `BOT_USERNAME` | ✅ Tài khoản bot tự đăng nhập hệ thống |
| `BOT_PASSWORD` | ✅ Mật khẩu bot tự đăng nhập hệ thống |
| `BOT_CLUB_ID` | ✅ Club ID mặc định của bot |

---

## Theme hiện tại (sau redesign 2026-07-01)

| Theme | Label | Primary | Algorithm |
|---|---|---|---|
| `ai-minimalist` | ☀️ Sáng | `#27A063` | defaultAlgorithm |
| `ai-inspired` | 🌙 Tối | `#27A063` | darkAlgorithm |

**Font:** Outfit (Google Fonts) — đã thay Inter
