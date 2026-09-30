import { useEffect, useMemo, useState } from "react";
import {
  Alert, Badge, Button, Card, Checkbox, Empty, Form, Input, Modal, Select, Space, Tabs, Tag, Typography, message,
} from "antd";
import { PlusOutlined, UserAddOutlined, UserOutlined } from "@ant-design/icons";
import { membersApi, playersApi, tournamentsApi } from "../api";
import ResponsiveTable from "./ResponsiveTable";
import { useRankLevels } from "../hooks/useRankLevels";

const { Text } = Typography;

const MEMBER_STATUS_MAP = {
  active: { label: "Hoạt động", color: "success" },
  inactive: { label: "Tạm nghỉ", color: "warning" },
  suspended: { label: "Đình chỉ", color: "error" },
};

/** Form nhỏ tạo khách mời nhanh (dùng trong AddParticipantsModal & ReplaceParticipantModal) — hạng từ cấu hình CLB. */
export function QuickGuestForm({ form, loading, onAdd, title = "Tạo khách mời mới" }) {
  const { options: rankOptions, unranked } = useRankLevels();
  return (
    <Card size="small" style={{ marginBottom: 12, background: "#fafafa" }}
      title={<span style={{ fontSize: 13 }}>{title}</span>}>
      <Form form={form} layout="inline" style={{ flexWrap: "wrap", gap: 8 }}>
        <Form.Item name="name" rules={[{ required: true, message: "Nhập tên" }]} style={{ marginBottom: 8 }}>
          <Input placeholder="Họ và tên *" style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="phone" style={{ marginBottom: 8 }}>
          <Input placeholder="Số điện thoại" style={{ width: 130 }} />
        </Form.Item>
        <Form.Item name="rank" initialValue={unranked} style={{ marginBottom: 8 }}>
          <Select style={{ width: 150 }} placeholder="Chọn hạng" showSearch
            options={rankOptions.map((r) => ({ value: r, label: r }))} />
        </Form.Item>
        <Form.Item style={{ marginBottom: 8 }}>
          <Button type="primary" icon={<PlusOutlined />} loading={loading} onClick={onAdd}>Thêm</Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

// ── Thêm người chơi hàng loạt vào giải Nháp (thành viên + khách mời) ──
// Chuyển từ bước "Chọn người chơi" của wizard cũ: tabs, checkbox list, tìm kiếm, chọn tất cả, tạo khách mời nhanh.
/**
 * Props: { tournament: {participants, team_type?}, onAdded(entity), onClose }
 *  - title / inLabel: chữ hiển thị (mặc định cho giải đấu);
 *  - submitFn(memberIds, playerIds) → Promise<axios response> (mặc định: thêm vào giải đấu);
 *  - entityKey: khoá chứa bản ghi mới trong res.data ("tournament" cho giải, "event" cho sự kiện thành tích).
 * Dùng chung cho giải đấu và sự kiện thành tích cá nhân (PointEventDetail).
 */
export function AddParticipantsModal({
  tournament, onAdded, onClose,
  title = "Thêm người chơi vào giải", inLabel = "Đã trong giải", entityKey = "tournament", submitFn,
}) {
  const [allMembers, setAllMembers] = useState([]);
  const [allGuests, setAllGuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);           // member IDs
  const [selectedGuestIds, setSelectedGuestIds] = useState([]); // player IDs (khách mời)
  const [memberSearch, setMemberSearch] = useState("");
  const [guestSearch, setGuestSearch] = useState("");
  const [guestForm] = Form.useForm();
  const [addingGuest, setAddingGuest] = useState(false);
  const [saving, setSaving] = useState(false);
  const { unranked } = useRankLevels();

  useEffect(() => {
    let cancelled = false;
    Promise.all([membersApi.list(), playersApi.list("guest")])
      .then(([m, g]) => { if (!cancelled) { setAllMembers(m.data); setAllGuests(g.data); } })
      .catch(() => { if (!cancelled) message.error("Không tải được danh sách người chơi"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Người đã có trong giải (ở bất kỳ vị trí, kể cả người 2 của một đội) → disabled + "Đã trong giải"
  const { usedMemberIds, usedPlayerIds } = useMemo(() => {
    const m = new Set(), p = new Set();
    (tournament.participants || []).forEach((x) => {
      if (x.member_id) m.add(x.member_id);
      if (x.partner_member_id) m.add(x.partner_member_id);
      if (x.player_id) p.add(x.player_id);
      if (x.partner_player_id) p.add(x.partner_player_id);
    });
    return { usedMemberIds: m, usedPlayerIds: p };
  }, [tournament.participants]);

  const norm = (s) => (s || "").toString().toLowerCase();
  const visibleMembers = allMembers.filter((m) => !memberSearch
    || norm(m.full_name).includes(norm(memberSearch)) || norm(m.phone).includes(norm(memberSearch)) || norm(m.member_code).includes(norm(memberSearch)));
  const visibleGuests = allGuests.filter((g) => !guestSearch
    || norm(g.name).includes(norm(guestSearch)) || norm(g.phone).includes(norm(guestSearch)));
  const selectableMembers = visibleMembers.filter((m) => !usedMemberIds.has(m.id));
  const selectableGuests = visibleGuests.filter((g) => !usedPlayerIds.has(g.id));
  const totalSelected = selectedIds.length + selectedGuestIds.length;

  // ResponsiveTable (mobile) không hỗ trợ getCheckboxProps → lọc bỏ người đã trong giải ngay tại onChange
  const onMemberKeys = (keys) => setSelectedIds(keys.filter((id) => !usedMemberIds.has(id)));
  const onGuestKeys = (keys) => setSelectedGuestIds(keys.filter((id) => !usedPlayerIds.has(id)));
  // "Chọn tất cả" áp dụng trên danh sách đang hiển thị (theo ô tìm kiếm), giữ các lựa chọn ngoài bộ lọc
  const toggleAll = (checked, selectable, selected, setSelected) => {
    const ids = selectable.map((x) => x.id);
    setSelected(checked ? [...new Set([...selected, ...ids])] : selected.filter((id) => !ids.includes(id)));
  };
  const allChecked = (selectable, selected) => selectable.length > 0 && selectable.every((x) => selected.includes(x.id));
  const someChecked = (selectable, selected) => selectable.some((x) => selected.includes(x.id));

  const handleAddGuest = async () => {
    let vals;
    try { vals = await guestForm.validateFields(); } catch { return; }
    setAddingGuest(true);
    try {
      const res = await playersApi.create({ name: vals.name, phone: vals.phone || null, rank: vals.rank || unranked });
      setAllGuests((prev) => [res.data, ...prev]);
      setSelectedGuestIds((prev) => [...prev, res.data.id]);
      guestForm.resetFields();
      message.success(`Đã thêm khách mời: ${res.data.name}`);
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể thêm khách mời");
    } finally { setAddingGuest(false); }
  };

  const handleSubmit = async () => {
    if (totalSelected === 0) { message.error("Chọn ít nhất 1 người"); return; }
    setSaving(true);
    try {
      const res = submitFn
        ? await submitFn(selectedIds, selectedGuestIds)
        : await tournamentsApi.addParticipantsBulk(tournament.id, { member_ids: selectedIds, player_ids: selectedGuestIds });
      const { added = 0, skipped = [] } = res.data || {};
      message.success(`Đã thêm ${added} người${skipped.length ? ` (bỏ qua ${skipped.length} đã có)` : ""}`);
      await onAdded(res.data?.[entityKey]);
      onClose();
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể thêm người chơi");
    } finally { setSaving(false); }
  };

  const inTournamentTag = <Tag color="default" style={{ marginLeft: 6 }}>{inLabel}</Tag>;
  const rankTag = (v) => (v ? <Tag color="purple">{v}</Tag> : <Text type="secondary">—</Text>);

  const memberCols = [
    { title: "Họ và tên", dataIndex: "full_name", render: (v, r) => <span>{v}{usedMemberIds.has(r.id) && inTournamentTag}</span> },
    { title: "Hạng", dataIndex: "rank", width: 110, render: rankTag },
    { title: "Trạng thái", dataIndex: "status", width: 110, render: (v) => { const s = MEMBER_STATUS_MAP[v] || { label: v, color: "default" }; return <Badge status={s.color} text={s.label} />; } },
    { title: "SĐT", dataIndex: "phone", width: 120, render: (v) => v || "—" },
  ];
  const guestCols = [
    { title: "Họ và tên", dataIndex: "name",
      render: (v, r) => <span><Tag color="orange" style={{ marginRight: 6 }}>Khách</Tag>{v}{usedPlayerIds.has(r.id) && inTournamentTag}</span> },
    { title: "SĐT", dataIndex: "phone", width: 120, render: (v) => v || "—" },
    { title: "Hạng", dataIndex: "rank", width: 110, render: (v) => rankTag(v || unranked) },
  ];

  const selectionBar = (selectable, selected, setSelected, label) => (
    <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Checkbox
        checked={allChecked(selectable, selected)}
        indeterminate={!allChecked(selectable, selected) && someChecked(selectable, selected)}
        disabled={selectable.length === 0}
        onChange={(e) => toggleAll(e.target.checked, selectable, selected, setSelected)}
      >
        Chọn tất cả {label} ({selectable.length})
      </Checkbox>
      {selected.length > 0 && (
        <Button size="small" type="link" onClick={() => setSelected([])}>Bỏ chọn ({selected.length})</Button>
      )}
    </div>
  );

  return (
    <Modal title={title} open onCancel={onClose} width={720}
      footer={
        <Space>
          <Button onClick={onClose}>Đóng</Button>
          <Button type="primary" icon={<PlusOutlined />} loading={saving} disabled={totalSelected === 0} onClick={handleSubmit}>
            Thêm {totalSelected} người
          </Button>
        </Space>
      }>
      <Alert type={totalSelected > 0 ? "info" : "warning"} showIcon style={{ marginBottom: 12 }}
        message={totalSelected > 0
          ? `Đã chọn ${totalSelected} người (${selectedIds.length} thành viên, ${selectedGuestIds.length} khách mời)`
          : "Tích chọn người chơi ở hai tab rồi bấm Thêm"}
        description={tournament.team_type === "doubles"
          ? "Giải đôi: mỗi người được thêm ở trạng thái chưa có đội — ghép đội bằng vòng quay hoặc ghép tay sau."
          : undefined} />
      <Tabs
        defaultActiveKey="member"
        items={[
          {
            key: "member",
            label: <span><UserOutlined /> Thành viên CLB ({selectedIds.length})</span>,
            children: (
              <>
                <Input.Search allowClear placeholder="Tìm theo tên / SĐT / mã TV" value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)} style={{ marginBottom: 12 }} />
                {selectionBar(selectableMembers, selectedIds, setSelectedIds, "thành viên")}
                <ResponsiveTable
                  loading={loading}
                  rowSelection={{
                    selectedRowKeys: selectedIds,
                    onChange: onMemberKeys,
                    getCheckboxProps: (r) => ({ disabled: usedMemberIds.has(r.id) }),
                  }}
                  columns={memberCols}
                  dataSource={visibleMembers}
                  rowKey="id" size="small" pagination={{ pageSize: 10 }}
                  mobileTitle={(r) => {
                    const s = MEMBER_STATUS_MAP[r.status] || { label: r.status, color: "default" };
                    return (
                      <span>
                        {r.full_name}
                        {r.rank && <Tag color="purple" style={{ marginLeft: 6 }}>{r.rank}</Tag>}
                        {r.status !== "active" && <Badge status={s.color} text={s.label} style={{ marginLeft: 8 }} />}
                        {usedMemberIds.has(r.id) && inTournamentTag}
                      </span>
                    );
                  }}
                  mobileHideColumns={["Họ và tên", "Hạng", "Trạng thái"]}
                />
              </>
            ),
          },
          {
            key: "guest",
            label: <span><UserAddOutlined /> Khách mời ({selectedGuestIds.length})</span>,
            children: (
              <>
                <QuickGuestForm form={guestForm} loading={addingGuest} onAdd={handleAddGuest} title="Thêm người chơi ngoài CLB" />
                {allGuests.length === 0 && !loading ? (
                  <Empty description="Chưa có khách mời nào — thêm mới ở trên" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <>
                    <Input.Search allowClear placeholder="Tìm theo tên / SĐT" value={guestSearch}
                      onChange={(e) => setGuestSearch(e.target.value)} style={{ marginBottom: 12 }} />
                    {selectionBar(selectableGuests, selectedGuestIds, setSelectedGuestIds, "khách mời")}
                    <ResponsiveTable
                      loading={loading}
                      rowSelection={{
                        selectedRowKeys: selectedGuestIds,
                        onChange: onGuestKeys,
                        getCheckboxProps: (r) => ({ disabled: usedPlayerIds.has(r.id) }),
                      }}
                      columns={guestCols}
                      dataSource={visibleGuests}
                      rowKey="id" size="small" pagination={{ pageSize: 10 }}
                      mobileTitle={(r) => (
                        <span>
                          <Tag color="orange" style={{ marginRight: 6 }}>Khách</Tag>{r.name}
                          {usedPlayerIds.has(r.id) && inTournamentTag}
                        </span>
                      )}
                      mobileHideColumns={["Họ và tên"]}
                    />
                  </>
                )}
              </>
            ),
          },
        ]}
      />
    </Modal>
  );
}
