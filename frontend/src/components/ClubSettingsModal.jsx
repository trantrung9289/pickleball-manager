/**
 * ClubSettingsModal — "Cài đặt CLB" cho club admin (2026-10-28, trước là BrandColorModal): 2 mục
 *  - Logo: tải ảnh (PNG/JPEG/WebP ≤ 5MB) → backend thu nhỏ ≤512px, lưu trong DB; xem trước; xoá.
 *  - Màu thương hiệu (lớp 1 đổi giao diện 2026-10-26): chọn màu, xem thử ngay (setBrandColor), Lưu → PUT /api/club/appearance.
 * Props: { club, onSaved(), onClose(), initialTab? }
 */
import { useState } from "react";
import { Alert, Button, ColorPicker, Modal, Space, Tabs, Tag, Typography, Upload, message, Popconfirm } from "antd";
import { UploadOutlined, DeleteOutlined, PictureOutlined, BgColorsOutlined } from "@ant-design/icons";
import { authApi, logoSrc } from "../api";
import { useAppTheme } from "../contexts/ThemeContext";
import { BRAND_PRESETS, DEFAULT_BRAND, brandPalette, contrast, isHex } from "../utils/color";

const { Text } = Typography;

function LogoTab({ club, onSaved }) {
  const [busy, setBusy] = useState(false);
  const src = logoSrc(club?.logo_src);
  const upload = async (file) => {
    setBusy(true);
    try {
      await authApi.uploadLogo(file);
      message.success("Đã cập nhật logo");
      await onSaved?.();
    } catch (err) { message.error(err?.response?.data?.detail || "Không tải được logo"); }
    finally { setBusy(false); }
    return false;   // không để antd tự upload
  };
  const remove = async () => {
    setBusy(true);
    try { await authApi.deleteLogo(); message.success("Đã xoá logo"); await onSaved?.(); }
    catch (err) { message.error(err?.response?.data?.detail || "Không xoá được logo"); }
    finally { setBusy(false); }
  };
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Text type="secondary">Logo hiện ở thanh bên, trang public, màn chọn CLB và bản in. Ảnh PNG/JPEG/WebP tối đa 5MB; hệ thống tự thu nhỏ về tối đa 512px, nên dùng ảnh vuông, nền trong suốt.</Text>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 96, height: 96, borderRadius: 16, border: "1px dashed var(--line)", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {src ? <img src={src} alt="Logo CLB" style={{ maxWidth: "100%", maxHeight: "100%" }} /> : <PictureOutlined style={{ fontSize: 32, color: "var(--muted)" }} />}
        </div>
        <Space direction="vertical">
          <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} beforeUpload={upload} disabled={busy}>
            <Button icon={<UploadOutlined />} loading={busy} type="primary">{src ? "Đổi logo" : "Tải logo lên"}</Button>
          </Upload>
          {src && (
            <Popconfirm title="Xoá logo CLB?" okText="Xoá" cancelText="Huỷ" okButtonProps={{ danger: true }} onConfirm={remove}>
              <Button icon={<DeleteOutlined />} danger disabled={busy}>Xoá logo</Button>
            </Popconfirm>
          )}
        </Space>
      </div>
    </Space>
  );
}

function BrandTab({ club, value, setValue, saved }) {
  const { setBrandColor, themeConfig } = useAppTheme();
  const preview = (hex) => { setValue(hex); setBrandColor(hex); };
  const p = brandPalette(value, themeConfig.dark);
  const ratio = contrast(p.brand, "#FFFFFF");
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Text type="secondary">Màu dùng cho nút chính, mục đang chọn, tab và chip của CLB <b>{club?.name}</b>. Đang xem thử ngay trên giao diện; bấm Lưu màu để áp dụng cho mọi người.{saved ? "" : " Đang dùng màu mặc định."}</Text>
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
  );
}

export default function ClubSettingsModal({ club, onSaved, onClose, initialTab = "logo" }) {
  const { setBrandColor } = useAppTheme();
  const saved = club?.brand_color || null;
  const [tab, setTab] = useState(initialTab);
  const [value, setValue] = useState(saved || DEFAULT_BRAND);
  const [busy, setBusy] = useState(false);
  const cancel = () => { setBrandColor(saved); onClose(); };
  const saveColor = async (hex) => {
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
  const footer = tab === "brand" ? (
    <Space>
      <Button onClick={() => saveColor(null)} disabled={busy || !saved}>Về mặc định</Button>
      <Button onClick={cancel} disabled={busy}>Huỷ</Button>
      <Button type="primary" loading={busy} disabled={!isHex(value)} onClick={() => saveColor(value.toUpperCase())}>Lưu màu</Button>
    </Space>
  ) : <Button onClick={cancel}>Đóng</Button>;
  return (
    <Modal open title="Cài đặt CLB" onCancel={cancel} width={560} footer={footer}>
      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: "logo", label: <span><PictureOutlined /> Logo</span>, children: <LogoTab club={club} onSaved={onSaved} /> },
        { key: "brand", label: <span><BgColorsOutlined /> Màu thương hiệu</span>, children: <BrandTab club={club} value={value} setValue={setValue} saved={saved} /> },
      ]} />
    </Modal>
  );
}
