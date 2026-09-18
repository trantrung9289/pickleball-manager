"""Đợt 1: cách ly đa CLB, PII trên endpoint public, quyền link public, docs production."""
import os
import subprocess
import sys

from conftest import World


def _make_tournament(client, world, members, fmt="round_robin", extra=None, as_user=None, club=None):
    h = World.headers(as_user or world.admin1, club or world.club1)
    body = {"name": "T", "format": fmt, "member_ids": [m.id for m in members]}
    body.update(extra or {})
    r = client.post("/api/tournaments", json=body, headers=h)
    return r


# ── Cách ly CLB trên endpoint hành động của giải đấu ──────────────────────

def test_cross_club_tournament_actions_are_404(client, world):
    h1 = World.headers(world.admin1, world.club1)
    h2 = World.headers(world.admin2, world.club2)
    tid = _make_tournament(client, world, world.members1[:4]).json()["id"]
    assert client.post(f"/api/tournaments/{tid}/generate", headers=h1).status_code == 200
    mid = client.get(f"/api/tournaments/{tid}", headers=h1).json()["matches"][0]["id"]

    assert client.get(f"/api/tournaments/{tid}", headers=h2).status_code == 404
    assert client.post(f"/api/tournaments/{tid}/generate", headers=h2).status_code == 404
    assert client.post(f"/api/tournaments/{tid}/start-knockout", headers=h2).status_code == 404
    assert client.get(f"/api/tournaments/{tid}/standings", headers=h2).status_code == 404
    assert client.post(f"/api/tournaments/{tid}/matches/{mid}/score",
                       json={"score1": 11, "score2": 3}, headers=h2).status_code == 404

    # Lịch của CLB 1 vẫn nguyên vẹn (6 trận round-robin 4 người), trận chưa bị chấm
    d = client.get(f"/api/tournaments/{tid}", headers=h1).json()
    assert len(d["matches"]) == 6
    assert all(m["status"] != "completed" for m in d["matches"])


def test_cannot_use_other_club_people_in_tournament(client, world):
    h2 = World.headers(world.admin2, world.club2)
    # member_ids của CLB 1 khi tạo giải ở CLB 2
    r = _make_tournament(client, world, world.members1[:2], as_user=world.admin2, club=world.club2)
    assert r.status_code == 404
    assert "phone" not in r.text
    # player_ids của CLB 1
    r = client.post("/api/tournaments", json={"name": "T", "format": "round_robin",
                    "player_ids": [world.guest1.id]}, headers=h2)
    assert r.status_code == 404
    # doubles teams
    r = client.post("/api/tournaments", json={"name": "T", "format": "round_robin", "team_type": "doubles",
                    "teams": [{"member_id": world.members2[0].id, "partner_member_id": world.members1[0].id}]},
                    headers=h2)
    assert r.status_code == 404
    # add_participant / replace slot trên giải hợp lệ của CLB 2
    tid = _make_tournament(client, world, world.members2[:2], as_user=world.admin2, club=world.club2).json()["id"]
    r = client.post(f"/api/tournaments/{tid}/participants", json={"member_id": world.members1[3].id}, headers=h2)
    assert r.status_code == 404
    pid = client.get(f"/api/tournaments/{tid}", headers=h2).json()["participants"][0]["id"]
    r = client.patch(f"/api/tournaments/{tid}/participants/{pid}",
                     json={"slot": "main", "player_id": world.guest1.id}, headers=h2)
    assert r.status_code == 404
    # Người của chính CLB 2 thì vẫn thêm được
    r = client.post(f"/api/tournaments/{tid}/participants", json={"member_id": world.members2[2].id}, headers=h2)
    assert r.status_code == 201


def test_transaction_rejects_other_club_member_and_player(client, world):
    h2 = World.headers(world.admin2, world.club2)
    base = {"fee_type_id": world.fee2.id, "amount": 100000, "transaction_date": "2026-09-01"}
    r = client.post("/api/transactions", json={**base, "member_id": world.members1[0].id}, headers=h2)
    assert r.status_code == 404
    r = client.post("/api/transactions", json={**base, "player_id": world.guest1.id}, headers=h2)
    assert r.status_code == 404
    r = client.post("/api/transactions", json={**base, "member_id": world.members2[0].id}, headers=h2)
    assert r.status_code == 201
    tx_id = r.json()["id"]
    r = client.put(f"/api/transactions/{tx_id}", json={**base, "member_id": world.members1[1].id}, headers=h2)
    assert r.status_code == 404


# ── PII trên endpoint public ────────────────────────────────────────────────

PII_KEYS = {"phone", "email", "dob", "address", "notes", "member_code", "join_date"}


def test_public_tournament_detail_has_no_pii(client, world):
    h1 = World.headers(world.admin1, world.club1)
    tid = _make_tournament(client, world, world.members1[:3], extra={"player_ids": [world.guest1.id]}).json()["id"]
    # generate với khách mời hiện còn crash (sửa ở đợt 3) → kích hoạt qua PUT status
    client.put(f"/api/tournaments/{tid}", json={"status": "active"}, headers=h1)
    r = client.get(f"/api/public/report/{world.token1.slug}/tournaments/{tid}")
    assert r.status_code == 200, r.text
    body = r.text
    for key in PII_KEYS:
        assert f'"{key}"' not in body, f"public tournament detail lộ trường {key}"
    d = r.json()
    members = [p["member"] for p in d["participants"] if p.get("member")]
    assert members and set(members[0].keys()) == {"id", "full_name", "rank"}
    players = [p["player"] for p in d["participants"] if p.get("player")]
    assert players and set(players[0].keys()) == {"id", "name", "rank"}


def test_public_fee_status_has_no_phone_but_admin_does(client, world):
    h1 = World.headers(world.admin1, world.club1)
    params = {"year": 2026, "month": 9, "fee_type_id": world.fee1.id}
    r = client.get(f"/api/public/report/{world.token1.slug}/fee-status", params=params)
    assert r.status_code == 200
    assert r.json()["members"] and all("phone" not in m for m in r.json()["members"])
    r = client.get("/api/reports/fee-status", params=params, headers=h1)
    assert r.status_code == 200
    assert all("phone" in m for m in r.json()["members"])


# ── Quyền tạo/bật/xoá link public ──────────────────────────────────────────

def test_report_links_require_edit_and_delete(client, world):
    hv = World.headers(world.viewer1, world.club1)
    ha = World.headers(world.admin1, world.club1)
    assert client.post("/api/report-links", json={"label": "x"}, headers=hv).status_code == 403
    r = client.post("/api/report-links", json={"label": "x"}, headers=ha)
    assert r.status_code == 200
    link_id = r.json()["id"]
    assert client.get("/api/report-links", headers=hv).status_code == 200
    assert client.patch(f"/api/report-links/{link_id}/toggle", headers=hv).status_code == 403
    assert client.delete(f"/api/report-links/{link_id}", headers=hv).status_code == 403
    assert client.patch(f"/api/report-links/{link_id}/toggle", headers=ha).status_code == 200
    assert client.delete(f"/api/report-links/{link_id}", headers=ha).status_code == 200


# ── /docs tắt khi chạy trên Fly ────────────────────────────────────────────

def test_docs_disabled_in_production_env(client):
    assert client.get("/docs").status_code == 200  # môi trường test = dev
    env = {**os.environ, "FLY_APP_NAME": "pickleball-manager", "DATABASE_URL": os.environ["DATABASE_URL"]}
    out = subprocess.run([sys.executable, "-c", "import main; print(main.app.docs_url, main.app.openapi_url)"],
                         capture_output=True, text=True, env=env, cwd=os.path.dirname(os.path.dirname(__file__)))
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "None None"
