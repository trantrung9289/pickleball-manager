import { useState } from "react";
import { Alert, Button, Input, InputNumber, Radio, Space, Switch, Tag, Tooltip, Typography } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  RUBBER_CODE_LIST, SCORING_LABELS, defaultRubbers, defaultTargetTotal, placeholderLabels, rubberName,
} from "../../utils/teamFormat";

const { Text } = Typography;

const CODE_COLOR = { MD: "blue", WD: "magenta", XD: "purple", MS: "geekblue", WS: "pink" };
const POINT_PRESETS = [11, 15, 21];

/**
 * Editor quy tắc giải đồng đội (team_rules) — controlled: props { value, onChange, disabled }.
 * `value` giữ shape thô của editor (nhãn trận có thể rỗng → hiển thị placeholder tự đánh số); trước khi gửi API
 * dùng normalizeTeamRules(value) để điền nhãn/mốc như backend.
 *  - scoring: PA1 "match_points" (đếm trận thắng) | PA2 "cumulative" (điểm nối tiếp, mốc tổng).
 *  - rubbers: danh sách trận thành phần theo thứ tự mẫu (thứ tự thật được bốc thăm từng trận đồng đội).
 *  - points_per_rubber 11/15/21 (hoặc tuỳ chỉnh), win_by_two, target_total (PA2), max_rubbers_per_player.
 */
export default function TeamRulesEditor({ value, onChange, disabled = false }) {
  const rules = value || {};
  const rubbers = rules.rubbers || [];
  const scoring = rules.scoring === "cumulative" ? "cumulative" : "match_points";
  const ppr = rules.points_per_rubber || 11;
  // Mốc tổng PA2 tự = điểm × số trận cho tới khi người dùng tự sửa (targetEdited)
  const [targetEdited, setTargetEdited] = useState(
    () => rules.target_total != null && rules.target_total !== defaultTargetTotal(rules),
  );

  const emit = (patch) => {
    const next = { ...rules, ...patch };
    if (!targetEdited) next.target_total = defaultTargetTotal(next);
    onChange(next);
  };
  const setRubbers = (list) => emit({ rubbers: list });
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= rubbers.length) return;
    const list = [...rubbers];
    [list[i], list[j]] = [list[j], list[i]];
    setRubbers(list);
  };

  const placeholders = placeholderLabels(rubbers);
  const autoTarget = defaultTargetTotal(rules);

  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Cách tính kết quả trận đồng đội</div>
      <Radio.Group value={scoring} disabled={disabled} onChange={(e) => emit({ scoring: e.target.value })}
        style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        <Radio value="match_points">
          <b>{SCORING_LABELS.match_points}</b>
          <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
            Mỗi trận thành phần thắng = 1. Đánh hết các trận; hoà số trận → hiệu số điểm nhỏ → đội thắng trận cuối.
          </Text>
        </Radio>
        <Radio value="cumulative">
          <b>{SCORING_LABELS.cumulative}</b>
          <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
            Điểm trận sau nối tiếp trận trước (11 → 22 → 33...). Đội chạm mốc tổng trước thắng cả trận đồng đội.
          </Text>
        </Radio>
      </Radio.Group>

      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        Các trận thành phần ({rubbers.length})
        <Text type="secondary" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
          thứ tự mẫu — thứ tự thật sẽ bốc thăm ở từng trận đồng đội
        </Text>
      </div>
      {rubbers.length === 0 && (
        <Alert type="error" showIcon style={{ marginBottom: 8 }} message="Cần ít nhất 1 trận thành phần" />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
        {rubbers.map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Text type="secondary" style={{ width: 18, textAlign: "right", flex: "none" }}>{i + 1}.</Text>
            <Tag color={CODE_COLOR[r.code]} style={{ margin: 0, width: 108, textAlign: "center", flex: "none" }}>
              {rubberName(r.code)}
            </Tag>
            <Input size="small" value={r.label || ""} placeholder={placeholders[i]} disabled={disabled} maxLength={60}
              style={{ flex: "1 1 140px", minWidth: 120 }}
              onChange={(e) => setRubbers(rubbers.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Space size={2} style={{ flex: "none" }}>
              <Button size="small" icon={<ArrowUpOutlined />} disabled={disabled || i === 0} onClick={() => move(i, -1)} />
              <Button size="small" icon={<ArrowDownOutlined />} disabled={disabled || i === rubbers.length - 1} onClick={() => move(i, 1)} />
              <Button size="small" danger icon={<DeleteOutlined />} disabled={disabled}
                onClick={() => setRubbers(rubbers.filter((_, j) => j !== i))} />
            </Space>
          </div>
        ))}
      </div>
      <Space wrap size={4} style={{ marginBottom: 12 }}>
        {RUBBER_CODE_LIST.map((code) => (
          <Button key={code} size="small" type="dashed" icon={<PlusOutlined />} disabled={disabled || rubbers.length >= 20}
            onClick={() => setRubbers([...rubbers, { code, label: "" }])}>
            {rubberName(code)}
          </Button>
        ))}
        <Tooltip title="Về mẫu 5 thể thức: Đôi Nam, Đôi Nữ, Đôi Nam Nữ, Đơn Nam, Đơn Nữ">
          <Button size="small" icon={<ReloadOutlined />} disabled={disabled} onClick={() => setRubbers(defaultRubbers())}>
            Mặc định
          </Button>
        </Tooltip>
      </Space>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 24px", alignItems: "center", marginBottom: 8 }}>
        <Space size={6} wrap>
          <Text>Điểm mỗi trận</Text>
          <InputNumber min={1} max={99} value={ppr} disabled={disabled} style={{ width: 70 }}
            onChange={(v) => emit({ points_per_rubber: v || 11 })} />
          {POINT_PRESETS.map((n) => (
            <Button key={n} size="small" type={ppr === n ? "primary" : "default"} disabled={disabled}
              onClick={() => emit({ points_per_rubber: n })}>{n}</Button>
          ))}
        </Space>
        <Space size={6}>
          <Switch size="small" checked={rules.win_by_two !== false} disabled={disabled}
            onChange={(v) => emit({ win_by_two: v })} />
          <Text>Cách biệt 2 điểm</Text>
        </Space>
        <Space size={6}>
          <Text>Tối đa trận / VĐV</Text>
          <InputNumber min={1} max={20} value={rules.max_rubbers_per_player || 2} disabled={disabled} style={{ width: 60 }}
            onChange={(v) => emit({ max_rubbers_per_player: v || 2 })} />
          <Tooltip title="Vượt giới hạn chỉ CẢNH BÁO (tên tô đậm), không chặn"><Text type="secondary">?</Text></Tooltip>
        </Space>
      </div>

      <Space size={6} wrap style={{ marginBottom: 8 }}>
        <Text>Sĩ số đội tối đa</Text>
        <InputNumber min={1} max={99} placeholder="—" value={rules.max_male ?? null} disabled={disabled} style={{ width: 64 }}
          addonAfter="Nam" onChange={(v) => emit({ max_male: v || null })} />
        <InputNumber min={1} max={99} placeholder="—" value={rules.max_female ?? null} disabled={disabled} style={{ width: 64 }}
          addonAfter="Nữ" onChange={(v) => emit({ max_female: v || null })} />
        <InputNumber min={1} max={199} placeholder="—" value={rules.max_players ?? null} disabled={disabled} style={{ width: 70 }}
          addonAfter="tổng" onChange={(v) => emit({ max_players: v || null })} />
        <Tooltip title="Để trống = không giới hạn. Vượt sĩ số chỉ CẢNH BÁO trên thẻ đội (bộ đếm 7/8 Nam, 2/2 Nữ), không chặn"><Text type="secondary">?</Text></Tooltip>
      </Space>

      {scoring === "cumulative" && (
        <Space size={6} wrap style={{ marginBottom: 4 }}>
          <Text>Mốc tổng (PA2)</Text>
          <InputNumber min={ppr} max={autoTarget} value={rules.target_total ?? autoTarget} disabled={disabled} style={{ width: 80 }}
            onChange={(v) => { setTargetEdited(true); onChange({ ...rules, target_total: Math.min(v || autoTarget, autoTarget) }); }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            tối đa {ppr} × {rubbers.length || 0} = {autoTarget} (thấp hơn → có thể kết thúc sớm)
            {targetEdited && (
              <Button type="link" size="small" style={{ padding: "0 4px" }} disabled={disabled}
                onClick={() => { setTargetEdited(false); onChange({ ...rules, target_total: autoTarget }); }}>
                dùng mặc định
              </Button>
            )}
          </Text>
        </Space>
      )}
    </div>
  );
}
