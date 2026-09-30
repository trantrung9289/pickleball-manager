"""Đợt 16: Sự kiện thành tích cá nhân (Mini game) — cộng/trừ điểm ±1 từng người, không có trận đấu.
Bao gồm: tạo (tên mặc định giờ VN), thêm người hàng loạt (member + khách, Player gắn thành viên quy về member),
rời/thêm lại giữ điểm, ghi điểm nguyên tử + idempotent + ĐỒNG THỜI 20 luồng, vòng đời trạng thái (mở lại),
chặn xoá thành viên/khách mời đang có tên, dọn sạch khi xoá CLB, endpoint public không PII / không actor."""
import re
from concurrent.futures import ThreadPoolExecutor

import pytest
from conftest import World

import main
import models


PII_KEYS = {"phone", "email", "dob", "address", "notes", "member_code", "join_date"}


def _h(world):
    return World.headers(world.admin1, world.club1)


def _hv(world):
    return World.headers(world.viewer1, world.club1)


def _h2(world):
    return World.headers(world.admin2, world.club2)


def _create(client, world, headers=None, **body):
    r = client.post("/api/point-events", json=body, headers=headers or _h(world))
    assert r.status_code == 201, r.text
    return r.json()


def _bulk(client, world, eid, member_ids=(), player_ids=(), headers=None):
    return client.post(f"/api/point-events/{eid}/participants/bulk",
                       json={"member_ids": list(member_ids), "player_ids": list(player_ids)},
                       headers=headers or _h(world))


def _detail(client, world, eid):
    r = client.get(f"/api/point-events/{eid}", headers=_h(world))
    assert r.status_code == 200, r.text
    return r.json()


def _set_status(client, world, eid, status):
    return client.put(f"/api/point-events/{eid}", json={"status": status}, headers=_h(world))


def _points(client, world, eid, pid, delta, op_id, headers=None):
    return client.post(f"/api/point-events/{eid}/participants/{pid}/points",
                       json={"delta": delta, "client_op_id": op_id}, headers=headers or _h(world))


def _logs(client, world, eid, after_id=0, limit=200):
    r = client.get(f"/api/point-events/{eid}/logs", params={"after_id": after_id, "limit": limit}, headers=_h(world))
    assert r.status_code == 200, r.text
    return r.json()


def _started(client, world, n_members=2, guest=True):
    """Sự kiện đang diễn ra với n thành viên (+ 1 khách) — trả (event, participants theo seq)."""
    ev = _create(client, world, name="Mini game test",
                 member_ids=[m.id for m in world.members1[:n_members]],
                 player_ids=[world.guest1.id] if guest else [])
    r = _set_status(client, world, ev["id"], "active")
    assert r.status_code == 200, r.text
    ev = r.json()
    return ev, ev["participants"]


# ── Tạo sự kiện ───────────────────────────────────────────────────────────────

def test_create_default_name_zero_people_and_actor(client, world):
    before = main._now_vn()
    ev = _create(client, world, name="   ")
    after = main._now_vn()
    assert re.fullmatch(r"Mini game \d{2}/\d{2}/\d{4}", ev["name"]), ev["name"]
    assert ev["name"] in {f"Mini game {d:%d/%m/%Y}" for d in (before, after)}
    assert ev["status"] == "draft" and ev["kind"] == "mini_game" and ev["version"] == 0
    assert ev["participants"] == [] and ev["participant_count"] == 0 and ev["log_count"] == 0
    assert ev["created_by"] == "admin1" and ev["created_at"] is not None
    assert ev["started_at"] is None and ev["completed_at"] is None
    # Không gửi name → cũng mặc định
    ev2 = _create(client, world)
    assert ev2["name"].startswith("Mini game ")
    # Tên có sẵn → giữ nguyên (đã strip)
    ev3 = _create(client, world, name="  Vui là chính  ", description="mô tả")
    assert ev3["name"] == "Vui là chính" and ev3["description"] == "mô tả"


def test_create_with_people_snapshots_and_guards(client, world):
    ms = world.members1[:2]
    ev = _create(client, world, name="X", member_ids=[ms[0].id, ms[1].id, ms[0].id], player_ids=[world.guest1.id])
    ps = ev["participants"]
    assert [(p["member_id"], p["player_id"]) for p in ps] == [(ms[0].id, None), (ms[1].id, None), (None, world.guest1.id)]
    assert [p["display_name"] for p in ps] == [ms[0].full_name, ms[1].full_name, "Guest One"]
    assert [p["rank_snapshot"] for p in ps] == ["B", "B", "C"]
    assert [p["seq"] for p in ps] == [1, 2, 3]
    assert all(p["points"] == 0 and p["status"] == "active" for p in ps)
    assert ev["participant_count"] == 3
    # Thành viên CLB khác → 404, không tạo gì
    r = client.post("/api/point-events", json={"name": "Y", "member_ids": [world.members2[0].id]}, headers=_h(world))
    assert r.status_code == 404 and "không thuộc câu lạc bộ" in r.json()["detail"]
    r = client.post("/api/point-events", json={"name": "Y", "player_ids": [world.guest2.id]}, headers=_h(world))
    assert r.status_code == 404
    assert [e["name"] for e in client.get("/api/point-events", headers=_h(world)).json()] == ["X"]
    # Viewer chỉ xem → 403 tạo/sửa/xoá, 200 xem
    assert client.post("/api/point-events", json={"name": "Z"}, headers=_hv(world)).status_code == 403
    assert client.get(f"/api/point-events/{ev['id']}", headers=_hv(world)).status_code == 200
    assert client.put(f"/api/point-events/{ev['id']}", json={"name": "Z"}, headers=_hv(world)).status_code == 403
    assert _bulk(client, world, ev["id"], [ms[0].id], headers=_hv(world)).status_code == 403
    assert client.delete(f"/api/point-events/{ev['id']}", headers=_hv(world)).status_code == 403
    # Cách ly CLB: admin2 không thấy sự kiện của CLB 1
    for method, path in [("get", f"/api/point-events/{ev['id']}"), ("get", f"/api/point-events/{ev['id']}/state"),
                         ("get", f"/api/point-events/{ev['id']}/logs"), ("delete", f"/api/point-events/{ev['id']}")]:
        assert getattr(client, method)(path, headers=_h2(world)).status_code == 404, path
    assert _bulk(client, world, ev["id"], [world.members2[0].id], headers=_h2(world)).status_code == 404
    assert client.get("/api/point-events", headers=_h2(world)).json() == []


# ── Thêm người hàng loạt ─────────────────────────────────────────────────────

def test_bulk_member_guest_linked_player_and_duplicates(client, world, db):
    m = world.members1[0]
    linked = models.Player(name="Linked", club_id=world.club1.id, member_id=m.id, rank="A")
    db.add(linked); db.commit(); db.refresh(linked)
    ev = _create(client, world, name="B")
    r = _bulk(client, world, ev["id"], [m.id], [linked.id, world.guest1.id])
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["added"] == 2 and j["skipped"] == []
    ps = j["event"]["participants"]
    assert [(p["member_id"], p["player_id"]) for p in ps] == [(m.id, None), (None, world.guest1.id)]
    assert j["event"]["participant_count"] == 2 and j["event"]["version"] == 1
    # Gọi lại → skipped theo tên; version không đổi khi không có thay đổi
    r = _bulk(client, world, ev["id"], [m.id], [linked.id, world.guest1.id])
    assert r.json()["added"] == 0 and r.json()["skipped"] == [m.full_name, "Guest One"]
    assert r.json()["event"]["version"] == 1
    # Trùng trong cùng request → thêm 1, seq nối tiếp
    m2 = world.members1[1]
    r = _bulk(client, world, ev["id"], [m2.id, m2.id])
    assert r.json()["added"] == 1 and r.json()["event"]["participants"][-1]["seq"] == 3
    # Body rỗng → không lỗi; người CLB khác → 404, không thêm ai
    assert _bulk(client, world, ev["id"]).json()["added"] == 0
    assert _bulk(client, world, ev["id"], [world.members2[0].id]).status_code == 404
    assert len(_detail(client, world, ev["id"])["participants"]) == 3
    assert client.post(f"/api/point-events/{ev['id']}/participants/bulk", json={"member_ids": "x"},
                       headers=_h(world)).status_code == 422


def test_bulk_allowed_when_active_logs_them_and_blocked_when_completed(client, world):
    ev, ps = _started(client, world, n_members=1, guest=False)
    assert ev["log_count"] == 0
    r = _bulk(client, world, ev["id"], [world.members1[1].id], [world.guest1.id])
    assert r.status_code == 200 and r.json()["added"] == 2
    logs = _logs(client, world, ev["id"])
    assert [(l["kind"], l["note"], l["display_name"]) for l in logs] == [
        ("status", "Bắt đầu", None),
        ("participant", "Thêm", world.members1[1].full_name),
        ("participant", "Thêm", "Guest One"),
    ]
    assert all(l["actor_name"] == "admin1" for l in logs)
    assert r.json()["event"]["log_count"] == 0   # log_count chỉ đếm log score
    assert _set_status(client, world, ev["id"], "completed").status_code == 200
    r = _bulk(client, world, ev["id"], [world.members1[2].id])
    assert r.status_code == 400 and r.json()["detail"] == "Sự kiện đã kết thúc"


# ── Rời / thêm lại ──────────────────────────────────────────────────────────

def test_remove_participant_draft_active_readd_keeps_points(client, world, db):
    # Nháp → xoá cứng
    ev = _create(client, world, name="R", member_ids=[m.id for m in world.members1[:2]])
    pid0 = ev["participants"][0]["id"]
    r = client.delete(f"/api/point-events/{ev['id']}/participants/{pid0}", headers=_h(world))
    assert r.status_code == 204
    d = _detail(client, world, ev["id"])
    assert [p["id"] for p in d["participants"]] == [ev["participants"][1]["id"]] and d["version"] == 1
    assert db.query(models.PointEventParticipant).filter_by(id=pid0).first() is None
    assert client.delete(f"/api/point-events/{ev['id']}/participants/{pid0}", headers=_h(world)).status_code == 404

    # Đang diễn ra: chưa có điểm → xoá cứng (kể cả log "Thêm" đi theo)
    ev, ps = _started(client, world, n_members=2, guest=True)
    eid = ev["id"]
    late = _bulk(client, world, eid, [world.members1[5].id]).json()["event"]["participants"][-1]
    assert client.delete(f"/api/point-events/{eid}/participants/{late['id']}", headers=_h(world)).status_code == 204
    assert db.query(models.PointEventParticipant).filter_by(id=late["id"]).first() is None
    assert db.query(models.PointLog).filter_by(participant_id=late["id"]).count() == 0
    assert all(p["status"] == "active" for p in _detail(client, world, eid)["participants"])

    # Đã có điểm → status removed + log "Rời", giữ điểm
    guest = next(p for p in ps if p["player_id"] == world.guest1.id)
    assert _points(client, world, eid, guest["id"], 1, "op-g1").status_code == 200
    assert _points(client, world, eid, guest["id"], 1, "op-g2").status_code == 200
    v_before = _detail(client, world, eid)["version"]
    assert client.delete(f"/api/point-events/{eid}/participants/{guest['id']}", headers=_h(world)).status_code == 204
    d = _detail(client, world, eid)
    g = next(p for p in d["participants"] if p["id"] == guest["id"])
    assert g["status"] == "removed" and g["points"] == 2
    assert d["participant_count"] == 2 and d["version"] == v_before + 1
    assert _logs(client, world, eid)[-1]["note"] == "Rời"
    assert _logs(client, world, eid)[-1]["points_after"] == 2
    # Rời rồi → không chấm được, không rời lần 2
    assert _points(client, world, eid, guest["id"], 1, "op-g3").status_code == 409
    assert client.delete(f"/api/point-events/{eid}/participants/{guest['id']}", headers=_h(world)).status_code == 409

    # Thêm lại người đã rời → active, GIỮ điểm, log "Thêm lại", tính vào added; không tạo dòng mới
    r = _bulk(client, world, eid, [], [world.guest1.id])
    assert r.status_code == 200 and r.json()["added"] == 1 and r.json()["skipped"] == []
    g2 = next(p for p in r.json()["event"]["participants"] if p["id"] == guest["id"])
    assert g2["status"] == "active" and g2["points"] == 2 and g2["seq"] == guest["seq"]
    assert len(r.json()["event"]["participants"]) == 3
    assert _logs(client, world, eid)[-1]["note"] == "Thêm lại"
    assert _points(client, world, eid, guest["id"], 1, "op-g4").status_code == 200

    # Kết thúc → không rời được
    assert _set_status(client, world, eid, "completed").status_code == 200
    r = client.delete(f"/api/point-events/{eid}/participants/{guest['id']}", headers=_h(world))
    assert r.status_code == 400 and r.json()["detail"] == "Sự kiện đã kết thúc"


# ── Ghi điểm ─────────────────────────────────────────────────────────────────

def test_points_flow_and_guards(client, world):
    ev = _create(client, world, name="P", member_ids=[world.members1[0].id])
    eid, pid = ev["id"], ev["participants"][0]["id"]
    r = _points(client, world, eid, pid, 1, "op-draft")
    assert r.status_code == 400 and r.json()["detail"] == "Sự kiện chưa bắt đầu hoặc đã kết thúc"
    assert _set_status(client, world, eid, "active").status_code == 200
    v0 = _detail(client, world, eid)["version"]

    r = _points(client, world, eid, pid, 1, "op-1")
    assert r.status_code == 200, r.text
    assert r.json()["participants"][0]["points"] == 1 and r.json()["log_count"] == 1 and r.json()["version"] == v0 + 1
    assert _points(client, world, eid, pid, 1, "op-2").json()["participants"][0]["points"] == 2
    assert _points(client, world, eid, pid, -1, "op-3").json()["participants"][0]["points"] == 1
    assert _points(client, world, eid, pid, -1, "op-4").json()["participants"][0]["points"] == 0
    # −1 khi 0 → 409, không ghi log, version không đổi
    r = _points(client, world, eid, pid, -1, "op-5")
    assert r.status_code == 409 and r.json()["detail"] == "Điểm không thể xuống dưới 0"
    d = _detail(client, world, eid)
    assert d["participants"][0]["points"] == 0 and d["log_count"] == 4 and d["version"] == v0 + 4
    # delta ∉ {1,−1} → 422
    r = _points(client, world, eid, pid, 2, "op-6")
    assert r.status_code == 422 and r.json()["detail"] == "Chỉ hỗ trợ +1 / −1"
    assert _points(client, world, eid, pid, 0, "op-7").status_code == 422
    # client_op_id thiếu / quá dài → 422 (pydantic)
    assert client.post(f"/api/point-events/{eid}/participants/{pid}/points", json={"delta": 1},
                       headers=_h(world)).status_code == 422
    assert _points(client, world, eid, pid, 1, "x" * 41).status_code == 422
    assert _points(client, world, eid, pid, 1, "x" * 40).status_code == 200
    # Idempotent: cùng client_op_id → không ghi thêm, trả trạng thái hiện tại (200)
    r1 = _points(client, world, eid, pid, 1, "op-same")
    r2 = _points(client, world, eid, pid, 1, "op-same")
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["participants"][0]["points"] == 2 == r2.json()["participants"][0]["points"]
    assert r2.json()["version"] == r1.json()["version"]
    logs = _logs(client, world, eid)
    score_logs = [l for l in logs if l["kind"] == "score"]
    assert len(score_logs) == 6 and [l["points_after"] for l in score_logs] == [1, 2, 1, 0, 1, 2]
    assert [l["delta"] for l in score_logs] == [1, 1, -1, -1, 1, 1]
    assert all(l["display_name"] == world.members1[0].full_name and l["actor_name"] == "admin1" for l in score_logs)
    assert sum(1 for l in logs if l["kind"] == "score" and l["note"] is None) == 6
    # Người không tồn tại / thuộc sự kiện khác → 404; viewer → 403
    assert _points(client, world, eid, 999999, 1, "op-x").status_code == 404
    other = _create(client, world, name="Q", member_ids=[world.members1[1].id])
    assert _points(client, world, eid, other["participants"][0]["id"], 1, "op-y").status_code == 404
    assert _points(client, world, eid, pid, 1, "op-v", headers=_hv(world)).status_code == 403
    # Kết thúc → 400
    assert _set_status(client, world, eid, "completed").status_code == 200
    assert _points(client, world, eid, pid, 1, "op-done").status_code == 400


def test_points_concurrent_20_threads_no_lost_update(client, world):
    """20 request +1 song song cho cùng 1 người: không mất cập nhật, đúng 20 log score,
    points_after là hoán vị 1..20, version tăng đúng 20 (không ghi lùi)."""
    ev, ps = _started(client, world, n_members=1, guest=False)
    eid, pid = ev["id"], ps[0]["id"]
    v0 = _detail(client, world, eid)["version"]
    h = _h(world)

    def hit(i):
        return _points(client, world, eid, pid, 1, f"con-{i}", headers=h)

    with ThreadPoolExecutor(max_workers=20) as ex:
        results = list(ex.map(hit, range(20)))
    codes = [r.status_code for r in results]
    assert codes == [200] * 20, [(c, r.text[:120]) for c, r in zip(codes, results) if c != 200]

    d = _detail(client, world, eid)
    assert d["participants"][0]["points"] == 20
    assert d["log_count"] == 20 and d["version"] == v0 + 20
    logs = [l for l in _logs(client, world, eid) if l["kind"] == "score"]
    assert len(logs) == 20
    assert sorted(l["points_after"] for l in logs) == list(range(1, 21))
    assert len({l["id"] for l in logs}) == 20
    # Mọi phản hồi đều là PointEventOut hội tụ: điểm trong từng phản hồi ≤ 20 và phản hồi cuối cùng theo version = 20
    best = max(results, key=lambda r: r.json()["version"])
    assert best.json()["participants"][0]["points"] == 20


def test_points_concurrent_mixed_minus_never_below_zero(client, world):
    """Song song 10 lượt −1 khi điểm đang là 3: đúng 3 lượt thành công, 7 lượt 409, điểm dừng ở 0."""
    ev, ps = _started(client, world, n_members=1, guest=False)
    eid, pid = ev["id"], ps[0]["id"]
    for i in range(3):
        assert _points(client, world, eid, pid, 1, f"up-{i}").status_code == 200
    h = _h(world)
    with ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(lambda i: _points(client, world, eid, pid, -1, f"down-{i}", headers=h), range(10)))
    codes = sorted(r.status_code for r in results)
    assert codes == [200] * 3 + [409] * 7, codes
    d = _detail(client, world, eid)
    assert d["participants"][0]["points"] == 0 and d["log_count"] == 6


# ── Trạng thái ───────────────────────────────────────────────────────────────

def test_status_transitions_start_finish_reopen(client, world):
    ev = _create(client, world, name="S")
    eid = ev["id"]
    r = _set_status(client, world, eid, "active")
    assert r.status_code == 400 and r.json()["detail"] == "Cần ít nhất 1 người tham gia"
    r = _set_status(client, world, eid, "completed")
    assert r.status_code == 400 and "Không thể chuyển trạng thái" in r.json()["detail"]
    assert _bulk(client, world, eid, [world.members1[0].id]).json()["added"] == 1
    # Người duy nhất bị xoá ở Nháp → vẫn chưa bắt đầu được
    only = _detail(client, world, eid)["participants"][0]
    assert client.delete(f"/api/point-events/{eid}/participants/{only['id']}", headers=_h(world)).status_code == 204
    assert _set_status(client, world, eid, "active").status_code == 400
    assert _bulk(client, world, eid, [world.members1[0].id]).json()["added"] == 1
    v = _detail(client, world, eid)["version"]

    r = _set_status(client, world, eid, "active")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active" and r.json()["started_at"] is not None and r.json()["completed_at"] is None
    assert r.json()["version"] == v + 1
    assert [l["note"] for l in _logs(client, world, eid)] == ["Bắt đầu"]
    # active → draft: không cho
    assert _set_status(client, world, eid, "draft").status_code == 400
    # Đặt cùng trạng thái → không lỗi, không log, không tăng version
    r = _set_status(client, world, eid, "active")
    assert r.status_code == 200 and r.json()["version"] == v + 1 and len(_logs(client, world, eid)) == 1

    pid = r.json()["participants"][0]["id"]
    assert _points(client, world, eid, pid, 1, "s-1").status_code == 200
    r = _set_status(client, world, eid, "completed")
    assert r.status_code == 200 and r.json()["status"] == "completed" and r.json()["completed_at"] is not None
    assert _points(client, world, eid, pid, 1, "s-2").status_code == 400
    # Mở lại: completed → active, completed_at = None, log "Mở lại", chấm tiếp được
    r = _set_status(client, world, eid, "active")
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["completed_at"] is None
    assert r.json()["started_at"] is not None
    assert [l["note"] for l in _logs(client, world, eid) if l["kind"] == "status"] == ["Bắt đầu", "Kết thúc", "Mở lại"]
    assert _points(client, world, eid, pid, 1, "s-3").json()["participants"][0]["points"] == 2
    # completed → draft: không cho
    assert _set_status(client, world, eid, "completed").status_code == 200
    assert _set_status(client, world, eid, "draft").status_code == 400
    assert client.put(f"/api/point-events/{eid}", json={"status": "bogus"}, headers=_h(world)).status_code == 422


def test_update_name_description_any_status(client, world):
    ev, ps = _started(client, world, n_members=1, guest=False)
    eid = ev["id"]
    v = ev["version"]
    r = client.put(f"/api/point-events/{eid}", json={"name": "  Tên mới  ", "description": "mô tả"}, headers=_h(world))
    assert r.status_code == 200 and r.json()["name"] == "Tên mới" and r.json()["description"] == "mô tả"
    assert r.json()["status"] == "active" and r.json()["version"] == v   # đổi tên không tăng version
    r = client.put(f"/api/point-events/{eid}", json={"name": "   "}, headers=_h(world))
    assert r.status_code == 400 and r.json()["detail"] == "Tên sự kiện không được để trống"
    # Chỉ đổi mô tả → tên giữ nguyên; mô tả None → xoá mô tả
    r = client.put(f"/api/point-events/{eid}", json={"description": None}, headers=_h(world))
    assert r.status_code == 200 and r.json()["name"] == "Tên mới" and r.json()["description"] is None
    assert _set_status(client, world, eid, "completed").status_code == 200
    r = client.put(f"/api/point-events/{eid}", json={"name": "Sau kết thúc"}, headers=_h(world))
    assert r.status_code == 200 and r.json()["name"] == "Sau kết thúc" and r.json()["status"] == "completed"
    assert client.put("/api/point-events/999999", json={"name": "x"}, headers=_h(world)).status_code == 404


# ── Danh sách / logs ─────────────────────────────────────────────────────────

def test_list_is_light_and_ordered(client, world):
    e1 = _create(client, world, name="Một", member_ids=[world.members1[0].id])
    e2, ps = _started(client, world, n_members=2, guest=False)
    for i in range(3):
        assert _points(client, world, e2["id"], ps[0]["id"], 1, f"l-{i}").status_code == 200
    rows = client.get("/api/point-events", headers=_h(world)).json()
    assert [r["id"] for r in rows] == [e2["id"], e1["id"]]
    assert all("participants" not in r for r in rows)
    assert rows[0]["participant_count"] == 2 and rows[0]["log_count"] == 3 and rows[0]["status"] == "active"
    assert rows[1]["participant_count"] == 1 and rows[1]["log_count"] == 0 and rows[1]["status"] == "draft"
    assert set(rows[0]) >= {"id", "kind", "name", "description", "status", "version", "created_by", "created_at",
                            "started_at", "completed_at", "participant_count", "log_count"}
    # state: gọn, có version
    st = client.get(f"/api/point-events/{e2['id']}/state", headers=_h(world)).json()
    assert set(st) == {"version", "status", "log_count", "participants"} and st["status"] == "active"
    assert st["version"] == _detail(client, world, e2["id"])["version"]
    assert {p["id"]: p["points"] for p in st["participants"]} == {ps[0]["id"]: 3, ps[1]["id"]: 0}
    assert set(st["participants"][0]) == {"id", "points", "status"}


def test_logs_pagination_after_id_and_limit_clamp(client, world):
    ev, ps = _started(client, world, n_members=1, guest=False)
    eid, pid = ev["id"], ps[0]["id"]
    for i in range(6):
        assert _points(client, world, eid, pid, 1, f"pg-{i}").status_code == 200
    allrows = _logs(client, world, eid)                     # 1 status + 6 score
    assert len(allrows) == 7 and [l["id"] for l in allrows] == sorted(l["id"] for l in allrows)
    page1 = _logs(client, world, eid, after_id=0, limit=3)
    assert [l["id"] for l in page1] == [l["id"] for l in allrows[:3]]
    page2 = _logs(client, world, eid, after_id=page1[-1]["id"], limit=3)
    assert [l["id"] for l in page2] == [l["id"] for l in allrows[3:6]]
    page3 = _logs(client, world, eid, after_id=page2[-1]["id"], limit=3)
    assert [l["id"] for l in page3] == [allrows[6]["id"]]
    assert _logs(client, world, eid, after_id=allrows[-1]["id"]) == []
    # limit quá lớn → kẹp về ≤ 500, không lỗi
    assert len(_logs(client, world, eid, limit=10000)) == 7
    assert len(_logs(client, world, eid, limit=0)) == 1
    assert set(allrows[0]) == {"id", "kind", "participant_id", "display_name", "delta", "points_after",
                               "note", "actor_name", "created_at"}


# ── Xoá sự kiện / chặn xoá người / xoá CLB ───────────────────────────────────

def test_delete_event_cascades_participants_and_logs(client, world, db):
    ev, ps = _started(client, world, n_members=2, guest=True)
    eid = ev["id"]
    for i in range(4):
        assert _points(client, world, eid, ps[i % 3]["id"], 1, f"d-{i}").status_code == 200
    assert db.query(models.PointLog).filter_by(event_id=eid).count() == 5
    assert client.delete(f"/api/point-events/{eid}", headers=_hv(world)).status_code == 403
    assert client.delete(f"/api/point-events/{eid}", headers=_h2(world)).status_code == 404
    assert client.delete(f"/api/point-events/{eid}", headers=_h(world)).status_code == 204
    assert db.query(models.PointEvent).filter_by(id=eid).first() is None
    assert db.query(models.PointEventParticipant).filter_by(event_id=eid).count() == 0
    assert db.query(models.PointLog).filter_by(event_id=eid).count() == 0
    assert client.get(f"/api/point-events/{eid}", headers=_h(world)).status_code == 404
    # Người vẫn còn nguyên
    assert db.query(models.Member).filter_by(id=world.members1[0].id).first() is not None
    assert db.query(models.Player).filter_by(id=world.guest1.id).first() is not None
    # Xoá được cả khi Nháp và khi đã kết thúc
    e_draft = _create(client, world, name="nháp")
    assert client.delete(f"/api/point-events/{e_draft['id']}", headers=_h(world)).status_code == 204
    e_done, _ = _started(client, world, n_members=1, guest=False)
    assert _set_status(client, world, e_done["id"], "completed").status_code == 200
    assert client.delete(f"/api/point-events/{e_done['id']}", headers=_h(world)).status_code == 204


def test_delete_member_or_player_in_event_is_blocked(client, world):
    m = world.members1[7]
    ev = _create(client, world, name="Chặn", member_ids=[m.id], player_ids=[world.guest1.id])
    r = client.delete(f"/api/members/{m.id}", headers=_h(world))
    assert r.status_code == 400 and r.json()["detail"] == "Không thể xoá: thành viên đang có tên trong sự kiện thành tích"
    r = client.delete(f"/api/players/{world.guest1.id}", headers=_h(world))
    assert r.status_code == 400 and r.json()["detail"] == "Không thể xoá: khách mời đang có tên trong sự kiện thành tích"
    # Kể cả người đã rời (giữ lịch sử) vẫn chặn
    assert _set_status(client, world, ev["id"], "active").status_code == 200
    gp = next(p for p in _detail(client, world, ev["id"])["participants"] if p["player_id"] == world.guest1.id)
    assert _points(client, world, ev["id"], gp["id"], 1, "blk-1").status_code == 200
    assert client.delete(f"/api/point-events/{ev['id']}/participants/{gp['id']}", headers=_h(world)).status_code == 204
    assert client.delete(f"/api/players/{world.guest1.id}", headers=_h(world)).status_code == 400
    # Xoá sự kiện xong → xoá người được
    assert client.delete(f"/api/point-events/{ev['id']}", headers=_h(world)).status_code == 204
    assert client.delete(f"/api/members/{m.id}", headers=_h(world)).status_code in (200, 204)
    assert client.delete(f"/api/players/{world.guest1.id}", headers=_h(world)).status_code == 204


def test_admin_delete_club_removes_point_events(client, world, db):
    ev, ps = _started(client, world, n_members=2, guest=True)
    for i in range(3):
        assert _points(client, world, ev["id"], ps[0]["id"], 1, f"c-{i}").status_code == 200
    ev2 = _create(client, world, headers=_h2(world), name="CLB2", member_ids=[world.members2[0].id])
    su = models.User(username="root16", password_hash="x", role=models.UserRole.admin, is_superuser=True)
    db.add(su); db.commit()
    from auth import create_access_token
    hsu = {"Authorization": f"Bearer {create_access_token({'sub': 'root16'})}"}
    r = client.delete(f"/api/admin/clubs/{world.club1.id}", headers=hsu)
    assert r.status_code == 200, r.text
    assert db.query(models.PointEvent).filter_by(club_id=world.club1.id).count() == 0
    assert db.query(models.PointEventParticipant).filter_by(event_id=ev["id"]).count() == 0
    assert db.query(models.PointLog).filter_by(event_id=ev["id"]).count() == 0
    assert db.query(models.Member).filter_by(club_id=world.club1.id).count() == 0
    # CLB 2 không bị ảnh hưởng
    assert db.query(models.PointEvent).filter_by(id=ev2["id"]).first() is not None
    assert db.query(models.PointEventParticipant).filter_by(event_id=ev2["id"]).count() == 1


# ── Public ───────────────────────────────────────────────────────────────────

def test_public_point_events_visibility_pii_and_actor(client, world):
    slug = world.token1.slug
    base = f"/api/public/report/{slug}/point-events"
    ev = _create(client, world, name="Pub", member_ids=[m.id for m in world.members1[:2]], player_ids=[world.guest1.id])
    eid = ev["id"]
    # Nháp → ẩn hoàn toàn
    assert client.get(base).json() == []
    assert client.get(f"{base}/{eid}").status_code == 404
    assert client.get(f"{base}/{eid}/state").status_code == 404
    assert client.get(f"{base}/{eid}/logs").status_code == 404
    # Bắt đầu + chấm vài điểm → hiện
    assert _set_status(client, world, eid, "active").status_code == 200
    pid = ev["participants"][0]["id"]
    assert _points(client, world, eid, pid, 1, "pub-1").status_code == 200
    assert _points(client, world, eid, pid, 1, "pub-2").status_code == 200

    rows = client.get(base).json()
    assert [r["id"] for r in rows] == [eid]
    assert set(rows[0]) == {"id", "kind", "name", "status", "created_at", "started_at", "completed_at",
                            "participant_count", "log_count", "version"}
    assert rows[0]["participant_count"] == 3 and rows[0]["log_count"] == 2 and rows[0]["status"] == "active"

    r = client.get(f"{base}/{eid}")
    assert r.status_code == 200, r.text
    body = r.text
    for key in PII_KEYS | {"created_by", "actor_name", "member_id", "player_id"}:
        assert f'"{key}"' not in body, f"public point-event detail lộ trường {key}"
    d = r.json()
    assert d["name"] == "Pub" and d["status"] == "active" and len(d["participants"]) == 3
    assert set(d["participants"][0]) == {"id", "display_name", "rank_snapshot", "seq", "points", "status"}
    assert d["participants"][0]["points"] == 2 and d["log_count"] == 2
    assert d["version"] == _detail(client, world, eid)["version"]

    st = client.get(f"{base}/{eid}/state").json()
    assert st["version"] == d["version"] and st["status"] == "active"
    assert {p["id"]: p["points"] for p in st["participants"]}[pid] == 2

    r = client.get(f"{base}/{eid}/logs", params={"after_id": 0, "limit": 200})
    assert r.status_code == 200
    logs = r.json()
    assert len(logs) == 3 and all("actor_name" not in l for l in logs)
    for key in PII_KEYS:
        assert f'"{key}"' not in r.text
    assert [l["kind"] for l in logs] == ["status", "score", "score"]
    assert logs[1]["display_name"] == world.members1[0].full_name and logs[2]["points_after"] == 2
    # Phân trang public
    assert [l["id"] for l in client.get(f"{base}/{eid}/logs", params={"after_id": logs[0]["id"]}).json()] == \
        [logs[1]["id"], logs[2]["id"]]

    # Kết thúc vẫn hiện (status completed)
    assert _set_status(client, world, eid, "completed").status_code == 200
    assert client.get(f"{base}/{eid}").json()["status"] == "completed"
    assert client.get(base).json()[0]["status"] == "completed"

    # Sai slug → 404; sự kiện CLB khác qua slug CLB 1 → 404
    assert client.get("/api/public/report/khong-ton-tai/point-events").status_code == 404
    assert client.get(f"/api/public/report/khong-ton-tai/point-events/{eid}").status_code == 404
    ev2 = _create(client, world, headers=_h2(world), name="CLB2", member_ids=[world.members2[0].id])
    assert client.put(f"/api/point-events/{ev2['id']}", json={"status": "active"}, headers=_h2(world)).status_code == 200
    assert client.get(f"{base}/{ev2['id']}").status_code == 404
    assert client.get(f"{base}/{ev2['id']}/state").status_code == 404
    assert [r["id"] for r in client.get(base).json()] == [eid]


# ── Hành vi cũ của giải đấu không đổi sau khi tách _normalize_people_ids ──────

def test_tournament_bulk_still_normalizes_linked_player(client, world, db):
    m = world.members1[0]
    linked = models.Player(name="Linked", club_id=world.club1.id, member_id=m.id, rank="A")
    db.add(linked); db.commit(); db.refresh(linked)
    tid = client.post("/api/tournaments", json={"name": "T", "format": "round_robin"}, headers=_h(world)).json()["id"]
    r = client.post(f"/api/tournaments/{tid}/participants/bulk",
                    json={"member_ids": [m.id], "player_ids": [linked.id, world.guest1.id, world.guest1.id]}, headers=_h(world))
    assert r.status_code == 200 and r.json()["added"] == 2 and r.json()["skipped"] == []
    r = client.post(f"/api/tournaments/{tid}/participants/bulk",
                    json={"member_ids": [], "player_ids": [linked.id]}, headers=_h(world))
    assert r.json()["added"] == 0 and r.json()["skipped"] == [m.full_name]
    r = client.post(f"/api/tournaments/{tid}/participants/bulk",
                    json={"member_ids": [world.members2[0].id]}, headers=_h(world))
    assert r.status_code == 404


# ═══ Phản biện đợt 2: đồng thời, tái dùng id, id khổng lồ ════════════════════════════

def test_state_log_count_tracks_score_logs(client, world):
    ev, ps = _started(client, world, n_members=1, guest=False)
    eid, pid = ev["id"], ps[0]["id"]
    st = client.get(f"/api/point-events/{eid}/state", headers=_h(world)).json()
    assert st["log_count"] == 0
    for i in range(3):
        assert _points(client, world, eid, pid, 1, f"lc-{i}").status_code == 200
    assert client.get(f"/api/point-events/{eid}/state", headers=_h(world)).json()["log_count"] == 3


def test_ids_not_reused_after_hard_delete(client, world):
    """AUTOINCREMENT: xoá cứng người mới thêm (chưa có điểm) rồi phát sinh log/người mới → id KHÔNG bị cấp lại.
    Nếu id bị tái dùng, máy khác tải log theo after_id sẽ bỏ sót lượt chấm và nhầm người."""
    ev, ps = _started(client, world, n_members=1, guest=False)
    eid, p1 = ev["id"], ps[0]["id"]
    added = _bulk(client, world, eid, member_ids=[world.members1[5].id]).json()["event"]
    late = next(p for p in added["participants"] if p["member_id"] == world.members1[5].id)
    seen_log_max = max(l["id"] for l in _logs(client, world, eid))      # log "Thêm" của người đến muộn
    assert client.delete(f"/api/point-events/{eid}/participants/{late['id']}", headers=_h(world)).status_code == 204
    assert _points(client, world, eid, p1, 1, "reuse-1").status_code == 200
    new_logs = [l for l in _logs(client, world, eid, after_id=seen_log_max)]
    assert [l["kind"] for l in new_logs] == ["score"], "lượt chấm mới phải có id > mọi id client đã thấy"
    # người mới thêm sau khi xoá cứng cũng nhận id mới, không trùng id người vừa xoá
    again = _bulk(client, world, eid, member_ids=[world.members1[6].id]).json()["event"]
    newp = next(p for p in again["participants"] if p["member_id"] == world.members1[6].id)
    assert newp["id"] > late["id"]


def test_stale_event_cannot_score_after_completed(client, world, db):
    """Request +1 đã qua guard 'active' trên bản ORM cũ nhưng sự kiện vừa Kết thúc ở máy khác: câu UPDATE tự
    kiểm tra trạng thái sự kiện nên KHÔNG ghi điểm (trước đây vẫn ghi sau khi đã chốt)."""
    from fastapi import HTTPException
    ev, ps = _started(client, world, n_members=1, guest=False)
    eid, pid = ev["id"], ps[0]["id"]
    ev_orm = db.get(models.PointEvent, eid)
    p_orm = db.get(models.PointEventParticipant, pid)
    assert ev_orm.status == models.TournamentStatus.active      # bản cũ nằm trong session này
    assert _set_status(client, world, eid, "completed").status_code == 200   # máy khác chốt (session khác)
    with pytest.raises(HTTPException) as ei:
        main._apply_point_delta(db, ev_orm, p_orm, 1, "stale-op", actor="admin1")
    assert ei.value.status_code == 400
    d = _detail(client, world, eid)
    assert d["participants"][0]["points"] == 0 and d["log_count"] == 0


def test_points_vs_hard_delete_race_never_loses_acknowledged_points(client, world):
    """+1 chạy song song với xoá người: không 500; điểm đã trả 200 không bao giờ bị mất
    (người còn → points == số lượt 200; người bị xoá cứng → không có lượt nào được báo thành công)."""
    for trial in range(4):
        ev, ps = _started(client, world, n_members=2, guest=False)
        eid, pid = ev["id"], ps[0]["id"]
        h = _h(world)

        def hit(i):
            if i == 4:
                return client.delete(f"/api/point-events/{eid}/participants/{pid}", headers=h)
            return _points(client, world, eid, pid, 1, f"race-{trial}-{i}", headers=h)

        with ThreadPoolExecutor(max_workers=9) as ex:
            res = list(ex.map(hit, range(9)))
        assert all(r.status_code < 500 for r in res), [(r.status_code, r.text[:100]) for r in res]
        ok_points = sum(1 for i, r in enumerate(res) if i != 4 and r.status_code == 200)
        d = _detail(client, world, eid)
        row = next((x for x in d["participants"] if x["id"] == pid), None)
        if row is None:
            assert ok_points == 0, "người bị xoá cứng nhưng vẫn có lượt +1 được báo thành công (mất điểm)"
        else:
            assert row["points"] == ok_points
            score = [l for l in _logs(client, world, eid) if l["kind"] == "score" and l["participant_id"] == pid]
            assert len(score) == ok_points


def test_concurrent_status_change_single_log(client, world):
    """6 máy cùng bấm 'Kết thúc': chỉ ghi đúng 1 log 'Kết thúc', không 500."""
    ev, _ = _started(client, world, n_members=1, guest=False)
    eid = ev["id"]
    h = _h(world)
    with ThreadPoolExecutor(max_workers=6) as ex:
        res = list(ex.map(lambda _i: client.put(f"/api/point-events/{eid}", json={"status": "completed"}, headers=h), range(6)))
    assert all(r.status_code in (200, 400, 409) for r in res), [(r.status_code, r.text[:80]) for r in res]
    assert sum(1 for r in res if r.status_code == 200) >= 1
    notes = [l["note"] for l in _logs(client, world, eid) if l["kind"] == "status"]
    assert notes.count("Kết thúc") == 1 and notes.count("Bắt đầu") == 1
    assert _detail(client, world, eid)["status"] == "completed"


def test_concurrent_bulk_add_same_person_no_500(client, world):
    ev = _create(client, world, name="Bulk race")
    eid = ev["id"]
    h = _h(world)
    mid = world.members1[0].id
    with ThreadPoolExecutor(max_workers=8) as ex:
        res = list(ex.map(lambda _i: _bulk(client, world, eid, member_ids=[mid], headers=h), range(8)))
    assert all(r.status_code in (200, 409) for r in res), [(r.status_code, r.text[:100]) for r in res]
    assert sum(1 for r in res if r.status_code == 200) >= 1
    parts = _detail(client, world, eid)["participants"]
    assert len(parts) == 1 and parts[0]["member_id"] == mid


def test_concurrent_bulk_add_different_people_unique_seq(client, world):
    ev = _create(client, world, name="Bulk seq race")
    eid = ev["id"]
    h = _h(world)
    ids = [m.id for m in world.members1[:6]]
    with ThreadPoolExecutor(max_workers=6) as ex:
        res = list(ex.map(lambda mid: _bulk(client, world, eid, member_ids=[mid], headers=h), ids))
    assert all(r.status_code == 200 for r in res), [(r.status_code, r.text[:100]) for r in res]
    parts = _detail(client, world, eid)["participants"]
    assert sorted(p["member_id"] for p in parts) == sorted(ids)
    assert len({p["seq"] for p in parts}) == 6, "seq phải duy nhất"


def test_idempotent_retry_after_event_finished_returns_ok(client, world):
    """Client retry lượt ĐÃ GHI sau khi sự kiện kết thúc vẫn nhận 200 (idempotent trước guard trạng thái)."""
    ev, ps = _started(client, world, n_members=1, guest=False)
    eid, pid = ev["id"], ps[0]["id"]
    assert _points(client, world, eid, pid, 1, "retry-op").status_code == 200
    assert _set_status(client, world, eid, "completed").status_code == 200
    r = _points(client, world, eid, pid, 1, "retry-op")
    assert r.status_code == 200 and r.json()["participants"][0]["points"] == 1
    assert _points(client, world, eid, pid, 1, "new-op").status_code == 400   # lượt mới thì vẫn bị chặn


def test_guest_converted_to_member_is_not_added_twice(client, world, db):
    ev = _create(client, world, name="Convert")
    eid = ev["id"]
    assert _bulk(client, world, eid, player_ids=[world.guest1.id]).status_code == 200
    guest = db.get(models.Player, world.guest1.id)
    guest.member_id = world.members1[2].id          # khách được chuyển thành thành viên sau khi đã vào sự kiện
    db.commit()
    r = _bulk(client, world, eid, member_ids=[world.members1[2].id])
    assert r.status_code == 200 and r.json()["added"] == 0 and len(r.json()["skipped"]) == 1
    assert len(_detail(client, world, eid)["participants"]) == 1


def test_huge_ids_are_404_or_empty_not_500(client, world):
    ev, ps = _started(client, world, n_members=1, guest=False)
    eid = ev["id"]
    big = 10 ** 30
    h = _h(world)
    assert client.get(f"/api/point-events/{big}", headers=h).status_code == 404
    assert client.get(f"/api/point-events/{eid}/logs", params={"after_id": big}, headers=h).json() == []
    assert client.delete(f"/api/point-events/{eid}/participants/{big}", headers=h).status_code == 404
    assert _points(client, world, eid, big, 1, "big-op").status_code == 404
    pub = f"/api/public/report/{world.token1.slug}/point-events"
    assert client.get(f"{pub}/{big}").status_code == 404
    assert client.get(f"{pub}/{eid}/logs", params={"after_id": big}).json() == []
