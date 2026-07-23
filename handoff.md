# Handoff — Phiên làm việc 2026-07-23 (mới nhất)

## Trạng thái hiện tại
- Deployed: https://pickleball-manager.fly.dev
- Branch: main
- DB: SQLite persistent trên Fly.io (volume)
- Commit mới nhất đã deploy: `5db3972`

---

## Phiên làm việc 2026-07-23 (tiếp 2) — Gán khoản thu cho Khách mời

**Yêu cầu người dùng:** "Các khoản thu đều có thể gán cho Khách mời và Thành viên ở tất cả trạng thái" — trước đó `Transaction` chỉ có `member_id`, khách mời (`Player.member_id IS NULL`) hoàn toàn không thể được gán khoản thu, không xuất hiện trong báo cáo, và bot Telegram không biết đến khoản thu từ khách mời.

### 1. Backend — thêm `player_id` vào `Transaction` (commit `6ed16e2`)
- `backend/models.py`: `Transaction.player_id` (FK `players.id`, nullable) + relationship `player`.
- `backend/main.py` `_run_migration()`: thêm dòng migration tự động `("transactions", "player_id", "INTEGER REFERENCES players(id)", None)` — pattern y hệt các cột khác trong list này, chạy tự động mỗi lần app khởi động, an toàn/idempotent.
- `backend/schemas.py`: di chuyển `PlayerOut`/`PlayerCreate` lên TRƯỚC `TransactionBase` (forward-reference), thêm `player_id` vào `TransactionBase`, `player: Optional[PlayerOut]` vào `TransactionOut`.
- `list_transactions`: thêm filter `player_id`, `search` join thêm `models.Player`.
- `create_transaction`/`update_transaction`: không cần sửa gì — dùng `data.model_dump()` generic nên field mới tự động đi qua.

### 2. Frontend — selector gộp Thành viên + Khách mời (`Transactions.jsx`)
- Field form đổi từ `member_id` → `assignee` (string dạng `"m:5"` hoặc `"g:3"`), tách ra `member_id`/`player_id` lúc submit (xem `handleSave`).
- Cột bảng "Thành viên / Khách mời" hiển thị tag "Khách mời" màu cam khi `r.player` có giá trị.
- Load thêm `playersApi.list("guest")` cùng lúc với `membersApi.list()`.

### 3. Báo cáo + Bot Telegram cũng bỏ sót khách mời — fix tiếp (commit `5db3972`)
Sau khi thêm `player_id`, người dùng phát hiện: "trong bot tele: các khoản thu chưa có thu cho khách mời, và trong báo cáo thống kê chưa hiển thị được các khoản thu của khách mời" — vì các endpoint báo cáo/nhắc phí có TỪ TRƯỚC được viết cứng theo `member_id`/bảng `members`, không biết `player_id` mới thêm tồn tại.

- `/api/reports/member-contributions` (`main.py`): thêm query thứ 2 join `Transaction.player_id == Player.id`, gộp kết quả với query member cũ, thêm field `is_guest`/`player_id`, `member_code=None` cho khách mời.
- `/api/reports/fee-status`: thêm field mới `guests` (list khách mời đã đóng khoản này trong tháng) + `guest_paid_count`. **Không** đưa khách mời vào `members`/`unpaid` — khách mời không có nghĩa vụ đóng định kỳ như thành viên nên không có khái niệm "chưa đóng".
- `_build_reminder_data` (dùng chung bởi preview/send thủ công + cron nội bộ): thêm `guests_paid`/`guest_paid_count` cho mỗi fee_type; cả 2 nơi build text tin nhắn Telegram (`send_fee_reminders_frontend`, `send_fee_reminder`) đều thêm dòng "Khách mời đã đóng (N người): ..." khi có.
- Frontend: `ReportContent.jsx` (cột "Thành viên" trong bảng giao dịch, bảng "Đóng góp thành viên" — rowKey/mobileTitle phải xử lý `member_id === null`, bảng "Theo dõi phí" thêm Card riêng liệt kê khách mời đã đóng); `BotConfigPanel.jsx` (modal xem trước nhắc phí thêm khối "Khách mời đã đóng").

### Xác minh đã thực hiện
- Backend: test round-trip qua Python trực tiếp (import `main` để trigger migration, tạo `Transaction` với `player_id`, serialize qua `TransactionOut.model_validate` — xác nhận JSON đúng cấu trúc).
- Cả 2 lần deploy: chạy local `uvicorn` trên bản sao `clb.db.bak` của DB dev (không đụng file gốc), tạo JWT thủ công bằng `auth.create_access_token({'sub': 'trantrung9289'})` (user thường có membership, KHÔNG dùng `admin` vì là superuser bị chặn ở club endpoint), gọi `curl` trực tiếp 3 endpoint (`member-contributions`, `fee-status`, `fee-reminders/preview`) — xác nhận cả 3 đều trả về đúng dữ liệu khách mời. Dọn dẹp transaction/player test, khôi phục `clb.db` nguyên trạng sau khi xong.
- Frontend: `npx vite build` sạch (chỉ warning chunk size, không lỗi).
- Đã hỏi & được xác nhận trước khi `fly deploy` cả 2 lần (migration cột mới lần 1 — giải thích rõ chỉ ADD COLUMN nullable, không ảnh hưởng số liệu cũ; lần 2 không có thay đổi schema). Cả 2 lần `curl` production trả HTTP 200 sau deploy; lần 1 còn xác nhận qua `fly ssh console` cột `player_id` đã tồn tại trong `/data/clb.db` thật.

**Việc còn để ngỏ (chưa làm, có thể cần sau):** `/api/transactions/export` (xuất Excel) và file mẫu import Excel giao dịch chưa được kiểm tra có hỗ trợ khách mời hay không — nếu người dùng cần xuất/nhập Excel có khách mời thì cần rà lại `export_transactions`/`import_transactions` trong `main.py`.

---

## Phiên làm việc 2026-07-23 (tiếp 3) — Đồng bộ báo cáo public với admin + cơ chế chống lệch tương lai

**Yêu cầu người dùng:** "Cần đồng bộ hiển thị báo cáo trên trang public giống như bên trang quản lý CLB cho phần thu chi vừa chỉnh sửa hôm nay" — phát hiện đúng như dự đoán ở mục "để ngỏ" phiên trước: các endpoint `/api/public/report/{slug}/*` là bản **copy-paste riêng** của endpoint admin, nên khi thêm khách mời vào báo cáo admin (commit `5db3972`) thì bản public bị bỏ sót, không có `player_id`/`is_guest`/`guests`/`guest_paid_count`.

### Root cause
`PublicReport.jsx` (frontend) tái sử dụng chung component `ReportContent.jsx` với trang admin — UI không có vấn đề gì. Vấn đề nằm ở **backend**: 2 endpoint public (`public_report_member_contributions`, `public_report_fee_status`) có logic SQL viết tay trùng lặp hoàn toàn với 2 endpoint admin (`member_contributions`, `fee_status`), thay vì gọi chung một chỗ. Đây là nguyên nhân gốc khiến 2 bên dễ lệch nhau mỗi khi sửa logic báo cáo.

### Fix — refactor thành hàm dùng chung (không tạo commit riêng cho bug-fix tạm, sửa thẳng kiến trúc)
- Tách logic ra 2 hàm nội bộ trong `backend/main.py`: `_query_member_contributions(db, club_id, fee_type_id, year, month)` và `_query_fee_status(db, club_id, month, year, fee_type_id)` — nhận `club_id` làm tham số thay vì lấy trực tiếp từ `perms`/`rec`.
- Endpoint admin (`/api/reports/member-contributions`, `/api/reports/fee-status`) và endpoint public (`/api/public/report/{slug}/member-contributions`, `/api/public/report/{slug}/fee-status`) đều chỉ còn vài dòng gọi hàm dùng chung, khác nhau ở chỗ lấy `club_id` (từ `perms.club_id` vs `rec.club_id` sau `_validate_token`).
- Kết quả: `main.py` giảm 74 dòng code trùng lặp. Từ nay sửa logic báo cáo thu chi (thêm field, đổi filter, join thêm bảng...) chỉ cần sửa 1 nơi — cả 2 trang tự động đồng bộ.

### Đối chiếu: phần Giải đấu (Tournament) trên trang public — đã kiểm tra, KHÔNG có vấn đề tương tự
Endpoint admin `/api/tournaments/{tid}/standings` và public `/api/public/report/{slug}/tournaments/{tid}/standings` đều build `p_dicts`/`m_dicts` rồi gọi chung hàm `compute_standings()` — mô hình này đã đúng từ trước, không cần sửa. Khác biệt duy nhất (chủ đích, không phải bug): public list/detail lọc bỏ giải trạng thái `draft`.

### Xác minh
- `python3 -c "import ast; ast.parse(open('main.py').read())"` → OK (không lỗi cú pháp).
- Chạy `uvicorn` local trên bản sao `clb_test_copy.db` (không đụng file gốc), tạo 1 `public_report_tokens` test trực tiếp bằng SQL, `curl` cả 2 endpoint (`member-contributions`, `fee-status`) → trả đúng cấu trúc có `player_id`/`is_guest` (member-contributions) và `guests`/`guest_paid_count` (fee-status). Đã dọn dẹp file DB test sau khi xong.

---

## Phiên làm việc 2026-07-23 (tiếp) — Bottom nav mobile cho link public

**Yêu cầu:** Trên link public (`/public/report/:token`) ở chế độ Mobile, đưa 5 mục (Tổng hợp năm, Thống kê tháng, Đóng góp thành viên, Theo dõi phí, Theo dõi giải đấu) vào 1 menu hiển thị bên dưới giống trang quản lý CLB, thay vì thanh Tabs cuộn ngang phía trên.

**Fix:**
- `components/mobile/MobileBottomNav.jsx`: sửa để chỉ render nút "Thêm" (overflow) khi có truyền `onMore` — cho phép tái sử dụng component này ở nơi không cần overflow (đủ ≤5 mục).
- `pages/PublicReport.jsx`: import `useViewMode` (trước đây không dùng context này); gộp định nghĩa 5 section vào mảng `SECTIONS` dùng chung cho cả 2 chế độ; khi `isMobileView` render `MobileBottomNav` (không truyền `onMore`) + nội dung section đang chọn (state `activeSection`); khi desktop giữ nguyên `Tabs` top như cũ, cùng điều khiển bởi `activeSection` nên chuyển đổi qua lại giữa 2 kích thước màn hình không mất tab đang xem.
- Thêm `navLabel` ngắn riêng cho bottom nav (Tháng/Năm/Đóng góp/Phí/Giải đấu) vì label đầy đủ quá dài cho nút 1/5 chiều rộng màn hình.

**Xác minh:** Chạy dev server (frontend + backend), tạo tạm 1 dòng `public_report_tokens` trong `clb.db` trỏ tới club có dữ liệu thật, mở `/public/report/devtest123` ở viewport mobile (375x812) — xác nhận bottom nav hiện đủ 5 tab, click "Đóng góp" chuyển đúng nội dung (dữ liệu thật hiển thị). Resize desktop (1440x900) xác nhận quay lại `Tabs` top, giữ nguyên tab đang chọn. Đã xóa token test sau khi xong.

Xem thêm pattern `MobileBottomNav` trong memory `ui_conventions.md`.

---

## Phiên làm việc 2026-07-23 — Fix thứ tự tie-break bảng xếp hạng

**Lỗi:** Bảng xếp hạng sắp xếp sai — `compute_standings` áp dụng hệ số đối đầu (head-to-head) TRƯỚC khi xét hiệu số toàn giải trong nhóm các đội bằng điểm, khiến các đội bị xếp sai thứ tự dù hiệu số toàn giải chênh lệch rõ ràng (VD: đội +7 xếp trên đội +19 vì thắng đối đầu).

**Quy tắc đúng theo yêu cầu người dùng:** điểm cao → hiệu số toàn giải cao → chỉ khi bằng CẢ điểm lẫn hiệu số mới xét hệ số đối đầu.

**Fix (`backend/tournament_engine.py:367-384`):** đổi sort key chính thành `(-points, -goal_diff, -goals_for)`; nhóm tied giờ chỉ gộp các đội bằng cả điểm lẫn goal_diff; head-to-head chỉ áp dụng trong nhóm tied đó (dùng `goals_for` làm fallback cuối thay vì `goal_diff` vì goal_diff đã bằng nhau trong nhóm).

**Xác minh:** Test bằng script Python gọi trực tiếp `compute_standings` với dữ liệu synthetic — xác nhận đội có goal_diff cao hơn (+21) xếp trên đội thắng đối đầu nhưng goal_diff thấp hơn (+1); xác nhận tie-break đối đầu vẫn hoạt động khi điểm và goal_diff bằng nhau hệt nhau. Không test được trên UI vì DB dev local rỗng (chưa có giải đấu/trận đấu).

---

## Phiên làm việc 2026-07-22 — Trạng thái giải đấu, thể thức vòng tròn 2 lượt, tie-break đối đầu

### 1. Nút Bắt đầu/Kết thúc giải + khóa chỉnh sửa sau khi bắt đầu

**Yêu cầu:** Giải chưa bắt đầu (draft) vẫn sửa được thể thức/thêm người chơi; sau khi bắt đầu thì khóa lại.

**Luồng trạng thái mới:** `draft → active → completed`, một chiều — đã bỏ nút "Mở lại giải" (completed→active) theo lựa chọn của người dùng khi được hỏi.

**Backend (`backend/main.py`, `backend/schemas.py`):**
- `update_tournament`: chặn sửa `format/team_type/pairing_mode/rank_rules/num_groups` nếu status khác `draft`; validate transition qua dict `ALLOWED_STATUS_TRANSITIONS` (chỉ draft→active, active→completed).
- 2 endpoint mới: `POST /api/tournaments/{tid}/participants` (thêm), `DELETE /api/tournaments/{tid}/participants/{pid}` (xóa) — chỉ hoạt động khi draft. Tính năng PATCH thay người (đang active) giữ nguyên, không đụng tới.
- `schemas.TournamentUpdate` thêm các field config (optional); `schemas.ParticipantCreate` mới.

**Frontend (`frontend/src/pages/Tournament.jsx`, `frontend/src/api.js`):**
- Nút "Bắt đầu giải" (draft→active, KHÔNG tự sinh lịch) và "Kết thúc giải" (active→completed); bỏ nút "Mở lại giải".
- Modal `EditSetupModal` mới (chỉ hiện khi draft): sửa thể thức/số bảng, thêm/xóa người chơi — tái dùng pattern chọn thành viên/khách mời từ `CreateWizard`.
- Nút "Sinh lịch" chỉ hiện khi đã active.

Xem chi tiết đầy đủ trong memory `tournament_system.md`.

### 2. Thể thức Vòng tròn hai lượt (`round_robin_double`)

**Lưu ý quan trọng:** `TournamentFormat` enum tồn tại độc lập ở **2 file** (`backend/models.py` và `backend/schemas.py`, không import lẫn nhau) — phải sửa cả hai khi thêm format mới. Đã sửa cả hai lần này.

- `tournament_engine.generate_schedule`: case mới `round_robin_double` — lượt đi giống vòng tròn 1 lượt, lượt về đảo p1/p2 (đảo sân), đặt tên vòng "Lượt đi – Vòng N" / "Lượt về – Vòng N". 4 đội → 12 trận.
- Frontend: thêm vào `FORMAT_MAP`, mở rộng điều kiện hiển thị tab Lịch thi đấu/Bảng xếp hạng cho format mới (trước đây chỉ check `fmt === "round_robin"`).
- Không cần migration DB: cột `tournaments.format` là `VARCHAR(11)` không có CHECK constraint trên SQLite.

### 3. Tie-break ưu tiên hệ số đối đầu

**Yêu cầu:** Khi 2 đội bằng điểm, ưu tiên hệ số đối đầu trước khi xét hiệu số toàn giải.

`tournament_engine.compute_standings`: nhóm các đội theo điểm, trong mỗi nhóm >1 đội bằng điểm tính lại điểm/hiệu số/bàn thắng chỉ trong các trận giữa các đội đang tied để sắp xếp trước; nếu vẫn hòa (VD: tie vòng tròn 3 chiều) mới fallback về hiệu số/bàn thắng toàn giải như cũ.

### Xác minh đã thực hiện

- Backend: `python -c "import main"` không lỗi; test qua `curl` với JWT tự tạo (`auth.create_access_token`) — đầy đủ luồng gating (sửa format lúc draft OK, lúc active FAIL 400; thêm/xóa participant lúc draft OK, lúc active FAIL 400; chuyển thẳng draft→completed FAIL 400; completed→active FAIL 400 — xác nhận đã bỏ mở lại).
- Test riêng `tournament_engine.py`: sinh lịch `round_robin_double` cho 4 đội ra đúng 12 trận; test tie-break xác nhận đội thắng đối đầu trực tiếp xếp trên dù hiệu số toàn giải thấp hơn nhiều.
- Frontend: dev server không có lỗi build/console (`preview_logs`, `read_console_messages`).
- Đã commit + push (`bfb937f`, `a8d6549`) + `fly deploy` — xác nhận qua `curl` production trả HTTP 200 sau mỗi lần deploy.

---

## Phiên làm việc 2026-07-21 — Quản lý Khách mời

**Yêu cầu:** Thêm trang quản lý khách mời độc lập (trước đây chỉ tạo/sửa được trong lúc đăng ký giải đấu).

**Phân tích trước khi làm:** Khách mời (`Player.member_id IS NULL`) không nằm trong bất kỳ luồng tài chính nào — `Transaction` chỉ có `member_id`, không có `player_id`; hệ thống nhắc phí Telegram chỉ query `Member`. Quyết định: trang Khách mời không có mục công nợ/giao dịch.

**Backend (`backend/main.py`):**
- `GET /api/players/{pid}/tournaments` — lịch sử tham gia giải đấu của 1 player (dùng cho cả khách mời lẫn thành viên), join qua `TournamentParticipant.player_id`/`partner_player_id`.
- `POST /api/players/{pid}/convert-to-member` — tạo `Member` mới từ 1 khách mời (copy tên/SĐT/email/hạng, mã thành viên tự động qua `auto_member_code()`), gán `Player.member_id` trỏ về member mới. Chặn convert nếu player đã có `member_id`.

**Frontend:**
- `frontend/src/pages/Guests.jsx` (mới) — danh sách khách mời (`playersApi.list("guest")`), thêm/sửa/xoá, modal lịch sử giải đấu, nút "Chuyển thành thành viên".
- `frontend/src/api.js` — thêm `playersApi.tournaments()` và `playersApi.convertToMember()`.
- `frontend/src/App.jsx` — đăng ký trang `guests` vào `ALL_PAGES`, icon `UserAddOutlined`, nằm trong overflow "Thêm" trên mobile (không phải 1 trong 4 tab chính).

**Bug phát sinh khi test (không phải do thay đổi lần này):** DB dev local (`backend/clb.db`) thiếu cột `players.rank` — `migrations/add_players_tables.py` chỉ chạy tự động trong Docker (`docker-entrypoint.sh`), không chạy khi khởi động local qua `start.sh`/`uvicorn --reload` trực tiếp. Đã chạy migration thủ công để test local. **Lưu ý cho phiên sau:** cân nhắc gọi migration này trong `start.sh` luôn để tránh lặp lại vấn đề.

**Xác minh đã thực hiện:** Test end-to-end qua Chrome preview với dữ liệu thật trên backend local (venv) — tạo khách mời (kèm validate tên bắt buộc), sửa, xoá, xem lịch sử giải đấu (rỗng), chuyển khách mời thành thành viên (xác nhận qua SQL: `Member` mới tạo mã `TV0015`, `Player.member_id` đã liên kết), kiểm tra thành viên mới xuất hiện đúng ở trang Thành viên, kiểm tra hiển thị responsive trên mobile (trong sheet "Thêm").

---

## Phiên làm việc 2026-07-20 — Theo dõi giải đấu public + Thay người chơi

### 39. Chế độ theo dõi giải đấu trên link public

**Yêu cầu:** Cho phép xem tiến độ giải đấu (bracket, lịch đấu, bảng xếp hạng) qua link public, tích hợp vào link báo cáo tài chính có sẵn (không tạo token riêng).

**Backend (`backend/main.py`):**
- 3 endpoint mới, dùng chung `_validate_token()` (club-scoped, không cần auth):
  - `GET /api/public/report/{slug}/tournaments` — danh sách giải (loại trừ `draft`)
  - `GET /api/public/report/{slug}/tournaments/{tid}` — chi tiết (participants + matches)
  - `GET /api/public/report/{slug}/tournaments/{tid}/standings` — bảng xếp hạng (tái dùng `compute_standings`)

**Frontend:**
- `frontend/src/components/PublicTournamentTracker.jsx` (mới) — component read-only, polling tự động mỗi 12s + nút "Làm mới" thủ công. Hỗ trợ đủ 3 định dạng: round_robin, knockout, combined.
- `frontend/src/pages/PublicReport.jsx` — thêm tab "Theo dõi giải đấu"
- `frontend/src/api.js` — thêm `tournaments.list/detail/standings` vào `createPublicReportApi`

### 40. Thay người chơi trong giải đấu đang diễn ra

**Yêu cầu:** 1 thành viên không thể tiếp tục thi đấu giữa giải → cần thay người khác (thành viên CLB chưa tham gia, hoặc tạo khách mời mới), không mất lịch sử trận đã đấu.

**Kiến trúc quan trọng:** `TournamentMatch.p1_id/p2_id` trỏ tới `TournamentParticipant.id` ("chỗ ngồi"), không phải `member_id` trực tiếp → đổi `member_id`/`player_id` trên participant có sẵn giữ nguyên toàn bộ điểm/thắng-thua đã ghi nhận.

**Backend:**
- `schemas.ParticipantSlotUpdate` — `{slot: "main"|"partner", member_id?, player_id?, team_name?}`
- `PATCH /api/tournaments/{tid}/participants/{pid}` — chặn chọn trùng người đã có mặt ở đội khác trong cùng giải, tự tính lại `team_name`

**Frontend (`frontend/src/pages/Tournament.jsx`):**
- Tab mới "Người chơi" trong `TournamentDetail` — liệt kê từng đội, nút "Thay [tên]" cho mỗi vị trí (main/partner nếu đấu đôi)
- `ReplaceParticipantModal` — 2 tab: Thành viên CLB chưa tham gia (loại trừ người đã ở đội khác) / Khách mời (chọn có sẵn hoặc tạo mới ngay trong modal)
- **Bug đã sửa trong lúc test:** `rowSelection.selectedRowKeys` dùng key có tiền tố (`m-5`, `g-3`) nhưng `rowKey` mặc định là `"id"` (số) → radio không bao giờ hiện chọn. Fix: `rowKey={(r) => \`m-${r.id}\`}` khớp với format key đang dùng.

### 41. Bug schema đã sửa (ảnh hưởng cả production)

Phát hiện khi test bằng DB thật (không phải suy đoán từ đọc code): local dev DB thiếu 3 cột mà `models.py` đã khai báo nhưng `_run_migration()` trong `main.py` chưa từng thêm:
- `tournament_participants.player_id`, `tournament_participants.partner_player_id` — thiếu thì mọi giải có khách mời lỗi 500 (kể cả trang quản trị đã đăng nhập)
- `club_memberships.telegram_chat_id` — thiếu thì `GET /api/my-memberships` lỗi 500 (đăng nhập CLB admin thường cũng gãy)

Đã thêm cả 3 vào migrations list, deploy lên production, xác nhận cột đã tạo qua `fly ssh console`.

**Bài học:** Xem chi tiết trong memory `feedback.md` — nên đối chiếu `models.py` ↔ migrations list khi nghi ngờ, đừng chỉ tin vào đọc code.

### Xác minh đã thực hiện
- Test end-to-end cả 2 tính năng bằng dữ liệu thật trên backend local (venv) + frontend dev server, qua Chrome preview
- Deploy production qua `fly deploy --no-cache`, xác nhận migration mới chạy đúng qua `fly ssh console`, xác nhận endpoint mới có trong `/openapi.json`
- Test trực tiếp trên link public thật của CLB Silk Village Pickleball (slug `silk-village-pickleball-XI57o0ZR`)

### Lưu ý công cụ (không phải bug ứng dụng)
Trong phiên này, Browser pane (Claude_Browser tools) có độ trễ giữa DOM thực tế và ảnh chụp `screenshot` — nhiều lần click đã thành công (xác nhận qua `read_page`/network requests) nhưng `screenshot` chụp muộn cho thấy trạng thái cũ. Khi nghi ngờ 1 click "không phản hồi", nên `read_page` lại hoặc kiểm tra network requests trước khi kết luận là lỗi code.

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
