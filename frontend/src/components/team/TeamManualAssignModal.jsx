/**
 * TeamManualAssignModal — bảng PHÂN ĐỘI THỦ CÔNG theo lô (giải đồng đội, 2026-10-23).
 * Trái: VĐV chưa phân đội (tick chọn nhiều, lọc theo tên / hạng / giới tính). Phải: các đội đang hoạt động —
 * "Phân N đã chọn vào đội này", gỡ từng VĐV (×) về danh sách, "Chia đều" số đã chọn vào các đội ít người trước.
 * Mọi thao tác gửi MỘT request nguyên tử (POST /team-players/assign); modal giữ mở, dữ liệu mới đến qua props.
 * Props: { pool: TeamPlayerOut[], teams: TeamOut[] (đang hoạt động), rankOptions: string[], busy,
 *          onApply(assignments, okMsg) → Promise<boolean>, onClose }
 */
import { useMemo, useState } from "react";
import { Alert, Button, Card, Col, Empty, Input, Modal, Row, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import { CloseOutlined, UserAddOutlined, StarFilled } from "@ant-design/icons";
import GenderTag from "./GenderTag";
import { GENDER_OPTIONS, countGenders, distributeEvenly } from "../../utils/teamFormat";

const { Text } = Typography;
const UNRANKED = "__none__";

export default function TeamManualAssignModal({ pool = [], teams = [], rankOptions = [], busy, onApply, onClose }) {
  const [selected, setSelected] = useState([]);
  const [q, setQ] = useState("");
  const [ranks, setRanks] = useState([]);
  const [gender, setGender] = useState(undefined);

  const rankChoices = useMemo(() => {
    const set = new Set([...(rankOptions || []), ...pool.map((p) => p.rank).filter(Boolean)]);
    return [...set].map((r) => ({ value: r, label: r })).concat([{ value: UNRANKED, label: "Chưa xếp hạng" }]);
  }, [rankOptions, pool]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pool.filter((p) => {
      if (needle && !p.display_name.toLowerCase().includes(needle)) return false;
      if (ranks.length && !ranks.includes(p.rank || UNRANKED)) return false;
      if (gender && (p.gender || "other") !== gender) return false;
      return true;
    });
  }, [pool, q, ranks, gender]);

  // Chỉ giữ lựa chọn còn trong danh sách chờ (sau khi phân xong, người đó rời pool)
  const poolIds = useMemo(() => new Set(pool.map((p) => p.id)), [pool]);
  const picked = selected.filter((id) => poolIds.has(id));
  const n = picked.length;

  const apply = async (assignments, okMsg) => {
    const ok = await onApply(assignments, okMsg);
    if (ok) setSelected([]);
  };
  const assignTo = (t) => apply(picked.map((tpid) => ({ tpid, participant_id: t.participant.id })),
    `Đã phân ${n} VĐV vào ${t.participant.team_name}`);
  const unassign = (p) => apply([{ tpid: p.id, participant_id: null }], `Đã gỡ ${p.display_name} về danh sách tham dự`);
  const distribute = () => apply(distributeEvenly(picked, teams), `Đã chia đều ${n} VĐV vào ${teams.length} đội`);

  const columns = [
    {
      title: "VĐV", dataIndex: "display_name",
      render: (v, p) => (
        <span>{v}{p.player_id && !p.member_id && <Tag color="orange" style={{ marginLeft: 6, fontSize: 11, lineHeight: "16px", padding: "0 5px" }}>Khách</Tag>}</span>
      ),
    },
    { title: "Hạng", dataIndex: "rank", width: 70, render: (v) => (v ? <Tag color="purple" style={{ margin: 0 }}>{v}</Tag> : <Text type="secondary">—</Text>) },
    { title: "Giới", dataIndex: "gender", width: 70, render: (v) => <GenderTag value={v} showEmpty /> },
  ];

  const g = countGenders(pool);
  return (
    <Modal title="✋ Phân đội thủ công" open onCancel={onClose} width={1000} footer={<Button onClick={onClose}>Đóng</Button>}
      styles={{ body: { paddingTop: 8 } }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={10}>
          <Card size="small"
            title={<span>Chưa phân đội ({pool.length}) <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>· {g.male} Nam · {g.female} Nữ</Text></span>}
            extra={<Text type="secondary" style={{ fontSize: 12 }}>Đã chọn: <b>{n}</b></Text>}>
            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              <Space.Compact style={{ width: "100%" }}>
                <Input allowClear placeholder="Tìm tên…" value={q} onChange={(e) => setQ(e.target.value)} />
                <Select allowClear placeholder="Giới" value={gender} style={{ width: 110 }} options={GENDER_OPTIONS} onChange={setGender} />
              </Space.Compact>
              <Select mode="multiple" allowClear placeholder="Lọc theo hạng" value={ranks} options={rankChoices} style={{ width: "100%" }} onChange={setRanks} />
              <Space size={4} wrap>
                <Button size="small" disabled={!filtered.length} onClick={() => setSelected([...new Set([...picked, ...filtered.map((p) => p.id)])])}>
                  Chọn tất cả ({filtered.length})
                </Button>
                <Button size="small" disabled={!n} onClick={() => setSelected([])}>Bỏ chọn</Button>
                <Tooltip title="Lần lượt gán mỗi VĐV đã chọn cho đội đang ít người nhất">
                  <Button size="small" type="dashed" disabled={!n || teams.length < 2 || busy} loading={busy && n > 0} onClick={distribute}>
                    Chia đều {n ? `${n} ` : ""}vào {teams.length} đội
                  </Button>
                </Tooltip>
              </Space>
              {pool.length === 0 ? (
                <Empty description="Mọi VĐV đã có đội — gỡ (×) ở thẻ đội để phân lại" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <Table size="small" rowKey="id" columns={columns} dataSource={filtered} pagination={false}
                  scroll={{ y: 360 }} locale={{ emptyText: "Không có VĐV khớp bộ lọc" }}
                  rowSelection={{ selectedRowKeys: picked, onChange: (keys) => setSelected(keys), preserveSelectedRowKeys: true }}
                  onRow={(p) => ({ onClick: () => setSelected((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id])), style: { cursor: "pointer" } })} />
              )}
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={14}>
          {teams.length === 0 ? (
            <Alert type="info" showIcon message="Chưa có đội — tạo đội trước rồi quay lại bảng này" />
          ) : (
            <Row gutter={[12, 12]}>
              {teams.map((t) => {
                const players = t.players || [];
                const tg = countGenders(players);
                return (
                  <Col xs={24} sm={12} key={t.participant.id}>
                    <Card size="small" style={{ height: "100%" }}
                      title={<span>{t.participant.team_name} <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>· {players.length} VĐV · {tg.male} Nam · {tg.female} Nữ</Text></span>}>
                      <Button block size="small" type="primary" icon={<UserAddOutlined />} disabled={!n || busy} onClick={() => assignTo(t)} style={{ marginBottom: 8 }}>
                        Phân {n ? `${n} đã chọn` : "VĐV đã chọn"} vào đây
                      </Button>
                      {players.length === 0 ? (
                        <Text type="secondary" style={{ fontSize: 12 }}>Chưa có VĐV</Text>
                      ) : (
                        <Space size={[4, 4]} wrap>
                          {players.map((p) => (
                            <Tag key={p.id} style={{ margin: 0, paddingRight: 4 }}>
                              {p.is_captain && <StarFilled style={{ color: "#faad14", marginRight: 3 }} />}
                              {p.display_name}{p.rank ? ` · ${p.rank}` : ""}{p.gender === "male" ? " · Nam" : p.gender === "female" ? " · Nữ" : ""}
                              <Tooltip title="Gỡ về danh sách chưa phân đội">
                                <Button type="text" size="small" icon={<CloseOutlined style={{ fontSize: 10 }} />} disabled={busy}
                                  style={{ width: 18, height: 18, minWidth: 18, marginLeft: 2 }} onClick={() => unassign(p)} />
                              </Tooltip>
                            </Tag>
                          ))}
                        </Space>
                      )}
                    </Card>
                  </Col>
                );
              })}
            </Row>
          )}
        </Col>
      </Row>
    </Modal>
  );
}
