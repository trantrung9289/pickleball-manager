/**
 * ZaloTab — "Zalo" trong Cài đặt CLB (2026-10-30): kết nối bot Zalo Bot Platform chính thức (miễn phí) và chọn nhóm nhận thông báo.
 * Luồng: chủ nhiệm tạo bot trong app Zalo (OA "Zalo Bot Manager" → Tạo bot) → dán token → thêm bot vào nhóm → @nhắc tên bot một lần
 * → hệ thống nhận diện nhóm (webhook; dev không có HTTPS thì bấm "Quét tin mới") → đặt nhãn, bật/tắt, gửi thử.
 * Token chỉ hiện 4 ký tự cuối; không bao giờ trả lại token đầy đủ.
 */
import { useEffect, useState } from "react";
import { Alert, Button, Input, List, Popconfirm, Space, Switch, Tag, Typography, message, Tooltip } from "antd";
import { ApiOutlined, DisconnectOutlined, ReloadOutlined, SendOutlined, DeleteOutlined, EditOutlined, CheckOutlined } from "@ant-design/icons";
import { zaloApi } from "../api";

const { Text, Paragraph } = Typography;

function GroupRow({ g, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(g.label || "");
  const [busy, setBusy] = useState(false);
  const run = async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (okMsg) message.success(okMsg); onChanged(r?.data); }
    catch (err) { message.error(err?.response?.data?.detail || "Thao tác thất bại"); }
    finally { setBusy(false); }
  };
  return (
    <List.Item
      actions={[
        <Tooltip key="t" title="Gửi tin thử vào nhóm"><Button size="small" icon={<SendOutlined />} loading={busy} onClick={() => run(() => zaloApi.testGroup(g.id), "Đã gửi tin thử")} /></Tooltip>,
        <Popconfirm key="d" title="Bỏ nhóm này khỏi danh sách nhận thông báo?" okText="Bỏ" cancelText="Huỷ" onConfirm={() => run(() => zaloApi.deleteGroup(g.id), "Đã bỏ nhóm")}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>,
      ]}
    >
      <List.Item.Meta
        title={
          <Space wrap>
            {editing ? (
              <Space.Compact>
                <Input size="small" autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Tên nhóm (tự đặt)" maxLength={200} style={{ width: 220 }}
                  onPressEnter={() => run(() => zaloApi.patchGroup(g.id, { label }), "Đã lưu tên").then(() => setEditing(false))} />
                <Button size="small" icon={<CheckOutlined />} onClick={() => run(() => zaloApi.patchGroup(g.id, { label }), "Đã lưu tên").then(() => setEditing(false))} />
              </Space.Compact>
            ) : (
              <>
                <Text strong>{g.label || "Nhóm chưa đặt tên"}</Text>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(true)} />
              </>
            )}
            <Switch size="small" checked={g.enabled} loading={busy} checkedChildren="Nhận" unCheckedChildren="Tắt"
              onChange={(c) => run(() => zaloApi.patchGroup(g.id, { enabled: c }))} />
            {g.last_error && <Tag color="error">Lỗi gần nhất: {g.last_error}</Tag>}
          </Space>
        }
        description={
          <Text type="secondary" style={{ fontSize: 12 }}>
            Nhận diện qua tin của <b>{g.added_by || "?"}</b>{g.first_text ? `: “${g.first_text}”` : ""} · mã {g.chat_id}
            {g.last_sent_at ? ` · gửi gần nhất ${new Date(g.last_sent_at).toLocaleString("vi-VN")}` : ""}
          </Text>
        }
      />
    </List.Item>
  );
}

export default function ZaloTab() {
  const [st, setSt] = useState(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);

  const load = () => zaloApi.status().then((r) => setSt(r.data)).catch(() => setSt({ connected: false, groups: [] }));
  useEffect(() => { load(); }, []);

  const connect = async () => {
    if (!token.trim()) { message.error("Dán token bot Zalo"); return; }
    setBusy(true);
    try {
      const r = await zaloApi.setToken(token.trim());
      setSt(r.data); setToken("");
      if (r.data.warning) message.warning(r.data.warning, 8); else message.success(`Đã kết nối ${r.data.bot_name}`);
    } catch (err) { message.error(err?.response?.data?.detail || "Không kết nối được"); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true);
    try { const r = await zaloApi.disconnect(); setSt(r.data); message.success("Đã ngắt kết nối Zalo"); }
    catch (err) { message.error(err?.response?.data?.detail || "Không ngắt được"); }
    finally { setBusy(false); }
  };
  const poll = async () => {
    setPolling(true);
    message.info("Đang chờ 25 giây — hãy gửi tin có @nhắc tên bot trong nhóm Zalo NGAY BÂY GIỜ.", 6);
    try { const r = await zaloApi.poll(); setSt(r.data); message[r.data.groups_seen ? "success" : "warning"](r.data.groups_seen ? `Đã nhận diện ${r.data.groups_seen} nhóm` : "Không thấy tin nào trong lúc quét. Bấm Quét rồi @nhắc tên bot trong vòng 25 giây."); }
    catch (err) { message.error(err?.response?.data?.detail || "Quét thất bại"); }
    finally { setPolling(false); }
  };

  if (!st) return null;
  return (
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <Alert type="info" showIcon message="Zalo Bot Platform chính thức, miễn phí"
        description={<span>Tạo bot trong app Zalo: tìm OA <b>Zalo Bot Manager</b> → <b>Tạo bot</b> (tên bắt đầu bằng “Bot”). Dán token Zalo gửi về vào ô dưới.
          Sau đó thêm bot vào nhóm Zalo của CLB và nhắc <b>@tên bot</b> một lần để hệ thống nhận diện nhóm. Thông báo nhắc nhở sẽ gửi vào các nhóm đang bật theo giờ đẩy của từng quy tắc.</span>} />

      {!st.connected ? (
        <Space.Compact style={{ width: "100%" }}>
          <Input.Password value={token} onChange={(e) => setToken(e.target.value)} placeholder="Dán Bot Token (dạng 123456789:abc…)" onPressEnter={connect} />
          <Button type="primary" icon={<ApiOutlined />} loading={busy} onClick={connect}>Kết nối</Button>
        </Space.Compact>
      ) : (
        <Space wrap>
          <Tag color="success">Đã kết nối: {st.bot_name} ({st.token_tail})</Tag>
          <Tag color={st.webhook_ok ? "processing" : "warning"}>{st.webhook_ok ? "Nhận tin tự động (webhook)" : "Webhook chưa đăng ký được"}</Tag>
          {!st.webhook_ok && <Button size="small" icon={<ReloadOutlined />} loading={polling} onClick={poll}>{polling ? "Đang chờ tin @nhắc…" : "Quét tin mới (25 giây)"}</Button>}
          <Popconfirm title="Ngắt kết nối bot và xoá danh sách nhóm?" okText="Ngắt" okButtonProps={{ danger: true }} cancelText="Huỷ" onConfirm={disconnect}>
            <Button size="small" danger icon={<DisconnectOutlined />} loading={busy}>Ngắt kết nối</Button>
          </Popconfirm>
        </Space>
      )}
      {st.token_stored && !st.connected && <Alert type="warning" showIcon message="Token đã lưu nhưng không giải mã được (máy chủ đổi khoá). Dán lại token." />}

      {st.connected && (
        <>
          <Space>
            <Switch checked={st.show_unpaid_names} onChange={async (c) => { try { const r = await zaloApi.setSettings({ show_unpaid_names: c }); setSt(r.data); } catch { message.error("Không lưu được"); } }} />
            <Text>Tin nhắc phí liệt kê tên người chưa đóng (không kèm số điện thoại)</Text>
          </Space>
          <div>
            <Space style={{ marginBottom: 6 }}>
              <Text strong>Nhóm nhận thông báo ({st.groups.length})</Text>
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={load} />
            </Space>
            {st.groups.length === 0 ? (
              <Paragraph type="secondary" style={{ fontSize: 13 }}>Chưa có nhóm. Thêm bot <b>{st.bot_name}</b> vào nhóm Zalo rồi gửi một tin có @nhắc tên bot{st.webhook_ok ? "." : ", hoặc bấm “Quét tin mới” rồi @nhắc trong 25 giây."}</Paragraph>
            ) : (
              <List size="small" bordered dataSource={st.groups} rowKey="id" renderItem={(g) => <GroupRow g={g} onChanged={(d) => (d ? setSt(d) : load())} />} />
            )}
          </div>
        </>
      )}
    </Space>
  );
}
