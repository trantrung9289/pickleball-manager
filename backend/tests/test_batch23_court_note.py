"""Đợt 2 (2026-10-26): sân cho từng trận thành phần, ghi chú BTC cho trận đồng đội, sĩ số đội trong team_rules."""
import tournament_engine as eng
from tests.test_batch19_team_format import _create_team_tournament, _two_teams, _h


def test_team_rules_roster_caps_normalized():
    r = eng.normalize_team_rules({"max_male": "8", "max_female": 2, "max_players": ""})
    assert (r["max_male"], r["max_female"], r["max_players"]) == (8, 2, None)
    assert eng.normalize_team_rules(None)["max_male"] is None
    assert eng.normalize_team_rules({"max_male": 0})["max_male"] is None
    assert eng.normalize_team_rules({"max_players": "abc"})["max_players"] is None


def test_court_and_note_flow_admin_and_public(client, world, db):
    t = _create_team_tournament(client, world, team_rules={
        "scoring": "match_points", "points_per_rubber": 11, "win_by_two": True, "max_male": 2,
        "rubbers": [{"code": "MD"}, {"code": "WD"}, {"code": "XD"}]})
    tid = t["id"]; h = _h(world)
    assert t["team_rules"]["max_male"] == 2          # sĩ số đội lưu trong team_rules
    _two_teams(client, world, db, tid)
    client.put(f"/api/tournaments/{tid}", json={"status": "active"}, headers=h)
    tt = client.post(f"/api/tournaments/{tid}/generate", headers=h).json()
    m = tt["matches"][0]
    tie = client.get(f"/api/tournaments/{tid}/matches/{m['id']}/tie", headers=h).json()
    r0 = sorted(tie["rubbers"], key=lambda x: x["order_index"])[0]
    assert r0["court"] is None and tie["match"]["btc_note"] is None

    # Sân: PUT chỉ court (không đụng VĐV) → lưu, có trong TieOut + MatchOut.rubbers
    r = client.put(f"/api/tournaments/{tid}/matches/{m['id']}/tie/rubbers/{r0['id']}", json={"court": " 3 "}, headers=h)
    assert r.status_code == 200, r.text
    assert next(x for x in r.json()["rubbers"] if x["id"] == r0["id"])["court"] == "3"
    tt = client.get(f"/api/tournaments/{tid}", headers=h).json()
    mm = next(x for x in tt["matches"] if x["id"] == m["id"])
    assert next(x for x in mm["rubbers"] if x["id"] == r0["id"])["court"] == "3"
    # Xoá sân bằng chuỗi rỗng
    r = client.put(f"/api/tournaments/{tid}/matches/{m['id']}/tie/rubbers/{r0['id']}", json={"court": ""}, headers=h)
    assert next(x for x in r.json()["rubbers"] if x["id"] == r0["id"])["court"] is None

    # Ghi chú BTC
    r = client.put(f"/api/tournaments/{tid}/matches/{m['id']}/tie/note", json={"note": "Đội 2 đến trễ 10 phút"}, headers=h)
    assert r.status_code == 200 and r.json()["match"]["btc_note"] == "Đội 2 đến trễ 10 phút"
    logs = client.get(f"/api/tournaments/{tid}/team-logs", headers=h).json()
    assert any(l["kind"] == "note" for l in logs) and any(l["kind"] == "court" for l in logs)
    # Public thấy sân + ghi chú
    client.put(f"/api/tournaments/{tid}/matches/{m['id']}/tie/rubbers/{r0['id']}", json={"court": "5"}, headers=h)
    pub = client.get(f"/api/public/report/{world.token1.slug}/tournaments/{tid}/matches/{m['id']}/tie").json()
    assert pub["match"]["btc_note"] == "Đội 2 đến trễ 10 phút"
    assert next(x for x in pub["rubbers"] if x["id"] == r0["id"])["court"] == "5"
    # Xoá ghi chú; quyền xem không sửa được
    assert client.put(f"/api/tournaments/{tid}/matches/{m['id']}/tie/note", json={"note": ""}, headers=h).json()["match"]["btc_note"] is None
    from tests.conftest import World
    assert client.put(f"/api/tournaments/{tid}/matches/{m['id']}/tie/note", json={"note": "x"},
                      headers=World.headers(world.viewer1, world.club1)).status_code == 403
