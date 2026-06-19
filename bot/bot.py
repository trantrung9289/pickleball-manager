"""
Telegram Bot cho CLB Pickleball — hỗ trợ đa CLB.
Mỗi user chọn CLB muốn làm việc, bot dùng club_id tương ứng.
"""
import asyncio
import json
import logging
import os
from datetime import datetime

import httpx
from groq import Groq
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, filters, ContextTypes,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Cấu hình ──────────────────────────────────────────────────────────────────
TELEGRAM_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
GROQ_API_KEY = os.environ["GROQ_API_KEY"]
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")
BOT_USERNAME = os.environ["BOT_USERNAME"]
BOT_PASSWORD = os.environ["BOT_PASSWORD"]

groq_client = Groq(api_key=GROQ_API_KEY)

# ── JWT tự động refresh ───────────────────────────────────────────────────────
_jwt_token: str | None = None
_jwt_expires_at: float = 0


async def get_jwt_token() -> str:
    import time
    global _jwt_token, _jwt_expires_at
    if _jwt_token and time.time() < _jwt_expires_at - 3600:
        return _jwt_token
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{BACKEND_URL}/api/auth/login",
            json={"username": BOT_USERNAME, "password": BOT_PASSWORD},
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Bot login thất bại: {resp.text}")
        data = resp.json()
        _jwt_token = data["access_token"]
        _jwt_expires_at = time.time() + 6 * 24 * 3600
        logger.info("Bot đăng nhập thành công")
        return _jwt_token


async def call_backend(method: str, path: str, club_id: int | None = None, **kwargs) -> dict:
    token = await get_jwt_token()
    headers = {"Authorization": f"Bearer {token}"}
    if club_id:
        headers["X-Club-ID"] = str(club_id)
    url = f"{BACKEND_URL}{path}"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await getattr(client, method)(url, headers=headers, **kwargs)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise ValueError(f"Lỗi {resp.status_code}: {detail}")
        if resp.status_code == 204:
            return {"ok": True}
        return resp.json()


# ── Trạng thái per-user ───────────────────────────────────────────────────────
# user_id -> club_id đang chọn
_user_club: dict[int, int] = {}
# user_id -> tên CLB đang chọn
_user_club_name: dict[int, str] = {}
# user_id -> conversation history
_history: dict[int, list] = {}
MAX_HISTORY = 20


async def get_clubs() -> list[dict]:
    """Lấy danh sách tất cả CLB mà bot có quyền truy cập."""
    memberships = await call_backend("get", "/api/my-memberships")
    return memberships  # [{club_id, club_name, ...}]


async def ensure_club_selected(update: Update, user_id: int) -> int | None:
    """
    Kiểm tra user đã chọn CLB chưa.
    Nếu chưa: hiển thị menu chọn và trả về None.
    Nếu rồi: trả về club_id.
    """
    if user_id in _user_club:
        return _user_club[user_id]

    memberships = await call_backend("get", "/api/my-memberships")
    if not memberships:
        await update.message.reply_text("❌ Không tìm thấy CLB nào trong hệ thống.")
        return None

    if len(memberships) == 1:
        # Chỉ có 1 CLB → tự động chọn
        club = memberships[0]
        _user_club[user_id] = club["club_id"]
        _user_club_name[user_id] = club["club"]["name"] if club.get("club") else f"CLB #{club['club_id']}"
        return club["club_id"]

    # Nhiều CLB → hiển thị nút chọn
    keyboard = [
        [InlineKeyboardButton(f"🏸 {m['club']['name']}", callback_data=f"select_club:{m['club_id']}:{m['club']['name']}")]
        for m in memberships if m.get("club")
    ]
    await update.message.reply_text(
        "Bạn có quyền quản lý nhiều CLB. Chọn CLB muốn làm việc:",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return None


# ── Tool definitions ──────────────────────────────────────────────────────────
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_overview",
            "description": "Lấy tổng quan CLB: số thành viên, tổng thu, tổng chi, số dư.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_members",
            "description": "Xem danh sách thành viên. Có thể lọc theo trạng thái hoặc tìm kiếm.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "enum": ["active", "inactive"]},
                    "search": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_member",
            "description": "Thêm thành viên mới vào CLB.",
            "parameters": {
                "type": "object",
                "properties": {
                    "full_name": {"type": "string"},
                    "phone": {"type": "string"},
                    "email": {"type": "string"},
                    "rank": {"type": "string", "description": "beginner/intermediate/advanced/pro"},
                    "join_date": {"type": "string", "description": "YYYY-MM-DD"},
                },
                "required": ["full_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_fee_types",
            "description": "Xem danh mục khoản thu/chi.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "record_transaction",
            "description": "Ghi nhận giao dịch thu hoặc chi.",
            "parameters": {
                "type": "object",
                "properties": {
                    "fee_type_name": {"type": "string"},
                    "amount": {"type": "number"},
                    "member_name": {"type": "string"},
                    "transaction_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "payment_method": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["fee_type_name", "amount"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_monthly_report",
            "description": "Báo cáo thu chi theo tháng.",
            "parameters": {
                "type": "object",
                "properties": {
                    "month": {"type": "integer"},
                    "year": {"type": "integer"},
                },
                "required": ["month", "year"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fee_status",
            "description": "Kiểm tra trạng thái đóng phí của thành viên trong tháng.",
            "parameters": {
                "type": "object",
                "properties": {
                    "month": {"type": "integer"},
                    "year": {"type": "integer"},
                },
                "required": ["month", "year"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_transactions",
            "description": "Xem danh sách giao dịch, có thể lọc theo tháng/năm/loại.",
            "parameters": {
                "type": "object",
                "properties": {
                    "month": {"type": "integer"},
                    "year": {"type": "integer"},
                    "type": {"type": "string", "enum": ["income", "expense"]},
                },
            },
        },
    },
]


# ── Tool executor ─────────────────────────────────────────────────────────────
def fmt_money(amount) -> str:
    try:
        return f"{int(float(amount)):,}đ".replace(",", ".")
    except Exception:
        return str(amount)


async def execute_tool(name: str, inputs: dict, club_id: int) -> str:
    """Thực thi tool với club_id của user đang dùng."""
    try:
        if name == "get_overview":
            data = await call_backend("get", "/api/reports/overview", club_id=club_id)
            return (
                f"📊 Tổng quan CLB:\n"
                f"• Thành viên: {data['total_members']} (hoạt động: {data['active_members']})\n"
                f"• Tổng thu: {fmt_money(data['total_income'])}\n"
                f"• Tổng chi: {fmt_money(data['total_expense'])}\n"
                f"• Số dư: {fmt_money(data['balance'])}"
            )

        elif name == "list_members":
            params = {k: v for k, v in inputs.items() if v}
            members = await call_backend("get", "/api/members", club_id=club_id, params=params)
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
            member = await call_backend("post", "/api/members", club_id=club_id, json=payload)
            return (
                f"✅ Đã thêm thành viên:\n"
                f"• Mã: {member['member_code']}\n"
                f"• Tên: {member['full_name']}\n"
                f"• SĐT: {member.get('phone', '—')}\n"
                f"• Ngày tham gia: {member['join_date']}"
            )

        elif name == "list_fee_types":
            fee_types = await call_backend("get", "/api/fee-types", club_id=club_id)
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
            fee_types = await call_backend("get", "/api/fee-types", club_id=club_id)
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
                members = await call_backend("get", "/api/members", club_id=club_id,
                                             params={"search": inputs["member_name"]})
                if members:
                    payload["member_id"] = members[0]["id"]

            tx = await call_backend("post", "/api/transactions", club_id=club_id, json=payload)
            type_label = "THU" if tx["type"] == "income" else "CHI"
            return (
                f"✅ Đã ghi nhận giao dịch:\n"
                f"• Loại: {type_label}\n"
                f"• Khoản: {fee_type['name']}\n"
                f"• Số tiền: {fmt_money(tx['amount'])}\n"
                f"• Ngày: {tx['transaction_date']}"
            )

        elif name == "get_monthly_report":
            data = await call_backend("get", "/api/reports/monthly-detail", club_id=club_id,
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
            data = await call_backend("get", "/api/reports/fee-status", club_id=club_id,
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
            txs = await call_backend("get", "/api/transactions", club_id=club_id, params=params)
            if not txs:
                return "Không có giao dịch nào."
            total_income = sum(float(t["amount"]) for t in txs if t["type"] == "income")
            total_expense = sum(float(t["amount"]) for t in txs if t["type"] == "expense")
            lines = [f"💳 {len(txs)} giao dịch | Thu: {fmt_money(total_income)} | Chi: {fmt_money(total_expense)}"]
            for t in txs[:15]:
                icon = "💚" if t["type"] == "income" else "🔴"
                fee_name = t.get("fee_type", {}).get("name", "?") if isinstance(t.get("fee_type"), dict) else "?"
                member = t.get("member") or {}
                member_name = member.get("full_name", "") if isinstance(member, dict) else ""
                lines.append(
                    f"{icon} {t['transaction_date']} — {fee_name}: {fmt_money(t['amount'])}"
                    + (f" ({member_name})" if member_name else "")
                )
            if len(txs) > 15:
                lines.append(f"... và {len(txs)-15} giao dịch khác")
            return "\n".join(lines)

        return f"Tool '{name}' chưa được hỗ trợ."

    except ValueError as e:
        return f"❌ {e}"
    except Exception as e:
        logger.error(f"Tool {name} error: {e}")
        return f"❌ Lỗi hệ thống: {e}"


# ── Conversation processing ───────────────────────────────────────────────────
async def process_message(user_id: int, user_text: str, club_id: int, club_name: str) -> str:
    history = _history.setdefault(user_id, [])
    history.append({"role": "user", "content": user_text})

    system_prompt = (
        f"Bạn là trợ lý quản lý CLB Pickleball. Hôm nay: {datetime.now().strftime('%d/%m/%Y')}.\n"
        f"CLB đang làm việc: {club_name} (ID: {club_id}).\n"
        "Trả lời bằng tiếng Việt, ngắn gọn, rõ ràng.\n"
        "Khi cần thông tin từ hệ thống, dùng tool được cung cấp.\n"
        "Định dạng số tiền bằng VNĐ (ví dụ: 500.000đ)."
    )

    messages = [{"role": "system", "content": system_prompt}] + history[-MAX_HISTORY:]

    for _ in range(10):
        response = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
            max_tokens=1024,
        )

        msg = response.choices[0].message

        if msg.tool_calls:
            messages.append({
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in msg.tool_calls
                ],
            })

            results = await asyncio.gather(*[
                execute_tool(tc.function.name, json.loads(tc.function.arguments), club_id)
                for tc in msg.tool_calls
            ])

            for tc, result in zip(msg.tool_calls, results):
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
        else:
            final_text = msg.content or "Xin lỗi, tôi không hiểu yêu cầu này."
            history.append({"role": "assistant", "content": final_text})
            if len(history) > MAX_HISTORY:
                _history[user_id] = history[-MAX_HISTORY:]
            return final_text

    return "❌ Quá nhiều bước xử lý, vui lòng thử lại."


# ── Telegram handlers ─────────────────────────────────────────────────────────
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    # Reset club selection để cho phép chọn lại
    _user_club.pop(user_id, None)
    _user_club_name.pop(user_id, None)
    _history.pop(user_id, None)

    club_id = await ensure_club_selected(update, user_id)
    if club_id:
        club_name = _user_club_name.get(user_id, "")
        await update.message.reply_text(
            f"👋 Xin chào! Đang quản lý CLB: *{club_name}*\n\n"
            "Bạn có thể hỏi tôi:\n"
            "• Xem danh sách thành viên\n"
            "• Thêm thành viên mới\n"
            "• Ghi nhận thu/chi\n"
            "• Báo cáo thu chi theo tháng\n"
            "• Kiểm tra ai chưa đóng phí\n\n"
            "Gõ /club để đổi CLB | /reset để xóa lịch sử",
            parse_mode="Markdown",
        )


async def cmd_club(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Hiển thị menu chọn CLB."""
    user_id = update.effective_user.id
    try:
        memberships = await call_backend("get", "/api/my-memberships")
        if not memberships:
            await update.message.reply_text("❌ Không tìm thấy CLB nào.")
            return

        current = _user_club_name.get(user_id, "Chưa chọn")
        keyboard = [
            [InlineKeyboardButton(
                f"{'✅ ' if m['club_id'] == _user_club.get(user_id) else '🏸 '}{m['club']['name']}",
                callback_data=f"select_club:{m['club_id']}:{m['club']['name']}"
            )]
            for m in memberships if m.get("club")
        ]
        await update.message.reply_text(
            f"Đang làm việc với: *{current}*\nChọn CLB:",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="Markdown",
        )
    except Exception as e:
        await update.message.reply_text(f"❌ Lỗi: {e}")


async def cmd_reset(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    _history.pop(user_id, None)
    club_name = _user_club_name.get(user_id, "")
    await update.message.reply_text(f"🔄 Đã xóa lịch sử hội thoại. CLB hiện tại: {club_name}")


async def handle_club_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Xử lý khi user bấm nút chọn CLB."""
    query = update.callback_query
    await query.answer()

    parts = query.data.split(":", 2)  # "select_club:123:Tên CLB"
    club_id = int(parts[1])
    club_name = parts[2]

    user_id = query.from_user.id
    _user_club[user_id] = club_id
    _user_club_name[user_id] = club_name
    _history.pop(user_id, None)  # Reset history khi đổi CLB

    await query.edit_message_text(
        f"✅ Đã chuyển sang CLB: *{club_name}*\n\n"
        "Bạn có thể hỏi tôi:\n"
        "• Xem danh sách thành viên\n"
        "• Thêm thành viên mới\n"
        "• Ghi nhận thu/chi\n"
        "• Báo cáo thu chi theo tháng\n"
        "• Kiểm tra ai chưa đóng phí\n\n"
        "Gõ /club để đổi CLB | /reset để xóa lịch sử",
        parse_mode="Markdown",
    )


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    text = update.message.text.strip()
    if not text:
        return

    # Đảm bảo đã chọn CLB
    club_id = await ensure_club_selected(update, user_id)
    if not club_id:
        return  # Đang hiển thị menu chọn CLB

    club_name = _user_club_name.get(user_id, "")
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")

    try:
        reply = await process_message(user_id, text, club_id, club_name)
    except Exception as e:
        logger.error(f"process_message error: {e}")
        reply = "❌ Đã xảy ra lỗi, vui lòng thử lại."

    await update.message.reply_text(reply)


def main():
    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("club", cmd_club))
    app.add_handler(CommandHandler("reset", cmd_reset))
    app.add_handler(CallbackQueryHandler(handle_club_selection, pattern=r"^select_club:"))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    logger.info("Bot đang chạy (Groq / Llama 3.3 70B — đa CLB)...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
