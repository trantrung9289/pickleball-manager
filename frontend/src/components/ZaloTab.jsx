/**
 * ZaloTab — "Zalo" trong Cài đặt CLB (2026-10-30): kết nối bot Zalo Bot Platform chính thức (miễn phí) và chọn nhóm nhận thông báo.
 * Luồng: chủ nhiệm tạo bot trong app Zalo (OA "Zalo Bot Manager" → Tạo bot) → dán token → thêm bot vào nhóm → @nhắc tên bot một lần
 * → hệ thống nhận diện nhóm (webhook; dev không có HTTPS thì bấm "Quét tin mới").
 * DUYỆT NHÓM: mọi thành viên trong nhóm có bot đều @nhắc được → nhóm mới vào "Chờ duyệt" (tắt, im lặng), chủ nhiệm Duyệt / Từ chối (chặn).
 * "Người được phép": @nhắc từ người này thì nhóm mới tự duyệt. Thêm bằng "Duyệt và tin cậy người này" hoặc nút khiên ở nhóm đã duyệt.
 * Token chỉ hiện 4 ký tự cuối; không bao giờ trả lại token đầy đủ.
 */
import { useEffect, useState } from "react";
import { Alert, Button, Input, List, Popconfirm, Space, Switch, Tag, Typography, message, Tooltip } from "antd";
import {
  ApiOutlined, DisconnectOutlined, ReloadOutlined, SendOutlined, DeleteOutlined, EditOutlined, CheckOutlined,
  SafetyCertificateOutlined, StopOutlined,
} from "@ant-design/icons";
import { zaloApi } from "../api";

const { Text, Paragraph } = Typography;

function GroupRow({ g, allowedIds, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(g.label || "");
  const [busy, setBusy] = useState(false);
  const run = async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (okMsg) message.success(okMsg); onChanged(r?.data); }
    catch (err) { message.error(err?.response?.data?.detail || "Thao tác thất bại"); }
    finally { setBusy(false); }
  };
  const trusted = !!g.added_by_id && allowedIds.has(g.added_by_id);
  const who = <span>Nhận diện qua tin của <b>{g.added_by || "?"}</b>{trusted ? " (được phép)" : ""}{g.first_text ? `: “${g.first_text}”` : ""} · mã {g.chat_id}</span>;

  if (g.status === "pending") {
    return (
      <List.Item
        actions={[
          <Button key="a" size="small" type="primary" icon={<CheckOutlined />} loading={busy} onClick={() => run(() => zaloApi.approveGroup(g.id), "Đã duyệt nhóm")}>Duyệt</Button>,
          g.added_by_id && (
            <Tooltip key="t" title="Duyệt và cho phép người này: nhóm họ thêm bot sau sẽ tự duyệt">
              <Button size="small" icon={<SafetyCertificateOutlined />} loading={busy} onClick={() => run(() => zaloApi.approveGroup(g.id, true), "Đã duyệt và tin cậy người này")}>Duyệt + tin cậy</Button>
            </Tooltip>
          ),
          <Popconfirm key="r" title="Từ chối và chặn nhóm này? Tin sau của nhóm sẽ bị bỏ qua." okText="Chặn" okButtonProps={{ danger: true }} cancelText="Huỷ"
            onConfirm={() => run(() => zaloApi.rejectGroup(g.id), "Đã chặn nhóm")}>
            <Button size="small" danger icon={<StopOutlined />}>Từ chối</Button>
          </Popconfirm>,
        ].filter(Boolean)}
      >
        <List.Item.Meta title={<Text strong>Nhóm chờ duyệt</Text>} description={<Text type="secondary" style={{ fontSize: 12 }}>{who}</Text>} />
      </List.Item>
    );
  }
  if (g.status === "blocked") {
    return (
      <List.Item actions={[
        <Popconfirm key="u" title="Bỏ chặn? Nhóm sẽ biến mất khỏi danh sách; lần @nhắc sau sẽ vào hàng chờ duyệt." okText="Bỏ chặn" cancelText="Huỷ"
          onConfirm={() => run(() => zaloApi.deleteGroup(g.id), "Đã bỏ chặn")}>
          <Button size="small" icon={<DeleteOutlined />} loading={busy}>Bỏ chặn</Button>
        </Popconfirm>,
      ]}>
        <List.Item.Meta title={<Space><Tag color="error">Đã chặn</Tag><Text type="secondary">{g.label || g.chat_id}</Text></Space>}
          description={<Text type="secondary" style={{ fontSize: 12 }}>{who}</Text>} />
      </List.Item>
    );
  }
  return (
    <List.Item
      actions={[
        <Tooltip key="t" title="Gửi tin thử vào nhóm"><Button size="small" icon={<SendOutlined />} loading={busy} onClick={() => run(() => zaloApi.testGroup(g.id), "Đã gửi tin thử")} /></Tooltip>,
        g.added_by_id && !trusted && (
          <Tooltip key="s" title={`Tin cậy ${g.added_by || "người này"}: nhóm họ thêm bot sau sẽ tự duyệt`}>
            <Button size="small" icon={<SafetyCertificateOutlined />} loading={busy} onClick={() => run(() => zaloApi.trustGroup(g.id), "Đã thêm vào danh sách được phép")} />
          </Tooltip>
        ),
        <Popconfirm key="d" title="Bỏ nhóm này khỏi danh sách nhận thông báo?" okText="Bỏ" cancelText="Huỷ" onConfirm={() => run(() => zaloApi.deleteGroup(g.id), "Đã bỏ nhóm")}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>,
      ].filter(Boolean)}
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
            {who}{g.last_sent_at ? ` · gửi gần nhất ${new Date(g.last_sent_at).toLocaleString("vi-VN")}` : ""}
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

  const load = () => zaloApi.status().then((r) => setSt(r.data)).catch(() => setSt({ connected: false, groups: [], allowed: [] }));
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
  const removeAllowed = async (a) => {
    try { const r = await zaloApi.deleteAllowed(a.id); setSt(r.data); message.success("Đã bỏ khỏi danh sách được phép"); }
    catch (err) { message.error(err?.response?.data?.detail || "Không bỏ được"); }
  };

  if (!st) return null;
  const groups = st.groups || [];
  const pending = groups.filter((g) => g.status === "pending");
  const approved = groups.filter((g) => g.status === "approved");
  const blocked = groups.filter((g) => g.status === "blocked");
  const allowed = st.allowed || [];
  const allowedIds = new Set(allowed.map((a) => a.sender_id));
  const onChanged = (d) => (d ? setSt(d) : load());

  return (
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <Alert type="info" showIcon message="Zalo Bot Platform chính thức, miễn phí"
        description={<span>Tạo bot trong app Zalo: tìm OA <b>Zalo Bot Manager</b> → <b>Tạo bot</b> (tên bắt đầu bằng “Bot”). Dán token Zalo gửi về vào ô dưới.
          Sau đó thêm bot vào nhóm Zalo của CLB và nhắc <b>@tên bot</b> một lần. <b>Mọi thành viên trong nhóm đều nhắc được bot</b>, nên nhóm mới luôn ở trạng thái <b>chờ duyệt</b> cho tới khi bạn bấm Duyệt.
          Người trong danh sách được phép thì nhóm tự duyệt.</span>} />

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
          <Popconfirm title="Ngắt kết nối bot và xoá danh sách nhóm, người được phép?" okText="Ngắt" okButtonProps={{ danger: true }} cancelText="Huỷ" onConfirm={disconnect}>
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

          {pending.length > 0 && (
            <div>
              <Alert type="warning" showIcon style={{ marginBottom: 8 }} message={`Có ${pending.length} nhóm đang chờ duyệt`}
                description="Các nhóm này chưa nhận thông báo. Chỉ duyệt nhóm của CLB bạn; nhóm lạ hãy Từ chối." />
              <List size="small" bordered dataSource={pending} rowKey="id" renderItem={(g) => <GroupRow g={g} allowedIds={allowedIds} onChanged={onChanged} />} />
            </div>
          )}

          <div>
            <Space style={{ marginBottom: 6 }}>
              <Text strong>Nhóm nhận thông báo ({approved.length})</Text>
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={load} />
            </Space>
            {approved.length === 0 ? (
              <Paragraph type="secondary" style={{ fontSize: 13 }}>Chưa có nhóm. Thêm bot <b>{st.bot_name}</b> vào nhóm Zalo rồi gửi một tin có @nhắc tên bot{st.webhook_ok ? "." : ", hoặc bấm “Quét tin mới” rồi @nhắc trong 25 giây."} Nhóm sẽ hiện ở mục chờ duyệt.</Paragraph>
            ) : (
              <List size="small" bordered dataSource={approved} rowKey="id" renderItem={(g) => <GroupRow g={g} allowedIds={allowedIds} onChanged={onChanged} />} />
            )}
          </div>

          <div>
            <Text strong>Người được phép tự thêm nhóm ({allowed.length})</Text>
            <div style={{ marginTop: 6 }}>
              {allowed.length === 0 ? (
                <Text type="secondary" style={{ fontSize: 13 }}>Chưa có ai. Dùng “Duyệt + tin cậy” ở một nhóm chờ duyệt, hoặc nút khiên ở nhóm đã duyệt, để cho phép người @nhắc bot.</Text>
              ) : (
                <Space wrap>
                  {allowed.map((a) => (
                    <Tag key={a.id} closable color="blue" onClose={(e) => { e.preventDefault(); removeAllowed(a); }}>{a.display_name || a.sender_id}</Tag>
                  ))}
                </Space>
              )}
            </div>
          </div>

          {blocked.length > 0 && (
            <div>
              <Text strong>Nhóm đã chặn ({blocked.length})</Text>
              <List size="small" bordered style={{ marginTop: 6 }} dataSource={blocked} rowKey="id" renderItem={(g) => <GroupRow g={g} allowedIds={allowedIds} onChanged={onChanged} />} />
            </div>
          )}
        </>
      )}
    </Space>
  );
}
