"""
Telegram Bot cho CLB Pickleball — tích hợp Claude API với Tool Use.
Chạy độc lập bên cạnh backend FastAPI.
"""
import asyncio
import json
import logging
import os
from datetime import datetime

import httpx
from anthropic import Anthropic
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Cấu hình ──────────────────────────────────────────────────────────────────
TELEGRAM_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")
BOT_USERNAME = os.environ["BOT_USERNAME"]    # Username tài khoản bot trong hệ thống
BOT_PASSWORD = os.environ["BOT_PASSWORD"]    # Password tài khoản bot
BOT_CLUB_ID = os.environ.get("BOT_CLUB_ID", "1")

anthropic = Anthropic(api_key=ANTHROPIC_API_KEY)

# ── JWT tự động refresh ───────────────────────────────────────────────────────
_jwt_token: str | None = None
_jwt_expires_at: float = 0


async def get_jwt_token() -> str:
    """Lấy JWT token, tự đăng nhập lại nếu hết hạn."""
    import time
    global _jwt_token, _jwt_expires_at

    if _jwt_token and time.time() < _jwt_expires_at - 3600:  # còn hơn 1 giờ
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
        _jwt_expires_at = time.time() + 6 * 24 * 3600  # refresh sau 6 ngày
        logger.info("Bot đăng nhập thành công")
        return _jwt_token


# ── HTTP client gọi backend ───────────────────────────────────────────────────
async def backend_headers() -> dict:
    token = await get_jwt_token()
    return {
        "Authorization": f"Bearer {token}",
        "X-Club-ID": BOT_CLUB_ID,
    }


async def call_backend(method: str, path: str, **kwargs) -> dict:
    """Gọi backend API, trả về dict kết quả hoặc raise với message lỗi."""
    url = f"{BACKEND_URL}{path}"
    headers = await backend_headers()
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


# ── Tool definitions cho Claude ───────────────────────────────────────────────
TOOLS = [
    {
        "name": "get_overview",
        "description": "Lấy tổng quan CLB: số thành viên, tổng thu, tổng chi, số dư.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "list_members",
        "description": "Xem danh sách thành viên. Có thể lọc theo trạng thái.",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["active", "inactive"], "description": "Lọc theo trạng thái (bỏ trống = tất cả)"},
                "search": {"type": "string", "description": "Tìm theo tên hoặc mã thành viên"},
            },
        },
    },
    {
        "name": "add_member",
        "description": "Thêm thành viên mới vào CLB.",
        "input_schema": {
            "type": "object",
            "properties": {
                "full_name": {"type": "string", "description": "Họ và tên"},
                "phone": {"type": "string", "description": "Số điện thoại"},
                "email": {"type": "string", "description": "Email (tuỳ chọn)"},
                "rank": {"type": "string", "description": "Hạng: beginner, intermediate, advanced, pro"},
                "join_date": {"type": "string", "description": "Ngày tham gia YYYY-MM-DD (mặc định hôm nay)"},
            },
            "required": ["full_name"],
        },
    },
    {
        "name": "list_fee_types",
        "description": "Xem danh mục khoản thu/chi.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "record_transaction",
        "description": "Ghi nhận giao dịch thu hoặc chi.",
        "input_schema": {
            "type": "object",
            "properties": {
                "fee_type_name": {"type": "string", "description": "Tên khoản thu/chi (phải khớp với danh mục)"},
                "amount": {"type": "number", "description": "Số tiền (VNĐ)"},
                "member_name": {"type": "string", "description": "Tên thành viên (nếu là khoản thu từ thành viên)"},
                "transaction_date": {"type": "string", "description": "Ngày giao dịch YYYY-MM-DD (mặc định hôm nay)"},
                "payment_method": {"type": "string", "description": "Phương thức: Tiền mặt, Chuyển khoản, Momo"},
                "description": {"type": "string", "description": "Ghi chú thêm"},
            },
            "required": ["fee_type_name", "amount"],
        },
    },
    {
        "name": "get_monthly_report",
        "description": "Báo cáo thu chi theo tháng.",
        "input_schema": {
            "type": "object",
            "properties": {
                "month": {"type": "integer", "description": "Tháng (1-12)"},
                "year": {"type": "integer", "description": "Năm"},
            },
            "required": ["month", "year"],
        },
    },
    {
        "name": "get_fee_status",
        "description": "Kiểm tra trạng thái đóng phí của thành viên trong tháng.",
        "input_schema": {
            "type": "object",
            "properties": {
                "month": {"type": "integer", "description": "Tháng"},
                "year": {"type": "integer", "description": "Năm"},
                "fee_type_name": {"type": "string", "description": "Tên loại phí (tuỳ chọn)"},
            },
            "required": ["month", "year"],
        },
    },
    {
        "name": "list_transactions",
        "description": "Xem danh sách giao dịch, có thể lọc theo tháng/năm.",
        "input_schema": {
            "type": "object",
            "properties": {
                "month": {"type": "integer"},
                "year": {"type": "integer"},
                "type": {"type": "string", "enum": ["income", "expense"]},
            },
        },
    },
]


# ── Tool executor ─────────────────────────────────────────────────────────────
async def execute_tool(name: str, inputs: dict) -> str:
    try:
        if name == "get_overview":
            data = await call_backend("get", "/api/reports/overview")
            return (
                f"📊 Tổng quan CLB:\n"
                f"• Thành viên: {data['total_members']} (hoạt động: {data['active_members']})\n"
                f"• Tổng thu: {fmt_money(data['total_income'])}\n"
                f"• Tổng chi: {fmt_money(data['total_expense'])}\n"
                f"• Số dư: {fmt_money(data['balance'])}"
            )

        elif name == "list_members":
            params = {}
            if inputs.get("status"):
                params["status"] = inputs["status"]
            if inputs.get("search"):
                params["search"] = inputs["search"]
            members = await call_backend("get", "/api/members", params=params)
            if not members:
                return "Không có thành viên nào."
            lines = [f"👥 Danh sách thành viên ({len(members)} người):"]
            for m in members[:20]:
                status_icon = "✅" if m["status"] == "active" else "⏸"
                lines.append(f"{status_icon} {m['member_code']} — {m['full_name']}" +
                             (f" ({m['phone']})" if m.get("phone") else ""))
            if len(members) > 20:
                lines.append(f"... và {len(members)-20} người khác")
            return "\n".join(lines)

        elif name == "add_member":
            payload = {
                "full_name": inputs["full_name"],
                "status": "active",
                "join_date": inputs.get("join_date") or datetime.now().strftime("%Y-%m-%d"),
            }
            if inputs.get("phone"):
                payload["phone"] = inputs["phone"]
            if inputs.get("email"):
                payload["email"] = inputs["email"]
            if inputs.get("rank"):
                payload["rank"] = inputs["rank"]
            member = await call_backend("post", "/api/members", json=payload)
            return (
                f"✅ Đã thêm thành viên:\n"
                f"• Mã: {member['member_code']}\n"
                f"• Tên: {member['full_name']}\n"
                f"• SĐT: {member.get('phone', '—')}\n"
                f"• Ngày tham gia: {member['join_date']}"
            )

        elif name == "list_fee_types":
            fee_types = await call_backend("get", "/api/fee-types")
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
            # Tìm fee_type_id từ tên
            fee_types = await call_backend("get", "/api/fee-types")
            fee_type = next(
                (f for f in fee_types if inputs["fee_type_name"].lower() in f["name"].lower()),
                None
            )
            if not fee_type:
                names = ", ".join(f["name"] for f in fee_types)
                return f"❌ Không tìm thấy khoản '{inputs['fee_type_name']}'. Các khoản hiện có: {names}"

            payload = {
                "fee_type_id": fee_type["id"],
                "amount": inputs["amount"],
                "type": fee_type["type"],
                "transaction_date": inputs.get("transaction_date") or datetime.now().strftime("%Y-%m-%d"),
                "payment_method": inputs.get("payment_method", "Tiền mặt"),
                "description": inputs.get("description", ""),
            }

            # Tìm member_id nếu có tên thành viên
            if inputs.get("member_name"):
                members = await call_backend("get", "/api/members", params={"search": inputs["member_name"]})
                if members:
                    payload["member_id"] = members[0]["id"]

            tx = await call_backend("post", "/api/transactions", json=payload)
            type_label = "thu" if tx["type"] == "income" else "chi"
            return (
                f"✅ Đã ghi nhận giao dịch:\n"
                f"• Loại: {type_label.upper()}\n"
                f"• Khoản: {fee_type['name']}\n"
                f"• Số tiền: {fmt_money(tx['amount'])}\n"
                f"• Ngày: {tx['transaction_date']}\n"
                f"• PT: {tx.get('payment_method', 'Tiền mặt')}"
            )

        elif name == "get_monthly_report":
            data = await call_backend(
                "get", "/api/reports/monthly-detail",
                params={"month": inputs["month"], "year": inputs["year"]}
            )
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
            params = {"month": inputs["month"], "year": inputs["year"]}
            data = await call_backend("get", "/api/reports/fee-status", params=params)
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
            params = {}
            if inputs.get("month"):
                params["month"] = inputs["month"]
            if inputs.get("year"):
                params["year"] = inputs["year"]
            if inputs.get("type"):
                params["type"] = inputs["type"]
            txs = await call_backend("get", "/api/transactions", params=params)
            if not txs:
                return "Không có giao dịch nào."
            total_income = sum(float(t["amount"]) for t in txs if t["type"] == "income")
            total_expense = sum(float(t["amount"]) for t in txs if t["type"] == "expense")
            lines = [f"💳 {len(txs)} giao dịch | Thu: {fmt_money(total_income)} | Chi: {fmt_money(total_expense)}"]
            for t in txs[:15]:
                icon = "💚" if t["type"] == "income" else "🔴"
                fee_name = t.get("fee_type", {}).get("name", "?") if isinstance(t.get("fee_type"), dict) else "?"
                member = t.get("member", {})
                member_name = member.get("full_name", "") if isinstance(member, dict) else ""
                lines.append(
                    f"{icon} {t['transaction_date']} — {fee_name}: {fmt_money(t['amount'])}"
                    + (f" ({member_name})" if member_name else "")
                )
            if len(txs) > 15:
                lines.append(f"... và {len(txs)-15} giao dịch khác")
            return "\n".join(lines)

        else:
            return f"Tool '{name}' chưa được hỗ trợ."

    except ValueError as e:
        return f"❌ {e}"
    except Exception as e:
        logger.error(f"Tool {name} error: {e}")
        return f"❌ Lỗi hệ thống: {e}"


def fmt_money(amount) -> str:
    try:
        return f"{int(float(amount)):,}đ".replace(",", ".")
    except Exception:
        return str(amount)


# ── Conversation history (per user) ──────────────────────────────────────────
# Giữ tối đa 20 tin nhắn gần nhất mỗi user
_history: dict[int, list] = {}
MAX_HISTORY = 20

SYSTEM_PROMPT = f"""Bạn là trợ lý quản lý CLB Pickleball.
Ngày hôm nay: {datetime.now().strftime("%d/%m/%Y")}.
Trả lời bằng tiếng Việt, ngắn gọn, rõ ràng.
Khi cần thông tin từ hệ thống, hãy dùng tool được cung cấp.
Với các thao tác thêm/sửa/xóa, luôn xác nhận rõ thông tin trước khi thực hiện.
Định dạng số tiền bằng VNĐ (ví dụ: 500.000đ).
"""


async def process_message(user_id: int, user_text: str) -> str:
    """Gửi tin nhắn qua Claude với Tool Use, trả về response cuối."""
    history = _history.setdefault(user_id, [])
    history.append({"role": "user", "content": user_text})

    messages = history[-MAX_HISTORY:]

    # Agentic loop — Claude có thể gọi nhiều tool
    for _ in range(10):  # tối đa 10 vòng tool call
        response = anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        # Nếu Claude muốn gọi tool
        if response.stop_reason == "tool_use":
            # Thêm response của Claude vào history
            messages.append({"role": "assistant", "content": response.content})

            # Thực thi tất cả tool call song song
            tool_results = []
            tool_calls = [b for b in response.content if b.type == "tool_use"]
            results = await asyncio.gather(*[execute_tool(tc.name, tc.input) for tc in tool_calls])

            for tc, result in zip(tool_calls, results):
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tc.id,
                    "content": result,
                })

            messages.append({"role": "user", "content": tool_results})

        else:
            # Claude đã trả lời xong
            final_text = "".join(
                b.text for b in response.content if hasattr(b, "text")
            )
            # Lưu vào history
            history.append({"role": "assistant", "content": final_text})
            # Giới hạn kích thước history
            if len(history) > MAX_HISTORY:
                _history[user_id] = history[-MAX_HISTORY:]
            return final_text

    return "❌ Quá nhiều bước xử lý, vui lòng thử lại."


# ── Telegram handlers ─────────────────────────────────────────────────────────
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "👋 Xin chào! Tôi là bot quản lý CLB Pickleball.\n\n"
        "Bạn có thể hỏi tôi:\n"
        "• Xem danh sách thành viên\n"
        "• Thêm thành viên mới\n"
        "• Ghi nhận thu/chi\n"
        "• Báo cáo thu chi theo tháng\n"
        "• Kiểm tra ai chưa đóng phí\n\n"
        "Gõ /reset để xóa lịch sử hội thoại."
    )


async def cmd_reset(update: Update, context: ContextTypes.DEFAULT_TYPE):
    _history.pop(update.effective_user.id, None)
    await update.message.reply_text("🔄 Đã xóa lịch sử hội thoại.")


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    text = update.message.text.strip()
    if not text:
        return

    # Hiển thị "đang gõ..."
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")

    try:
        reply = await process_message(user_id, text)
    except Exception as e:
        logger.error(f"process_message error: {e}")
        reply = "❌ Đã xảy ra lỗi, vui lòng thử lại."

    await update.message.reply_text(reply)


def main():
    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("reset", cmd_reset))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    logger.info("Bot đang chạy...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
