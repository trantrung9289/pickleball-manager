/**
 * PushSettings — khối "Thông báo trên thiết bị" trong Drawer chuông trang public (2026-10-28).
 * Trạng thái: máy chủ chưa cấu hình / trình duyệt không hỗ trợ / iOS chưa thêm vào màn hình chính (hướng dẫn 3 bước) /
 * bị chặn quyền / sẵn sàng (nút Bật) / đã bật (nút Tắt). Đăng ký qua props.push (createPublicReportApi().push).
 */
import { useEffect, useState } from "react";
import { Alert, Button, Space, Typography, message } from "antd";
import { BellOutlined, CheckCircleOutlined, ShareAltOutlined } from "@ant-design/icons";
import { pushSupportState, readPushEnv, currentSubscription, subscribeBrowser, unsubscribeBrowser } from "../utils/webPush";

const { Text } = Typography;

export default function PushSettings({ push }) {
  const [cfg, setCfg] = useState(null);            // { enabled, public_key }
  const [subscribed, setSubscribed] = useState(null);   // null = đang kiểm tra
  const [busy, setBusy] = useState(false);
  const [env, setEnv] = useState(() => readPushEnv());
  const state = pushSupportState(env);

  useEffect(() => {
    push.config().then((r) => setCfg(r.data)).catch(() => setCfg({ enabled: false }));
    if (state === "ready") currentSubscription().then((s) => setSubscribed(!!s)).catch(() => setSubscribed(false));
    else Promise.resolve().then(() => setSubscribed(false));
  }, [push, state]);

  const enable = async () => {
    setBusy(true);
    try {
      const json = await subscribeBrowser(cfg.public_key);
      await push.subscribe({ endpoint: json.endpoint, keys: json.keys, user_agent: navigator.userAgent.slice(0, 300) });
      setSubscribed(true); setEnv(readPushEnv());
      message.success("Đã bật thông báo trên thiết bị này");
    } catch (err) {
      setEnv(readPushEnv());
      message.error(err?.response?.data?.detail || err?.message || "Không bật được thông báo");
    } finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true);
    try {
      const json = await unsubscribeBrowser();
      if (json?.endpoint) await push.unsubscribe({ endpoint: json.endpoint });
      setSubscribed(false);
      message.success("Đã tắt thông báo trên thiết bị này");
    } catch (err) { message.error(err?.message || "Không tắt được"); }
    finally { setBusy(false); }
  };

  let body;
  if (cfg && !cfg.enabled) body = <Text type="secondary">Máy chủ chưa bật thông báo đẩy.</Text>;
  else if (state === "ios_not_installed") body = (
    <Alert type="info" showIcon icon={<ShareAltOutlined />} message="Trên iPhone cần thêm trang này vào màn hình chính"
      description={<ol style={{ margin: "4px 0 0 16px", padding: 0 }}>
        <li>Mở trang này bằng Safari, bấm nút Chia sẻ.</li>
        <li>Chọn "Thêm vào MH chính" rồi bấm Thêm.</li>
        <li>Mở app từ màn hình chính và bật thông báo tại đây.</li>
      </ol>} />
  );
  else if (state === "unsupported") body = <Text type="secondary">Trình duyệt này không hỗ trợ thông báo đẩy.</Text>;
  else if (state === "denied") body = <Text type="secondary">Bạn đã chặn thông báo cho trang này. Mở cài đặt trình duyệt để cho phép lại.</Text>;
  else if (subscribed) body = (
    <Space>
      <Text><CheckCircleOutlined style={{ color: "var(--ok)" }} /> Đã bật trên thiết bị này</Text>
      <Button size="small" onClick={disable} loading={busy}>Tắt</Button>
    </Space>
  );
  else body = (
    <Space wrap>
      <Text type="secondary">Nhận lịch sinh hoạt và nhắc phí ngay cả khi không mở trang.</Text>
      <Button size="small" type="primary" icon={<BellOutlined />} onClick={enable} loading={busy} disabled={!cfg?.public_key}>Bật thông báo</Button>
    </Space>
  );

  return (
    <div style={{ padding: "10px 12px", marginBottom: 8, borderRadius: 10, background: "var(--brand-soft)", border: "1px solid var(--brand-line)" }}>
      <Text strong style={{ display: "block", marginBottom: 4 }}>Thông báo trên thiết bị</Text>
      {body}
    </div>
  );
}
