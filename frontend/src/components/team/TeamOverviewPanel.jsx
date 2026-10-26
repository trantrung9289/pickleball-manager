/**
 * TeamOverviewPanel — tab "Tổng quan" của giải đồng đội (admin & public), (2026-10-26):
 * tiến độ trận đồng đội / trận thành phần / VĐV, danh sách "cặp đấu chưa xong" (bấm mở biên bản),
 * đội dẫn đầu từng bảng (từ API xếp hạng), kết quả chung cuộc, tóm tắt thể thức.
 * Props: { tournament, rules, fetchStandings(group|null) → Promise<rows>, onOpenMatch(m)?, isPublic? }
 */
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Empty, List, Row, Space, Tag, Typography } from "antd";
import { StatCard } from "../ui";
import { FileTextOutlined } from "@ant-design/icons";
import { tieScoreLabel } from "../../utils/teamFormat";
import {
  finalPlacements, teamName, teamOverviewCounts, teamRoundsPlayed, teamRuleSummary,
} from "../../utils/teamOverview";

const { Text } = Typography;
const MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉", 4: "4️⃣" };

export default function TeamOverviewPanel({ tournament, rules, fetchStandings, onOpenMatch, isPublic = false }) {
  const matches = useMemo(() => tournament.matches || [], [tournament.matches]);
  const participants = useMemo(() => tournament.participants || [], [tournament.participants]);
  const byId = useMemo(() => Object.fromEntries(participants.map((p) => [p.id, p])), [participants]);
  const groups = useMemo(() => [...new Set(participants.map((p) => p.group_name).filter(Boolean))].sort(), [participants]);
  const counts = useMemo(() => teamOverviewCounts(tournament, rules), [tournament, rules]);
  const placements = useMemo(() => finalPlacements(matches), [matches]);
  const summary = useMemo(() => teamRuleSummary(tournament, rules), [tournament, rules]);
  const hasGroupStage = matches.some((m) => m.phase !== "knockout");
  const doneCount = counts.ties.done;

  // Dẫn đầu từng bảng (hoặc toàn giải với vòng tròn) — API xếp hạng dùng chung với tab BXH
  const [leaders, setLeaders] = useState([]);
  useEffect(() => {
    if (!fetchStandings || !hasGroupStage) return undefined;
    let cancelled = false;
    const keys = groups.length ? groups : [null];
    Promise.all(keys.map((g) => fetchStandings(g).then((r) => ({ group: g, rows: r?.data ?? r ?? [] })).catch(() => ({ group: g, rows: [] }))))
      .then((res) => { if (!cancelled) setLeaders(res); });
    return () => { cancelled = true; };
  }, [fetchStandings, groups, hasGroupStage, doneCount]);

  const allDone = counts.ties.total > 0 && counts.ties.pending.length === 0;
  const koStarted = matches.some((m) => m.phase === "knockout");
  const nextStep = allDone
    ? (tournament.format === "combined" && !koStarted
      ? "Vòng bảng đã nhập đủ. Sang bước Lên vòng loại trực tiếp để xếp các trận tiếp theo."
      : tournament.status === "completed" ? "Giải đã kết thúc." : "Mọi trận đã có kết quả.")
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><StatCard title="Trận đồng đội" value={counts.ties.done} total={counts.ties.total} note={`${counts.ties.pending.length} chưa xong`} /></Col>
        <Col xs={12} md={6}><StatCard title="Trận thành phần" value={counts.rubbers.done} total={counts.rubbers.total} note={counts.rubbers.perTie ? `${counts.rubbers.perTie} trận / trận đồng đội` : null} /></Col>
        <Col xs={12} md={6}><StatCard title="VĐV đã vào đội" value={counts.players.assigned} total={counts.players.total} note={counts.players.pool ? `${counts.players.pool} chưa phân đội` : "đủ"} tone={counts.players.pool ? "warn" : "ink"} /></Col>
        <Col xs={12} md={6}>
          <StatCard title="Đội" value={counts.teams} note={groups.length ? `${groups.length} bảng: ${groups.join(", ")}` : "một bảng"} />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card size="small" title={<span>Cặp đấu chưa xong <Tag>{counts.ties.pending.length}</Tag></span>}>
            {counts.ties.pending.length === 0 ? (
              <Alert type="success" showIcon message={nextStep || "Chưa có trận nào được xếp."} />
            ) : (
              <List size="small" dataSource={counts.ties.pending} rowKey="id"
                renderItem={(m) => {
                  const live = tieScoreLabel(m);
                  return (
                    <List.Item
                      actions={onOpenMatch ? [<Button key="open" size="small" icon={<FileTextOutlined />} onClick={() => onOpenMatch(m)}>{isPublic ? "Xem biên bản" : "Mở biên bản"}</Button>] : undefined}>
                      <Space wrap size={6}>
                        <Tag color={m.phase === "knockout" ? "gold" : "blue"}>{m.round_name || `Vòng ${m.round_number}`}</Tag>
                        {m.group_name && <Tag>Bảng {m.group_name}</Tag>}
                        <Text strong>{teamName(m.p1 || byId[m.p1_id])}</Text>
                        <Text type="secondary">gặp</Text>
                        <Text strong>{teamName(m.p2 || byId[m.p2_id])}</Text>
                        {live.live && <Tag color="processing">Đang đấu {live.text}</Tag>}
                      </Space>
                    </List.Item>
                  );
                }} />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {hasGroupStage && (
              <Card size="small" title={groups.length ? "Dẫn đầu từng bảng" : "Dẫn đầu"}>
                {leaders.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu" /> : (
                  <Row gutter={[8, 8]}>
                    {leaders.map(({ group, rows }) => {
                      const top = rows?.[0];
                      const rp = top ? teamRoundsPlayed(matches.filter((m) => !group || m.group_name === group), top.participant_id) : null;
                      return (
                        <Col xs={24} sm={groups.length > 1 ? 12 : 24} key={group || "_all"}>
                          <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: "8px 10px", borderLeft: "4px solid #1677ff" }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>{group ? `Bảng ${group}` : "Toàn giải"}</Text>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>{top ? (top.team_name || top.full_name) : "—"}</div>
                            {top && (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {top.points} điểm · HS trận {top.rubber_diff > 0 ? "+" : ""}{top.rubber_diff ?? 0} · HS điểm {top.pts_diff > 0 ? "+" : ""}{top.pts_diff ?? 0}
                                {rp ? ` · ${rp.played}/${rp.total} lượt` : ""}
                              </Text>
                            )}
                          </div>
                        </Col>
                      );
                    })}
                  </Row>
                )}
              </Card>
            )}
            {placements && (
              <Card size="small" title="Kết quả chung cuộc">
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  {placements.map((x) => (
                    <div key={x.rank} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                      <span>{MEDAL[x.rank]} {x.label}</span>
                      <b>{teamName(byId[x.pid])}</b>
                    </div>
                  ))}
                </Space>
              </Card>
            )}
          </Space>
        </Col>
      </Row>

      <Card size="small" title="Thể thức">
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8, fontSize: 13 }}>
          {summary.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      </Card>
    </div>
  );
}
