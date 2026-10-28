/**
 * InstallApp — "Cài đặt ứng dụng" cho trang public (2026-10-28, phương án A):
 *  - InstallButton: nút ở header, ẩn khi đã cài. Android/desktop có prompt → hộp thoại cài của máy; còn lại mở hướng dẫn.
 *  - InstallBanner: thanh mời lần đầu dưới thanh nhãn link; "Để sau" giấu 14 ngày (localStorage theo slug).
 *  - InstallGuide: Drawer hướng dẫn theo nền tảng (iOS 3 bước; Android menu ⋮; trong app Zalo/Messenger → mở bằng trình duyệt + sao chép link).
 * Dùng chung hook useInstallPrompt (truyền từ PublicReport để nút và thanh cùng trạng thái).
 */
import { useState } from "react";
import { Alert, Button, Drawer, Space, Typography, message } from "antd";
import { DownloadOutlined, ShareAltOutlined, MoreOutlined, CopyOutlined, CheckCircleOutlined, CloseOutlined } from "@ant-design/icons";
import { bannerKey, writeLS } from "../utils/install";

const { Text, Title } = Typography;

function Steps({ items }) {
  return <ol style={{ margin: "6px 0 0 18px", padding: 0, lineHeight: 1.8 }}>{items.map((t, i) => <li key={i}>{t}</li>)}</ol>;
}

export function InstallGuide({ open, onClose, platform, isMobileView }) {
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); message.success("Đã sao chép liên kết"); }
    catch { message.info(window.location.href); }
  };
  let content;
  if (platform === "in_app_browser") content = (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Alert type="warning" showIcon message="Bạn đang mở trong ứng dụng khác (Zalo, Messenger…)" description="Trình duyệt trong app không cài được và không nhận thông báo. Hãy mở liên kết bằng Safari (iPhone) hoặc Chrome (Android)." />
      <Steps items={["Bấm nút ⋯ hoặc biểu tượng trình duyệt ở góc màn hình, chọn \"Mở bằng trình duyệt\".", "Hoặc sao chép liên kết rồi dán vào Safari / Chrome."]} />
      <Button icon={<CopyOutlined />} onClick={copyLink}>Sao chép liên kết</Button>
    </Space>
  );
  else if (platform === "ios") content = (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Alert type="info" showIcon icon={<ShareAltOutlined />} message="Trên iPhone / iPad (Safari)" />
      <Steps items={[
        <>Bấm nút <b>Chia sẻ</b> <ShareAltOutlined /> ở thanh dưới của Safari.</>,
        <>Cuộn xuống, chọn <b>"Thêm vào MH chính"</b> rồi bấm <b>Thêm</b>.</>,
        <>Mở ứng dụng từ màn hình chính, bấm chuông <b>Thông báo</b> và <b>Bật thông báo</b>.</>,
      ]} />
      <Text type="secondary">Cần iOS 16.4 trở lên. Nếu không thấy mục này, bạn đang không dùng Safari.</Text>
    </Space>
  );
  else if (platform === "android_manual") content = (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Alert type="info" showIcon icon={<MoreOutlined />} message="Trên Android" />
      <Steps items={[<>Bấm menu <b>⋮</b> góc trên bên phải trình duyệt.</>, <>Chọn <b>"Cài đặt ứng dụng"</b> hoặc <b>"Thêm vào màn hình chính"</b>.</>, <>Mở ứng dụng từ màn hình chính và bật thông báo trong chuông.</>]} />
    </Space>
  );
  else content = (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Alert type="info" showIcon message="Trên máy tính" />
      <Steps items={[<>Bấm biểu tượng <b>cài đặt</b> ở cuối thanh địa chỉ (Chrome, Edge) hoặc menu trình duyệt.</>, "Chọn Cài đặt."]} />
    </Space>
  );
  return (
    <Drawer title="Cài đặt ứng dụng" open={open} onClose={onClose} placement={isMobileView ? "bottom" : "right"} height={isMobileView ? "70%" : undefined} width={400}>
      {content}
    </Drawer>
  );
}

export function InstallButton({ install, onGuide, dark = false }) {
  const { platform, installed, prompt } = install;
  if (platform === "installed") return null;
  const style = dark
    ? { border: "1px solid rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.85)", background: "rgba(255,255,255,0.08)" }
    : { border: "1px solid var(--line)", color: "var(--ink)", background: "var(--surface)" };
  if (installed) return <Button type="text" size="small" style={{ ...style, height: 28 }} icon={<CheckCircleOutlined style={{ color: "var(--ok)" }} />}>Đã cài</Button>;
  const onClick = async () => {
    if (platform === "prompt") {
      const outcome = await prompt();
      if (outcome === "accepted") message.success("Đã cài ứng dụng. Mở từ màn hình chính để bật thông báo.");
      return;
    }
    onGuide();
  };
  return <Button type="text" size="small" style={{ ...style, height: 28, padding: "0 10px" }} icon={<DownloadOutlined />} onClick={onClick}>Cài đặt ứng dụng</Button>;
}

export function InstallBanner({ install, slug, onGuide, onDismiss }) {
  const { platform, prompt } = install;
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const dismiss = () => { writeLS(bannerKey(slug), Date.now()); setHidden(true); onDismiss?.(); };
  const go = async () => {
    if (platform === "prompt") {
      const outcome = await prompt();
      if (outcome === "accepted") { message.success("Đã cài ứng dụng. Mở từ màn hình chính để bật thông báo."); setHidden(true); }
      return;
    }
    onGuide();
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", background: "var(--brand-soft)", borderBottom: "1px solid var(--brand-line)" }}>
      <DownloadOutlined style={{ color: "var(--brand-strong)", fontSize: 18 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Title level={5} style={{ margin: 0, fontSize: 14 }}>Cài đặt ứng dụng CLB</Title>
        <Text type="secondary" style={{ fontSize: 12 }}>Nhận lịch sinh hoạt và nhắc phí ngay trên điện thoại.</Text>
      </div>
      <Button type="primary" size="small" onClick={go}>Cài đặt</Button>
      <Button type="text" size="small" icon={<CloseOutlined />} aria-label="Để sau" onClick={dismiss} />
    </div>
  );
}
