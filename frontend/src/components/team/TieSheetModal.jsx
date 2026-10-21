import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Col, Dropdown, InputNumber, Modal, Row, Space, Spin, Tag, Typography, message } from "antd";
import { DeleteOutlined, GiftOutlined, SaveOutlined, StopOutlined } from "@ant-design/icons";
import { tournamentsApi } from "../../api";
import { useViewMode } from "../../contexts/ViewModeContext";
import GenderTag from "./GenderTag";
import SlotSelect from "./SlotSelect";
import {
  SCORING_SHORT, STAGE_LABELS, appearanceCounts, playerIndex, rubberName, rubberSize, rubberStatusLabel, slotIssueText,
} from "../../utils/teamFormat";

const { Text, Title } = Typography;

const confirm = (opts) =>
  new Promise((res) =>
    Modal.confirm({ okText: "Xác nhận", cancelText: "Hủy", ...opts, onOk: () => res(true), onCancel: () => res(false) })
  );

/** Ô nhập điểm khởi tạo từ TieOut: đã có điểm → điểm đó; PA2 chưa đấu → điểm xuất phát; PA1 chưa đấu → trống. */
function initInputs(tie) {
  const pa2 = tie?.rules?.scoring === "cumulative";
  const out = {};
  (tie?.rubbers || []).forEach((r) => {
    out[r.id] = r.status === "completed"
      ? { s1: r.score1, s2: r.score2 }
      : (pa2 ? { s1: r.start1 || 0, s2: r.start2 || 0 } : { s1: null, s2: null });
  });
  return out;
}

const BIG_INPUT_CSS = `
.tie-score-input .ant-input-number-input { font-size: 24px; font-weight: 700; height: 46px; text-align: center; }
.tie-score-input { width: 96px; }
`;

/**
 * Biên bản trận đồng đội (tie): header 2 đội + tỉ số tổng, bốc thăm thứ tự trận thành phần, danh sách trận thành phần
 * theo order_index (VĐV 2 bên sửa được khi chưa có điểm, ô điểm to, xử thua, xoá điểm), cảnh báo vượt số trận.
 * Mọi thao tác dùng TieOut trả về để cập nhật; gọi onUpdated(tie) sau mỗi thay đổi điểm để trang giải tải lại
 * lịch/nhánh (tỉ số tổng, đẩy vòng sau).
 * Props: { tournament, match ({id, round_name, match_number}), canEdit, onClose, onUpdated }
 */
export default function TieSheetModal({ tournament, match, canEdit = false, onClose, onUpdated }) {
  const { isMobileView } = useViewMode();
  const [tie, setTie] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);        // rid đang thao tác | "draw"
  const [inputs, setInputs] = useState({});      // rid → {s1, s2}
  const [pendingSides, setPendingSides] = useState({});   // `${rid}:${side}` → ids đang chọn dở (chưa đủ người)
  const onUpdatedRef = useRef(onUpdated);
  useEffect(() => { onUpdatedRef.current = onUpdated; }, [onUpdated]);
  const tid = tournament.id, mid = match.id;

  const apply = useCallback((next, { notify = true } = {}) => {
    setTie(next);
    setInputs(initInputs(next));
    setPendingSides({});
    if (notify) onUpdatedRef.current && onUpdatedRef.current(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    tournamentsApi.tie.get(tid, mid)
      .then((r) => { if (!cancelled) { setTie(r.data); setInputs(initInputs(r.data)); } })
      .catch((err) => { if (!cancelled) message.error(err?.response?.data?.detail || "Không tải được biên bản"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tid, mid]);

  const rules = tie?.rules;
  const pa2 = rules?.scoring === "cumulative";
  const rubbers = useMemo(() => [...(tie?.rubbers || [])].sort((a, b) => a.order_index - b.order_index), [tie]);
  const playerById = useMemo(() => playerIndex(tie?.team1, tie?.team2), [tie]);
  const over = new Set((tie?.over_limit || []).map(Number));
  const counts = appearanceCounts(rubbers.flatMap((r) => [r.side1_players, r.side2_players]));
  const editable = canEdit && !!tie?.can_edit;
  const finished = !!tie?.result?.finished;
  const anyScored = rubbers.some((r) => r.status === "completed");
  const t1 = tie?.team1?.participant?.team_name || "Đội 1";
  const t2 = tie?.team2?.participant?.team_name || "Đội 2";

  const run = async (key, fn, okMsg) => {
    setBusy(key);
    try {
      const res = await fn();
      apply(res.data);
      if (okMsg) message.success(okMsg);
    } catch (err) {
      message.error(err?.response?.data?.detail || "Thao tác không thành công");
    } finally { setBusy(null); }
  };

  const handleDraw = async () => {
    const ok = await confirm({
      title: "Bốc thăm thứ tự các trận thành phần?",
      content: "Máy chủ xáo thứ tự bằng seed công khai (SHA256(seed:k) như vòng quay) — khán giả kiểm chứng được. Chỉ bốc khi chưa có trận nào có điểm.",
    });
    if (ok) run("draw", () => tournamentsApi.tie.drawOrder(tid, mid), "Đã bốc thăm thứ tự");
  };

  const handlePlayers = (r, side, ids) => {
    const key = `${r.id}:${side}`;
    const n = rubberSize(r.code);
    if (ids.length && ids.length !== n) { setPendingSides((p) => ({ ...p, [key]: ids })); return; }   // chờ chọn đủ
    setBusy(r.id);
    tournamentsApi.tie.setPlayers(tid, mid, r.id, side === 1 ? { side1_players: ids } : { side2_players: ids })
      .then((res) => apply(res.data, { notify: false }))
      .catch((err) => message.error(err?.response?.data?.detail || "Không thể đổi VĐV"))
      .finally(() => setBusy(null));
  };

  const handleScore = async (r) => {
    const v = inputs[r.id] || {};
    const s1 = Number(v.s1), s2 = Number(v.s2);
    if (v.s1 == null || v.s2 == null || Number.isNaN(s1) || Number.isNaN(s2)) { message.error("Nhập đủ điểm hai bên"); return; }
    if (r.status === "completed") {
      const ok = await confirm({
        title: `Sửa điểm ${r.label}?`,
        content: pa2 ? "Điểm nối tiếp: chỉ sửa được khi các trận sau chưa có điểm." : "Kết quả trận đồng đội và vòng sau (nếu có) sẽ được tính lại.",
      });
      if (!ok) return;
    }
    run(r.id, () => tournamentsApi.tie.score(tid, mid, r.id, { score1: s1, score2: s2 }), `Đã lưu ${r.label}: ${s1}–${s2}`);
  };

  const handleWalkover = async (r, side) => {
    const loser = side === 1 ? t1 : t2;
    const ok = await confirm({
      title: `Xử thua ${r.label} cho đội "${loser}"?`,
      content: pa2
        ? "Bên thắng được cộng tới mốc của trận này, bên thua giữ nguyên điểm xuất phát (điều lệ 5.1)."
        : `Bên thua nhận 0 − ${rules.points_per_rubber} (điều lệ 5.1).`,
      okButtonProps: { danger: true }, okText: "Xử thua",
    });
    if (ok) run(r.id, () => tournamentsApi.tie.walkover(tid, mid, r.id, { side }), `Đã xử thua ${r.label}`);
  };

  const handleReset = async (r) => {
    const ok = await confirm({
      title: `Xoá điểm ${r.label}?`,
      content: pa2 ? "Điểm nối tiếp: các trận SAU trận này cũng bị xoá điểm. Trận đồng đội quay về đang đấu, vòng sau (nếu có) bị dọn." : "Trận đồng đội quay về đang đấu; kết quả ở vòng sau (nếu có) bị dọn.",
      okButtonProps: { danger: true }, okText: "Xoá điểm",
    });
    if (ok) run(r.id, () => tournamentsApi.tie.resetScore(tid, mid, r.id), `Đã xoá điểm ${r.label}`);
  };

  // ── Điều kiện thao tác từng trận thành phần ──
  const gate = (r) => {
    if (!editable) return { score: false, players: false, reset: false, hint: tie?.can_edit === false ? (tie?.blocked_reason || "Giải chưa bắt đầu hoặc đã kết thúc") : null };
    const done = r.status === "completed";
    if (!pa2) return { score: true, players: !done, reset: done, hint: null };
    const prevAllDone = rubbers.filter((x) => x.order_index < r.order_index).every((x) => x.status === "completed");
    const laterDone = rubbers.some((x) => x.order_index > r.order_index && x.status === "completed");
    if (done) return { score: !laterDone, players: false, reset: true, hint: laterDone ? "Trận sau đã có điểm — xoá điểm trận sau trước khi sửa" : null };
    if (finished) return { score: false, players: true, reset: false, hint: "Trận đồng đội đã chạm mốc tổng — không cần đấu" };
    if (!prevAllDone) return { score: false, players: true, reset: false, hint: "Điểm nối tiếp: nhập các trận trước theo đúng thứ tự" };
    return { score: true, players: true, reset: false, hint: null };
  };

  const sideBlock = (r, side, g) => {
    const ids = r[`side${side}_players`] || [];
    const key = `${r.id}:${side}`;
    const shown = pendingSides[key] ?? ids;
    const team = side === 1 ? tie.team1 : tie.team2;
    const issue = slotIssueText(r.code, ids, playerById);
    return (
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>{side === 1 ? t1 : t2}</Text>
        {g.players ? (
          <SlotSelect code={r.code} value={shown} onChange={(v) => handlePlayers(r, side, v)} players={team?.players || []}
            overLimit={[...over]} counts={counts} size={isMobileView ? "large" : "middle"} disabled={busy === r.id} />
        ) : (
          <div style={{ minHeight: 24 }}>
            {ids.length === 0 ? <Text type="secondary">— chưa xếp —</Text> : ids.map((id) => (
              <Tag key={id} style={{ fontWeight: over.has(id) ? 700 : 400, marginBottom: 2 }}>
                {playerById[id]?.display_name || `#${id}`} <GenderTag value={playerById[id]?.gender} />
              </Tag>
            ))}
          </div>
        )}
        {pendingSides[key] && <Text type="secondary" style={{ fontSize: 12 }}>Chọn đủ {rubberSize(r.code)} VĐV để lưu</Text>}
        {!pendingSides[key] && issue && <Text type="warning" style={{ fontSize: 12 }}>⚠ {issue}</Text>}
      </div>
    );
  };

  const rubberCard = (r) => {
    const g = gate(r);
    const done = r.status === "completed";
    const v = inputs[r.id] || {};
    const winner1 = done && (r.score1 ?? 0) > (r.score2 ?? 0);
    const winner2 = done && (r.score2 ?? 0) > (r.score1 ?? 0);
    const unitHint = pa2 ? `Xuất phát ${r.start1} – ${r.start2} → mốc ${r.target}` : `Tới ${r.target} điểm${rules.win_by_two ? ", cách biệt 2" : ""}`;
    const statusColor = done ? (r.is_walkover ? "gold" : "success") : (finished ? "default" : "processing");
    const walkoverItems = [
      { key: "1", label: `${t1} thua (bỏ / đến trễ)` },
      { key: "2", label: `${t2} thua (bỏ / đến trễ)` },
    ];
    return (
      <Card key={r.id} size="small" style={{ borderColor: done ? "#b7eb8f" : undefined }}
        title={
          <Space size={6} wrap>
            <Text type="secondary">#{r.order_index}</Text>
            <Text strong>{r.label}</Text>
            <Tag style={{ margin: 0 }}>{rubberName(r.code)}</Tag>
            <Tag color={statusColor} style={{ margin: 0 }}>{rubberStatusLabel(r, finished)}</Tag>
          </Space>
        }
        extra={<Text type="secondary" style={{ fontSize: 12 }}>{unitHint}</Text>}>
        <Row gutter={[12, 8]}>
          <Col xs={24} md={12}>{sideBlock(r, 1, g)}</Col>
          <Col xs={24} md={12}>{sideBlock(r, 2, g)}</Col>
        </Row>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <InputNumber className="tie-score-input" min={0} max={999} controls={false} inputMode="numeric" size="large"
            value={v.s1} disabled={!g.score || busy === r.id}
            style={{ borderColor: winner1 ? "#52c41a" : undefined }}
            onChange={(x) => setInputs((p) => ({ ...p, [r.id]: { ...(p[r.id] || {}), s1: x } }))} />
          <Text style={{ fontSize: 22, color: "#999" }}>–</Text>
          <InputNumber className="tie-score-input" min={0} max={999} controls={false} inputMode="numeric" size="large"
            value={v.s2} disabled={!g.score || busy === r.id}
            style={{ borderColor: winner2 ? "#52c41a" : undefined }}
            onChange={(x) => setInputs((p) => ({ ...p, [r.id]: { ...(p[r.id] || {}), s2: x } }))} />
          {editable && (
            <Space wrap>
              <Button type="primary" icon={<SaveOutlined />} disabled={!g.score} loading={busy === r.id} onClick={() => handleScore(r)}
                style={{ minHeight: 44, minWidth: 88 }}>
                {done ? "Sửa" : "Lưu"}
              </Button>
              {!done && (
                <Dropdown menu={{ items: walkoverItems, onClick: ({ key }) => handleWalkover(r, Number(key)) }} disabled={!g.score} trigger={["click"]}>
                  <Button icon={<StopOutlined />} disabled={!g.score} style={{ minHeight: 44 }}>Xử thua</Button>
                </Dropdown>
              )}
              {done && (
                <Button danger icon={<DeleteOutlined />} disabled={!g.reset} loading={busy === r.id} onClick={() => handleReset(r)} style={{ minHeight: 44 }}>
                  Xoá điểm
                </Button>
              )}
            </Space>
          )}
        </div>
        {g.hint && <Text type="secondary" style={{ display: "block", textAlign: "center", fontSize: 12, marginTop: 6 }}>{g.hint}</Text>}
        {done && r.is_walkover && <Text type="warning" style={{ display: "block", textAlign: "center", fontSize: 12, marginTop: 4 }}>Kết quả xử thua</Text>}
      </Card>
    );
  };

  const res = tie?.result;
  const winnerName = res?.winner_side === 1 ? t1 : res?.winner_side === 2 ? t2 : null;

  return (
    <Modal open onCancel={onClose} destroyOnHidden
      title={<span>Biên bản trận đồng đội — {match.round_name || "Trận"} #{match.match_number}</span>}
      width={isMobileView ? "100vw" : 880}
      style={isMobileView ? { top: 0, margin: 0, maxWidth: "100vw", paddingBottom: 0 } : undefined}
      footer={<Button onClick={onClose} style={{ minHeight: 44 }}>Đóng</Button>}>
      <style>{BIG_INPUT_CSS}</style>
      {loading || !tie ? <div style={{ textAlign: "center", padding: 24 }}><Spin /></div> : (
        <>
          {/* Header: 2 đội + tỉ số tổng */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <Title level={5} style={{ margin: 0, flex: 1, textAlign: "right", color: res.winner_side === 1 ? "#237804" : undefined }}>{t1}</Title>
            <div style={{ flex: "none", textAlign: "center", minWidth: 110 }}>
              <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{res.score1} – {res.score2}</div>
              <Text type="secondary" style={{ fontSize: 11 }}>{pa2 ? `điểm · mốc ${rules.target_total}` : "trận thắng"}</Text>
            </div>
            <Title level={5} style={{ margin: 0, flex: 1, color: res.winner_side === 2 ? "#237804" : undefined }}>{t2}</Title>
          </div>
          <div style={{ textAlign: "center", marginBottom: 10 }}>
            <Space size={4} wrap style={{ justifyContent: "center" }}>
              <Tag color="blue">{STAGE_LABELS[tie.stage_key] || tie.stage_key}</Tag>
              <Tag>{SCORING_SHORT[rules.scoring]}</Tag>
              {finished
                ? <Tag color="success">Kết thúc{winnerName ? ` — ${winnerName} thắng` : ""}</Tag>
                : res.decided
                  ? <Tag color="processing">Đã phân định — đánh hết các trận còn lại</Tag>
                  : <Tag color="processing">Đang đấu</Tag>}
            </Space>
            {res.detail && <Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }}>{res.detail}</Text>}
          </div>

          {/* Bốc thăm thứ tự */}
          {tie.draw_seed ? (
            <Text type="secondary" style={{ display: "block", fontSize: 12, marginBottom: 10 }}>
              <GiftOutlined /> Thứ tự đã bốc thăm · seed <Text code copyable style={{ fontSize: 12 }}>{tie.draw_seed}</Text>
            </Text>
          ) : (
            <Alert type="warning" showIcon style={{ marginBottom: 10 }}
              message="Chưa bốc thăm thứ tự trận thành phần — đang theo thứ tự mẫu"
              action={editable && !anyScored && (
                <Button type="primary" size="small" icon={<GiftOutlined />} loading={busy === "draw"} onClick={handleDraw}>Bốc thăm thứ tự</Button>
              )} />
          )}

          {(tie.warnings?.length > 0 || over.size > 0) && (
            <Alert type="warning" showIcon style={{ marginBottom: 10 }} message="Cảnh báo (không chặn)"
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {over.size > 0 && (
                    <li>Vượt tối đa {rules.max_rubbers_per_player} trận/VĐV: {[...over].map((id) => `${playerById[id]?.display_name || id} (${counts[id]} trận)`).join(", ")}</li>
                  )}
                  {(tie.warnings || []).map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              } />
          )}

          {rubbers.length === 0 && (
            <Alert type="info" showIcon style={{ marginBottom: 10 }}
              message={!tie.match?.p1_id || !tie.match?.p2_id
                ? "Trận chưa đủ 2 đội — biên bản được tạo khi xác định xong đối thủ"
                : "Chưa có biên bản — người có quyền sửa mở biên bản này (giải đang diễn ra) để tạo các trận thành phần"} />
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rubbers.map(rubberCard)}
          </div>

          <Text type="secondary" style={{ display: "block", marginTop: 12, fontSize: 12 }}>
            Đội hình {STAGE_LABELS[tie.stage_key]}: {t1} {tie.lineup1?.locked ? "đã khoá" : "chưa khoá"} · {t2} {tie.lineup2?.locked ? "đã khoá" : "chưa khoá"}
            {" — "}khoá tự động khi trận thành phần đầu tiên của giai đoạn có điểm.
          </Text>
        </>
      )}
    </Modal>
  );
}
