import React, { useState } from "react";
import { Modal, Table, Tag, Tooltip } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import useHotkey from "../hooks/useHotkey";

const KBD = ({ children }) => (
  <kbd style={{
    display: "inline-block", padding: "2px 7px", fontSize: 12,
    fontFamily: "monospace", background: "#f5f5f5", border: "1px solid #d9d9d9",
    borderBottom: "2px solid #bbb", borderRadius: 4, color: "#333",
  }}>
    {children}
  </kbd>
);

const SHORTCUTS = [
  { scope: "Chung", key: "N", desc: "Mở form thêm mới" },
  { scope: "Chung", key: "R", desc: "Làm mới dữ liệu" },
  { scope: "Chung", key: "?", desc: "Hiển thị bảng phím tắt này" },
  { scope: "Form", key: "Ctrl + Enter", desc: "Lưu form đang mở" },
  { scope: "Form", key: "Escape", desc: "Hủy / đóng form (hỏi xác nhận nếu có thay đổi)" },
  { scope: "Giao dịch", key: "Ctrl + A", desc: "Chọn tất cả giao dịch" },
  { scope: "Giao dịch", key: "Delete", desc: "Xóa các giao dịch đã chọn (có xác nhận)" },
  { scope: "Giao dịch", key: "Escape", desc: "Bỏ chọn tất cả / đóng form" },
  { scope: "Tìm kiếm", key: "/", desc: "Focus ô tìm kiếm (Thành viên & Giao dịch)" },
  { scope: "Xuất dữ liệu", key: "—", desc: "Nút Xuất CSV ở Thành viên & Giao dịch" },
];

const columns = [
  { title: "Phạm vi", dataIndex: "scope", render: (v) => <Tag>{v}</Tag>, width: 120 },
  { title: "Phím tắt", dataIndex: "key", render: (v) => <KBD>{v}</KBD>, width: 160 },
  { title: "Chức năng", dataIndex: "desc" },
];

export { KBD };

export default function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  useHotkey({ "?": () => setOpen(true), "escape": () => setOpen(false) }, []);

  return (
    <>
      <Tooltip title="Phím tắt (?)">
        <QuestionCircleOutlined
          onClick={() => setOpen(true)}
          style={{ fontSize: 18, color: "#888", cursor: "pointer" }}
        />
      </Tooltip>
      <Modal
        title="Phím tắt"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={500}
      >
        <Table
          columns={columns}
          dataSource={SHORTCUTS}
          rowKey="key"
          size="small"
          pagination={false}
        />
      </Modal>
    </>
  );
}
