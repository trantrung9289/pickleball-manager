/**
 * Nút "Chia sẻ lên Zalo" (2026-10-30): đưa nội dung thông báo vào nhóm Zalo KHÔNG qua API (không vi phạm chính sách, 0đ).
 * - Có Web Share API (điện thoại): mở hộp chia sẻ hệ điều hành → chọn Zalo → chọn nhóm.
 * - Không có (desktop): sao chép vào clipboard, báo "dán vào nhóm Zalo".
 * Dùng cho admin (chuông, trang Thông báo); không hiển thị ở trang public.
 */
import { Button, Tooltip, message, Modal, Input } from "antd";
import { ShareAltOutlined } from "@ant-design/icons";

/** Sao chép: Clipboard API → execCommand (trình duyệt cũ / bị chặn) → false. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* thử cách cũ */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

export default function ShareZaloButton({ text, title, size = "small", type = "text" }) {
  const onClick = async (e) => {
    e?.stopPropagation?.();
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: title || "Thông báo", text });
        return;
      }
    } catch (err) {
      if (err?.name === "AbortError") return;   // người dùng huỷ hộp chia sẻ
    }
    if (await copyText(text)) {
      message.success("Đã sao chép nội dung. Mở nhóm Zalo và dán vào.");
      return;
    }
    // Không sao chép tự động được → hiện nội dung để người dùng tự chọn và sao chép
    Modal.info({
      title: "Nội dung chia sẻ",
      width: 520,
      okText: "Đóng",
      content: <Input.TextArea value={text} readOnly autoSize={{ minRows: 4, maxRows: 14 }} onFocus={(e) => e.target.select()} style={{ marginTop: 8 }} />,
    });
  };
  return (
    <Tooltip title="Chia sẻ lên Zalo (hoặc ứng dụng khác)">
      <Button size={size} type={type} icon={<ShareAltOutlined />} onClick={onClick} aria-label="Chia sẻ lên Zalo" />
    </Tooltip>
  );
}
