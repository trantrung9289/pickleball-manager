import React from 'react';
import { Button, Dropdown, Space } from 'antd';
import { DesktopOutlined, MobileOutlined, SyncOutlined, DownOutlined } from '@ant-design/icons';
import { useViewMode } from '../contexts/ViewModeContext';

const LABELS = { auto: 'Auto', desktop: 'Desktop', mobile: 'Mobile' };

const DEVICE_LABEL = { mobile: 'điện thoại', tablet: 'máy tính bảng', desktop: 'máy tính' };

const ViewModeSwitcher = () => {
  const { mode, setMode, isForced, deviceType } = useViewMode();

  const icon =
    mode === 'desktop' ? <DesktopOutlined /> :
    mode === 'mobile'  ? <MobileOutlined />  :
    <SyncOutlined />;

  const items = [
    { key: 'auto',    icon: <SyncOutlined />,    label: `Tự động — nhận dạng: ${DEVICE_LABEL[deviceType] || 'máy tính'}` },
    { key: 'desktop', icon: <DesktopOutlined />, label: 'Giao diện Desktop' },
    { key: 'mobile',  icon: <MobileOutlined />,  label: 'Giao diện Mobile' },
  ].map(item => ({
    ...item,
    label: (
      <Space>
        {item.icon}
        <span>{item.label}</span>
        {mode === item.key && <span style={{ color: '#1890ff' }}>✓</span>}
      </Space>
    ),
    onClick: () => setMode(item.key),
  }));

  return (
    <Dropdown menu={{ items }} placement="bottomRight" trigger={['click']}>
      <Button
        type="text"
        size="small"
        style={{
          color: isForced ? '#1890ff' : '#888',
          border: `1px solid ${isForced ? '#1890ff' : '#d9d9d9'}`,
          background: isForced ? 'rgba(24,144,255,0.08)' : 'transparent',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 10px',
          height: 30,
        }}
      >
        {icon}
        <span style={{ fontSize: 12, fontWeight: 500 }}>{LABELS[mode]}</span>
        <DownOutlined style={{ fontSize: 10 }} />
      </Button>
    </Dropdown>
  );
};

export default ViewModeSwitcher;
