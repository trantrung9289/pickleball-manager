import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Empty, Input, Modal, Row, Select, Space, Spin, Tag, Tooltip, Typography, message } from "antd";
import {
  DeleteOutlined, EditOutlined, PlusOutlined, StarFilled, StarOutlined, TeamOutlined, UserAddOutlined, UsergroupAddOutlined,
} from "@ant-design/icons";
import { tournamentsApi } from "../../api";
import { AddParticipantsModal } from "../AddParticipantsModal";
import ResponsiveTable from "../ResponsiveTable";
import GenderTag from "./GenderTag";
import StageLineupModal from "./StageLineupModal";
import { GENDER_OPTIONS, countGenders, normalizeTeamRules, teamRosterWarnings } from "../../utils/teamFormat";

const { Text } = Typography;

const confirm = (opts) =>
  new Promise((res) =>
    Modal.confirm({ okText: "Xác nhận", cancelText: "Hủy", ...opts, onOk: () => res(true), onCancel: () => res(false) })
  );

/** Modal nhập tên đội (tạo mới / đổi tên). */
function TeamNameModal({ title, initial, okText, saving, onOk, onClose }) {
  const [name, setName] = useState(initial || "");
  return (
    <Modal open title={title} onCancel={onClose} destroyOnHidden
      okText={okText} cancelText="Hủy" confirmLoading={saving} onOk={() => onOk(name.trim())}
      okButtonProps={{ disabled: !name.trim() }}>
      <Input value={name} autoFocus maxLength={200} placeholder="Tên đội" style={{ marginTop: 8 }}
        onChange={(e) => setName(e.target.value)} onPressEnter={() => name.trim() && onOk(name.trim())} />
    </Modal>
  );
}

/**
 * Khung "Đội" của giải đồng đội: tạo đội / đổi tên / xoá (Nháp), thêm VĐV (Nháp hoặc đang diễn ra), bảng VĐV
 * (giới tính, đội trưởng, xoá), cảnh báo thiếu giới tính theo thể thức, nút "Đội hình" theo giai đoạn.
 * Props: { tournament, canEdit, onChanged (reload giải — khi danh sách đội đổi), onWithdraw(participant), autoOpenCreate }
 */
export default function TeamRosterPanel({ tournament, canEdit = false, onChanged, onWithdraw, autoOpenCreate = false }) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(() => !!autoOpenCreate);
  const [saving, setSaving] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null);   // TeamOut
  const [addTarget, setAddTarget] = useState(null);         // TeamOut
  const [lineupTarget, setLineupTarget] = useState(null);   // TeamOut
  const tid = tournament.id;
  const status = tournament.status;
  const rules = useMemo(() => normalizeTeamRules(tournament.team_rules), [tournament.team_rules]);
  // Chữ ký danh sách đội của giải → đổi (tạo/xoá/bỏ giải/chia bảng ở nơi khác) thì tải lại đội + VĐV
  const participantsSig = (tournament.participants || []).map((p) => `${p.id}:${p.status}:${p.group_name || ""}:${p.team_name || ""}`).join("|");

  // Nạp đội + VĐV khi mở và khi danh sách đội của giải đổi ở nơi khác (participantsSig)
  useEffect(() => {
    let cancelled = false;
    tournamentsApi.teams.list(tid)
      .then((r) => { if (!cancelled) setTeams(r.data || []); })
      .catch((err) => { if (!cancelled) message.error(err?.response?.data?.detail || "Không tải được danh sách đội"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tid, participantsSig]);
  // Sau thao tác (thêm/xoá VĐV...): tải lại ngay để các modal/bảng có dữ liệu mới (không chờ effect)
  const loadTeams = useCallback(async () => {
    try {
      const r = await tournamentsApi.teams.list(tid);
      setTeams(r.data || []);
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không tải được danh sách đội");
    }
  }, [tid]);

  const allPlayers = useMemo(() => teams.flatMap((t) => t.players || []), [teams]);
  const canAddPlayers = canEdit && status !== "completed";
  const isDraft = status === "draft";

  const handleCreate = async (name) => {
    setSaving(true);
    try {
      const res = await tournamentsApi.teams.create(tid, { team_name: name });
      message.success(`Đã tạo đội "${name}" — thêm VĐV cho đội`);
      setCreateOpen(false);
      await loadTeams();
      onChanged && (await onChanged());
      setAddTarget(res.data);   // mở luôn modal thêm VĐV cho đội vừa tạo
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể tạo đội");
    } finally { setSaving(false); }
  };

  const handleRename = async (name) => {
    setSaving(true);
    try {
      await tournamentsApi.teams.update(tid, renameTarget.participant.id, { team_name: name });
      message.success("Đã đổi tên đội");
      setRenameTarget(null);
      await loadTeams();
      onChanged && (await onChanged());
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể đổi tên đội");
    } finally { setSaving(false); }
  };

  const handleDeleteTeam = async (t) => {
    const ok = await confirm({
      title: `Xoá đội "${t.participant.team_name}"?`,
      content: `${(t.players || []).length} VĐV của đội sẽ rời khỏi giải.`,
      okButtonProps: { danger: true }, okText: "Xoá",
    });
    if (!ok) return;
    try {
      await tournamentsApi.teams.delete(tid, t.participant.id);
      message.success("Đã xoá đội");
      await loadTeams();
      onChanged && (await onChanged());
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể xoá đội");
    }
  };

  const handleRemovePlayer = async (t, p) => {
    const ok = await confirm({ title: `Xoá "${p.display_name}" khỏi đội ${t.participant.team_name}?` });
    if (!ok) return;
    try {
      await tournamentsApi.teams.removePlayer(tid, t.participant.id, p.id);
      message.success("Đã xoá VĐV khỏi đội");
      await loadTeams();
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể xoá VĐV");
    }
  };

  const patchPlayer = async (t, p, data, okMsg) => {
    try {
      const res = await tournamentsApi.teams.patchPlayer(tid, t.participant.id, p.id, data);
      // Đội trưởng: backend bỏ cờ của người khác trong đội → cập nhật cả đội tại chỗ
      setTeams((prev) => prev.map((x) => (x.participant.id !== t.participant.id ? x : {
        ...x,
        players: x.players.map((y) => (y.id === p.id ? res.data : (data.is_captain ? { ...y, is_captain: false } : y))),
      })));
      if (okMsg) message.success(okMsg);
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể cập nhật VĐV");
    }
  };

  const playerCols = (t) => [
    {
      title: "VĐV", dataIndex: "display_name",
      render: (v, p) => (
        <span>
          {p.is_captain && <Tooltip title="Đội trưởng"><StarFilled style={{ color: "#faad14", marginRight: 4 }} /></Tooltip>}
          {v}
          {p.player_id && !p.member_id && <Tag color="orange" style={{ marginLeft: 6, fontSize: 11, lineHeight: "16px", padding: "0 5px" }}>Khách</Tag>}
        </span>
      ),
    },
    {
      title: "Giới tính", dataIndex: "gender", width: 110,
      render: (v, p) => canAddPlayers
        ? <Select size="small" value={v || undefined} placeholder="Chưa khai" options={GENDER_OPTIONS} style={{ width: 96 }}
            status={v ? undefined : "warning"} onChange={(g) => patchPlayer(t, p, { gender: g })} />
        : <GenderTag value={v} showEmpty />,
    },
    ...(canAddPlayers ? [{
      title: "", width: 140, align: "right",
      render: (_, p) => (
        <Space size={4}>
          {!p.is_captain && (
            <Tooltip title="Đặt làm đội trưởng">
              <Button size="small" icon={<StarOutlined />} onClick={() => patchPlayer(t, p, { is_captain: true }, "Đã đặt đội trưởng")} />
            </Tooltip>
          )}
          <Tooltip title="Xoá khỏi đội">
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleRemovePlayer(t, p)} />
          </Tooltip>
        </Space>
      ),
    }] : []),
  ];

  const teamCard = (t) => {
    const p = t.participant;
    const players = t.players || [];
    const withdrawn = p.status === "withdrawn";
    const warnings = teamRosterWarnings(rules, players);
    const g = countGenders(players);
    return (
      <Col xs={24} lg={12} key={p.id}>
        <Card size="small" style={{ height: "100%", borderColor: withdrawn ? "#ffccc7" : undefined }}
          title={
            <Space size={6} wrap>
              <span style={withdrawn ? { textDecoration: "line-through", color: "#999" } : undefined}>{p.team_name}</span>
              {p.group_name && <Tag>Bảng {p.group_name}</Tag>}
              {withdrawn && <Tag color="error">Đã bỏ giải</Tag>}
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                {players.length} VĐV · {g.male} Nam · {g.female} Nữ{g.unknown ? ` · ${g.unknown} chưa khai` : ""}
              </Text>
            </Space>
          }
          extra={
            <Space size={4} wrap>
              {canAddPlayers && !withdrawn && (
                <Button size="small" type="primary" icon={<UserAddOutlined />} onClick={() => setAddTarget(t)}>Thêm VĐV</Button>
              )}
              <Button size="small" icon={<UsergroupAddOutlined />} onClick={() => setLineupTarget(t)}>Đội hình</Button>
              {canAddPlayers && (
                <Tooltip title="Đổi tên đội"><Button size="small" icon={<EditOutlined />} onClick={() => setRenameTarget(t)} /></Tooltip>
              )}
              {canEdit && isDraft && (
                <Tooltip title="Xoá đội"><Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteTeam(t)} /></Tooltip>
              )}
              {canEdit && status === "active" && !withdrawn && onWithdraw && (
                <Button size="small" danger onClick={() => onWithdraw(p)}>Bỏ giải</Button>
              )}
            </Space>
          }>
          {warnings.length > 0 && !withdrawn && (
            <Alert type="warning" showIcon style={{ marginBottom: 8, padding: "4px 10px" }}
              message={<span style={{ fontSize: 12 }}>{warnings.join(" · ")}</span>} />
          )}
          {players.length === 0 ? (
            <Empty description="Chưa có VĐV" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: "8px 0" }}>
              {canAddPlayers && !withdrawn && (
                <Button size="small" type="primary" icon={<UserAddOutlined />} onClick={() => setAddTarget(t)}>Thêm VĐV</Button>
              )}
            </Empty>
          ) : (
            <ResponsiveTable columns={playerCols(t)} dataSource={players} rowKey="id" size="small" pagination={false}
              mobileTitle={(x) => (
                <span>
                  {x.is_captain && <StarFilled style={{ color: "#faad14", marginRight: 4 }} />}{x.display_name}
                  {x.player_id && !x.member_id && <Tag color="orange" style={{ marginLeft: 6 }}>Khách</Tag>}
                </span>
              )}
              mobileHideColumns={["VĐV"]} />
          )}
        </Card>
      </Col>
    );
  };

  return (
    <Card size="small" style={{ marginBottom: 16 }}
      title={<span><TeamOutlined /> Đội ({teams.length})</span>}
      extra={canEdit && isDraft && (
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Tạo đội</Button>
      )}>
      {loading ? <div style={{ textAlign: "center", padding: 24 }}><Spin /></div>
        : teams.length === 0 ? (
          <Empty description={isDraft ? "Chưa có đội — bấm Tạo đội rồi thêm VĐV cho từng đội" : "Chưa có đội"} image={Empty.PRESENTED_IMAGE_SIMPLE}>
            {canEdit && isDraft && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Tạo đội</Button>}
          </Empty>
        ) : (
          <Row gutter={[12, 12]}>{teams.map(teamCard)}</Row>
        )}

      {createOpen && (
        <TeamNameModal title="Tạo đội mới" initial={`Đội ${teams.length + 1}`} okText="Tạo đội" saving={saving}
          onOk={handleCreate} onClose={() => setCreateOpen(false)} />
      )}
      {renameTarget && (
        <TeamNameModal title="Đổi tên đội" initial={renameTarget.participant.team_name} okText="Lưu" saving={saving}
          onOk={handleRename} onClose={() => setRenameTarget(null)} />
      )}
      {addTarget && (
        <AddParticipantsModal
          // Một người chỉ được ở MỘT đội → "đã dùng" = mọi VĐV của MỌI đội (mô phỏng participants {member_id, player_id})
          tournament={{ ...tournament, participants: allPlayers.map((p) => ({ member_id: p.member_id, player_id: p.player_id })) }}
          title={`Thêm VĐV vào đội ${addTarget.participant.team_name}`}
          inLabel="Đã trong đội"
          entityKey="team"
          submitFn={(memberIds, playerIds) => tournamentsApi.teams.addPlayers(tid, addTarget.participant.id, { member_ids: memberIds, player_ids: playerIds })}
          onAdded={loadTeams}
          onClose={() => setAddTarget(null)}
        />
      )}
      {lineupTarget && (
        <StageLineupModal tournament={tournament} team={lineupTarget} canEdit={canEdit} onClose={() => setLineupTarget(null)} />
      )}
    </Card>
  );
}
