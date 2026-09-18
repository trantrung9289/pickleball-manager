"""
Test harness dùng chung.
- DATABASE_URL trỏ tới SQLite tạm TRƯỚC khi import main (main chạy create_all + migration lúc import).
- Dùng auth thật (JWT + X-Club-ID + ClubMembership) thay vì override dependency,
  để test bắt được đúng lỗi phân quyền/cách ly CLB.
"""
import os
import sys
import tempfile
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="clb_test_")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP}/test.db"
os.environ.pop("FLY_APP_NAME", None)
os.environ.pop("TELEGRAM_BOT_TOKEN", None)
os.environ.pop("BOT_USERNAME", None)
os.environ["SECRET_KEY"] = "test-secret-key-not-for-production"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient

import main  # noqa: E402  (import sau khi set env)
import models  # noqa: E402
from auth import create_access_token, hash_password  # noqa: E402
from database import SessionLocal, engine, Base  # noqa: E402


@pytest.fixture(scope="session")
def client():
    return TestClient(main.app, raise_server_exceptions=False)


@pytest.fixture()
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture(autouse=True)
def _clean_db():
    """Mỗi test bắt đầu với DB trống (giữ schema)."""
    yield
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())


class World:
    """Hai CLB, mỗi CLB một admin + vài thành viên + một khách mời, và một link public cho CLB 1."""

    def __init__(self, db):
        self.db = db
        self.club1 = models.Club(name="Club One")
        self.club2 = models.Club(name="Club Two")
        db.add_all([self.club1, self.club2]); db.flush()

        self.admin1 = self._user("admin1", self.club1, role=models.UserRole.admin)
        self.admin2 = self._user("admin2", self.club2, role=models.UserRole.admin)
        self.viewer1 = self._user("viewer1", self.club1, role=models.UserRole.member,
                                  can_view=True, can_create=False, can_edit=False, can_delete=False)

        self.members1 = [self._member(self.club1, i) for i in range(1, 9)]
        self.members2 = [self._member(self.club2, i, prefix="V") for i in range(1, 4)]
        self.guest1 = models.Player(name="Guest One", club_id=self.club1.id, rank="C", phone="0911111111")
        self.guest2 = models.Player(name="Guest Two", club_id=self.club2.id, rank="C", phone="0922222222")
        db.add_all([self.guest1, self.guest2])

        self.fee1 = models.FeeType(club_id=self.club1.id, name="Phí tháng", type="income", default_amount=100000)
        self.fee2 = models.FeeType(club_id=self.club2.id, name="Phí tháng", type="income", default_amount=100000)
        db.add_all([self.fee1, self.fee2])

        self.token1 = models.PublicReportToken(token="tok-club1", slug="clubone-abc12345",
                                               club_id=self.club1.id, label="pub", is_active=True)
        db.add(self.token1)
        db.commit()
        for obj in [self.club1, self.club2, self.guest1, self.guest2, self.fee1, self.fee2, self.token1] + self.members1 + self.members2:
            db.refresh(obj)

    def _user(self, username, club, role, **perm):
        u = models.User(username=username, full_name=username, password_hash=hash_password("pw"),
                        role=models.UserRole.member, is_superuser=False)
        self.db.add(u); self.db.flush()
        m = models.ClubMembership(user_id=u.id, club_id=club.id, role=role,
                                  can_view=perm.get("can_view", True), can_create=perm.get("can_create", True),
                                  can_edit=perm.get("can_edit", True), can_delete=perm.get("can_delete", True))
        self.db.add(m); self.db.flush()
        return u

    def _member(self, club, i, prefix="M"):
        m = models.Member(club_id=club.id, member_code=f"{prefix}{i:03d}", full_name=f"{prefix} Member {i}",
                          phone=f"0900000{i:03d}", email=f"{prefix.lower()}{i}@x.vn",
                          address=f"Addr {i}", notes="secret note", rank="B", status="active")
        self.db.add(m)
        return m

    @staticmethod
    def headers(user, club):
        tok = create_access_token({"sub": user.username})
        return {"Authorization": f"Bearer {tok}", "X-Club-ID": str(club.id)}


@pytest.fixture()
def world(db):
    return World(db)
