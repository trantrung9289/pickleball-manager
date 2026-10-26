import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Tag, Typography, Spin, Alert, Space, Button, Badge, Empty } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useViewMode } from "../contexts/ViewModeContext";
import { useFastPoll } from "../hooks/useFastPoll";
import { teamLabel } from "../utils/tournamentLabels";
import {
  isCumulative, scoringLabel, stageLabel, playersById, rubberCodeLabel, rubberStatusLabel, normalizeTeamRules,
} from "../utils/teamLabels";

const { Text } = Typography;

const TIE_POLL_MS = 3000;       // biên bản đang diễn ra: poll GET .../matches/{mid}/tie (bucket rate-limit riêng 600/phút)
const TIE_POLL_SLOW_MS = 8000;  // giãn ra khi server trả 429, tới lần thành công kế tiếp

const GENDER_TAG = { male: { label: "Nam", color: "blue" }, female: { label: "Nữ", color: "magenta" } };

// Tên VĐV một bên của trận thành phần (tra từ team1/team2.players theo team_player_id); in đậm khi vượt số trận
function PlayerNames({ ids, byId, overLimit, align }) {
  if (!ids?.length) return <Text type="secondary" style={{ fontSize: 13 }}>Chưa xếp VĐV</Text>;
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 2, minWidth: 0,
      alignItems: align === "right" ? "flex-end" : "flex-start",
    }}>
      {ids.map((id) => {
        const p = byId[id];
        const over = overLimit.includes(id);
        const g = GENDER_TAG[p?.gender];
        return (
          <span key={id} style={{ fontSize: 14, fontWeight: over ? 700 : 500, wordBreak: "break-word", textAlign: align || "left" }}>
            {p?.display_name || `#${id}`}
            {g && (
              <Tag color={g.color} style={{ marginLeft: 4, marginRight: 0, fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>
                {g.label}
              </Tag>
            )}
          </span>
        );
      })}
    </div>
  );
}

// Một trận thành phần: nhãn + trạng thái, VĐV 2 bên, tỉ số; PA2 hiện điểm xuất phát → mốc
function RubberRow({ r, byId, overLimit, cumulative, isNext }) {
  const done = r.status === "completed";
  const won1 = done && (r.score1 ?? 0) > (r.score2 ?? 0);
  const won2 = done && (r.score2 ?? 0) > (r.score1 ?? 0);
  // PA2: điểm xuất phát chỉ có nghĩa với trận đã đấu hoặc trận kế tiếp (các trận sau chưa biết xuất phát)
  const showStart = cumulative && (done || isNext || (r.start1 || 0) > 0 || (r.start2 || 0) > 0);
  return (
    <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: "8px 10px", background: done ? "#fafafa" : "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <Text strong style={{ fontSize: 13 }}>
          #{r.order_index} · {r.label}{" "}
          <Text type="secondary" style={{ fontWeight: 400 }}>({rubberCodeLabel(r.code)})</Text>
        </Text>
        <Space size={4}>
          {r.court && <Tag color="geekblue" style={{ margin: 0 }}>Sân {r.court}</Tag>}
          {r.is_walkover && <Tag color="warning" style={{ margin: 0 }}>Xử thua</Tag>}
          <Tag color={done ? "success" : isNext ? "processing" : "default"} style={{ margin: 0 }}>
            {done ? "Đã đấu" : isNext ? "Tiếp theo" : rubberStatusLabel(r)}
          </Tag>
        </Space>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", gap: 8, alignItems: "center" }}>
        <div style={{ color: won1 ? "#237804" : undefined, minWidth: 0 }}>
          <PlayerNames ids={r.side1_players} byId={byId} overLimit={overLimit} />
        </div>
        <div style={{ textAlign: "center", minWidth: 64 }}>
          {done
            ? <div style={{ fontSize: 20, fontWeight: 700, whiteSpace: "nowrap" }}>{r.score1} – {r.score2}</div>
            : <Text type="secondary" style={{ fontSize: 16 }}>— : —</Text>}
          {showStart && (
            <div style={{ fontSize: 11, color: "#888", whiteSpace: "nowrap", lineHeight: 1.4 }}>
              {done ? `từ ${r.start1 || 0} – ${r.start2 || 0}` : `xuất phát ${r.start1 || 0} – ${r.start2 || 0}`}
              <br />mốc {r.target}
            </div>
          )}
          {!cumulative && !done && <div style={{ fontSize: 11, color: "#888" }}>tới {r.target} điểm</div>}
        </div>
        <div style={{ color: won2 ? "#237804" : undefined, minWidth: 0 }}>
          <PlayerNames ids={r.side2_players} byId={byId} overLimit={overLimit} align="right" />
        </div>
      </div>
    </div>
  );
}

/**
 * Biên bản trận đồng đội — bản public chỉ đọc (giải team KHÔNG nhập điểm qua public).
 * Poll mỗi 3s khi giải đang diễn ra và tie chưa kết thúc (hook dùng chung useFastPoll: tạm dừng khi tab ẩn,
 * giãn nhịp khi 429); giải đã kết thúc / tie đã xong → nạp một lần. Khi tie vừa chuyển sang kết thúc → gọi
 * onFinished để trang cha nạp lại lịch ngay thay vì chờ nhịp 12s.
 *
 * Props: api (createPublicReportApi(slug)), tid, match (PublicMatchOut từ lịch — dùng hiển thị tạm trước khi
 * TieOut về), tournament (để biết status), onClose, onFinished?.
 */
export default function PublicTieBoard({ api, tid, match, tournament, onClose, onFinished }) {
  const { isMobileView } = useViewMode();
  const [tie, setTie] = useState(null);
  const [error, setError] = useState(null);
  const loadedRef = useRef(false);        // đã nạp thành công ít nhất 1 lần
  const finishedRef = useRef(false);      // trạng thái finished lần nạp trước — phát hiện chuyển sang kết thúc
  const onFinishedRef = useRef(onFinished);
  useEffect(() => { onFinishedRef.current = onFinished; });

  const supported = typeof api?.tournaments?.tie === "function";
  const matchId = match?.id;

  // Trả { ok, status } để useFastPoll giãn nhịp khi 429 (lỗi 429 không hiện thông báo — giữ dữ liệu cũ)
  const loadTie = useCallback(async () => {
    if (!supported || !matchId) return { ok: false };
    try {
      const r = await api.tournaments.tie(tid, matchId);
      const d = r.data || null;
      const wasFinished = finishedRef.current;
      finishedRef.current = !!d?.result?.finished;
      setTie(d);
      setError(null);
      if (loadedRef.current && !wasFinished && finishedRef.current) onFinishedRef.current?.();
      loadedRef.current = true;
      return { ok: true };
    } catch (err) {
      const status = err?.response?.status;
      if (status !== 429) setError(err?.response?.data?.detail || "Không tải được biên bản trận đấu");
      return { ok: false, status };
    }
  }, [api, tid, matchId, supported]);

  // Lỗi ngay lần nạp đầu (404/mạng, không phải 429) → dừng poll, chờ bấm "Thử lại"; lỗi khi đã có dữ liệu → poll tiếp
  // Dừng poll khi trận đã xong: kết quả chốt, hoặc match completed (kể cả xử thắng do bỏ giải — không có biên bản)
  const done = !!tie?.result?.finished || (tie?.match || match)?.status === "completed";
  const live = tournament?.status === "active" && !done && !(error && !tie);
  useFastPoll(supported && live, loadTie, { intervalMs: TIE_POLL_MS, slowMs: TIE_POLL_SLOW_MS });

  // Không ở chế độ poll (giải đã kết thúc) và chưa có dữ liệu → nạp một lần
  useEffect(() => {
    if (supported && !live && !loadedRef.current) loadTie();
  }, [supported, live, loadTie]);

  const m = tie?.match || match;
  const rules = normalizeTeamRules(tie?.rules || tournament?.team_rules);
  const cumulative = isCumulative(rules);
  const byId = playersById(tie?.team1, tie?.team2);
  const overLimit = tie?.over_limit || [];
  const res = tie?.result;
  const name1 = teamLabel(m?.p1);
  const name2 = teamLabel(m?.p2);
  const rubbers = [...(tie?.rubbers || [])].sort((a, b) => a.order_index - b.order_index);
  const finished = !!res?.finished || m?.status === "completed";
  const started = (res?.score1 || 0) > 0 || (res?.score2 || 0) > 0 || rubbers.some((r) => r.status === "completed");
  const nextIdx = finished ? -1 : rubbers.findIndex((r) => r.status !== "completed");
  const winnerSide = res?.winner_side
    ?? (m?.status === "completed" ? (m.winner_id === m.p1_id ? 1 : m.winner_id === m.p2_id ? 2 : null) : null);

  return (
    <Modal
      open
      onCancel={onClose}
      footer={null}
      width={isMobileView ? "100%" : 760}
      style={isMobileView ? { top: 0, maxWidth: "100vw", margin: 0, paddingBottom: 0 } : { top: 24 }}
      styles={{
        content: { padding: isMobileView ? "12px 10px" : 24 },
        body: { maxHeight: isMobileView ? "calc(100vh - 90px)" : "72vh", overflowY: "auto", overflowX: "hidden" },
      }}
      title={(
        <span style={{ fontSize: 15 }}>
          Biên bản trận đồng đội{" "}
          <Text type="secondary" style={{ fontWeight: 400, fontSize: 13 }}>
            {m?.round_name || `Vòng ${m?.round_number ?? ""}`} · Trận #{m?.match_number}
            {m?.group_name ? ` · Bảng ${m.group_name}` : ""}
          </Text>
        </span>
      )}
    >
      {!supported && (
        <Alert type="warning" showIcon message="Phiên bản ứng dụng chưa hỗ trợ xem biên bản trận đồng đội" />
      )}
      {supported && error && !tie && (
        <Alert
          type="error" showIcon message={error}
          action={<Button size="small" icon={<ReloadOutlined />} onClick={loadTie}>Thử lại</Button>}
        />
      )}
      {supported && !tie && !error && (
        <div style={{ textAlign: "center", padding: 32 }}><Spin /></div>
      )}
      {tie && (
        <>
          <div style={{
            display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", gap: 8, alignItems: "center",
            padding: "12px 8px", background: "#f5f7fa", borderRadius: 10,
          }}>
            <div style={{ textAlign: "center", minWidth: 0 }}>
              <Text strong style={{ fontSize: 15, color: winnerSide === 1 ? "#237804" : undefined, wordBreak: "break-word" }}>
                {name1}
              </Text>
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, whiteSpace: "nowrap", color: "#1677ff", lineHeight: 1 }}>
              {res?.score1 ?? 0} – {res?.score2 ?? 0}
            </div>
            <div style={{ textAlign: "center", minWidth: 0 }}>
              <Text strong style={{ fontSize: 15, color: winnerSide === 2 ? "#237804" : undefined, wordBreak: "break-word" }}>
                {name2}
              </Text>
            </div>
          </div>
          <div style={{ textAlign: "center", marginTop: 8 }}>
            <Space size={6} wrap style={{ justifyContent: "center" }}>
              <Tag color={finished ? "success" : started ? "processing" : "default"} style={{ margin: 0 }}>
                {finished ? "Đã kết thúc" : started ? "Đang diễn ra" : "Chưa bắt đầu"}
              </Tag>
              {res?.detail && <Text type="secondary" style={{ fontSize: 13 }}>{res.detail}</Text>}
            </Space>
          </div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 8, lineHeight: 1.6, wordBreak: "break-word" }}>
            <div>
              Giai đoạn: {stageLabel(tie.stage_key)} · {scoringLabel(rules)} · {rules.points_per_rubber} điểm/trận
              {rules.win_by_two ? ", cách biệt 2" : ""}
              {cumulative ? ` · mốc tổng ${rules.target_total}` : (rules.play_all ? " · đánh hết các trận" : "")}
              {" · "}tối đa {rules.max_rubbers_per_player} trận/VĐV
            </div>
            <div>
              {tie.draw_seed
                ? <>Thứ tự thể thức đã bốc thăm · seed <Text code style={{ fontSize: 11 }}>{tie.draw_seed}</Text></>
                : "Thứ tự thể thức theo mẫu (chưa bốc thăm)"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {rubbers.length === 0
              ? <Empty description="Chưa có trận thành phần" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              : rubbers.map((r, i) => (
                <RubberRow
                  key={r.id ?? r.order_index} r={r} byId={byId} overLimit={overLimit}
                  cumulative={cumulative} isNext={i === nextIdx}
                />
              ))}
          </div>
          {overLimit.length > 0 && (
            <Text type="warning" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
              ⚠ {overLimit.map((id) => byId[id]?.display_name || `#${id}`).join(", ")} được xếp quá {rules.max_rubbers_per_player} trận thành phần trong trận đồng đội này (in đậm).
            </Text>
          )}
          {tie.match?.btc_note && (
            <Alert type="info" showIcon style={{ marginTop: 10 }} message="Ghi chú BTC"
              description={<span style={{ whiteSpace: "pre-wrap" }}>{tie.match.btc_note}</span>} />
          )}
          <div style={{ marginTop: 10, textAlign: "center" }}>
            <Badge status={live ? "processing" : "default"} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {" "}{live ? `Cập nhật mỗi ${TIE_POLL_MS / 1000}s` : "Biên bản đã chốt"}
            </Text>
          </div>
        </>
      )}
    </Modal>
  );
}
