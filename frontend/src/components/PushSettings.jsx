/**
 * PushSettings — khối "Thông báo trên thiết bị" trong Drawer chuông trang public (2026-10-28).
 * Trạng thái: máy chủ chưa cấu hình / trình duyệt không hỗ trợ / iOS chưa thêm vào màn hình chính (hướng dẫn 3 bước) /
 * bị chặn quyền / sẵn sàng (nút Bật) / đã bật. Đăng ký qua props.push (createPublicReportApi().push).
 * 2026-10-30: thông báo nhắc nhở MẶC ĐỊNH BẬT và KHÔNG CÓ NÚT TẮT: hooks/useAutoPush (gắn ở PublicReport) tự đăng ký; khối này chỉ hiển thị
 * trạng thái, giữ nút "Bật thông báo" khi chưa bật và tự cập nhật khi nhận sự kiện PUSH_CHANGED_EVENT.
 * 2026-10-29: khi đã bật, hiện thêm khối RIÊNG "Thông báo trò chuyện" (tách khỏi nhắc nhở): chế độ Tất cả / Chỉ nhắc tên & bình chọn / Tắt,
 * giờ yên tĩnh theo thiết bị (mặc định 22h–7h). Lưu theo endpoint subscription của thiết bị.
 */
import { useEffect, useState } from "react";
import { Alert, Button, Select, Space, Switch, Typography, message } from "antd";
import { BellOutlined, CheckCircleOutlined, ShareAltOutlined, MessageOutlined } from "@ant-design/icons";
import { pushSupportState, readPushEnv, currentSubscription, subscribeBrowser, PUSH_CHANGED_EVENT } from "../utils/webPush";

const { Text } = Typography;

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, "0")}:00` }));

/** Khối "Thông báo trò chuyện" — tách riêng khỏi nhắc nhở; đọc/lưu tuỳ chọn theo endpoint subscription của thiết bị. */
function ChatPushPrefs({ push }) {
  const [prefs, setPrefs] = useState(null);
  const [endpoint, setEndpoint] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    currentSubscription().then((s) => {
      if (!s) return;
      setEndpoint(s.endpoint);
      return push.prefs(s.endpoint).then((r) => setPrefs(r.data));
    }).catch(() => {});
  }, [push]);
  if (!prefs) return null;
  const save = async (patch) => {
    setBusy(true);
    try { const r = await push.setPrefs({ endpoint, ...patch }); setPrefs(r.data); }
    catch (err) { message.error(err?.response?.data?.detail || "Không lưu được"); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ padding: "10px 12px", marginBottom: 8, borderRadius: 10, background: "var(--info-soft)", border: "1px solid var(--info)" }}>
      <Text strong style={{ display: "block", marginBottom: 6 }}><MessageOutlined /> Thông báo trò chuyện</Text>
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text>Nhận tin nhắn</Text>
          <Select size="small" value={prefs.chat_mode} disabled={busy} style={{ width: 210 }} onChange={(v) => save({ chat_mode: v })}
            options={[{ value: "all", label: "Tất cả tin nhắn" }, { value: "mentions", label: "Chỉ nhắc tên và bình chọn" }, { value: "off", label: "Tắt" }]} />
        </div>
        {prefs.chat_mode === "all" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Text>Giờ yên tĩnh (không đẩy tin thường)</Text>
              <Switch size="small" checked={prefs.quiet_enabled} disabled={busy} onChange={(v) => save({ quiet_enabled: v })} />
            </div>
            {prefs.quiet_enabled && (
              <Space size={6} wrap>
                <Text type="secondary">Từ</Text>
                <Select size="small" value={prefs.quiet_start} options={HOURS} style={{ width: 90 }} disabled={busy} onChange={(v) => save({ quiet_start: v })} />
                <Text type="secondary">đến</Text>
                <Select size="small" value={prefs.quiet_end} options={HOURS} style={{ width: 90 }} disabled={busy} onChange={(v) => save({ quiet_end: v })} />
              </Space>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>Nhắc tên và bình chọn vẫn báo trong giờ yên tĩnh. Nhắc phí, lịch sinh hoạt không bị ảnh hưởng.</Text>
          </>
        )}
      </Space>
    </div>
  );
}

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
  // useAutoPush vừa đăng ký xong (khi Drawer đang mở) → cập nhật trạng thái
  useEffect(() => {
    const refresh = () => { setEnv(readPushEnv()); currentSubscription().then((s) => setSubscribed(!!s)).catch(() => {}); };
    window.addEventListener(PUSH_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PUSH_CHANGED_EVENT, refresh);
  }, []);

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
  else if (state === "denied") body = <Text type="secondary">Thông báo đang bị chặn cho trang này. Mở cài đặt trình duyệt (hoặc điện thoại) để cho phép lại, thông báo sẽ tự bật.</Text>;
  else if (subscribed) body = (
    <Space direction="vertical" size={2}>
      <Text><CheckCircleOutlined style={{ color: "var(--ok)" }} /> Đã bật trên thiết bị này</Text>
      <Text type="secondary" style={{ fontSize: 12 }}>Thông báo nhắc nhở luôn bật để không bỏ lỡ lịch sinh hoạt và nhắc phí.</Text>
    </Space>
  );
  else body = (
    <Space wrap>
      <Text type="secondary">Thông báo được bật mặc định để không bỏ lỡ lịch sinh hoạt và nhắc phí, kể cả khi không mở trang.</Text>
      <Button size="small" type="primary" icon={<BellOutlined />} onClick={enable} loading={busy} disabled={!cfg?.public_key}>Bật thông báo</Button>
    </Space>
  );

  return (
    <>
      <div style={{ padding: "10px 12px", marginBottom: 8, borderRadius: 10, background: "var(--brand-soft)", border: "1px solid var(--brand-line)" }}>
        <Text strong style={{ display: "block", marginBottom: 4 }}>Thông báo nhắc nhở trên thiết bị</Text>
        {body}
      </div>
      {subscribed && cfg?.enabled && <ChatPushPrefs push={push} />}
    </>
  );
}
