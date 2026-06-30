"""
Telegram Bot cho CLB Pickleball — đa CLB, bảo mật bằng đăng nhập hệ thống.
Mỗi Telegram user phải đăng nhập bằng tài khoản CLB của mình.
"""
import asyncio
import json
import logging
import os
import time
from datetime import datetime

import httpx
from groq import AsyncGroq
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, filters, ContextTypes, ConversationHandler,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Cấu hình ──────────────────────────────────────────────────────────────────
TELEGRAM_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
GROQ_API_KEY = os.environ["GROQ_API_KEY"]
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")

groq_client = AsyncGroq(api_key=GROQ_API_KEY)

# ── ConversationHandler states ────────────────────────────────────────────────
WAIT_USERNAME, WAIT_PASSWORD = range(2)

# ── Trạng thái per-user ───────────────────────────────────────────────────────
# user_id -> {"token": str, "expires_at": float, "username": str, "full_name": str}
_sessions: dict[int, dict] = {}
# user_id -> club_id đang chọn
_user_club: dict[int, int] = {}
# user_id -> tên CLB
_user_club_name: dict[int, str] = {}
# user_id -> conversation history
_history: dict[int, list] = {}
# user_id -> username đang nhập (tạm thời trong flow đăng nhập)
_pending_username: dict[int, str] = {}

MAX_HISTORY = 20
SESSION_TTL = 7 * 24 * 3600  # session tự hết sau 7 ngày


# ── Auth helpers ──────────────────────────────────────────────────────────────
def get_session(user_id: int) -> dict | None:
    s = _sessions.get(user_id)
    if s and time.time() < s["expires_at"]:
        return s
    _sessions.pop(user_id, None)
    return None


async def login(username: str, password: str) -> dict:
    """Đăng nhập vào backend, trả về session dict hoặc raise."""
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


async def call_backend(method: str, path: str, token: str, club_id: int | None = None, **kwargs) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    if club_id:
        headers["X-Club-ID"] = str(club_id)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await getattr(client, method)(f"{BACKEND_URL}{path}", headers=headers, **kwargs)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise ValueError(f"Lỗi {resp.status_code}: {detail}")
        if resp.status_code == 204:
            return {"ok": True}
        return resp.json()


# ── Club selection ────────────────────────────────────────────────────────────
async def show_club_menu(update: Update, token: str, user_id: int, edit: bool = False):
    memberships = await call_backend("get", "/api/my-memberships", token=token)
    if not memberships:
        text = "❌ Tài khoản chưa được thêm vào CLB nào. Liên hệ quản trị viên."
        if edit:
            await update.callback_query.edit_message_text(text)
        else:
            await update.message.reply_text(text)
        return False

    if len(memberships) == 1 and not edit:
        m = memberships[0]
        _user_club[user_id] = m["club_id"]
        _user_club_name[user_id] = m["club"]["name"] if m.get("club") else f"CLB #{m['club_id']}"
        return True

    current_id = _user_club.get(user_id)
    keyboard = [
        [InlineKeyboardButton(
            f"{'✅ ' if m['club_id'] == current_id else '🏸 '}{m['club']['name']}",
            callback_data=f"sel_club:{m['club_id']}:{m['club']['name']}"
        )]
        for m in memberships if m.get("club")
    ]
    text = f"Đang làm việc: *{_user_club_name.get(user_id, 'Chưa chọn')}*\nChọn CLB:" if edit else "Chọn CLB muốn làm việc:"
    if edit:
        await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    else:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    return False  # chờ user bấm


# ── ConversationHandler: đăng nhập ───────────────────────────────────────────
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    session = get_session(user_id)
    if session:
        # Đã đăng nhập → vào thẳng
        _user_club.pop(user_id, None)
        _user_club_name.pop(user_id, None)
        _history.pop(user_id, None)
        ready = await show_club_menu(update, session["token"], user_id)
        if ready:
            await _send_welcome(update, session, _user_club_name.get(user_id, ""))
        return ConversationHandler.END

    await update.message.reply_text(
        "👋 Xin chào! Đây là bot quản lý CLB Pickleball.\n\n"
        "🔐 Vui lòng đăng nhập để tiếp tục.\n\n"
        "Nhập *tên đăng nhập* của bạn:",
        parse_mode="Markdown",
    )
    return WAIT_USERNAME


async def receive_username(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    _pending_username[user_id] = update.message.text.strip()
    await update.message.reply_text("Nhập *mật khẩu*:", parse_mode="Markdown")
    return WAIT_PASSWORD


async def receive_password(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    username = _pending_username.pop(user_id, "")
    password = update.message.text.strip()

    # Xóa tin nhắn mật khẩu để bảo mật
    try:
        await update.message.delete()
    except Exception:
        pass

    try:
        session = await login(username, password)
        _sessions[user_id] = session
        _user_club.pop(user_id, None)
        _user_club_name.pop(user_id, None)
        _history.pop(user_id, None)

        # Kiểm tra superuser — bot không dành cho superuser
        if session.get("is_superuser"):
            await update.message.reply_text(
                "⚠️ Tài khoản quản trị hệ thống không sử dụng bot này.\n"
                "Vui lòng dùng tài khoản thành viên CLB."
            )
            _sessions.pop(user_id, None)
            return ConversationHandler.END

        ready = await show_club_menu(update, session["token"], user_id)
        if ready:
            await _send_welcome(update, session, _user_club_name.get(user_id, ""))

    except ValueError as e:
        await update.message.reply_text(
            f"❌ {e}\n\nNhập lại *tên đăng nhập*:",
            parse_mode="Markdown",
        )
        return WAIT_USERNAME

    return ConversationHandler.END


async def _send_welcome(update: Update, session: dict, club_name: str):
    name = session.get("full_name") or session["username"]
    await update.message.reply_text(
        f"✅ Đăng nhập thành công!\n"
        f"👤 Xin chào *{name}*\n"
        f"🏸 CLB: *{club_name}*\n\n"
        "Bạn có thể hỏi tôi:\n"
        "• Xem danh sách thành viên\n"
        "• Thêm thành viên mới\n"
        "• Ghi nhận thu/chi\n"
        "• Báo cáo thu chi theo tháng\n"
        "• Kiểm tra ai chưa đóng phí\n\n"
        "Gõ /club đổi CLB | /logout đăng xuất | /reset xóa lịch sử",
        parse_mode="Markdown",
    )


async def cmd_logout(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    _sessions.pop(user_id, None)
    _user_club.pop(user_id, None)
    _user_club_name.pop(user_id, None)
    _history.pop(user_id, None)
    await update.message.reply_text("👋 Đã đăng xuất. Gõ /start để đăng nhập lại.")


async def cmd_club(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    session = get_session(user_id)
    if not session:
        await update.message.reply_text("🔐 Bạn chưa đăng nhập. Gõ /start để đăng nhập.")
        return
    await show_club_menu(update, session["token"], user_id, edit=False)


async def cmd_reset(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    session = get_session(user_id)
    if not session:
        await update.message.reply_text("🔐 Bạn chưa đăng nhập. Gõ /start để đăng nhập.")
        return
    _history.pop(user_id, None)
    await update.message.reply_text(f"🔄 Đã xóa lịch sử. CLB: {_user_club_name.get(user_id, '—')}")


async def handle_club_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = query.from_user.id

    session = get_session(user_id)
    if not session:
        await query.edit_message_text("🔐 Phiên đã hết hạn. Gõ /start để đăng nhập lại.")
        return

    parts = query.data.split(":", 2)
    club_id = int(parts[1])
    club_name = parts[2]

    _user_club[user_id] = club_id
    _user_club_name[user_id] = club_name
    _history.pop(user_id, None)

    name = session.get("full_name") or session["username"]
    await query.edit_message_text(
        f"✅ CLB: *{club_name}*\n👤 {name}\n\n"
        "Bạn có thể hỏi tôi bất cứ điều gì về CLB này.\n"
        "Gõ /club đổi CLB | /logout đăng xuất",
        parse_mode="Markdown",
    )


# ── Tool definitions (OpenAI/Groq format) ────────────────────────────────────
TOOLS = [
    {"type": "function", "function": {
        "name": "get_overview",
        "description": "Lấy tổng quan CLB: số thành viên, tổng thu, tổng chi, số dư.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "list_members",
        "description": "Xem danh sách thành viên.",
        "parameters": {"type": "object", "properties": {
            "status": {"type": "string", "enum": ["active", "inactive"]},
            "search": {"type": "string"},
        }},
    }},
    {"type": "function", "function": {
        "name": "add_member",
        "description": "Thêm thành viên mới vào CLB.",
        "parameters": {"type": "object", "properties": {
            "full_name": {"type": "string"},
            "phone": {"type": "string"},
            "email": {"type": "string"},
            "rank": {"type": "string"},
            "join_date": {"type": "string", "description": "YYYY-MM-DD"},
        }, "required": ["full_name"]},
    }},
    {"type": "function", "function": {
        "name": "list_fee_types",
        "description": "Xem danh mục khoản thu/chi.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "record_transaction",
        "description": "Ghi nhận giao dịch thu hoặc chi.",
        "parameters": {"type": "object", "properties": {
            "fee_type_name": {"type": "string"},
            "amount": {"type": "number"},
            "member_name": {"type": "string"},
            "transaction_date": {"type": "string", "description": "YYYY-MM-DD"},
            "payment_method": {"type": "string"},
            "description": {"type": "string"},
        }, "required": ["fee_type_name", "amount"]},
    }},
    {"type": "function", "function": {
        "name": "get_monthly_report",
        "description": "Báo cáo thu chi theo tháng.",
        "parameters": {"type": "object", "properties": {
            "month": {"type": "integer"},
            "year": {"type": "integer"},
        }, "required": ["month", "year"]},
    }},
    {"type": "function", "function": {
        "name": "get_fee_status",
        "description": "Kiểm tra trạng thái đóng phí của thành viên trong tháng.",
        "parameters": {"type": "object", "properties": {
            "month": {"type": "integer"},
            "year": {"type": "integer"},
        }, "required": ["month", "year"]},
    }},
    {"type": "function", "function": {
        "name": "list_transactions",
        "description": "Xem danh sách giao dịch (có ID). Dùng để tìm ID trước khi xóa.",
        "parameters": {"type": "object", "properties": {
            "month": {"type": "integer"},
            "year": {"type": "integer"},
            "type": {"type": "string", "enum": ["income", "expense"]},
        }},
    }},
    {"type": "function", "function": {
        "name": "delete_transaction",
        "description": "Xóa giao dịch theo ID. Phải gọi list_transactions trước để lấy ID thực.",
        "parameters": {"type": "object", "properties": {
            "transaction_id": {"type": "integer"},
        }, "required": ["transaction_id"]},
    }},
    {"type": "function", "function": {
        "name": "delete_member",
        "description": "Xóa thành viên theo ID. Phải gọi list_members trước để lấy ID thực.",
        "parameters": {"type": "object", "properties": {
            "member_id": {"type": "integer"},
        }, "required": ["member_id"]},
    }},
    {"type": "function", "function": {
        "name": "update_member_status",
        "description": "Cập nhật trạng thái thành viên (active/inactive).",
        "parameters": {"type": "object", "properties": {
            "member_id": {"type": "integer"},
            "status": {"type": "string", "enum": ["active", "inactive"]},
        }, "required": ["member_id", "status"]},
    }},
]


def fmt_money(amount) -> str:
    try:
        return f"{int(float(amount)):,}đ".replace(",", ".")
    except Exception:
        return str(amount)


async def execute_tool(name: str, inputs: dict, token: str, club_id: int) -> str:
    try:
        if name == "get_overview":
            data = await call_backend("get", "/api/reports/overview", token=token, club_id=club_id)
            return (
                f"📊 Tổng quan CLB:\n"
                f"• Thành viên: {data['total_members']} (hoạt động: {data['active_members']})\n"
                f"• Tổng thu: {fmt_money(data['total_income'])}\n"
                f"• Tổng chi: {fmt_money(data['total_expense'])}\n"
                f"• Số dư: {fmt_money(data['balance'])}"
            )

        elif name == "list_members":
            params = {k: v for k, v in inputs.items() if v}
            members = await call_backend("get", "/api/members", token=token, club_id=club_id, params=params)
            if not members:
                return "Không có thành viên nào."
            lines = [f"👥 Danh sách thành viên ({len(members)} người):"]
            for m in members[:20]:
                icon = "✅" if m["status"] == "active" else "⏸"
                phone = f" ({m['phone']})" if m.get("phone") else ""
                lines.append(f"{icon} {m['member_code']} — {m['full_name']}{phone}")
            if len(members) > 20:
                lines.append(f"... và {len(members)-20} người khác")
            return "\n".join(lines)

        elif name == "add_member":
            payload = {
                "full_name": inputs["full_name"],
                "status": "active",
                "join_date": inputs.get("join_date") or datetime.now().strftime("%Y-%m-%d"),
            }
            for f in ["phone", "email", "rank"]:
                if inputs.get(f):
                    payload[f] = inputs[f]
            member = await call_backend("post", "/api/members", token=token, club_id=club_id, json=payload)
            return (
                f"✅ Đã thêm thành viên:\n"
                f"• Mã: {member['member_code']}\n"
                f"• Tên: {member['full_name']}\n"
                f"• SĐT: {member.get('phone', '—')}\n"
                f"• Ngày tham gia: {member['join_date']}"
            )

        elif name == "list_fee_types":
            fee_types = await call_backend("get", "/api/fee-types", token=token, club_id=club_id)
            if not fee_types:
                return "Chưa có danh mục khoản nào."
            income = [f for f in fee_types if f["type"] == "income"]
            expense = [f for f in fee_types if f["type"] == "expense"]
            lines = ["📋 Danh mục khoản:"]
            if income:
                lines.append("💚 Khoản thu:")
                for f in income:
                    amt = f" — {fmt_money(f['default_amount'])}" if f.get("default_amount") else ""
                    lines.append(f"  • {f['name']}{amt}")
            if expense:
                lines.append("🔴 Khoản chi:")
                for f in expense:
                    amt = f" — {fmt_money(f['default_amount'])}" if f.get("default_amount") else ""
                    lines.append(f"  • {f['name']}{amt}")
            return "\n".join(lines)

        elif name == "record_transaction":
            fee_types = await call_backend("get", "/api/fee-types", token=token, club_id=club_id)
            fee_type = next(
                (f for f in fee_types if inputs["fee_type_name"].lower() in f["name"].lower()), None
            )
            if not fee_type:
                names = ", ".join(f["name"] for f in fee_types)
                return f"❌ Không tìm thấy khoản '{inputs['fee_type_name']}'. Hiện có: {names}"

            payload = {
                "fee_type_id": fee_type["id"],
                "amount": inputs["amount"],
                "type": fee_type["type"],
                "transaction_date": inputs.get("transaction_date") or datetime.now().strftime("%Y-%m-%d"),
                "payment_method": inputs.get("payment_method", "Tiền mặt"),
                "description": inputs.get("description", ""),
            }
            if inputs.get("member_name"):
                members = await call_backend("get", "/api/members", token=token, club_id=club_id,
                                             params={"search": inputs["member_name"]})
                if members:
                    payload["member_id"] = members[0]["id"]

            tx = await call_backend("post", "/api/transactions", token=token, club_id=club_id, json=payload)
            type_label = "THU" if tx["type"] == "income" else "CHI"
            return (
                f"✅ Đã ghi nhận giao dịch:\n"
                f"• Loại: {type_label}\n"
                f"• Khoản: {fee_type['name']}\n"
                f"• Số tiền: {fmt_money(tx['amount'])}\n"
                f"• Ngày: {tx['transaction_date']}"
            )

        elif name == "get_monthly_report":
            data = await call_backend("get", "/api/reports/monthly-detail", token=token, club_id=club_id,
                                      params={"month": inputs["month"], "year": inputs["year"]})
            lines = [
                f"📅 Báo cáo tháng {inputs['month']}/{inputs['year']}:",
                f"• Tổng thu: {fmt_money(data['total_income'])}",
                f"• Tổng chi: {fmt_money(data['total_expense'])}",
                f"• Số dư: {fmt_money(data['balance'])}",
                f"• Số giao dịch: {data['transaction_count']}",
            ]
            if data.get("income_breakdown"):
                lines.append("\n💚 Chi tiết thu:")
                for item in data["income_breakdown"][:5]:
                    lines.append(f"  • {item['fee_type']}: {fmt_money(item['amount'])} ({item['count']} lần)")
            if data.get("expense_breakdown"):
                lines.append("\n🔴 Chi tiết chi:")
                for item in data["expense_breakdown"][:5]:
                    lines.append(f"  • {item['fee_type']}: {fmt_money(item['amount'])} ({item['count']} lần)")
            return "\n".join(lines)

        elif name == "get_fee_status":
            data = await call_backend("get", "/api/reports/fee-status", token=token, club_id=club_id,
                                      params={"month": inputs["month"], "year": inputs["year"]})
            paid = [m for m in data if m.get("paid")]
            unpaid = [m for m in data if not m.get("paid")]
            lines = [
                f"📋 Trạng thái đóng phí tháng {inputs['month']}/{inputs['year']}:",
                f"✅ Đã đóng: {len(paid)} người",
                f"❌ Chưa đóng: {len(unpaid)} người",
            ]
            if unpaid:
                lines.append("\nChưa đóng phí:")
                for m in unpaid[:10]:
                    lines.append(f"  • {m['member_code']} — {m['full_name']}")
                if len(unpaid) > 10:
                    lines.append(f"  ... và {len(unpaid)-10} người khác")
            return "\n".join(lines)

        elif name == "list_transactions":
            params = {k: v for k, v in inputs.items() if v is not None}
            txs = await call_backend("get", "/api/transactions", token=token, club_id=club_id, params=params)
            if not txs:
                return "Không có giao dịch nào."
            total_income = sum(float(t["amount"]) for t in txs if t["type"] == "income")
            total_expense = sum(float(t["amount"]) for t in txs if t["type"] == "expense")
            lines = [f"💳 {len(txs)} giao dịch | Thu: {fmt_money(total_income)} | Chi: {fmt_money(total_expense)}"]
            for t in txs[:20]:
                icon = "💚" if t["type"] == "income" else "🔴"
                fee_name = t.get("fee_type", {}).get("name", "?") if isinstance(t.get("fee_type"), dict) else "?"
                member = t.get("member") or {}
                member_name = member.get("full_name", "") if isinstance(member, dict) else ""
                lines.append(
                    f"{icon} [ID:{t['id']}] {t['transaction_date']} — {fee_name}: {fmt_money(t['amount'])}"
                    + (f" ({member_name})" if member_name else "")
                )
            if len(txs) > 20:
                lines.append(f"... và {len(txs)-20} giao dịch khác")
            return "\n".join(lines)

        elif name == "delete_transaction":
            tx_id = inputs["transaction_id"]
            # Lấy thông tin trước khi xóa để xác nhận
            try:
                tx = await call_backend("get", f"/api/transactions/{tx_id}", token=token, club_id=club_id)
                fee_name = tx.get("fee_type", {}).get("name", "?") if isinstance(tx.get("fee_type"), dict) else "?"
                amount = fmt_money(tx["amount"])
                date = tx["transaction_date"]
            except Exception:
                return f"❌ Không tìm thấy giao dịch ID {tx_id}."

            await call_backend("delete", f"/api/transactions/{tx_id}", token=token, club_id=club_id)
            return f"✅ Đã xóa giao dịch [ID:{tx_id}] — {fee_name}: {amount} ngày {date}"

        elif name == "delete_member":
            member_id = inputs["member_id"]
            try:
                member = await call_backend("get", f"/api/members/{member_id}", token=token, club_id=club_id)
                name_member = member.get("full_name", f"ID {member_id}")
            except Exception:
                return f"❌ Không tìm thấy thành viên ID {member_id}."

            await call_backend("delete", f"/api/members/{member_id}", token=token, club_id=club_id)
            return f"✅ Đã xóa thành viên {name_member} [ID:{member_id}]"

        elif name == "update_member_status":
            member_id = inputs["member_id"]
            status = inputs["status"]
            member = await call_backend("put", f"/api/members/{member_id}", token=token, club_id=club_id,
                                        json={"status": status})
            label = "hoạt động" if status == "active" else "tạm nghỉ"
            return f"✅ Đã cập nhật {member['full_name']} → {label}"

        return f"Tool '{name}' chưa được hỗ trợ."

    except ValueError as e:
        return f"❌ {e}"
    except Exception as e:
        logger.error(f"Tool {name} error: {e}")
        return f"❌ Lỗi hệ thống: {e}"


# ── Message handler ───────────────────────────────────────────────────────────
async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id

    # Kiểm tra đăng nhập
    session = get_session(user_id)
    if not session:
        await update.message.reply_text("🔐 Bạn chưa đăng nhập. Gõ /start để đăng nhập.")
        return

    # Kiểm tra đã chọn CLB
    club_id = _user_club.get(user_id)
    if not club_id:
        await show_club_menu(update, session["token"], user_id)
        return

    text = update.message.text.strip()
    if not text:
        return

    club_name = _user_club_name.get(user_id, "")
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")

    history = _history.setdefault(user_id, [])
    history.append({"role": "user", "content": text})

    name = session.get("full_name") or session["username"]
    system_prompt = (
        f"Bạn là trợ lý quản lý CLB Pickleball. Hôm nay: {datetime.now().strftime('%d/%m/%Y')}.\n"
        f"Người dùng: {name}. CLB đang làm việc: {club_name} (ID: {club_id}).\n"
        "Trả lời bằng tiếng Việt, ngắn gọn, rõ ràng. Định dạng tiền: 500.000đ.\n\n"
        "QUY TẮC BẮT BUỘC:\n"
        "1. BẤT KỲ câu hỏi/yêu cầu nào liên quan đến dữ liệu CLB → LUÔN gọi tool tương ứng TRƯỚC.\n"
        "2. Xóa giao dịch: gọi list_transactions trước để lấy ID thực, rồi mới gọi delete_transaction.\n"
        "3. Xóa thành viên: gọi list_members trước để lấy ID thực, rồi mới gọi delete_member.\n"
        "4. KHÔNG gọi record_transaction / add_member khi user muốn xóa hoặc xem.\n"
        "5. Nếu tool báo lỗi → trả lỗi thực tế, không đoán mò."
    )

    # Build Groq messages
    import re as _re
    _text_lower = text.lower()
    _has_delete_intent = any(kw in _text_lower for kw in ("xóa", "xoá", "hủy", "huỷ"))
    _has_explicit_id = bool(_re.search(r'\b\d+\b', text))
    if _has_delete_intent and not _has_explicit_id:
        history[-1]["content"] += "\n[Chú ý: chưa có ID — gọi list_transactions hoặc list_members trước]"

    messages = [{"role": "system", "content": system_prompt}]
    messages += [{"role": h["role"], "content": h["content"]} for h in history[-MAX_HISTORY:]]

    try:
        for turn in range(10):
            response = await groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",
                temperature=0.1,
                max_tokens=2048,
            )
            msg = response.choices[0].message

            if msg.tool_calls:
                messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": [
                    {"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                    for tc in msg.tool_calls
                ]})
                results = await asyncio.gather(*[
                    execute_tool(tc.function.name, json.loads(tc.function.arguments), session["token"], club_id)
                    for tc in msg.tool_calls
                ])
                for tc, result in zip(msg.tool_calls, results):
                    messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
            else:
                reply = msg.content or "Xin lỗi, tôi không hiểu yêu cầu này."
                history.append({"role": "assistant", "content": reply})
                if len(history) > MAX_HISTORY:
                    _history[user_id] = history[-MAX_HISTORY:]
                await update.message.reply_text(reply)
                return

        await update.message.reply_text("❌ Quá nhiều bước xử lý, vui lòng thử lại.")

    except Exception as e:
        logger.error(f"handle_message error: {e}")
        await update.message.reply_text(f"❌ Lỗi: {e}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    app = Application.builder().token(TELEGRAM_TOKEN).build()

    # ConversationHandler cho luồng đăng nhập
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
    app.add_handler(CommandHandler("club", cmd_club))
    app.add_handler(CommandHandler("reset", cmd_reset))
    app.add_handler(CallbackQueryHandler(handle_club_selection, pattern=r"^sel_club:"))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    logger.info("Bot đang chạy (Groq Llama 3.3 70B — đa CLB + auth)...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
