/**
 * TeamImportModal — nhập ĐỘI + VĐV cho giải đồng đội từ Excel (mẫu FIS đợt 5, 2026-10-26).
 * Tải mẫu → điền → kéo thả; kết quả: số đội tạo, VĐV thêm, khách mời tạo, dòng bỏ qua / lỗi.
 * Props: { tid, onDone(result), onClose }
 */
import { useState } from "react";
import { Alert, Button, List, Modal, Space, Tag, Typography, Upload, message } from "antd";
import { DownloadOutlined, InboxOutlined } from "@ant-design/icons";
import { tournamentsApi } from "../../api";

const { Text } = Typography;

export default function TeamImportModal({ tid, onDone, onClose }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const downloadTemplate = async () => {
    try {
      const res = await tournamentsApi.teamPlayers.importTemplate();
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url; a.download = "mau_nhap_vdv_giai_dong_doi.xlsx"; a.click();
      URL.revokeObjectURL(url);
    } catch { message.error("Không tải được file mẫu"); }
  };
  const handleFile = async (file) => {
    setBusy(true);
    try {
      const res = await tournamentsApi.teamPlayers.importExcel(tid, file);
      setResult(res.data);
      if (res.data.added > 0 || res.data.teams_created?.length) await onDone?.(res.data);
    } catch (err) {
      message.error(err?.response?.data?.detail || "Nhập file thất bại");
    } finally { setBusy(false); }
    return false;
  };

  return (
    <Modal open title="Nhập đội & VĐV từ Excel" onCancel={onClose} footer={<Button onClick={onClose}>Đóng</Button>} width={640}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Alert type="info" showIcon message="Cột: Đội · Họ và tên · Giới tính · Hạng · Mã TV · SĐT"
          description="Khớp thành viên theo Mã TV → SĐT → họ tên (duy nhất trong CLB); không khớp → tạo khách mời. Cột Đội trống → vào danh sách chưa phân đội. Đội chưa có được tạo tự động khi giải còn Nháp." />
        <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>Tải file mẫu</Button>
        <Upload.Dragger accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleFile} disabled={busy}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">{busy ? "Đang nhập…" : "Kéo thả hoặc bấm để chọn file Excel"}</p>
        </Upload.Dragger>
        {result && (
          <div>
            <Space wrap size={6} style={{ marginBottom: 8 }}>
              <Tag color="success">Thêm {result.added} VĐV</Tag>
              {result.teams_created?.length > 0 && <Tag color="blue">Tạo {result.teams_created.length} đội: {result.teams_created.join(", ")}</Tag>}
              {result.guests_created > 0 && <Tag color="orange">Tạo {result.guests_created} khách mời</Tag>}
              {result.skipped?.length > 0 && <Tag>Bỏ qua {result.skipped.length}</Tag>}
              {result.errors?.length > 0 && <Tag color="error">{result.errors.length} dòng lỗi</Tag>}
              <Tag>Chưa phân đội: {result.pool_count}</Tag>
            </Space>
            {result.errors?.length > 0 && (
              <List size="small" header={<Text strong>Dòng lỗi</Text>} dataSource={result.errors}
                renderItem={(e) => <List.Item><Text type="danger">{e.row ? `Dòng ${e.row}: ` : ""}{e.reason}</Text></List.Item>} />
            )}
            {result.skipped?.length > 0 && (
              <List size="small" header={<Text strong>Bỏ qua</Text>} dataSource={result.skipped}
                renderItem={(s) => <List.Item><Text type="secondary">{s}</Text></List.Item>} />
            )}
          </div>
        )}
      </Space>
    </Modal>
  );
}
