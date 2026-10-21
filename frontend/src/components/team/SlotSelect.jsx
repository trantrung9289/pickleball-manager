import { Select, Typography } from "antd";
import GenderTag from "./GenderTag";
import { preferredGenders, rubberSize } from "../../utils/teamFormat";

const { Text } = Typography;

/**
 * Chọn VĐV cho một slot (một trận thành phần) — Select nhiều, đúng số người theo thể thức (maxCount); gợi ý lọc
 * theo giới tính nhưng vẫn cho chọn khác (cảnh báo ở ngoài). Dùng trong StageLineupModal và TieSheetModal.
 * Props: { code, value, onChange, players, overLimit (mảng id tô đậm), counts ({id: số trận}), disabled, size, placeholder }
 */
export default function SlotSelect({ code, value, onChange, players, overLimit = [], counts = {}, disabled = false, size, placeholder }) {
  const n = rubberSize(code);
  const over = new Set((overLimit || []).map(Number));
  const preferred = preferredGenders(code);
  const toOption = (p) => ({
    value: p.id,
    title: p.display_name,
    label: (
      <span style={{ fontWeight: over.has(p.id) ? 700 : 400 }}>
        {p.display_name}
        {p.is_captain ? " ★" : ""}
        <GenderTag value={p.gender} style={{ marginLeft: 4 }} />
        {counts[p.id] > 0 && <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>({counts[p.id]} trận)</Text>}
      </span>
    ),
  });
  const good = (players || []).filter((p) => preferred.includes(p.gender));
  const other = (players || []).filter((p) => !preferred.includes(p.gender));
  const options = good.length && other.length
    ? [{ label: "Gợi ý (đúng giới tính)", options: good.map(toOption) }, { label: "Khác / chưa khai", options: other.map(toOption) }]
    : [...good, ...other].map(toOption);
  return (
    <Select mode="multiple" value={value || []} onChange={(v) => onChange(v || [])} options={options} disabled={disabled}
      maxCount={n} size={size} style={{ width: "100%" }} allowClear showSearch optionFilterProp="title"
      placeholder={placeholder || `Chọn ${n} VĐV`} maxTagCount="responsive"
      filterOption={(inp, opt) => (opt?.title || "").toLowerCase().includes(inp.toLowerCase())} />
  );
}
