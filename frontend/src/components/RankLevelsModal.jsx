/**
 * RankLevelsModal — "Cấu hình hạng của CLB": sắp thứ tự (nút lên/xuống), xoá (chặn khi đang có người dùng),
 * thêm hạng mới. Lưu → PUT /api/club/rank-levels → useRankLevels().refresh() để mọi ô chọn hạng cập nhật.
 * "Chưa xếp hạng" là hạng ngầm định, luôn có sẵn, không nằm trong danh sách.
 *
 * State cục bộ chỉ khởi tạo MỘT lần khi mở (destroyOnHidden → mount lại mỗi lần mở). Nếu danh sách hạng của hook
 * đổi trong lúc đang mở: chưa sửa gì → đồng bộ lặng lẽ (VD dữ liệu thật tải xong thay danh sách mặc định);
 * đang sửa dở (dirty) → hiện Alert "vừa được cập nhật ở nơi khác — Tải lại" thay vì remount làm mất chỉnh sửa.
 *
 * Props: { open, onClose, onSaved?(levels) }
 */
import { useState } from "react";
import { Alert, Button, Input, Modal, Space, Spin, Tooltip, Typography, message, theme } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { authApi } from "../api";
import { useRankLevels } from "../hooks/useRankLevels";

const { Text } = Typography;
const MAX_LEN = 30;     // khớp members.rank String(30) ở backend
const MAX_COUNT = 30;

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export default function RankLevelsModal({ open, onClose, onSaved }) {
  const { levels, inUse, unranked, loading, error, isFallback, refresh } = useRankLevels();
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title="Cấu hình hạng của CLB"
      width={520}
      destroyOnHidden
    >
      <Spin spinning={loading}>
        <RankLevelsEditor
          levels={levels}
          inUse={inUse || {}}
          unranked={unranked}
          loadError={error} loadFallback={isFallback}
          onClose={onClose}
          onSaved={async (list) => {
            await refresh();
            onSaved?.(list);
          }}
        />
      </Spin>
    </Modal>
  );
}

function RankLevelsEditor({ levels, inUse, unranked, loadError, loadFallback, onClose, onSaved }) {
  const { token } = theme.useToken();
  // baseline = bản danh sách của hook mà `list` đang dựa trên; khởi tạo một lần lúc mount
  const [baseline, setBaseline] = useState(levels);
  const [list, setList] = useState(() => [...levels]);
  const [stale, setStale] = useState(false);   // hook có bản mới trong lúc đang sửa dở
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = !sameList(list, baseline);

  // Danh sách của hook đổi trong lúc modal mở (điều chỉnh state ngay trong render, không dùng effect):
  // chưa sửa gì → nhận bản mới; đã sửa → giữ chỉnh sửa, báo stale để người dùng tự bấm "Tải lại"
  if (baseline !== levels && !sameList(baseline, levels)) {
    if (!dirty || sameList(list, levels)) {
      setList([...levels]);
      setStale(false);
    } else {
      setStale(true);
    }
    setBaseline(levels);
  }

  const reloadFromHook = () => {
    setList([...levels]);
    setStale(false);
  };

  const move = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  };
  const remove = (i) => setList(list.filter((_, k) => k !== i));

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    if (name.length > MAX_LEN) return void message.error(`Tên hạng tối đa ${MAX_LEN} ký tự`);
    if (name === unranked) return void message.error(`"${unranked}" là hạng ngầm định, luôn có sẵn — không cần thêm`);
    if (list.includes(name)) return void message.error(`Hạng "${name}" đã có trong danh sách`);
    if (list.length >= MAX_COUNT) return void message.error(`Tối đa ${MAX_COUNT} hạng`);
    setList([...list, name]);
    setNewName("");
  };

  const save = async () => {
    setSaving(true);
    try {
      await authApi.updateRankLevels(list);
      await onSaved?.(list);
      message.success("Đã lưu danh sách hạng của CLB");
      onClose?.();
    } catch (err) {
      message.error(err.response?.data?.detail || "Không lưu được danh sách hạng");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message={
          <>
            Hạng <b>"{unranked}"</b> luôn có sẵn cho người chưa xếp hạng. Thứ tự dưới đây là thứ tự hiện trong ô chọn hạng
            của Thành viên, Khách mời và quy tắc ghép đội.
          </>
        }
      />

      {loadError && (
        <Alert
          type="warning" showIcon
          message={loadFallback
            ? "Không tải được danh sách hạng của CLB — đang hiện danh sách mặc định. Lưu sẽ ghi đè cấu hình hiện có."
            : "Không tải lại được danh sách hạng của CLB — đang hiện bản đã tải trước đó."}
        />
      )}

      {stale && (
        <Alert
          type="warning" showIcon
          message="Danh sách hạng vừa được cập nhật ở nơi khác"
          description="Bạn đang có chỉnh sửa chưa lưu. Tải lại để lấy bản mới (chỉnh sửa hiện tại sẽ mất), hoặc tiếp tục và Lưu để ghi đè."
          action={<Button size="small" icon={<ReloadOutlined />} onClick={reloadFromHook}>Tải lại</Button>}
        />
      )}

      {list.length === 0 ? (
        <Text type="secondary">Chưa có hạng nào — thêm hạng bên dưới.</Text>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {list.map((r, i) => {
            const used = Number(inUse?.[r]) || 0;
            return (
              <div
                key={r}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                  border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8,
                }}
              >
                <Text type="secondary" style={{ width: 22, textAlign: "right" }}>{i + 1}.</Text>
                <Text strong style={{ flex: 1, overflowWrap: "anywhere" }}>{r}</Text>
                <Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                  {used > 0 ? `${used} người` : "chưa dùng"}
                </Text>
                <Button size="small" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Lên" />
                <Button size="small" icon={<ArrowDownOutlined />} disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Xuống" />
                <Tooltip title={used > 0 ? `Đang có ${used} người dùng hạng này — đổi hạng của họ trước khi xoá` : "Xoá hạng"}>
                  <Button size="small" danger icon={<DeleteOutlined />} disabled={used > 0} onClick={() => remove(i)} aria-label="Xoá" />
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}

      <Space.Compact style={{ width: "100%" }}>
        <Input
          placeholder="Tên hạng mới (VD: Pro)"
          value={newName}
          maxLength={MAX_LEN}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={add}
        />
        <Button icon={<PlusOutlined />} onClick={add} disabled={!newName.trim()}>Thêm hạng</Button>
      </Space.Compact>

      <Space style={{ justifyContent: "flex-end", width: "100%" }}>
        <Button onClick={onClose} disabled={saving}>Đóng</Button>
        <Button type="primary" onClick={save} loading={saving} disabled={!dirty}>Lưu</Button>
      </Space>
    </Space>
  );
}
