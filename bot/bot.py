"""
Telegram Bot CLB Pickleball — Menu-driven với Inline Buttons
Không dùng AI — hoàn toàn miễn phí, không rate limit
"""
import json
import logging
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, filters, ContextTypes, ConversationHandler,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TELEGRAM_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")

# ── ConversationHandler states (login) ───────────────────────────────────────
WAIT_USERNAME, WAIT_PASSWORD = range(2)

# ── Per-user state ────────────────────────────────────────────────────────────
_sessions: dict[int, dict] = {}       # user_id → {token, expires_at, ...}
_user_club: dict[int, int] = {}        # user_id → club_id
_user_club_name: dict[int, str] = {}   # user_id → club_name
_pending_username: dict[int, str] = {} # tạm thời khi login
_wizard: dict[int, dict] = {}          # user_id → {name, step, data}
_ft_name_cache: dict[int, dict] = {}   # user_id → {str(ft_id): ft_name} — cho category delete
_tx_cache: dict[int, dict] = {}        # user_id → {tx_id: tx_dict} — cho confirm xóa GD
_menu_cfg: dict[int, dict] = {}        # user_id → {"menu": {checkedKeys}, "welcome": str}
_welcomed: set[int] = set()            # user_ids đã thấy tin nhắn chào mừng trong session này

SESSION_TTL = 7 * 24 * 3600


# ── Helpers ───────────────────────────────────────────────────────────────────
def get_session(user_id: int) -> dict | None:
    s = _sessions.get(user_id)
    if s and time.time() < s["expires_at"]:
        return s
    _sessions.pop(user_id, None)
    return None


async def call_backend(method: str, path: str, token: str,
                       club_id: int | None = None, **kwargs) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    if club_id:
        headers["X-Club-ID"] = str(club_id)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await getattr(client, method)(
            f"{BACKEND_URL}{path}", headers=headers, **kwargs
        )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise ValueError(f"Lỗi {resp.status_code}: {detail}")
        if resp.status_code == 204:
            return {"ok": True}
        return resp.json()


def fmt(amount) -> str:
    try:
        return f"{int(float(amount)):,}đ".replace(",", ".")
    except Exception:
        return str(amount)


_VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

def _now_vn() -> datetime:
    return datetime.now(_VN_TZ).replace(tzinfo=None)

def today_str() -> str:
    return _now_vn().strftime("%Y-%m-%d")


def parse_date(text: str) -> str | None:
    """Chuyển DD/MM/YYYY → YYYY-MM-DD. None nếu sai."""
    try:
        return datetime.strptime(text.strip(), "%d/%m/%Y").strftime("%Y-%m-%d")
    except Exception:
        return None


def kb(*rows) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(t, callback_data=d) for t, d in row]
        for row in rows
    ])


async def safe_edit(query, text: str, keyboard=None):
    try:
        await query.edit_message_text(text, reply_markup=keyboard, parse_mode="Markdown")
    except Exception:
        await query.message.reply_text(text, reply_markup=keyboard, parse_mode="Markdown")


async def reply(update: Update, text: str, keyboard=None):
    if update.callback_query:
        await safe_edit(update.callback_query, text, keyboard)
    else:
        await update.message.reply_text(text, reply_markup=keyboard, parse_mode="Markdown")


# ── Menu config mapping: tree key → (label, callback_data) ───────────────────
KEY_TO_ACTION: dict[str, tuple[str, str]] = {
    "members":            ("👥 Thành viên",        "menu:members"),
    "thu":                ("💰 Thu tiền",           "menu:thu"),
    "chi":                ("📤 Chi tiền",           "menu:chi"),
    "report":             ("📊 Báo cáo",            "menu:report"),
    "gdlist":             ("📋 Giao dịch",          "menu:gdlist"),
    "category":           ("🗂 Danh mục",           "menu:category"),
    "help":               ("❓ Hướng dẫn",          "menu:help"),
    "members_list":       ("📋 Danh sách",          "member:list"),
    "members_add":        ("➕ Thêm mới",           "wiz:add_member"),
    "members_upd_rank":   ("🏆 Cập nhật hạng",     "wiz:upd_member_rank"),
    "members_upd_status": ("🔄 Cập nhật T.Thái",   "wiz:upd_member_status"),
    "members_delete":     ("🗑 Xóa thành viên",     "wiz:del_member"),
    "report_overview":    ("📈 Tổng quan",          "report:overview"),
    "report_monthly":     ("📅 Theo tháng",         "report:monthly"),
    "report_fee_status":  ("💳 Trạng thái phí",     "report:fee_status"),
    "category_add":       ("➕ Thêm khoản",         "wiz:add_fee_type"),
    "category_delete":    ("🗑 Xóa khoản",          "category:delete"),
}

DEFAULT_TOP_KEYS     = ["members", "thu", "chi", "report", "gdlist", "category", "help"]
DEFAULT_MEMBER_KEYS  = ["members_list", "members_add", "members_upd_rank", "members_upd_status", "members_delete"]
DEFAULT_REPORT_KEYS  = ["report_overview", "report_monthly", "report_fee_status"]
DEFAULT_CATEGORY_KEYS = ["category_add", "category_delete"]


async def fetch_and_cache_menu_cfg(user_id: int, token: str, club_id: int):
    """Tải toàn bộ bot-config từ API, cache cả menu_config lẫn welcome_message."""
    try:
        cfg_data = await call_backend("get", "/api/bot-config", token=token, club_id=club_id)
        menu_cfg = json.loads(cfg_data["menu_config"]) if "menu_config" in cfg_data else None
        _menu_cfg[user_id] = {
            "menu": menu_cfg,
            "welcome": cfg_data.get("welcome_message", "").strip(),
        }
    except Exception as e:
        logger.warning(f"fetch_menu_cfg lỗi user {user_id}: {e}")
        _menu_cfg[user_id] = None


def _menu_buttons(user_id: int, keys: list[str], cols: int = 2) -> list[list[tuple]]:
    """
    Tạo danh sách hàng nút dựa trên menu_config của user.
    - cfg không tồn tại (user mới login, chưa fetch) → dùng mặc định
    - cfg là None → chưa có config trong DB → dùng mặc định
    - cfg là dict với checkedKeys → lọc theo danh sách đó
    """
    sentinel = object()
    wrapper = _menu_cfg.get(user_id, sentinel)

    if wrapper is sentinel or wrapper is None:
        ordered_keys = keys
        enabled = None
    else:
        menu_cfg = wrapper.get("menu") if isinstance(wrapper, dict) else None
        if menu_cfg is None:
            ordered_keys = keys
            enabled = None
        else:
            enabled = set(menu_cfg.get("checkedKeys", keys))
            ordered_keys = keys

    buttons = [
        KEY_TO_ACTION[k]
        for k in ordered_keys
        if k in KEY_TO_ACTION and (enabled is None or k in enabled)
    ]

    rows = []
    for i in range(0, len(buttons), cols):
        rows.append(buttons[i:i + cols])
    return rows


def back_btn(target: str = "menu:main") -> list:
    return [("↩ Quay lại", target)]


# ── LOGIN FLOW ────────────────────────────────────────────────────────────────
async def _login_api(username: str, password: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{BACKEND_URL}/api/auth/login",
            json={"username": username, "password": password},
        )
        if resp.status_code != 200:
            raise ValueError("Sai tên đăng nhập hoặc mật khẩu.")
        data = resp.json()
        return {
            "token": data["access_token"],
            "expires_at": time.time() + SESSION_TTL,
            "username": data["user"]["username"],
            "full_name": data["user"].get("full_name") or data["user"]["username"],
            "is_superuser": data["user"].get("is_superuser", False),
        }


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    session = get_session(user_id)
    if session:
        _wizard.pop(user_id, None)
        await _after_login(update, user_id, session)
        return ConversationHandler.END

    await update.message.reply_text(
        "🔐 *Đăng nhập vào CLB*\n\nNhập *tên đăng nhập*:",
        parse_mode="Markdown",
    )
    return WAIT_USERNAME


async def receive_username(update: Update, context: ContextTypes.DEFAULT_TYPE):
    _pending_username[update.effective_user.id] = update.message.text.strip()
    await update.message.reply_text("🔑 Nhập *mật khẩu*:", parse_mode="Markdown")
    return WAIT_PASSWORD


async def receive_password(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    username = _pending_username.pop(user_id, "")
    try:
        await update.message.delete()
    except Exception:
        pass
    try:
        session = await _login_api(username, update.message.text.strip())
        if session.get("is_superuser"):
            await update.message.reply_text("⚠️ Tài khoản quản trị không dùng bot này.")
            return ConversationHandler.END
        _sessions[user_id] = session
        _wizard.pop(user_id, None)
        await _after_login(update, user_id, session)
    except ValueError as e:
        await update.message.reply_text(
            f"❌ {e}\n\nNhập lại *tên đăng nhập*:", parse_mode="Markdown"
        )
        return WAIT_USERNAME
    return ConversationHandler.END


async def _after_login(update: Update, user_id: int, session: dict):
    """Sau login: nếu 1 CLB → vào thẳng main menu. Nhiều CLB → chọn."""
    memberships = await call_backend("get", "/api/my-memberships", token=session["token"])
    if not memberships:
        await reply(update, "❌ Tài khoản chưa được thêm vào CLB nào.")
        return
    if len(memberships) == 1:
        m = memberships[0]
        _user_club[user_id] = m["club_id"]
        _user_club_name[user_id] = m["club"]["name"] if m.get("club") else f"CLB #{m['club_id']}"
        await fetch_and_cache_menu_cfg(user_id, session["token"], m["club_id"])
        await show_main_menu(update, session, _user_club_name[user_id])
        return
    rows = [
        [("🏸 " + m["club"]["name"], f"club:{m['club_id']}")]
        for m in memberships if m.get("club")
    ]
    # Lưu tên CLB vào cache để dùng khi callback
    if not hasattr(_after_login, "_club_cache"):
        _after_login._club_cache = {}
    _after_login._club_cache[user_id] = {
        str(m["club_id"]): m["club"]["name"]
        for m in memberships if m.get("club")
    }
    await reply(update, "Chọn CLB muốn làm việc:", kb(*rows))


async def cmd_logout(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    _sessions.pop(user_id, None)
    _user_club.pop(user_id, None)
    _user_club_name.pop(user_id, None)
    _wizard.pop(user_id, None)
    _welcomed.discard(user_id)
    await update.message.reply_text("👋 Đã đăng xuất. Gõ /start để đăng nhập lại.")


async def cmd_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    session = get_session(user_id)
    if not session or user_id not in _user_club:
        await update.message.reply_text("🔐 Gõ /start để đăng nhập.")
        return
    _wizard.pop(user_id, None)
    await show_main_menu(update, session, _user_club_name.get(user_id, ""))


# ── MAIN MENU ─────────────────────────────────────────────────────────────────
async def show_main_menu(update: Update, session: dict, club_name: str):
    user_id = update.effective_user.id
    _wizard.pop(user_id, None)
    club_id = _user_club.get(user_id)
    if club_id:
        await fetch_and_cache_menu_cfg(user_id, session["token"], club_id)

    # Hiện tin nhắn chào mừng một lần duy nhất sau khi vào CLB
    # Dùng send_new_message (không edit) để tin nhắn không bị ghi đè bởi menu
    wrapper = _menu_cfg.get(user_id)
    if user_id not in _welcomed:
        custom = (wrapper.get("welcome", "") if isinstance(wrapper, dict) else "").strip()
        welcome = custom if custom else (
            f"👋 Xin chào! Tôi là Bot quản lý CLB *{club_name}* của các bạn, "
            f"chúc các bạn có một buổi thể thao vui vẻ!"
        )
        # Hỗ trợ placeholder {club_name} trong tin nhắn tùy chỉnh
        welcome = welcome.replace("{club_name}", club_name)
        # Gửi như tin nhắn MỚI (không edit), để không bị menu ghi đè
        if update.callback_query:
            await update.callback_query.message.reply_text(welcome, parse_mode="Markdown")
        else:
            await update.message.reply_text(welcome, parse_mode="Markdown")
        _welcomed.add(user_id)

    name = session.get("full_name") or session["username"]
    text = f"🏸 *{club_name}*\n👤 {name}\n\nChọn chức năng:"
    rows = _menu_buttons(user_id, DEFAULT_TOP_KEYS, cols=2)
    rows.append([("🔄 Đổi CLB", "menu:club")])
    await reply(update, text, kb(*rows))


# ── GUARD: kiểm tra đăng nhập & CLB ──────────────────────────────────────────
async def _guard(update: Update) -> tuple[dict, int] | None:
    """Trả về (session, club_id) hoặc None nếu chưa đăng nhập."""
    user_id = update.effective_user.id
    session = get_session(user_id)
    if not session:
        await reply(update, "🔐 Phiên hết hạn. Gõ /start để đăng nhập lại.")
        return None
    club_id = _user_club.get(user_id)
    if not club_id:
        await reply(update, "🔐 Chưa chọn CLB. Gõ /start để bắt đầu lại.")
        return None
    return session, club_id


# ── MEMBER FLOWS ──────────────────────────────────────────────────────────────
async def show_member_menu(update: Update):
    user_id = update.effective_user.id
    rows = _menu_buttons(user_id, DEFAULT_MEMBER_KEYS, cols=2)
    rows.append([back_btn("menu:main")[0]])
    await reply(update, "👥 *Thành viên* — Chọn thao tác:", kb(*rows))


async def member_list(update: Update, session: dict, club_id: int, status_filter: str = ""):
    params = {"status": status_filter} if status_filter else {}
    try:
        members = await call_backend("get", "/api/members", token=session["token"],
                                     club_id=club_id, params=params)
    except ValueError as e:
        await reply(update, f"❌ {e}")
        return
    if not members:
        await reply(update, "Không có thành viên nào.", kb([back_btn("menu:members")[0], ("🏠 Menu", "menu:exit")]))
        return
    lines = [f"👥 *Danh sách thành viên* ({len(members)} người)\n"]
    for m in members[:30]:
        icon = "✅" if m["status"] == "active" else "⏸"
        rank = f" [{m['rank']}]" if m.get("rank") else ""
        phone = f" — {m['phone']}" if m.get("phone") else ""
        lines.append(f"{icon} `{m['member_code']}` {m['full_name']}{rank}{phone}")
    if len(members) > 30:
        lines.append(f"\n_...và {len(members)-30} người khác_")
    await reply(update, "\n".join(lines), kb(
        [("✅ Hoạt động", "member:list:active"), ("⏸ Tạm nghỉ", "member:list:inactive"), ("👥 Tất cả", "member:list:")],
        [back_btn("menu:members")[0], ("🏠 Menu", "menu:exit")],
    ))


# ── WIZARD ENGINE ─────────────────────────────────────────────────────────────
"""
Mỗi wizard được định nghĩa là danh sách các bước.
Bước có thể là:
  - text: user gõ tự do
  - buttons: hiện inline buttons (value cố định)
  - dynamic_buttons: load từ API khi đến bước
  - date: hiện nút "Hôm nay" hoặc gõ DD/MM/YYYY
"""

WIZARDS: dict[str, dict] = {

    "add_member": {
        "back_to": "members",
        "title": "➕ *Thêm thành viên mới*",
        "steps": [
            {"key": "full_name", "prompt": "① Nhập *họ và tên* thành viên:"},
            {"key": "rank", "prompt": "② Chọn *hạng*:", "buttons": [
                [("🏆 A", "A"), ("🥈 B", "B"), ("🥉 C", "C"), ("🌱 Mới", "Mới")],
            ], "skippable": True},
            {"key": "phone", "prompt": "③ Nhập *số điện thoại*:", "skippable": True},
            {"key": "join_date", "prompt": "④ *Ngày tham gia*:", "is_date": True},
            {"key": "status", "prompt": "⑤ *Trạng thái ban đầu*:", "buttons": [
                [("✅ Hoạt động", "active"), ("⏸ Tạm nghỉ", "inactive")],
            ]},
        ],
    },

    "add_thu": {
        "back_to": "main",
        "title": "💰 *Ghi khoản thu*",
        "steps": [
            {"key": "_fee_type_id", "prompt": "① Chọn *khoản thu*:",
             "dynamic": "fee_types", "dynamic_filter": "income"},
            {"key": "amount", "prompt": "② Nhập *số tiền* (hoặc bấm dùng mặc định):",
             "has_default": True},
            {"key": "_member_id", "prompt": "③ *Thành viên* nộp tiền:",
             "dynamic": "members", "skippable": True},
            {"key": "transaction_date", "prompt": "④ *Ngày giao dịch*:", "is_date": True},
            {"key": "payment_method", "prompt": "⑤ *Phương thức thanh toán*:", "buttons": [
                [("💵 Tiền mặt", "Tiền mặt"), ("🏦 Chuyển khoản", "Chuyển khoản")],
            ]},
        ],
    },

    "add_chi": {
        "back_to": "main",
        "title": "📤 *Ghi khoản chi*",
        "steps": [
            {"key": "_fee_type_id", "prompt": "① Chọn *khoản chi*:",
             "dynamic": "fee_types", "dynamic_filter": "expense"},
            {"key": "amount", "prompt": "② Nhập *số tiền* (hoặc bấm dùng mặc định):",
             "has_default": True},
            {"key": "description", "prompt": "③ *Ghi chú*:", "skippable": True},
            {"key": "transaction_date", "prompt": "④ *Ngày giao dịch*:", "is_date": True},
            {"key": "payment_method", "prompt": "⑤ *Phương thức thanh toán*:", "buttons": [
                [("💵 Tiền mặt", "Tiền mặt"), ("🏦 Chuyển khoản", "Chuyển khoản")],
            ]},
        ],
    },

    "del_member": {
        "back_to": "members",
        "title": "🗑 *Xóa thành viên*",
        "steps": [
            {"key": "_member_id", "prompt": "Chọn *thành viên cần xóa*:",
             "dynamic": "members", "all_members": True},
        ],
        "confirm_template": "⚠️ Xác nhận xóa thành viên *{_member_name}*?\nThao tác này không thể hoàn tác!",
    },

    "upd_member_rank": {
        "back_to": "members",
        "title": "✏️ *Cập nhật hạng thành viên*",
        "steps": [
            {"key": "_member_id", "prompt": "Chọn *thành viên*:", "dynamic": "members", "all_members": True},
            {"key": "rank", "prompt": "Chọn *hạng mới*:", "buttons": [
                [("🏆 A", "A"), ("🥈 B", "B"), ("🥉 C", "C"), ("🌱 Mới", "Mới")],
            ]},
        ],
    },

    "upd_member_status": {
        "back_to": "members",
        "title": "✏️ *Cập nhật trạng thái thành viên*",
        "steps": [
            {"key": "_member_id", "prompt": "Chọn *thành viên*:", "dynamic": "members", "all_members": True},
            {"key": "status", "prompt": "Chọn *trạng thái mới*:", "buttons": [
                [("✅ Hoạt động", "active"), ("⏸ Tạm nghỉ", "inactive")],
            ]},
        ],
    },

    "add_fee_type": {
        "back_to": "category",
        "title": "🗂 *Thêm khoản thu/chi*",
        "steps": [
            {"key": "name", "prompt": "① Nhập *tên khoản*:"},
            {"key": "type", "prompt": "② Loại khoản:", "buttons": [
                [("💚 Thu", "income"), ("🔴 Chi", "expense")],
            ]},
            {"key": "default_amount", "prompt": "③ *Số tiền mặc định*:", "skippable": True},
        ],
    },
}


async def _go_back_from_wizard(update: Update, wiz_name: str | None,
                               session: dict, club_id: int):
    """Điều hướng về màn hình ngay trước wizard dựa vào back_to."""
    back_to = WIZARDS.get(wiz_name, {}).get("back_to", "main") if wiz_name else "main"
    if back_to == "members":
        await show_member_menu(update)
    elif back_to == "category":
        await show_category_menu(update, session, club_id)
    else:
        await show_main_menu(update, session, _user_club_name.get(
            update.effective_user.id, ""))


async def wizard_start(update: Update, name: str, session: dict, club_id: int):
    user_id = update.effective_user.id
    _wizard[user_id] = {"name": name, "step": 0, "data": {}}
    wiz = WIZARDS[name]
    await reply(update, wiz["title"])
    await wizard_show_step(update, user_id, session, club_id)


async def wizard_show_step(update: Update, user_id: int, session: dict, club_id: int):
    w = _wizard.get(user_id)
    if not w:
        return
    wiz = WIZARDS[w["name"]]
    steps = wiz["steps"]
    step_idx = w["step"]

    if step_idx >= len(steps):
        # Bước xác nhận hoặc submit
        confirm_tpl = wiz.get("confirm_template")
        if confirm_tpl:
            text = confirm_tpl.format(**w["data"])
            await reply(update, text, kb(
                [("✅ Xác nhận xóa", "wiz:confirm_yes"), ("❌ Hủy", "wiz:cancel")],
                [("🏠 Menu", "menu:exit")],
            ))
        else:
            await wizard_submit(update, user_id, session, club_id)
        return

    step = steps[step_idx]
    prompt = step["prompt"]
    rows = []

    if step.get("is_date"):
        rows = [[("📅 Hôm nay", "wiz_date:today"), ("✏️ Nhập tay (DD/MM/YYYY)", "wiz_date:manual")]]

    elif step.get("dynamic") == "fee_types":
        ftype_filter = step.get("dynamic_filter", "")
        try:
            fee_types = await call_backend("get", "/api/fee-types", token=session["token"], club_id=club_id)
        except Exception:
            fee_types = []
        filtered = [f for f in fee_types if not ftype_filter or f["type"] == ftype_filter]
        ft_cache = {}
        for i in range(0, len(filtered), 2):
            chunk = filtered[i:i+2]
            row = []
            for f in chunk:
                label = f["name"]
                if f.get("default_amount"):
                    label += f" ({fmt(f['default_amount'])})"
                ft_cache[str(f["id"])] = {"name": f["name"], "default": str(f.get("default_amount") or 0)}
                row.append((label, f"wiz_ft:{f['id']}"))
            rows.append(row)
        w["data"]["_ft_cache"] = ft_cache
        if not rows:
            rows = [[("(Chưa có khoản nào)", "wiz:noop")]]

    elif step.get("dynamic") == "members":
        params = {} if step.get("all_members") else {"status": "active"}
        try:
            members = await call_backend("get", "/api/members", token=session["token"],
                                         club_id=club_id, params=params)
        except Exception:
            members = []
        m_cache = {}
        for i in range(0, len(members), 2):
            chunk = members[i:i+2]
            row = []
            for m in chunk:
                status_icon = "✅" if m.get("status") == "active" else "⏸"
                label = f"{status_icon} {m['full_name']} ({m['member_code']})"
                m_cache[str(m["id"])] = m["full_name"]
                row.append((label, f"wiz_m:{m['id']}"))
            rows.append(row)
        w["data"]["_m_cache"] = m_cache
        if not rows:
            rows = [[("(Không có thành viên)", "wiz:noop")]]

    elif step.get("buttons"):
        rows = list(step["buttons"])  # Tạo bản sao để không mutate WIZARDS dict

    # Thêm nút mặc định nếu có (chỉ khi default > 0)
    if step.get("has_default"):
        try:
            _def_val = float(w["data"].get("_fee_default") or 0)
        except Exception:
            _def_val = 0
        if _def_val > 0:
            rows.append([(f"📋 Dùng mặc định ({fmt(_def_val)})", "wiz_default:amount")])

    # Nút bỏ qua
    if step.get("skippable"):
        rows.append([("⏭ Bỏ qua", "wiz:skip")])

    # Hủy + Menu — luôn ở dưới cùng
    rows.append([("❌ Hủy", "wiz:cancel"), ("🏠 Menu", "menu:exit")])
    await reply(update, prompt, kb(*rows))


async def wizard_set_value(update: Update, user_id: int, key: str, value,
                            session: dict, club_id: int):
    w = _wizard.get(user_id)
    if not w:
        return
    w["data"][key] = value
    w["step"] += 1
    await wizard_show_step(update, user_id, session, club_id)


async def wizard_submit(update: Update, user_id: int, session: dict, club_id: int):
    w = _wizard.pop(user_id, None)
    if not w:
        return
    name = w["name"]
    data = w["data"]
    token = session["token"]

    try:
        if name == "add_member":
            payload = {
                "full_name": data["full_name"],
                "status": data.get("status", "active"),
                "join_date": data.get("join_date") or today_str(),
            }
            for f in ["phone", "rank"]:
                if data.get(f):
                    payload[f] = data[f]
            m = await call_backend("post", "/api/members", token=token, club_id=club_id, json=payload)
            await reply(update,
                f"✅ *Đã thêm thành viên!*\n"
                f"• Mã: `{m['member_code']}`\n"
                f"• Tên: {m['full_name']}\n"
                f"• Hạng: {m.get('rank') or '—'}\n"
                f"• SĐT: {m.get('phone') or '—'}",
                kb([("➕ Thêm tiếp", "wiz:add_member"), back_btn("menu:members")[0]],
                   [("🏠 Menu", "menu:exit")])
            )

        elif name in ("add_thu", "add_chi"):
            payload = {
                "fee_type_id": int(data["_fee_type_id"]),
                "amount": float(data["amount"]),
                "type": data.get("_fee_type_kind", "income" if name == "add_thu" else "expense"),
                "transaction_date": data.get("transaction_date") or today_str(),
                "payment_method": data.get("payment_method", "Tiền mặt"),
                "description": data.get("description", ""),
            }
            if data.get("_member_id"):
                payload["member_id"] = int(data["_member_id"])
            tx = await call_backend("post", "/api/transactions", token=token, club_id=club_id, json=payload)
            kind = "Thu" if tx["type"] == "income" else "Chi"
            await reply(update,
                f"✅ *Đã ghi {kind}!*\n"
                f"• Khoản: {data.get('_fee_type_name', '')}\n"
                f"• Số tiền: {fmt(tx['amount'])}\n"
                f"• Ngày: {tx['transaction_date']}",
                kb([("➕ Ghi tiếp", f"wiz:{'add_thu' if name=='add_thu' else 'add_chi'}"),
                    back_btn("menu:main")[0]],
                   [("🏠 Menu", "menu:exit")])
            )

        elif name == "del_member":
            member_id = int(data["_member_id"])
            member_name = data.get("_member_name", f"ID {member_id}")
            await call_backend("delete", f"/api/members/{member_id}", token=token, club_id=club_id)
            await reply(update, f"✅ Đã xóa thành viên *{member_name}*.",
                        kb([back_btn("menu:members")[0], ("🏠 Menu", "menu:exit")]))

        elif name in ("upd_member_rank", "upd_member_status"):
            member_id = int(data["_member_id"])
            field = "rank" if name == "upd_member_rank" else "status"
            value = data[field]
            m = await call_backend("put", f"/api/members/{member_id}", token=token, club_id=club_id,
                                   json={field: value})
            label = {"rank": "hạng", "status": "trạng thái"}[field]
            await reply(update, f"✅ Đã cập nhật {label} *{m['full_name']}* → {value}",
                        kb([back_btn("menu:members")[0], ("🏠 Menu", "menu:exit")]))

        elif name == "add_fee_type":
            payload = {"name": data["name"], "type": data["type"]}
            if data.get("default_amount"):
                try:
                    payload["default_amount"] = float(data["default_amount"].replace(".", "").replace(",", ""))
                except Exception:
                    pass
            ft = await call_backend("post", "/api/fee-types", token=token, club_id=club_id, json=payload)
            kind = "Thu" if ft["type"] == "income" else "Chi"
            await reply(update, f"✅ Đã thêm khoản {kind}: *{ft['name']}*",
                        kb([("➕ Thêm khoản khác", "wiz:add_fee_type"), back_btn("menu:category")[0]],
                           [("🏠 Menu", "menu:exit")]))

    except ValueError as e:
        await reply(update, f"❌ {e}", kb([back_btn("menu:main")[0], ("🏠 Menu", "menu:exit")]))


# ── REPORT FLOWS ──────────────────────────────────────────────────────────────
async def show_report_menu(update: Update):
    user_id = update.effective_user.id
    rows = _menu_buttons(user_id, DEFAULT_REPORT_KEYS, cols=2)
    rows.append([back_btn("menu:main")[0]])
    await reply(update, "📊 *Báo cáo* — Chọn loại:", kb(*rows))


async def _period_menu(update: Update, prefix: str, label: str, back: str = "menu:main"):
    now = _now_vn()
    prev_m = now.month - 1 if now.month > 1 else 12
    prev_y = now.year if now.month > 1 else now.year - 1
    next_m = now.month + 1 if now.month < 12 else 1
    next_y = now.year if now.month < 12 else now.year + 1
    await reply(update, f"Chọn kỳ {label}:", kb(
        [(f"⬅ Tháng trước ({prev_m}/{prev_y})",  f"{prefix}:{prev_m}:{prev_y}")],
        [(f"📅 Tháng này ({now.month}/{now.year})", f"{prefix}:{now.month}:{now.year}")],
        [(f"➡ Tháng sau ({next_m}/{next_y})",     f"{prefix}:{next_m}:{next_y}")],
        [back_btn(back)[0], ("🏠 Menu", "menu:exit")],
    ))


async def report_overview(update: Update, session: dict, club_id: int):
    try:
        data = await call_backend("get", "/api/reports/overview", token=session["token"], club_id=club_id)
    except ValueError as e:
        await reply(update, f"❌ {e}")
        return
    await reply(update,
        f"📊 *Tổng quan CLB*\n\n"
        f"👥 Thành viên: {data['total_members']} (hoạt động: {data['active_members']})\n"
        f"💚 Tổng thu: {fmt(data['total_income'])}\n"
        f"🔴 Tổng chi: {fmt(data['total_expense'])}\n"
        f"💰 Số dư: {fmt(data['balance'])}",
        kb([("📅 Báo cáo tháng", "report:monthly"), back_btn("menu:report")[0]],
           [("🏠 Menu", "menu:exit")])
    )


async def report_monthly(update: Update, session: dict, club_id: int, month: int, year: int):
    try:
        data = await call_backend("get", "/api/reports/monthly-detail", token=session["token"],
                                  club_id=club_id, params={"month": month, "year": year})
    except ValueError as e:
        await reply(update, f"❌ {e}")
        return
    lines = [
        f"📅 *Báo cáo tháng {month}/{year}*\n",
        f"💚 Tổng thu: {fmt(data['total_income'])}",
        f"🔴 Tổng chi: {fmt(data['total_expense'])}",
        f"💰 Số dư: {fmt(data['balance'])}",
        f"📋 Giao dịch: {data['transaction_count']}",
    ]
    if data.get("income_breakdown"):
        lines.append("\n*Chi tiết thu:*")
        for item in data["income_breakdown"][:5]:
            lines.append(f"  • {item['fee_type']}: {fmt(item['amount'])} ({item['count']} lần)")
    if data.get("expense_breakdown"):
        lines.append("\n*Chi tiết chi:*")
        for item in data["expense_breakdown"][:5]:
            lines.append(f"  • {item['fee_type']}: {fmt(item['amount'])} ({item['count']} lần)")
    await reply(update, "\n".join(lines), kb([back_btn("menu:report")[0], ("🏠 Menu", "menu:exit")]))


async def report_fee_status_select_ft(update: Update, session: dict, club_id: int,
                                       month: int, year: int):
    """Bước 2: chọn khoản thu cần kiểm tra trạng thái đóng phí."""
    try:
        fee_types = await call_backend("get", "/api/fee-types", token=session["token"], club_id=club_id)
    except ValueError as e:
        await reply(update, f"❌ {e}")
        return
    income = [f for f in fee_types if f["type"] == "income"]
    if not income:
        await reply(update, "Chưa có khoản thu nào để kiểm tra.",
                    kb([back_btn("menu:report")[0], ("🏠 Menu", "menu:exit")]))
        return
    rows = [[(f["name"], f"rpt_fee_ft:{month}:{year}:{f['id']}")] for f in income]
    rows.append([back_btn("menu:report")[0], ("🏠 Menu", "menu:exit")])
    await reply(update, f"💳 Chọn *khoản thu* cần kiểm tra tháng *{month}/{year}*:", kb(*rows))


async def report_fee_status(update: Update, session: dict, club_id: int,
                             month: int, year: int, fee_type_id: int):
    try:
        data = await call_backend("get", "/api/reports/fee-status", token=session["token"],
                                  club_id=club_id,
                                  params={"month": month, "year": year, "fee_type_id": fee_type_id})
    except ValueError as e:
        await reply(update, f"❌ {e}")
        return
    paid   = [m for m in data.get("members", data) if m.get("paid")]
    unpaid = [m for m in data.get("members", data) if not m.get("paid")]
    total  = data.get("total", len(paid) + len(unpaid))
    lines = [
        f"💳 *Trạng thái phí tháng {month}/{year}*\n",
        f"👥 Tổng thành viên: {total}",
        f"✅ Đã đóng: {len(paid)} người",
        f"❌ Chưa đóng: {len(unpaid)} người",
    ]
    if unpaid:
        lines.append("\n*Chưa đóng phí:*")
        for m in unpaid[:15]:
            lines.append(f"  • `{m['member_code']}` {m['full_name']}")
        if len(unpaid) > 15:
            lines.append(f"  _...và {len(unpaid)-15} người khác_")
    await reply(update, "\n".join(lines), kb([back_btn("menu:report")[0], ("🏠 Menu", "menu:exit")]))


# ── GDLIST FLOW ───────────────────────────────────────────────────────────────
async def gdlist_show(update: Update, session: dict, club_id: int,
                      month: int | None = None, year: int | None = None, tx_type: str = ""):
    now = _now_vn()
    m = month or now.month
    y = year or now.year
    params = {"month": m, "year": y}
    if tx_type:
        params["type"] = tx_type
    try:
        txs = await call_backend("get", "/api/transactions", token=session["token"],
                                 club_id=club_id, params=params)
    except ValueError as e:
        await reply(update, f"❌ {e}")
        return
    if not txs:
        await reply(update, f"Không có giao dịch tháng {m}/{y}.",
                    kb([back_btn("menu:gdlist")[0], ("🏠 Menu", "menu:exit")]))
        return
    total_in = sum(float(t["amount"]) for t in txs if t["type"] == "income")
    total_ex = sum(float(t["amount"]) for t in txs if t["type"] == "expense")
    lines = [
        f"💳 *Giao dịch tháng {m}/{y}* ({len(txs)} GD)\n"
        f"💚 Thu: {fmt(total_in)} | 🔴 Chi: {fmt(total_ex)}\n"
    ]
    for t in txs[:20]:
        icon = "💚" if t["type"] == "income" else "🔴"
        fee_name = (t.get("fee_type") or {}).get("name", "?") if isinstance(t.get("fee_type"), dict) else "?"
        member_name = (t.get("member") or {}).get("full_name", "") if isinstance(t.get("member"), dict) else ""
        lines.append(f"{icon} `[{t['id']}]` {t['transaction_date']} {fee_name}: {fmt(t['amount'])}"
                     + (f" ({member_name})" if member_name else ""))
    if len(txs) > 20:
        lines.append(f"_...và {len(txs)-20} giao dịch khác_")
    await reply(update, "\n".join(lines), kb(
        [("💚 Chỉ thu", f"gdlist:{m}:{y}:income"), ("🔴 Chỉ chi", f"gdlist:{m}:{y}:expense"), ("Tất cả", f"gdlist:{m}:{y}:")],
        [("🗑 Xóa GD", f"gdlist_del:{m}:{y}")],
        [back_btn("menu:gdlist")[0], ("🏠 Menu", "menu:exit")],
    ))


# ── CATEGORY FLOW ─────────────────────────────────────────────────────────────
async def show_category_menu(update: Update, session: dict, club_id: int):
    user_id = update.effective_user.id
    try:
        fee_types = await call_backend("get", "/api/fee-types", token=session["token"], club_id=club_id)
    except ValueError as e:
        await reply(update, f"❌ {e}")
        return
    income = [f for f in fee_types if f["type"] == "income"]
    expense = [f for f in fee_types if f["type"] == "expense"]
    lines = ["🗂 *Danh mục khoản thu chi*\n"]
    if income:
        lines.append("💚 *Khoản thu:*")
        for f in income:
            amt = f" — {fmt(f['default_amount'])}" if f.get("default_amount") else ""
            lines.append(f"  • {f['name']}{amt}")
    if expense:
        lines.append("\n🔴 *Khoản chi:*")
        for f in expense:
            amt = f" — {fmt(f['default_amount'])}" if f.get("default_amount") else ""
            lines.append(f"  • {f['name']}{amt}")
    action_rows = _menu_buttons(user_id, DEFAULT_CATEGORY_KEYS, cols=2)
    action_rows.append([back_btn("menu:main")[0]])
    await reply(update, "\n".join(lines), kb(*action_rows))


async def category_delete_menu(update: Update, session: dict, club_id: int):
    user_id = update.effective_user.id
    try:
        fee_types = await call_backend("get", "/api/fee-types", token=session["token"], club_id=club_id)
    except ValueError as e:
        await reply(update, f"❌ {e}")
        return
    # Lưu cache tên khoản để tránh callback_data > 64 bytes
    _ft_name_cache[user_id] = {str(f["id"]): f["name"] for f in fee_types}
    rows = []
    for f in fee_types:
        icon = "💚" if f["type"] == "income" else "🔴"
        rows.append([(f"{icon} {f['name']}", f"category:del_confirm:{f['id']}")])
    rows.append([back_btn("menu:category")[0], ("🏠 Menu", "menu:exit")])
    await reply(update, "Chọn khoản cần xóa:", kb(*rows))


# ── HELP ──────────────────────────────────────────────────────────────────────
HELP_TEXT = """❓ *Hướng dẫn sử dụng Bot*

Sau khi đăng nhập, bấm các nút để điều hướng.

*Lệnh tắt:*
• `/menu` — Về menu chính
• `/logout` — Đăng xuất

*Xóa giao dịch:*
• Vào 📋 Giao dịch → chọn tháng → bấm 🗑 Xóa GD → chọn giao dịch → xác nhận

*Tất cả chức năng:*
👥 Thành viên · 💰 Thu · 📤 Chi
📊 Báo cáo · 📋 Giao dịch · 🗂 Danh mục
"""


# ── CALLBACK ROUTER ───────────────────────────────────────────────────────────
async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = query.from_user.id
    data = query.data

    # ── Club selection — xử lý trước _guard vì chưa có club_id ──
    if data.startswith("club:"):
        session = get_session(user_id)
        if not session:
            await safe_edit(query, "🔐 Phiên hết hạn. Gõ /start để đăng nhập lại.")
            return
        club_id_str = data[5:]
        new_club_id = int(club_id_str)
        _user_club[user_id] = new_club_id
        cache = getattr(_after_login, "_club_cache", {})
        club_name = cache.get(user_id, {}).get(club_id_str, f"CLB #{club_id_str}")
        _user_club_name[user_id] = club_name
        _welcomed.discard(user_id)  # Reset để hiện welcome message CLB mới
        await fetch_and_cache_menu_cfg(user_id, session["token"], new_club_id)
        await show_main_menu(update, session, club_name)
        return

    guard = await _guard(update)
    if not guard:
        return
    session, club_id = guard

    # ── Menu navigation ──
    if data == "menu:main":
        await show_main_menu(update, session, _user_club_name.get(user_id, ""))
        return
    if data == "menu:members":
        await show_member_menu(update)
        return
    if data == "menu:thu":
        await wizard_start(update, "add_thu", session, club_id)
        return
    if data == "menu:chi":
        await wizard_start(update, "add_chi", session, club_id)
        return
    if data == "menu:report":
        await show_report_menu(update)
        return
    if data == "menu:gdlist":
        await _period_menu(update, "gdlist", "giao dịch", back="menu:main")
        return
    if data == "menu:category":
        await show_category_menu(update, session, club_id)
        return
    if data == "menu:club":
        _user_club.pop(user_id, None)
        await _after_login(update, user_id, session)
        return
    if data == "menu:help":
        await reply(update, HELP_TEXT, kb([back_btn("menu:main")[0]]))
        return
    if data == "menu:exit":
        if _wizard.get(user_id):
            await reply(update, "⚠️ Bạn đang thao tác dở. Hủy và về menu chính?", kb(
                [("✅ Hủy & về Menu", "menu:exit_confirm"), ("↩ Tiếp tục", "wiz:resume")],
            ))
        else:
            await show_main_menu(update, session, _user_club_name.get(user_id, ""))
        return
    if data == "menu:exit_confirm":
        _wizard.pop(user_id, None)
        await show_main_menu(update, session, _user_club_name.get(user_id, ""))
        return

    # ── Member actions ──
    if data.startswith("member:list"):
        parts = data.split(":")
        status = parts[2] if len(parts) > 2 else ""
        await member_list(update, session, club_id, status)
        return

    # ── Report actions ──
    if data == "report:overview":
        await report_overview(update, session, club_id)
        return
    if data == "report:monthly":
        await _period_menu(update, "rpt_monthly", "báo cáo", back="menu:report")
        return
    if data.startswith("rpt_monthly:"):
        _, m, y = data.split(":")
        await report_monthly(update, session, club_id, int(m), int(y))
        return
    if data == "report:fee_status":
        await _period_menu(update, "rpt_fee", "trạng thái phí", back="menu:report")
        return
    if data.startswith("rpt_fee:") and not data.startswith("rpt_fee_ft:"):
        _, m, y = data.split(":")
        await report_fee_status_select_ft(update, session, club_id, int(m), int(y))
        return
    if data.startswith("rpt_fee_ft:"):
        parts = data.split(":")
        m, y, ft_id = int(parts[1]), int(parts[2]), int(parts[3])
        await report_fee_status(update, session, club_id, m, y, ft_id)
        return

    # ── Gdlist ──
    if data.startswith("gdlist:"):
        parts = data.split(":")
        m, y = int(parts[1]), int(parts[2])
        tx_type = parts[3] if len(parts) > 3 else ""
        await gdlist_show(update, session, club_id, m, y, tx_type)
        return

    # ── Xóa giao dịch — chọn GD (có phân trang) ──
    if data.startswith("gdlist_del:"):
        parts = data.split(":")
        m, y = int(parts[1]), int(parts[2])
        page = int(parts[3]) if len(parts) > 3 else 0
        PAGE_SIZE = 10
        try:
            txs = await call_backend("get", "/api/transactions", token=session["token"],
                                     club_id=club_id, params={"month": m, "year": y})
        except ValueError as e:
            await reply(update, f"❌ {e}")
            return
        if not txs:
            await reply(update, f"Không có giao dịch tháng {m}/{y}.",
                        kb([back_btn(f"gdlist:{m}:{y}")[0], ("🏠 Menu", "menu:exit")]))
            return
        _tx_cache[user_id] = {t["id"]: t for t in txs}
        total = len(txs)
        total_pages = (total + PAGE_SIZE - 1) // PAGE_SIZE
        page = max(0, min(page, total_pages - 1))
        slice_ = txs[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]
        rows = []
        for t in slice_:
            icon = "💚" if t["type"] == "income" else "🔴"
            fee_name = (t.get("fee_type") or {}).get("name", "?") if isinstance(t.get("fee_type"), dict) else "?"
            date_short = t["transaction_date"][5:]  # MM-DD
            label = f"{icon} {date_short} {fee_name} {fmt(t['amount'])}"
            rows.append([(label, f"deltx_confirm:{t['id']}:{m}:{y}")])
        nav = []
        if page > 0:
            nav.append((f"◀ Trang {page}", f"gdlist_del:{m}:{y}:{page-1}"))
        if page < total_pages - 1:
            nav.append((f"Trang {page+2} ▶", f"gdlist_del:{m}:{y}:{page+1}"))
        if nav:
            rows.append(nav)
        rows.append([back_btn(f"gdlist:{m}:{y}")[0], ("🏠 Menu", "menu:exit")])
        header = f"🗑 *Chọn giao dịch muốn xóa* (tháng {m}/{y})"
        if total_pages > 1:
            header += f"\nTrang {page+1}/{total_pages} — {total} GD"
        await reply(update, header + ":", kb(*rows))
        return

    # ── Xóa giao dịch — confirm ──
    if data.startswith("deltx_confirm:"):
        parts = data.split(":")
        tx_id, m, y = int(parts[1]), int(parts[2]), int(parts[3])
        tx = (_tx_cache.get(user_id) or {}).get(tx_id)
        if not tx:
            await reply(update, "❌ Không tìm thấy giao dịch. Vui lòng thử lại.",
                        kb([back_btn(f"gdlist_del:{m}:{y}")[0], ("🏠 Menu", "menu:exit")]))
            return
        fee_name = (tx.get("fee_type") or {}).get("name", "?") if isinstance(tx.get("fee_type"), dict) else "?"
        member_name = (tx.get("member") or {}).get("full_name", "") if isinstance(tx.get("member"), dict) else ""
        icon = "💚" if tx["type"] == "income" else "🔴"
        desc = f"{icon} *{fee_name}* — {fmt(tx['amount'])}"
        if member_name:
            desc += f" ({member_name})"
        desc += f"\n📅 Ngày: {tx['transaction_date']}"
        await reply(update,
            f"⚠️ Xác nhận xóa giao dịch?\n\n{desc}\n\n_Thao tác này không thể hoàn tác!_",
            kb(
                [("✅ Xác nhận xóa", f"deltx:{tx_id}:{m}:{y}"), ("❌ Hủy", f"gdlist_del:{m}:{y}")],
                [("🏠 Menu", "menu:exit")],
            ))
        return

    # ── Xóa giao dịch — thực hiện ──
    if data.startswith("deltx:"):
        parts = data.split(":")
        tx_id = int(parts[1])
        m, y = int(parts[2]), int(parts[3])
        try:
            await call_backend("delete", f"/api/transactions/{tx_id}",
                               token=session["token"], club_id=club_id)
            await reply(update, f"✅ Đã xóa giao dịch thành công.",
                        kb([("📋 Xem giao dịch", f"gdlist:{m}:{y}"), ("🏠 Menu", "menu:exit")]))
        except ValueError as e:
            await reply(update, f"❌ {e}", kb([back_btn(f"gdlist:{m}:{y}")[0], ("🏠 Menu", "menu:exit")]))
        return

    # ── Category ──
    if data == "category:delete":
        await category_delete_menu(update, session, club_id)
        return
    if data.startswith("category:del_confirm:"):
        ft_id = data[21:]
        ft_name = _ft_name_cache.get(user_id, {}).get(ft_id, f"ID {ft_id}")
        await reply(update,
            f"⚠️ Xác nhận xóa khoản *{ft_name}*?",
            kb([("✅ Xóa", f"category:del_exec:{ft_id}"), ("❌ Hủy", "menu:category")],
               [("🏠 Menu", "menu:exit")])
        )
        return
    if data.startswith("category:del_exec:"):
        ft_id = data[18:]
        ft_name = _ft_name_cache.get(user_id, {}).get(ft_id, f"ID {ft_id}")
        try:
            await call_backend("delete", f"/api/fee-types/{ft_id}", token=session["token"], club_id=club_id)
            await reply(update, f"✅ Đã xóa khoản *{ft_name}*.",
                        kb([back_btn("menu:category")[0], ("🏠 Menu", "menu:exit")]))
        except ValueError as e:
            await reply(update, f"❌ {e}",
                        kb([back_btn("menu:category")[0], ("🏠 Menu", "menu:exit")]))
        return

    # ── Wizard start ──
    if data.startswith("wiz:") and not data.startswith("wiz:skip") and not data.startswith("wiz:cancel") \
            and not data.startswith("wiz:confirm") and data != "wiz:noop":
        wiz_name = data[4:]
        if wiz_name in WIZARDS:
            await wizard_start(update, wiz_name, session, club_id)
            return

    # ── Wizard controls ──
    if data == "wiz:noop":
        return
    if data == "wiz:cancel":
        w = _wizard.pop(user_id, None)
        await _go_back_from_wizard(update, w["name"] if w else None, session, club_id)
        return
    if data == "wiz:resume":
        w = _wizard.get(user_id)
        if w:
            await wizard_show_step(update, user_id, session, club_id)
        else:
            await show_main_menu(update, session, _user_club_name.get(user_id, ""))
        return
    if data == "wiz:skip":
        w = _wizard.get(user_id)
        if w:
            steps = WIZARDS[w["name"]]["steps"]
            step = steps[w["step"]]
            w["data"][step["key"]] = None
            w["step"] += 1
            await wizard_show_step(update, user_id, session, club_id)
        return
    if data == "wiz:confirm_yes":
        await wizard_submit(update, user_id, session, club_id)
        return

    # ── Wizard: date ──
    if data.startswith("wiz_date:"):
        w = _wizard.get(user_id)
        if not w:
            return
        action = data[9:]
        steps = WIZARDS[w["name"]]["steps"]
        step = steps[w["step"]]
        if action == "today":
            await wizard_set_value(update, user_id, step["key"], today_str(), session, club_id)
        else:
            w["data"]["_waiting_date_key"] = step["key"]
            await reply(update, "Nhập ngày theo định dạng *DD/MM/YYYY*:",
                        kb([("🏠 Menu", "menu:exit")]))
        return

    # ── Wizard: fee type ──
    if data.startswith("wiz_ft:"):
        w = _wizard.get(user_id)
        if not w:
            return
        ft_id = data[7:]
        ft_info = w["data"].get("_ft_cache", {}).get(ft_id, {})
        w["data"]["_fee_type_id"] = ft_id
        w["data"]["_fee_type_name"] = ft_info.get("name", ft_id)
        w["data"]["_fee_default"] = ft_info.get("default", "0")
        w["data"]["_fee_type_kind"] = "income" if w["name"] == "add_thu" else "expense"
        w["step"] += 1
        await wizard_show_step(update, user_id, session, club_id)
        return

    # ── Wizard: member select ──
    if data.startswith("wiz_m:"):
        w = _wizard.get(user_id)
        if not w:
            return
        m_id = data[6:]
        m_name = w["data"].get("_m_cache", {}).get(m_id, f"ID {m_id}")
        steps = WIZARDS[w["name"]]["steps"]
        step = steps[w["step"]]
        w["data"][step["key"]] = m_id
        w["data"]["_member_name"] = m_name
        w["step"] += 1
        await wizard_show_step(update, user_id, session, club_id)
        return

    # ── Wizard: use default amount ──
    if data.startswith("wiz_default:"):
        w = _wizard.get(user_id)
        if not w:
            return
        key = data[12:]
        default_val = w["data"].get("_fee_default", "0")
        await wizard_set_value(update, user_id, key, default_val, session, club_id)
        return

    # ── Wizard: button choice ──
    if data.startswith("wiz_choice:"):
        w = _wizard.get(user_id)
        if not w:
            return
        value = data[11:]
        steps = WIZARDS[w["name"]]["steps"]
        step = steps[w["step"]]
        await wizard_set_value(update, user_id, step["key"], value, session, club_id)
        return

    # ── Wizard: generic button (value từ buttons list) ──
    # Kiểm tra nếu wizard đang chờ button choice
    w = _wizard.get(user_id)
    if w:
        wiz_def = WIZARDS.get(w["name"])
        if wiz_def and w["step"] < len(wiz_def["steps"]):
            step = wiz_def["steps"][w["step"]]
            if step.get("buttons"):
                # Tìm xem data có phải là value của button không
                all_values = [d for row in step["buttons"] for _, d in row]
                if data in all_values:
                    await wizard_set_value(update, user_id, step["key"], data, session, club_id)
                    return

    logger.warning(f"Unhandled callback: {data}")


# ── MESSAGE HANDLER ───────────────────────────────────────────────────────────
async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    text = update.message.text.strip()

    guard = await _guard(update)
    if not guard:
        return
    session, club_id = guard

    w = _wizard.get(user_id)

    # Wizard đang chờ nhập ngày thủ công
    if w and w["data"].get("_waiting_date_key"):
        date_key = w["data"].pop("_waiting_date_key")
        parsed = parse_date(text)
        if parsed:
            await wizard_set_value(update, user_id, date_key, parsed, session, club_id)
        else:
            await update.message.reply_text("❌ Sai định dạng. Nhập lại *DD/MM/YYYY*:", parse_mode="Markdown")
        return

    # Wizard đang chờ nhập text
    if w:
        wiz_def = WIZARDS.get(w["name"])
        if wiz_def and w["step"] < len(wiz_def["steps"]):
            step = wiz_def["steps"][w["step"]]
            # Chỉ nhận text nếu bước này không có buttons
            if not step.get("buttons") and not step.get("dynamic") and not step.get("is_date"):
                await wizard_set_value(update, user_id, step["key"], text, session, club_id)
                return

    # Không hiểu → nhắc
    await update.message.reply_text(
        "❓ Dùng các nút bấm hoặc gõ /menu để xem chức năng.",
        parse_mode="Markdown",
        reply_markup=kb([("🏠 Menu chính", "menu:main")])
    )


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    app = Application.builder().token(TELEGRAM_TOKEN).build()

    login_handler = ConversationHandler(
        entry_points=[CommandHandler("start", cmd_start)],
        states={
            WAIT_USERNAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, receive_username)],
            WAIT_PASSWORD: [MessageHandler(filters.TEXT & ~filters.COMMAND, receive_password)],
        },
        fallbacks=[CommandHandler("start", cmd_start)],
    )

    app.add_handler(login_handler)
    app.add_handler(CommandHandler("logout", cmd_logout))
    app.add_handler(CommandHandler("menu", cmd_menu))
    app.add_handler(CallbackQueryHandler(handle_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    logger.info("Bot đang chạy (Menu-driven — không AI)...")
    app.run_polling(allowed_updates=["message", "callback_query"])


if __name__ == "__main__":
    main()
