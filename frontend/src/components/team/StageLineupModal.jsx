import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, Modal, Space, Spin, Tag, Typography, message } from "antd";
import { CopyOutlined, LockOutlined, SaveOutlined, UnlockOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { tournamentsApi } from "../../api";
import { useViewMode } from "../../contexts/ViewModeContext";
import GenderTag from "./GenderTag";
import SlotSelect from "./SlotSelect";
import {
  STAGE_LABELS, appearanceCounts, normalizeTeamRules, overLimitIds, rubberSize, slotIssueText, stagesForFormat,
} from "../../utils/teamFormat";

const { Text } = Typography;

/** Giai đoạn "đang diễn ra" để mở sẵn: có trận knockout → knockout; vòng tròn 2 lượt đã sang lượt về → leg2; còn lại đầu danh sách. */
function currentStage(tournament, stages) {
  const matches = tournament.matches || [];
  if (stages.includes("knockout") && matches.some((m) => m.phase === "knockout")) return "knockout";
  if (stages.includes("leg2")) {
    const rounds = matches.filter((m) => m.phase === "group").map((m) => m.round_number || 0);
    const half = rounds.length ? Math.floor(Math.max(...rounds) / 2) : 0;
    if (half && matches.some((m) => m.phase === "group" && m.round_number > half && m.status === "completed")) return "leg2";
  }
  return stages[0];
}

/**
 * Đội hình đăng ký theo giai đoạn của một đội: leg1 / leg2 / knockout (theo thể thức giải). Mỗi slot = một trận
 * thành phần trong team_rules.rubbers. Khoá tự động khi giai đoạn có điểm; quản trị mở khoá kèm lý do (ghi log).
 * Props: { tournament, team (TeamOut), canEdit, onClose }
 */
export default function StageLineupModal({ tournament, team, canEdit = false, onClose }) {
  const { isMobileView } = useViewMode();
  const rules = useMemo(() => normalizeTeamRules(tournament.team_rules), [tournament.team_rules]);
  const stages = useMemo(() => stagesForFormat(tournament.format), [tournament.format]);
  const [stage, setStage] = useState(() => currentStage(tournament, stages));
  const [lineups, setLineups] = useState({});   // stage_key → LineupOut (server)
  const [drafts, setDrafts] = useState({});     // stage_key → slots đang sửa
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [unlockNote, setUnlockNote] = useState(null);   // null = đang đóng ô nhập lý do
  const players = useMemo(() => team?.players || [], [team]);
  const playerById = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p])), [players]);
  const tid = tournament.id, pid = team?.participant?.id;
  const editable = canEdit && tournament.status !== "completed";

  const applyLineup = (lu) => {
    setLineups((prev) => ({ ...prev, [lu.stage_key]: lu }));
    setDrafts((prev) => ({ ...prev, [lu.stage_key]: { ...(lu.slots || {}) } }));
  };

  useEffect(() => {
    let cancelled = false;
    tournamentsApi.lineups.list(tid, pid)
      .then((r) => {
        if (cancelled) return;
        const byStage = {}, ds = {};
        (r.data || []).forEach((lu) => { byStage[lu.stage_key] = lu; ds[lu.stage_key] = { ...(lu.slots || {}) }; });
        setLineups(byStage); setDrafts(ds);
      })
      .catch((err) => { if (!cancelled) message.error(err?.response?.data?.detail || "Không tải được đội hình"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tid, pid]);

  const lu = lineups[stage];
  const slots = drafts[stage] || {};
  const locked = !!lu?.locked;
  const sides = rules.rubbers.map((r) => slots[r.label] || []);
  const over = overLimitIds(rules, sides);
  const counts = appearanceCounts(sides);
  const dirty = JSON.stringify(slots) !== JSON.stringify(lu?.slots || {});
  const setSlot = (label, ids) => setDrafts((prev) => ({ ...prev, [stage]: { ...(prev[stage] || {}), [label]: ids } }));

  const handleSave = async () => {
    // Chỉ gửi slot đủ người hoặc rỗng — slot dở dang bị backend chặn (sai số người)
    const payload = {};
    for (const r of rules.rubbers) {
      const ids = slots[r.label] || [];
      if (ids.length && ids.length !== rubberSize(r.code)) {
        message.error(`${r.label}: cần đúng ${rubberSize(r.code)} VĐV (hoặc để trống)`); return;
      }
      payload[r.label] = ids;
    }
    setSaving(true);
    try {
      const res = await tournamentsApi.lineups.set(tid, pid, stage, { slots: payload });
      applyLineup(res.data);
      message.success(`Đã lưu đội hình ${STAGE_LABELS[stage]}`);
      if (res.data.warnings?.length) message.warning(res.data.warnings[0]);
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể lưu đội hình");
    } finally { setSaving(false); }
  };

  const handleUnlock = async () => {
    const note = (unlockNote || "").trim();
    if (!note) { message.error("Nhập lý do mở khoá"); return; }
    setSaving(true);
    try {
      const res = await tournamentsApi.lineups.unlock(tid, pid, stage, { note });
      applyLineup(res.data);
      setUnlockNote(null);
      message.success("Đã mở khoá đội hình — thao tác được ghi nhật ký");
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể mở khoá");
    } finally { setSaving(false); }
  };

  const copyFrom = (src) => setDrafts((prev) => ({ ...prev, [stage]: { ...(prev[src] || {}) } }));
  const copySources = stages.filter((s) => s !== stage && Object.values(lineups[s]?.slots || {}).some((v) => v?.length));

  return (
    <Modal open onCancel={onClose} destroyOnHidden
      title={<span>Đội hình — {team?.participant?.team_name}</span>}
      width={isMobileView ? "100vw" : 720}
      style={isMobileView ? { top: 0, margin: 0, maxWidth: "100vw", paddingBottom: 0 } : undefined}
      footer={
        <Space wrap>
          <Button onClick={onClose} style={{ minHeight: 44 }}>Đóng</Button>
          {editable && !locked && (
            <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={handleSave} style={{ minHeight: 44 }}>
              Lưu đội hình
            </Button>
          )}
        </Space>
      }>
      {loading ? <div style={{ textAlign: "center", padding: 24 }}><Spin /></div> : (
        <>
          {stages.length > 1 && (
            <Space wrap style={{ marginBottom: 12 }}>
              {stages.map((s) => (
                <Button key={s} type={s === stage ? "primary" : "default"} onClick={() => setStage(s)}
                  icon={lineups[s]?.locked ? <LockOutlined /> : null} style={{ minHeight: 40 }}>
                  {STAGE_LABELS[s]}
                </Button>
              ))}
            </Space>
          )}
          {stages.length === 1 && <Tag color="blue" style={{ marginBottom: 12 }}>{STAGE_LABELS[stage]}</Tag>}

          {locked ? (
            <Alert type="warning" showIcon icon={<LockOutlined />} style={{ marginBottom: 12 }}
              message={`Đội hình ${STAGE_LABELS[stage]} đã khoá${lu.locked_at ? ` lúc ${dayjs(lu.locked_at).format("HH:mm DD/MM")}` : ""} — giai đoạn này đã có điểm`}
              description={
                editable && (
                  unlockNote === null
                    ? <Button size="small" icon={<UnlockOutlined />} onClick={() => setUnlockNote("")}>Mở khoá (ghi lý do)</Button>
                    : (
                      <Space direction="vertical" style={{ width: "100%" }}>
                        <Input.TextArea rows={2} maxLength={200} value={unlockNote} placeholder="Lý do mở khoá (vd: VĐV chấn thương, đổi người)"
                          onChange={(e) => setUnlockNote(e.target.value)} />
                        <Space>
                          <Button size="small" type="primary" loading={saving} onClick={handleUnlock}>Xác nhận mở khoá</Button>
                          <Button size="small" onClick={() => setUnlockNote(null)}>Huỷ</Button>
                        </Space>
                      </Space>
                    )
                )
              } />
          ) : lu?.unlock_note ? (
            <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Đã mở khoá: ${lu.unlock_note}`} />
          ) : null}

          {players.length === 0 && (
            <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Đội chưa có VĐV — thêm VĐV trước khi xếp đội hình" />
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rules.rubbers.map((r) => {
              const ids = slots[r.label] || [];
              const issue = slotIssueText(r.code, ids, playerById);
              return (
                <div key={r.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
                    <Text strong>{r.label}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{rubberSize(r.code)} VĐV</Text>
                  </div>
                  {locked || !editable ? (
                    <div style={{ minHeight: 24 }}>
                      {ids.length === 0 ? <Text type="secondary">— chưa xếp —</Text> : ids.map((id) => (
                        <Tag key={id} style={{ fontWeight: over.includes(id) ? 700 : 400 }}>
                          {playerById[id]?.display_name || `#${id}`} <GenderTag value={playerById[id]?.gender} />
                        </Tag>
                      ))}
                    </div>
                  ) : (
                    <SlotSelect code={r.code} value={ids} onChange={(v) => setSlot(r.label, v)} players={players}
                      overLimit={over} counts={counts} size={isMobileView ? "large" : "middle"} />
                  )}
                  {issue && <Text type="warning" style={{ fontSize: 12 }}>⚠ {issue}</Text>}
                </div>
              );
            })}
          </div>

          {over.length > 0 && (
            <Alert type="warning" showIcon style={{ marginTop: 12 }}
              message={`Vượt tối đa ${rules.max_rubbers_per_player} trận/VĐV (chỉ cảnh báo): ${over.map((id) => `${playerById[id]?.display_name || id} (${counts[id]} trận)`).join(", ")}`} />
          )}
          {!!lu?.warnings?.length && (
            <Alert type="info" showIcon style={{ marginTop: 12 }} message="Ghi chú từ máy chủ"
              description={<ul style={{ margin: 0, paddingLeft: 18 }}>{lu.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>} />
          )}

          {editable && !locked && copySources.length > 0 && (
            <Space wrap style={{ marginTop: 12 }}>
              {copySources.map((s) => (
                <Button key={s} size="small" icon={<CopyOutlined />} onClick={() => copyFrom(s)}>Sao chép từ {STAGE_LABELS[s]}</Button>
              ))}
            </Space>
          )}
          <Text type="secondary" style={{ display: "block", marginTop: 12, fontSize: 12 }}>
            Đội hình giai đoạn tự khoá khi trận thành phần đầu tiên của giai đoạn có điểm. Trong từng trận đồng đội vẫn
            đổi được VĐV của trận thành phần chưa có điểm (biên bản trận).
          </Text>
        </>
      )}
    </Modal>
  );
}
