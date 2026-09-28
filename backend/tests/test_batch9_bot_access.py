"""Club admin cấp/tắt quyền dùng bot Telegram cho từng tài khoản trong CLB (phương án A)."""
from conftest import World


def _h(user, club):
    return World.headers(user, club)


def _rows(client, world):
    r = client.get("/api/club/memberships", headers=_h(world.admin1, world.club1))
    assert r.status_code == 200, r.text
    return r.json()


def test_list_club_memberships_defaults_and_self_flag(client, world):
    rows = _rows(client, world)
    by_user = {r["username"]: r for r in rows}
    assert {"admin1", "viewer1"} <= set(by_user)
    assert "admin2" not in by_user  # tài khoản CLB khác không lộ ra
    assert all(r["bot_enabled"] is True for r in rows)          # mặc định bật
    assert all(r["telegram_linked"] is False for r in rows)
    assert by_user["admin1"]["is_self"] is True and by_user["viewer1"]["is_self"] is False
    assert "telegram_chat_id" not in by_user["admin1"]           # không lộ chat id thật


def test_disable_bot_blocks_login_flow_and_telegram_link(client, world):
    viewer_mid = next(r["id"] for r in _rows(client, world) if r["username"] == "viewer1")
    r = client.patch(f"/api/club/memberships/{viewer_mid}/bot-enabled", json={"enabled": False},
                     headers=_h(world.admin1, world.club1))
    assert r.status_code == 200 and r.json()["bot_enabled"] is False

    # Bot đọc /api/my-memberships để quyết định cho vào CLB hay không
    mine = client.get("/api/my-memberships", headers=_h(world.viewer1, world.club1)).json()
    assert [m["bot_enabled"] for m in mine if m["club_id"] == world.club1.id] == [False]

    # Chỉ bot gọi endpoint lưu chat_id → bị chặn khi tắt bot (không lọt vào danh sách nhắc phí)
    r = client.patch("/api/my-memberships/telegram-chat-id", json={"chat_id": 12345},
                     headers=_h(world.viewer1, world.club1))
    assert r.status_code == 403

    # Bật lại → liên kết được, và danh sách báo đã liên kết
    client.patch(f"/api/club/memberships/{viewer_mid}/bot-enabled", json={"enabled": True},
                 headers=_h(world.admin1, world.club1))
    r = client.patch("/api/my-memberships/telegram-chat-id", json={"chat_id": 12345},
                     headers=_h(world.viewer1, world.club1))
    assert r.status_code == 200
    row = next(r for r in _rows(client, world) if r["username"] == "viewer1")
    assert row["telegram_linked"] is True and row["bot_enabled"] is True


def test_cannot_disable_self(client, world):
    self_mid = next(r["id"] for r in _rows(client, world) if r["is_self"])
    r = client.patch(f"/api/club/memberships/{self_mid}/bot-enabled", json={"enabled": False},
                     headers=_h(world.admin1, world.club1))
    assert r.status_code == 400


def test_requires_edit_permission_and_club_scope(client, world):
    admin_mid = next(r["id"] for r in _rows(client, world) if r["username"] == "admin1")
    # viewer1 chỉ có can_view → không được đổi
    r = client.patch(f"/api/club/memberships/{admin_mid}/bot-enabled", json={"enabled": False},
                     headers=_h(world.viewer1, world.club1))
    assert r.status_code == 403
    # viewer1 vẫn xem được danh sách (require_view)
    assert client.get("/api/club/memberships", headers=_h(world.viewer1, world.club1)).status_code == 200
    # admin2 (CLB khác) không đụng được membership của CLB 1 → 404 (không lộ tồn tại)
    r = client.patch(f"/api/club/memberships/{admin_mid}/bot-enabled", json={"enabled": False},
                     headers=_h(world.admin2, world.club2))
    assert r.status_code == 404


def test_disabled_admin_excluded_from_fee_reminders(client, world):
    """Tắt bot cho admin đã liên kết Telegram → không còn nằm trong admin_chat_ids nhắc phí."""
    # admin1 liên kết Telegram và bật nhắc cho khoản thu
    assert client.patch("/api/my-memberships/telegram-chat-id", json={"chat_id": 777},
                        headers=_h(world.admin1, world.club1)).status_code == 200
    assert client.put(f"/api/fee-types/{world.fee1.id}", json={"remind_enabled": True},
                      headers=_h(world.admin1, world.club1)).status_code == 200

    def chat_ids():
        r = client.get("/api/fee-reminders/preview", params={"month": 1, "year": 2030},
                       headers=_h(world.admin1, world.club1))
        assert r.status_code == 200, r.text
        return [cid for item in r.json() for cid in item.get("admin_chat_ids", [])]

    assert 777 in chat_ids()

    # Tự tắt mình bị chặn (400) → dùng một admin thứ hai trong CLB 1 để tắt admin1
    admin1b = world._user("admin1b", world.club1, role=world.admin1.club_memberships[0].role)
    world.db.commit()
    admin1_mid = next(r["id"] for r in _rows(client, world) if r["username"] == "admin1")
    r = client.patch(f"/api/club/memberships/{admin1_mid}/bot-enabled", json={"enabled": False},
                     headers=_h(admin1b, world.club1))
    assert r.status_code == 200
    assert 777 not in chat_ids()
