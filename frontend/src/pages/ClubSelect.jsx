import React from "react";
import { Typography, Row, Col, Tag, Button } from "antd";
import { TrophyOutlined, LogoutOutlined, EnvironmentOutlined } from "@ant-design/icons";
import { useAuth } from "../context/AuthContext";

const { Title, Text } = Typography;

export default function ClubSelect({ onBack }) {
  const { memberships, selectClub, user } = useAuth();

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
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <TrophyOutlined style={{ fontSize: 52, color: "#faad14" }} />
        <Title level={2} style={{ color: "#fff", margin: "12px 0 4px" }}>
          Chọn Câu lạc bộ
        </Title>
        <Text style={{ color: "rgba(255,255,255,0.55)" }}>
          Xin chào <b style={{ color: "#fff" }}>{user?.full_name || user?.username}</b> — bạn quản lý {memberships.length} câu lạc bộ
        </Text>
      </div>

      <Row gutter={[20, 20]} style={{ width: "100%", maxWidth: 800, justifyContent: "center" }}>
        {memberships.map((m) => (
          <Col key={m.id} xs={24} sm={12} md={8}>
            <div
              onClick={() => selectClub(m)}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "2px solid rgba(255,255,255,0.15)",
                borderRadius: 16,
                padding: "28px 20px",
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
              <TrophyOutlined style={{ fontSize: 40, color: "#1677ff", marginBottom: 12, display: "block" }} />
              <Title level={4} style={{ color: "#fff", margin: "0 0 6px", fontSize: 16 }}>
                {m.club?.name || `CLB #${m.club_id}`}
              </Title>
              {m.club?.sport && (
                <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, display: "block", marginBottom: 10 }}>
                  {m.club.sport}
                </Text>
              )}
              {m.club?.address && (
                <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, display: "block", marginBottom: 10 }}>
                  <EnvironmentOutlined style={{ marginRight: 4 }} />{m.club.address}
                </Text>
              )}
              <Tag color={m.role === "admin" ? "gold" : m.role === "treasurer" ? "blue" : "default"}>
                {m.role === "admin" ? "Quản trị CLB" : m.role === "treasurer" ? "Thủ quỹ" : "Thành viên"}
              </Tag>
            </div>
          </Col>
        ))}
      </Row>

      <Button
        icon={<LogoutOutlined />}
        onClick={onBack}
        type="text"
        style={{ color: "rgba(255,255,255,0.5)", marginTop: 32 }}
      >
        Quay lại / Đăng xuất
      </Button>
    </div>
  );
}
