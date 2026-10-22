import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Button, Card, Col, Empty, Input, InputNumber, Modal, Row, Select, Space, Spin, Tag, Tooltip, Typography, message,
} from "antd";
import {
  DeleteOutlined, EditOutlined, GiftOutlined, PlusOutlined, RollbackOutlined, StarFilled, StarOutlined, TeamOutlined,
  UserAddOutlined, UsergroupAddOutlined, UserOutlined,
} from "@ant-design/icons";
import { tournamentsApi } from "../../api";
import { AddParticipantsModal } from "../AddParticipantsModal";
import ResponsiveTable from "../ResponsiveTable";
import GenderTag from "./GenderTag";
import StageLineupModal from "./StageLineupModal";
import TeamDrawSetupModal from "./TeamDrawSetupModal";
import TeamDrawCeremony from "../draw/TeamDrawCeremony";
import { useRankLevels } from "../../hooks/useRankLevels";
import { serverOffset } from "../../utils/drawMath";
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

/** Modal tạo nhanh N đội "<tiền tố> k". */
function BulkTeamsModal({ existing, saving, onOk, onClose }) {
  const [count, setCount] = useState(4);
  const [prefix, setPrefix] = useState("Đội");
  return (
    <Modal open title="Tạo nhanh nhiều đội" onCancel={onClose} destroyOnHidden okText="Tạo đội" cancelText="Hủy"
      confirmLoading={saving} onOk={() => onOk(count, prefix.trim() || "Đội")} okButtonProps={{ disabled: !count }}>
      <Space direction="vertical" style={{ width: "100%", marginTop: 8 }}>
        <div>
          <Text type="secondary">Số đội cần tạo</Text>
          <InputNumber min={1} max={64} value={count} onChange={(v) => setCount(v || 1)} style={{ width: "100%" }} />
        </div>
        <div>
          <Text type="secondary">Tiền tố tên đội</Text>
          <Input value={prefix} maxLength={100} onChange={(e) => setPrefix(e.target.value)} placeholder="Đội" />
        </div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Tên đặt theo số thứ tự tiếp theo ({prefix.trim() || "Đội"} {existing + 1}, {prefix.trim() || "Đội"} {existing + 2}, …); đổi tên từng đội sau.
        </Text>
      </Space>
    </Modal>
  );
}

/**
 * Khung "Đội" của giải đồng đội (2026-10-22, luồng mới):
 *  1. "VĐV tham dự": danh sách chung chưa phân đội — thêm hàng loạt, sửa giới tính/hạng, phân vào đội, xoá.
 *  2. "Đội": tạo đội / tạo nhanh N đội / đổi tên / xoá (Nháp — VĐV quay về danh sách tham dự), thêm VĐV thẳng vào
 *     đội (= vào danh sách + phân luôn), chọn từ danh sách tham dự, gỡ VĐV về danh sách, đội trưởng, đội hình theo giai đoạn.
 * Props: { tournament, canEdit, onChanged (reload giải), onWithdraw(participant), autoOpenCreate }
 */
export default function TeamRosterPanel({ tournament, canEdit = false, onChanged, onWithdraw, autoOpenCreate = false }) {
  const [teams, setTeams] = useState([]);
  const [pool, setPool] = useState([]);                    // TeamPlayerOut chưa phân đội
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(() => !!autoOpenCreate);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null);   // TeamOut
  const [addTarget, setAddTarget] = useState(null);         // TeamOut | "pool"
  const [lineupTarget, setLineupTarget] = useState(null);   // TeamOut
  const [pickKey, setPickKey] = useState(0);                // tăng sau mỗi lần phân đội → ô Select "chọn đội / chọn VĐV" trở về placeholder
  // Vòng quay phân VĐV vào đội: phiên local (dict team draw), overlay, modal luật, bận
  const [teamDraw, setTeamDraw] = useState(null);
  const [drawOpen, setDrawOpen] = useState(false);
  const [drawSetup, setDrawSetup] = useState(false);
  const [drawBusy, setDrawBusy] = useState(false);
  const [drawOffset, setDrawOffset] = useState(0);
  const { options: rankOptions } = useRankLevels();
  const tid = tournament.id;
  const status = tournament.status;
  const rules = useMemo(() => normalizeTeamRules(tournament.team_rules), [tournament.team_rules]);
  // Chữ ký danh sách đội của giải → đổi (tạo/xoá/bỏ giải/chia bảng ở nơi khác) thì tải lại đội + VĐV
  const participantsSig = (tournament.participants || []).map((p) => `${p.id}:${p.status}:${p.group_name || ""}:${p.team_name || ""}`).join("|");

  const fetchAll = useCallback(() => Promise.all([tournamentsApi.teams.list(tid), tournamentsApi.teamPlayers.list(tid)])
    .then(([t, p]) => ({ teams: t.data || [], pool: (p.data || []).filter((x) => x.participant_id == null) })), [tid]);
  const loadAll = useCallback(async () => {
    const r = await fetchAll();
    setTeams(r.teams); setPool(r.pool);
  }, [fetchAll]);

  // Nạp đội + VĐV khi mở và khi danh sách đội của giải đổi ở nơi khác (participantsSig)
  useEffect(() => {
    let cancelled = false;
    fetchAll()
      .then((r) => { if (!cancelled) { setTeams(r.teams); setPool(r.pool); } })
      .catch((err) => { if (!cancelled) message.error(err?.response?.data?.detail || "Không tải được danh sách đội"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchAll, participantsSig]);
  // Sau thao tác: tải lại ngay để các modal/bảng có dữ liệu mới (không chờ effect)
  const refresh = useCallback(async (notify = false) => {
    try {
      await loadAll();
      if (notify && onChanged) await onChanged();   // team_pool_count / cảnh báo ở trang giải
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không tải được danh sách đội");
    }
  }, [loadAll, onChanged]);

  const allPlayers = useMemo(() => [...pool, ...teams.flatMap((t) => t.players || [])], [teams, pool]);
  const isDraft = status === "draft";
  const activeTeams = teams.filter((t) => t.participant.status !== "withdrawn");
  const teamOptions = activeTeams.map((t) => ({ value: t.participant.id, label: t.participant.team_name }));

  // ── Phiên phân đội bằng vòng quay ──
  const applyDraw = useCallback((d) => {
    setTeamDraw(d);
    if (d?.server_now_ms) setDrawOffset(serverOffset(d.server_now_ms));
  }, []);
  // Tóm tắt trong TournamentOut (sau F5 / tab khác): phiên đang mở → nạp bản đầy đủ; phiên kết thúc nơi khác → bỏ bản local
  const summaryDraw = tournament.team_draw || null;
  const openSummary = summaryDraw?.status === "open" ? summaryDraw : null;
  const drawRef = useRef(null);
  useEffect(() => { drawRef.current = teamDraw; }, [teamDraw]);
  useEffect(() => {
    if (!openSummary?.id || drawRef.current?.id === openSummary.id) return undefined;
    let cancelled = false;
    tournamentsApi.teamDraw.get(tid)
      .then((r) => { if (!cancelled && r.data?.status === "open") applyDraw(r.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [openSummary?.id, tid, applyDraw]);
  useEffect(() => {
    if (!summaryDraw || !drawRef.current || drawRef.current.id !== summaryDraw.id) return;
    if (summaryDraw.status !== "open" && drawRef.current.status === "open") { setTeamDraw(null); setDrawOpen(false); }
  }, [summaryDraw]);
  const pendingDraw = teamDraw?.status === "open" ? teamDraw : openSummary;
  const drawLocked = !!pendingDraw;   // phiên mở → khoá thao tác tay (backend cũng chặn)
  const canAddPlayers = canEdit && status !== "completed" && !drawLocked;
  const canDraw = canEdit && isDraft && pool.length >= 1 && activeTeams.length >= 2;

  const loadOpenDraw = async () => {
    const r = await tournamentsApi.teamDraw.get(tid);
    if (r.data?.status !== "open") return false;
    applyDraw(r.data); setDrawOpen(true);
    return true;
  };
  const handleOpenDraw = async (rules, revealMs) => {
    setDrawBusy(true);
    try {
      const res = await tournamentsApi.teamDraw.open(tid, { rules, reveal_ms: revealMs });
      setDrawSetup(false); applyDraw(res.data); setDrawOpen(true);
      onChanged && onChanged().catch?.(() => {});
    } catch (e) {
      if (e?.response?.status === 409) {
        setDrawSetup(false);
        try {
          if (await loadOpenDraw()) message.info("Đang có phiên phân đội chưa kết thúc — tiếp tục phiên đó.");
          else message.error(e?.response?.data?.detail || "Không thể mở phiên phân đội");
        } catch (e2) { message.error(e2?.response?.data?.detail || "Không thể tải phiên phân đội"); }
      } else message.error(e?.response?.data?.detail || "Không thể mở phiên phân đội");
    } finally { setDrawBusy(false); }
  };
  const handleResumeDraw = async () => {
    setDrawBusy(true);
    try {
      if (!(await loadOpenDraw())) {
        setTeamDraw(null); setDrawOpen(false);
        message.info("Phiên phân đội đã kết thúc ở nơi khác — đã tải lại");
        await refresh(true);
      }
    } catch (e) { message.error(e?.response?.data?.detail || "Không thể tải phiên phân đội"); }
    finally { setDrawBusy(false); }
  };
  const handleDrawSpin = async () => {
    if (!teamDraw) return;
    setDrawBusy(true);
    try {
      applyDraw((await tournamentsApi.teamDraw.spin(tid, teamDraw.done_steps)).data);
    } catch (e) {
      if (e?.response?.status === 409) {
        message.warning(e?.response?.data?.detail || "Lượt bốc không khớp — đã đồng bộ lại");
        try { applyDraw((await tournamentsApi.teamDraw.get(tid)).data); } catch { /* giữ bản local */ }
      } else message.error(e?.response?.data?.detail || "Không thể quay lượt này");
    } finally { setDrawBusy(false); }
  };
  const handleDrawCommit = async () => {
    setDrawBusy(true);
    try {
      await tournamentsApi.teamDraw.commit(tid);
      setTeamDraw(null); setDrawOpen(false);
      message.success("Đã chốt phân đội!");
      await refresh(true);
    } catch (e) { message.error(e?.response?.data?.detail || "Không thể chốt phân đội"); }
    finally { setDrawBusy(false); }
  };
  const handleDrawCancel = async () => {
    const ok = await confirm({
      title: "Huỷ phiên phân đội?",
      content: "Kết quả các lượt đã quay sẽ không được dùng. Phiên vẫn hiện trong lịch sử công khai.",
      okButtonProps: { danger: true }, okText: "Huỷ phiên",
    });
    if (!ok) return;
    setDrawBusy(true);
    try {
      await tournamentsApi.teamDraw.cancel(tid);
      setTeamDraw(null); setDrawOpen(false);
      await refresh(true);
      message.success("Đã huỷ phiên phân đội");
    } catch (e) { message.error(e?.response?.data?.detail || "Không thể huỷ phiên phân đội"); }
    finally { setDrawBusy(false); }
  };

  const run = async (fn, okMsg, failMsg, notify = false) => {
    try {
      await fn();
      if (okMsg) message.success(okMsg);
      await refresh(notify);
      return true;
    } catch (err) {
      message.error(err?.response?.data?.detail || failMsg);
      return false;
    }
  };

  const handleCreate = async (name) => {
    setSaving(true);
    try {
      const res = await tournamentsApi.teams.create(tid, { team_name: name });
      message.success(`Đã tạo đội "${name}"`);
      setCreateOpen(false);
      await refresh(true);
      if (pool.length === 0) setAddTarget(res.data);   // chưa có VĐV chờ → mở luôn modal thêm VĐV cho đội vừa tạo
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể tạo đội");
    } finally { setSaving(false); }
  };

  const handleBulkCreate = async (count, prefix) => {
    setSaving(true);
    const ok = await run(() => tournamentsApi.teams.bulkCreate(tid, { count, prefix }), `Đã tạo ${count} đội`, "Không thể tạo đội", true);
    setSaving(false);
    if (ok) setBulkOpen(false);
  };

  const handleRename = async (name) => {
    setSaving(true);
    const ok = await run(() => tournamentsApi.teams.update(tid, renameTarget.participant.id, { team_name: name }), "Đã đổi tên đội", "Không thể đổi tên đội", true);
    setSaving(false);
    if (ok) setRenameTarget(null);
  };

  const handleDeleteTeam = async (t) => {
    const n = (t.players || []).length;
    const ok = await confirm({
      title: `Xoá đội "${t.participant.team_name}"?`,
      content: n ? `${n} VĐV của đội sẽ quay về danh sách VĐV tham dự (chưa phân đội).` : "Đội chưa có VĐV.",
      okButtonProps: { danger: true }, okText: "Xoá",
    });
    if (!ok) return;
    await run(() => tournamentsApi.teams.delete(tid, t.participant.id), "Đã xoá đội", "Không thể xoá đội", true);
  };

  const handleUnassign = async (t, p) => {
    const ok = await confirm({ title: `Gỡ "${p.display_name}" khỏi đội ${t.participant.team_name}?`, content: "VĐV quay về danh sách VĐV tham dự, không rời giải." });
    if (!ok) return;
    await run(() => tournamentsApi.teams.removePlayer(tid, t.participant.id, p.id), "Đã gỡ VĐV về danh sách tham dự", "Không thể gỡ VĐV", true);
  };

  const handleRemoveFromTournament = async (p) => {
    const ok = await confirm({ title: `Xoá "${p.display_name}" khỏi giải?`, okButtonProps: { danger: true }, okText: "Xoá" });
    if (!ok) return;
    await run(() => tournamentsApi.teamPlayers.remove(tid, p.id), "Đã xoá VĐV khỏi giải", "Không thể xoá VĐV", true);
  };

  const handleAssign = async (p, participantId) => {
    const team = teams.find((t) => t.participant.id === participantId);
    setPickKey((k) => k + 1);
    await run(() => tournamentsApi.teamPlayers.patch(tid, p.id, { participant_id: participantId }),
      `Đã phân ${p.display_name} vào ${team?.participant.team_name || "đội"}`, "Không thể phân đội", true);
  };

  const patchPlayer = async (p, data, okMsg) => {
    try {
      const res = await tournamentsApi.teamPlayers.patch(tid, p.id, data);
      const apply = (y) => (y.id === p.id ? res.data : (data.is_captain && y.participant_id === p.participant_id ? { ...y, is_captain: false } : y));
      setPool((prev) => prev.map(apply));
      setTeams((prev) => prev.map((x) => ({ ...x, players: x.players.map(apply) })));
      if (okMsg) message.success(okMsg);
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể cập nhật VĐV");
    }
  };

  const nameCell = (v, p) => (
    <span>
      {p.is_captain && <Tooltip title="Đội trưởng"><StarFilled style={{ color: "#faad14", marginRight: 4 }} /></Tooltip>}
      {v}
      {p.player_id && !p.member_id && <Tag color="orange" style={{ marginLeft: 6, fontSize: 11, lineHeight: "16px", padding: "0 5px" }}>Khách</Tag>}
    </span>
  );
  const genderCol = {
    title: "Giới tính", dataIndex: "gender", width: 110,
    render: (v, p) => canAddPlayers
      ? <Select size="small" value={v || undefined} placeholder="Chưa khai" options={GENDER_OPTIONS} style={{ width: 96 }}
          status={v ? undefined : "warning"} onChange={(g) => patchPlayer(p, { gender: g })} />
      : <GenderTag value={v} showEmpty />,
  };
  const rankCol = {
    title: "Hạng", dataIndex: "rank", width: 130,
    render: (v, p) => canAddPlayers
      ? <Select size="small" value={v || undefined} placeholder="—" allowClear showSearch style={{ width: 118 }}
          options={[...new Set([...(rankOptions || []), ...(v ? [v] : [])])].map((r) => ({ value: r, label: r }))}
          onChange={(r) => patchPlayer(p, { rank: r || "" })} />
      : (v ? <Tag color="purple">{v}</Tag> : <Text type="secondary">—</Text>),
  };

  // ── Bảng VĐV tham dự (chưa phân đội) ──
  const poolCols = [
    { title: "VĐV", dataIndex: "display_name", render: nameCell },
    genderCol,
    rankCol,
    ...(canAddPlayers ? [{
      title: "Phân vào đội", width: 200,
      render: (_, p) => (
        <Select key={pickKey} size="small" placeholder={teamOptions.length ? "Chọn đội…" : "Chưa có đội"} options={teamOptions} showSearch optionFilterProp="label"
          disabled={!teamOptions.length} style={{ width: 180 }} onChange={(pid) => handleAssign(p, pid)} />
      ),
    }, {
      title: "", width: 50, align: "right",
      render: (_, p) => (
        <Tooltip title="Xoá khỏi giải"><Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleRemoveFromTournament(p)} /></Tooltip>
      ),
    }] : []),
  ];

  const playerCols = (t) => [
    { title: "VĐV", dataIndex: "display_name", render: nameCell },
    genderCol,
    rankCol,
    ...(canAddPlayers ? [{
      title: "", width: 110, align: "right",
      render: (_, p) => (
        <Space size={4}>
          {!p.is_captain && (
            <Tooltip title="Đặt làm đội trưởng">
              <Button size="small" icon={<StarOutlined />} onClick={() => patchPlayer(p, { is_captain: true }, "Đã đặt đội trưởng")} />
            </Tooltip>
          )}
          <Tooltip title="Gỡ về danh sách VĐV tham dự">
            <Button size="small" icon={<RollbackOutlined />} onClick={() => handleUnassign(t, p)} />
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
          {canAddPlayers && !withdrawn && pool.length > 0 && (
            <Select key={pickKey} size="small" placeholder={`＋ Chọn từ VĐV tham dự (${pool.length})`} showSearch optionFilterProp="label"
              style={{ width: "100%", marginBottom: 8 }}
              options={pool.map((x) => ({ value: x.id, label: `${x.display_name}${x.rank ? ` · ${x.rank}` : ""}${x.gender === "male" ? " · Nam" : x.gender === "female" ? " · Nữ" : ""}` }))}
              onChange={(tpid) => { const x = pool.find((y) => y.id === tpid); if (x) handleAssign(x, p.id); }} />
          )}
          {players.length === 0 ? (
            <Empty description="Chưa có VĐV" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: "8px 0" }}>
              {canAddPlayers && !withdrawn && (
                <Button size="small" type="primary" icon={<UserAddOutlined />} onClick={() => setAddTarget(t)}>Thêm VĐV</Button>
              )}
            </Empty>
          ) : (
            <ResponsiveTable columns={playerCols(t)} dataSource={players} rowKey="id" size="small" pagination={false}
              mobileTitle={(x) => nameCell(x.display_name, x)}
              mobileHideColumns={["VĐV"]} />
          )}
        </Card>
      </Col>
    );
  };

  const poolG = countGenders(pool);
  const poolRanks = useMemo(() => {
    const c = {};
    pool.forEach((p) => { const k = p.rank || "Chưa xếp hạng"; c[k] = (c[k] || 0) + 1; });
    return Object.entries(c);
  }, [pool]);

  return (
    <>
      {pendingDraw && !drawOpen && (
        <Alert type="warning" showIcon style={{ marginBottom: 16 }}
          message={`Phiên phân đội #${pendingDraw.seq} đang dở (${pendingDraw.done_steps}/${pendingDraw.total_steps} lượt)`}
          description="Trong lúc phiên mở không sửa tay đội/VĐV được. Tiếp tục quay để chốt, hoặc huỷ phiên."
          action={
            <Space>
              <Button type="primary" size="small" icon={<GiftOutlined />} loading={drawBusy} onClick={handleResumeDraw}>Tiếp tục</Button>
              <Button danger size="small" loading={drawBusy} onClick={handleDrawCancel}>Huỷ phiên</Button>
            </Space>
          } />
      )}
      <Card size="small" style={{ marginBottom: 16 }}
        title={<span><UserOutlined /> VĐV tham dự chưa phân đội ({pool.length})</span>}
        extra={canEdit && status !== "completed" && (
          <Space size={4} wrap>
            {canDraw && !drawLocked && (
              <Button size="small" icon={<GiftOutlined />} onClick={() => setDrawSetup(true)}>🎡 Phân đội (vòng quay)</Button>
            )}
            <Button type="primary" size="small" icon={<UserAddOutlined />} disabled={drawLocked} onClick={() => setAddTarget("pool")}>Thêm VĐV</Button>
          </Space>
        )}>
        {loading ? <div style={{ textAlign: "center", padding: 16 }}><Spin /></div> : pool.length === 0 ? (
          <Text type="secondary" style={{ fontSize: 13 }}>
            {allPlayers.length === 0
              ? "Bước 1: thêm toàn bộ VĐV tham dự giải (thành viên / khách mời). Bước 2: tạo đội. Bước 3: phân VĐV vào đội (chọn đội trên từng dòng, hoặc chọn từ danh sách ở thẻ đội)."
              : "Mọi VĐV đã được phân vào đội. Gỡ VĐV khỏi đội (nút ↩ trên thẻ đội) để phân lại, kể cả bằng vòng quay."}
          </Text>
        ) : (
          <>
            {status === "active" && (
              <Alert type="warning" showIcon style={{ marginBottom: 8, padding: "4px 10px" }}
                message={<span style={{ fontSize: 12 }}>{pool.length} VĐV chưa phân đội — không thi đấu cho tới khi được phân vào một đội.</span>} />
            )}
            <div style={{ marginBottom: 8 }}>
              <Space size={4} wrap>
                <Tag color="blue">{poolG.male} Nam</Tag><Tag color="magenta">{poolG.female} Nữ</Tag>
                {poolG.unknown > 0 && <Tag color="warning">{poolG.unknown} chưa khai giới tính</Tag>}
                {poolRanks.map(([k, n]) => <Tag key={k} color="purple">{k}: {n}</Tag>)}
              </Space>
            </div>
            <ResponsiveTable columns={poolCols} dataSource={pool} rowKey="id" size="small" pagination={false}
              mobileTitle={(x) => nameCell(x.display_name, x)} mobileHideColumns={["VĐV"]} />
          </>
        )}
      </Card>

      <Card size="small" style={{ marginBottom: 16 }}
        title={<span><TeamOutlined /> Đội ({teams.length})</span>}
        extra={canEdit && isDraft && (
          <Space size={4}>
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Tạo đội</Button>
            <Button size="small" onClick={() => setBulkOpen(true)}>Tạo nhanh N đội</Button>
          </Space>
        )}>
        {loading ? <div style={{ textAlign: "center", padding: 24 }}><Spin /></div>
          : teams.length === 0 ? (
            <Empty description={isDraft ? "Chưa có đội — bấm Tạo đội (hoặc Tạo nhanh N đội) rồi phân VĐV vào đội" : "Chưa có đội"} image={Empty.PRESENTED_IMAGE_SIMPLE}>
              {canEdit && isDraft && (
                <Space>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Tạo đội</Button>
                  <Button onClick={() => setBulkOpen(true)}>Tạo nhanh N đội</Button>
                </Space>
              )}
            </Empty>
          ) : (
            <Row gutter={[12, 12]}>{teams.map(teamCard)}</Row>
          )}
      </Card>

      {createOpen && (
        <TeamNameModal title="Tạo đội mới" initial={`Đội ${teams.length + 1}`} okText="Tạo đội" saving={saving}
          onOk={handleCreate} onClose={() => setCreateOpen(false)} />
      )}
      {bulkOpen && (
        <BulkTeamsModal existing={teams.length} saving={saving} onOk={handleBulkCreate} onClose={() => setBulkOpen(false)} />
      )}
      {renameTarget && (
        <TeamNameModal title="Đổi tên đội" initial={renameTarget.participant.team_name} okText="Lưu" saving={saving}
          onOk={handleRename} onClose={() => setRenameTarget(null)} />
      )}
      {addTarget && (
        <AddParticipantsModal
          // Một người chỉ có một bản ghi trong giải → "đã dùng" = mọi VĐV (đã phân đội lẫn chưa)
          tournament={{ ...tournament, participants: allPlayers.map((p) => ({ member_id: p.member_id, player_id: p.player_id })) }}
          title={addTarget === "pool" ? "Thêm VĐV tham dự giải" : `Thêm VĐV vào đội ${addTarget.participant.team_name}`}
          inLabel="Đã trong giải"
          entityKey="team"
          submitFn={(memberIds, playerIds) => tournamentsApi.teamPlayers.add(tid, {
            member_ids: memberIds, player_ids: playerIds,
            participant_id: addTarget === "pool" ? null : addTarget.participant.id,
          })}
          onAdded={() => refresh(true)}
          onClose={() => setAddTarget(null)}
        />
      )}
      {lineupTarget && (
        <StageLineupModal tournament={tournament} team={lineupTarget} canEdit={canEdit} onClose={() => setLineupTarget(null)} />
      )}
      {drawSetup && (
        <TeamDrawSetupModal tournament={tournament} pool={pool} teams={activeTeams} initialRules={teamDraw?.rules || tournament.team_draw_rules}
          busy={drawBusy} onOpen={handleOpenDraw} onClose={() => setDrawSetup(false)} />
      )}
      {drawOpen && teamDraw && (
        <TeamDrawCeremony mode="admin" tournament={tournament} draw={teamDraw} serverOffsetMs={drawOffset} busy={drawBusy}
          onSpin={handleDrawSpin} onCommit={handleDrawCommit} onCancel={handleDrawCancel} onClose={() => setDrawOpen(false)} fullscreen />
      )}
    </>
  );
}
