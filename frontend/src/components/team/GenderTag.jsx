import { Tag } from "antd";
import { GENDER_LABELS } from "../../utils/teamFormat";

const COLOR = { male: "blue", female: "magenta", other: "default" };

/**
 * Tag giới tính nhỏ dùng chung (Thành viên / Khách mời / đội / đội hình / biên bản).
 * Props: value ("male" | "female" | "other" | null), showEmpty (hiện "Chưa khai" khi trống), style.
 */
export default function GenderTag({ value, showEmpty = false, style }) {
  if (!value || !GENDER_LABELS[value]) {
    return showEmpty
      ? <Tag color="warning" style={{ fontSize: 11, lineHeight: "16px", padding: "0 5px", margin: 0, ...style }}>Chưa khai</Tag>
      : null;
  }
  return (
    <Tag color={COLOR[value]} style={{ fontSize: 11, lineHeight: "16px", padding: "0 5px", margin: 0, ...style }}>
      {GENDER_LABELS[value]}
    </Tag>
  );
}
