import React from "react";
import { Typography, Row, Col } from "antd";
import { SettingOutlined, TrophyOutlined } from "@ant-design/icons";

const { Title, Text } = Typography;

export default function Landing({ onSelect }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #001529 0%, #003a70 100%)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <TrophyOutlined style={{ fontSize: 56, color: "#faad14" }} />
        <Title level={1} style={{ color: "#fff", margin: "16px 0 8px", fontSize: 32 }}>
          Hệ thống Quản lý CLB
        </Title>
        <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 16 }}>
          Chọn chế độ truy cập
        </Text>
      </div>

      <Row gutter={24} style={{ width: "100%", maxWidth: 640 }}>
        {/* Mode: Quản trị viên hệ thống */}
        <Col span={12}>
          <div
            onClick={() => onSelect("admin")}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "2px solid rgba(255,255,255,0.15)",
              borderRadius: 16,
              padding: "40px 24px",
              textAlign: "center",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(255,255,255,0.12)";
              e.currentTarget.style.borderColor = "#faad14";
              e.currentTarget.style.transform = "translateY(-4px)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <SettingOutlined style={{ fontSize: 48, color: "#faad14", marginBottom: 16, display: "block" }} />
            <Title level={4} style={{ color: "#fff", margin: "0 0 8px" }}>
              Quản trị viên
            </Title>
            <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
              Quản lý tài khoản, câu lạc bộ và phân quyền hệ thống
            </Text>
          </div>
        </Col>

        {/* Mode: Thành viên CLB */}
        <Col span={12}>
          <div
            onClick={() => onSelect("member")}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "2px solid rgba(255,255,255,0.15)",
              borderRadius: 16,
              padding: "40px 24px",
              textAlign: "center",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(255,255,255,0.12)";
              e.currentTarget.style.borderColor = "#1677ff";
              e.currentTarget.style.transform = "translateY(-4px)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <TrophyOutlined style={{ fontSize: 48, color: "#1677ff", marginBottom: 16, display: "block" }} />
            <Title level={4} style={{ color: "#fff", margin: "0 0 8px" }}>
              Quản lý CLB
            </Title>
            <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
              Đăng nhập để quản lý câu lạc bộ thể thao của bạn
            </Text>
          </div>
        </Col>
      </Row>
    </div>
  );
}
