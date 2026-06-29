import React, { useState } from "react";
import { Table, Card, Empty, Spin, Pagination, Checkbox } from "antd";
import { useViewMode } from "../contexts/ViewModeContext";

/**
 * Bảng responsive: desktop hiển thị <Table> như cũ, mobile chuyển sang danh sách Card
 * (mỗi dòng = 1 card, mỗi cột = 1 hàng nhãn/giá trị) để tránh bị bóp cột, rớt chữ dọc.
 *
 * Dùng chung props với antd Table: columns, dataSource, rowKey, loading, pagination,
 * rowSelection. Trên mobile tự bỏ qua scroll ngang và render thân thiện cảm ứng.
 *
 * Tuỳ chọn thêm:
 *  - mobileTitle: (record) => ReactNode   — tiêu đề nổi bật của mỗi card
 *  - mobileHideColumns: [dataIndex|title] — ẩn bớt cột trên card cho gọn
 */
export default function ResponsiveTable({
  columns = [],
  dataSource = [],
  rowKey = "id",
  loading = false,
  pagination,
  rowSelection,
  summary,
  mobileTitle,
  mobileHideColumns = [],
  mobileSummary,
  ...rest
}) {
  const { isMobileView } = useViewMode();
  const pageSize = pagination?.pageSize || 20;
  const [page, setPage] = useState(1);

  if (!isMobileView) {
    return (
      <Table
        columns={columns}
        dataSource={dataSource}
        rowKey={rowKey}
        loading={loading}
        pagination={pagination}
        rowSelection={rowSelection}
        summary={summary}
        scroll={{ x: "max-content" }}
        {...rest}
      />
    );
  }

  // ── Mobile: render dạng Card ──
  const getKey = (record, idx) =>
    typeof rowKey === "function" ? rowKey(record) : record[rowKey] ?? idx;

  const getCellValue = (col, record) =>
    col.dataIndex != null ? record[col.dataIndex] : undefined;

  const renderCell = (col, record, idx) => {
    const value = getCellValue(col, record);
    return col.render ? col.render(value, record, idx) : value;
  };

  const isHidden = (col) =>
    mobileHideColumns.includes(col.dataIndex) || mobileHideColumns.includes(col.title);

  const isEmptyNode = (node) =>
    node == null || node === "" || node === "—";

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin />
      </div>
    );
  }

  if (!dataSource.length) {
    return <Empty description="Không có dữ liệu" style={{ padding: 24 }} />;
  }

  const usePager = pagination !== false && dataSource.length > pageSize;
  const pageData = usePager
    ? dataSource.slice((page - 1) * pageSize, page * pageSize)
    : dataSource;

  const selectedKeys = rowSelection?.selectedRowKeys || [];
  const onToggleSelect = (key, checked) => {
    if (!rowSelection?.onChange) return;
    const next = checked
      ? [...selectedKeys, key]
      : selectedKeys.filter((k) => k !== key);
    rowSelection.onChange(next);
  };

  return (
    <div>
      {pageData.map((record, idx) => {
        const key = getKey(record, idx);
        const visibleCols = columns.filter((c) => !isHidden(c));
        const selected = selectedKeys.includes(key);
        return (
          <Card
            key={key}
            size="small"
            style={{
              marginBottom: 10,
              borderRadius: 12,
              boxShadow: "0 1px 6px rgba(0,0,0,0.05)",
              borderColor: selected ? "#1677ff" : undefined,
            }}
            styles={{ body: { padding: 12 } }}
          >
            {(mobileTitle || rowSelection) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: mobileTitle ? 8 : 0,
                }}
              >
                {rowSelection && (
                  <Checkbox
                    checked={selected}
                    onChange={(e) => onToggleSelect(key, e.target.checked)}
                  />
                )}
                {mobileTitle && (
                  <div style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>
                    {mobileTitle(record)}
                  </div>
                )}
              </div>
            )}
            {visibleCols.map((col, ci) => {
              const node = renderCell(col, record, idx);
              if (isEmptyNode(node)) return null;
              return (
                <div
                  key={ci}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "4px 0",
                    fontSize: 14,
                    minHeight: 28,
                  }}
                >
                  <span style={{ color: "#8c8c8c", flexShrink: 0 }}>{col.title}</span>
                  <span style={{ textAlign: "right", wordBreak: "break-word" }}>
                    {node}
                  </span>
                </div>
              );
            })}
          </Card>
        );
      })}

      {usePager && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <Pagination
            simple
            current={page}
            pageSize={pageSize}
            total={dataSource.length}
            onChange={setPage}
          />
        </div>
      )}

      {mobileSummary && (
        <Card
          size="small"
          style={{ marginTop: 4, borderRadius: 12, background: "#fafafa" }}
          styles={{ body: { padding: 12 } }}
        >
          {mobileSummary(dataSource).map((row, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
                padding: "3px 0",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              <span style={{ color: "#595959", flexShrink: 0 }}>{row.label}</span>
              <span style={{ textAlign: "right", wordBreak: "break-word" }}>{row.value}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
