/**
 * TransparencyPanel — khối "Minh bạch" (cam kết seed, seed đã công bố, công thức, nút Kiểm chứng)
 * dùng chung cho vòng quay bốc CẶP ĐẤU và vòng quay GHÉP ĐỘI. Không tự tính gì: caller truyền
 * onVerify + verifyState ({loading, result}; result undefined = chưa bấm, null = không tính được).
 */
import { Button, Space, Tag } from "antd";
import { SafetyCertificateOutlined } from "@ant-design/icons";

export default function TransparencyPanel({
  seedCommit, seedHex, formulaText, onVerify, verifyState = { loading: false, result: undefined }, colors,
}) {
  const c = colors || { text: "inherit", muted: "#8c8c8c", panel: "transparent", border: "#d9d9d9" };
  const panelStyle = { background: c.panel, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12 };
  const codeStyle = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, wordBreak: "break-all", color: c.text };
  const result = verifyState?.result;

  return (
    <div style={{ ...panelStyle, fontSize: 13, color: c.text }}>
      <div style={{ fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        <SafetyCertificateOutlined /> Minh bạch
      </div>
      <div style={{ color: c.muted }}>Cam kết seed (SHA-256):</div>
      <div style={codeStyle}>{seedCommit || "—"}</div>
      {seedHex ? (
        <>
          <div style={{ color: c.muted, marginTop: 6 }}>Seed đã công bố:</div>
          <div style={codeStyle}>{seedHex}</div>
        </>
      ) : (
        <div style={{ color: c.muted, marginTop: 6 }}>Seed sẽ được công bố khi phiên kết thúc.</div>
      )}
      {formulaText && (
        <div style={{ color: c.muted, marginTop: 6 }}>
          Công thức lượt k: <code style={codeStyle}>{formulaText}</code>
        </div>
      )}
      {seedHex && onVerify && (
        <Space wrap size={8} style={{ marginTop: 8 }}>
          <Button size="small" icon={<SafetyCertificateOutlined />} loading={!!verifyState?.loading} onClick={onVerify}>
            Kiểm chứng
          </Button>
          {result === null && (
            <span style={{ color: c.muted }}>Trình duyệt không hỗ trợ tính SHA-256 (cần HTTPS).</span>
          )}
          {result && (
            result.ok
              ? <Tag color="success">✅ Hợp lệ — seed khớp cam kết, {result.steps.length} lượt đúng công thức</Tag>
              : <Tag color="error">❌ Không khớp{result.commitOk ? "" : " (seed ≠ cam kết)"}</Tag>
          )}
        </Space>
      )}
    </div>
  );
}
