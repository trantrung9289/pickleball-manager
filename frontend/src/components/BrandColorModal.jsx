/**
 * BrandColorModal — club admin chọn MÀU THƯƠNG HIỆU của CLB (lớp 1 đổi giao diện 2026-10-26).
 * Màu chọn được áp ngay để xem thử (setBrandColor), Lưu → PUT /api/club/appearance; Huỷ → trả về màu đang lưu.
 * Hệ thống tự tối màu cho chữ trắng đủ tương phản và sinh bản nhạt làm nền chip (utils/color.js).
 * Props: { club, onSaved(), onClose() }
 */
import { useState } from "react";
import { Alert, Button, ColorPicker, Modal, Space, Tag, Typography, message } from "antd";
import { authApi } from "../api";
import { useAppTheme } from "../contexts/ThemeContext";
import { BRAND_PRESETS, DEFAULT_BRAND, brandPalette, contrast, isHex } from "../utils/color";

const { Text } = Typography;

export default function BrandColorModal({ club, onSaved, onClose }) {
  const { setBrandColor, themeConfig } = useAppTheme();
  const saved = club?.brand_color || null;
  const [value, setValue] = useState(saved || DEFAULT_BRAND);
  const [busy, setBusy] = useState(false);
  const preview = (hex) => { setValue(hex); setBrandColor(hex); };
  const cancel = () => { setBrandColor(saved); onClose(); };
  const save = async (hex) => {
    setBusy(true);
    try {
      await authApi.updateAppearance({ brand_color: hex });
      message.success(hex ? "Đã lưu màu thương hiệu" : "Đã về màu mặc định");
      await onSaved?.();
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không lưu được màu");
      setBrandColor(saved);
    } finally { setBusy(false); }
  };
  const p = brandPalette(value, themeConfig.dark);
  const ratio = contrast(p.brand, "#FFFFFF");
  return (
    <Modal open title="Màu thương hiệu CLB" onCancel={cancel} width={520}
      footer={
        <Space>
          <Button onClick={() => save(null)} disabled={busy || !saved}>Về mặc định</Button>
          <Button onClick={cancel} disabled={busy}>Huỷ</Button>
          <Button type="primary" loading={busy} disabled={!isHex(value)} onClick={() => save(value.toUpperCase())}>Lưu</Button>
        </Space>
      }>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Text type="secondary">Màu dùng cho nút chính, mục đang chọn, tab và chip của CLB <b>{club?.name}</b>. Đang xem thử ngay trên giao diện; bấm Lưu để áp dụng cho mọi người.</Text>
        <Space wrap size={8}>
          {BRAND_PRESETS.map((x) => (
            <Button key={x.value} size="small" onClick={() => preview(x.value)}
              style={{ borderColor: value.toUpperCase() === x.value ? x.value : undefined, fontWeight: value.toUpperCase() === x.value ? 700 : 400 }}>
              <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: x.value, marginRight: 6, verticalAlign: -1 }} />
              {x.label}
            </Button>
          ))}
        </Space>
        <Space>
          <ColorPicker value={value} format="hex" disabledAlpha onChangeComplete={(c) => preview(`#${c.toHex().slice(0, 6).toUpperCase()}`)} />
          <Text code>{value.toUpperCase()}</Text>
        </Space>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Button type="primary">Nút chính</Button>
          <Tag style={{ background: p.brandSoft, color: p.brandStrong, borderColor: p.brandLine }}>Chip nền nhạt</Tag>
          <span style={{ color: p.brandStrong, fontWeight: 600 }}>Chữ nhấn</span>
        </div>
        <Alert type={ratio >= 4.5 ? "success" : "warning"} showIcon
          message={ratio >= 4.5
            ? `Chữ trắng trên màu chính đạt tương phản ${ratio.toFixed(1)} (đạt chuẩn 4.5)`
            : "Màu quá sáng — hệ thống sẽ tự tối lại để chữ trắng đọc được"} />
      </Space>
    </Modal>
  );
}
