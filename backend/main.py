from fastapi import FastAPI, Depends, HTTPException, Query, UploadFile, File, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, extract, text, or_, case
from sqlalchemy.exc import IntegrityError
from typing import Optional, List
from datetime import date, datetime
from zoneinfo import ZoneInfo

_VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

def _now_vn() -> datetime:
    return datetime.now(_VN_TZ).replace(tzinfo=None)
from decimal import Decimal
from pathlib import Path
import hashlib
import io
import os
import re
import secrets
import time
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
import models, schemas
from database import engine, get_db, Base
from tournament_engine import (
    generate_schedule, generate_group_schedule,
    generate_knockout_from_groups, compute_standings,
    DRAW_SUPPORTED_FORMATS, draw_slot_label, draw_picks_to_pid_list, draw_pick_index,
    normalize_rank, normalize_partner_rules, partner_draw_plan, partner_step_context, partner_draw_finished,
    partner_draw_stuck, _normalize_partner_plan, UNRANKED,
)
from auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, require_admin, require_superuser,
    get_club_permission, ClubPermissions,
)

Base.metadata.create_all(bind=engine)


# ── Helpers cách ly đa CLB: mọi id nhận từ body phải thuộc CLB hiện tại ──
def _get_member_in_club(db: Session, member_id: int, club_id: int) -> "models.Member":
    m = db.query(models.Member).filter(
        models.Member.id == member_id, models.Member.club_id == club_id
    ).first()
    if not m:
        raise HTTPException(404, f"Thành viên #{member_id} không thuộc câu lạc bộ này")
    return m


def _get_player_in_club(db: Session, player_id: int, club_id: int) -> "models.Player":
    pl = db.query(models.Player).filter(
        models.Player.id == player_id, models.Player.club_id == club_id
    ).first()
    if not pl:
        raise HTTPException(404, f"Khách mời #{player_id} không thuộc câu lạc bộ này")
    return pl


def _check_people_in_club(db: Session, club_id: int, member_id=None, player_id=None) -> None:
    if member_id is not None:
        _get_member_in_club(db, member_id, club_id)
    if player_id is not None:
        _get_player_in_club(db, player_id, club_id)

# ── MIGRATION: tự động thêm cột mới vào các bảng cũ khi deploy ──
def _run_migration():
    from sqlalchemy import text

    # Danh sách migration: (table, column, column_def, optional_update_sql)
    migrations = [
        # Bảng users — thêm các cột mới
        ("users", "full_name",    "VARCHAR(100)", None),
        ("users", "is_superuser", "BOOLEAN DEFAULT 0 NOT NULL", None),
        ("users", "member_id",    "INTEGER REFERENCES members(id)", None),
        # Bảng members — thêm rank và club_id
        ("members", "rank",    "VARCHAR(30)", None),
        ("members", "club_id", "INTEGER REFERENCES clubs(id)",
            "UPDATE members SET club_id = (SELECT id FROM clubs LIMIT 1) WHERE club_id IS NULL"),
        # Bảng fee_types — thêm club_id
        ("fee_types", "club_id", "INTEGER REFERENCES clubs(id)",
            "UPDATE fee_types SET club_id = (SELECT id FROM clubs LIMIT 1) WHERE club_id IS NULL"),
        # Bảng transactions — thêm club_id
        ("transactions", "club_id", "INTEGER REFERENCES clubs(id)",
            "UPDATE transactions SET club_id = (SELECT id FROM clubs LIMIT 1) WHERE club_id IS NULL"),
        # Bảng tournaments — thêm club_id
        ("tournaments", "club_id", "INTEGER REFERENCES clubs(id)",
            "UPDATE tournaments SET club_id = (SELECT id FROM clubs LIMIT 1) WHERE club_id IS NULL"),
        # Bảng public_report_tokens — thêm cột slug
        ("public_report_tokens", "slug", "VARCHAR(120)", None),
        # Bảng tournament_participants — thêm hỗ trợ khách mời (player_id)
        ("tournament_participants", "player_id", "INTEGER REFERENCES players(id)", None),
        ("tournament_participants", "partner_player_id", "INTEGER REFERENCES players(id)", None),
        # Bảng club_memberships — thêm telegram_chat_id (đăng nhập bot qua Telegram)
        ("club_memberships", "telegram_chat_id", "INTEGER", None),
        # Bảng transactions — thêm player_id (gán khoản thu cho khách mời)
        ("transactions", "player_id", "INTEGER REFERENCES players(id)", None),
        # Bảng tournaments — PIN nhập điểm qua trang public
        ("tournaments", "score_pin_hash", "VARCHAR(100)", None),
        ("tournaments", "public_scoring_enabled", "BOOLEAN DEFAULT 0 NOT NULL", None),
        # Bảng tournaments — bật/tắt trận tranh giải 3 (knockout/combined)
        ("tournaments", "third_place_enabled", "BOOLEAN DEFAULT 0 NOT NULL", None),
        # Bảng tournament_participants — trạng thái bỏ giải giữa chừng
        ("tournament_participants", "status", "VARCHAR(20) DEFAULT 'active' NOT NULL", None),
        # Bảng tournament_matches — thắng do đối thủ bỏ giải (walkover) + định tuyến người thua
        # sang trận tranh giải 3 (chỉ set trên 2 trận bán kết)
        ("tournament_matches", "is_walkover", "BOOLEAN DEFAULT 0 NOT NULL", None),
        ("tournament_matches", "loser_next_match_id", "INTEGER REFERENCES tournament_matches(id)", None),
        ("tournament_matches", "loser_next_match_slot", "INTEGER", None),
        # Bảng club_memberships — club admin bật/tắt quyền dùng bot Telegram cho từng tài khoản
        # (mặc định bật để không ảnh hưởng người đang dùng)
        ("club_memberships", "bot_enabled", "BOOLEAN DEFAULT 1 NOT NULL", None),
        # Bảng tournaments — quy tắc ghép ĐỒNG ĐỘI cho vòng quay ghép đội (giải đôi)
        ("tournaments", "partner_rules", "JSON", None),
        # Bảng clubs — danh sách hạng cấu hình ở cấp CLB (NULL → DEFAULT_RANK_LEVELS)
        ("clubs", "rank_levels", "JSON", None),
    ]

    with engine.connect() as conn:
        for table, column, col_def, update_sql in migrations:
            # Kiểm tra table có tồn tại không
            exists = conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"),
                {"t": table}
            ).fetchone()
            if not exists:
                continue
            # Kiểm tra column đã tồn tại chưa
            cols = [r[1] for r in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()]
            if column not in cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}"))
                if update_sql:
                    conn.execute(text(update_sql))
        conn.commit()

_run_migration()


_IS_PRODUCTION = bool(os.environ.get("FLY_APP_NAME") or os.environ.get("APP_ENV") == "production")

app = FastAPI(
    title="Quản lý CLB Thể thao", version="1.0.0",
    # Không lộ schema API (kể cả /api/internal/*) ra Internet trên production
    docs_url=None if _IS_PRODUCTION else "/docs",
    redoc_url=None if _IS_PRODUCTION else "/redoc",
    openapi_url=None if _IS_PRODUCTION else "/openapi.json",
)

# ── Rate limiting (public report endpoints) ──
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded


def _rate_limit_key(request):
    """IP thật của client, không phải IP proxy nội bộ của Fly.

    Uvicorn không chạy với --proxy-headers nên request.client.host luôn là IP của
    Fly edge proxy — nếu dùng get_remote_address() thẳng, MỌI client (kể cả bot gọi
    qua localhost) bị gộp chung một "xô" rate limit. Fly tự set header Fly-Client-IP
    ở edge (client không ghi đè được vì app chỉ nhận traffic qua proxy này), nên có
    thể tin cậy trực tiếp mà không cần bật proxy-headers cho toàn bộ uvicorn.
    """
    return request.headers.get("fly-client-ip") or get_remote_address(request)


limiter = Limiter(key_func=_rate_limit_key)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).parent / "static"


# ── HEALTH (dùng cho Fly checks + entrypoint; không lộ dữ liệu) ──

@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"ok": True}


# ── AUTH & CLUB ───────────────────────────────────────────

@app.get("/api/club/status")
def club_status(db: Session = Depends(get_db)):
    """Kiểm tra hệ thống đã khởi tạo (có ít nhất 1 CLB) chưa.
    Không trả thông tin CLB: hệ thống đa CLB nên "CLB đầu tiên" không đại diện cho ai,
    và endpoint này public (trang đăng nhập) — không lộ tên/địa chỉ/SĐT của bất kỳ CLB nào."""
    return {"initialized": db.query(models.Club.id).first() is not None}


@app.post("/api/club/setup", response_model=schemas.TokenOut)
def club_setup(payload: schemas.ClubSetup, db: Session = Depends(get_db)):
    """Khởi tạo CLB lần đầu + tạo tài khoản admin."""
    if db.query(models.Club).first():
        raise HTTPException(400, "CLB đã được khởi tạo rồi")
    if db.query(models.User).filter(models.User.username == payload.admin_username).first():
        raise HTTPException(400, "Tên đăng nhập đã tồn tại")

    club = models.Club(
        name=payload.club_name, sport=payload.sport,
        description=payload.description, founded_year=payload.founded_year,
        address=payload.address, phone=payload.phone, email=payload.email,
    )
    db.add(club)

    admin = models.User(
        username=payload.admin_username,
        full_name=payload.admin_full_name,
        password_hash=hash_password(payload.admin_password),
        role=models.UserRole.admin,
        is_superuser=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)

    token = create_access_token({"sub": admin.username})
    return {"access_token": token, "user": admin}


@app.post("/api/auth/login", response_model=schemas.TokenOut)
@limiter.limit("10/minute")
def login(request: Request, payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Sai tên đăng nhập hoặc mật khẩu")
    token = create_access_token({"sub": user.username})
    return {"access_token": token, "user": user}


@app.post("/api/auth/register", response_model=schemas.TokenOut)
def register(payload: schemas.RegisterRequest, db: Session = Depends(get_db)):
    if not db.query(models.Club).first():
        raise HTTPException(400, "CLB chưa được khởi tạo")
    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(400, "Tên đăng nhập đã tồn tại")
    # Tự đăng ký luôn là role member
    role = models.UserRole.member
    user = models.User(
        username=payload.username,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": user.username})
    return {"access_token": token, "user": user}


@app.get("/api/auth/me", response_model=schemas.UserOut)
def get_me(current_user: models.User = Depends(get_current_user)):
    return current_user


@app.get("/api/auth/users", response_model=List[schemas.UserOut])
def list_users(db: Session = Depends(get_db),
               current_user: models.User = Depends(require_admin)):
    return db.query(models.User).all()


@app.get("/api/club", response_model=schemas.ClubOut)
def get_club(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    club = db.query(models.Club).first()
    if not club:
        raise HTTPException(404, "Chưa khởi tạo CLB")
    return club


@app.put("/api/club", response_model=schemas.ClubOut)
def update_club(payload: schemas.ClubUpdate, db: Session = Depends(get_db),
                current_user: models.User = Depends(require_admin)):
    club = db.query(models.Club).first()
    if not club:
        raise HTTPException(404, "Chưa khởi tạo CLB")
    for k, v in payload.dict(exclude_none=True).items():
        setattr(club, k, v)
    db.commit()
    db.refresh(club)
    return club


# ── CẤU HÌNH HẠNG CỦA CLB (dùng chung Thành viên / Khách mời / quy tắc ghép đội) ──
DEFAULT_RANK_LEVELS = ["A", "B", "C", "D", "Hạt giống 1", "Hạt giống 2", "Hạt giống 3"]
MAX_RANK_LEVELS = 30
MAX_RANK_LEN = 30   # khớp members.rank String(30)


def _club_rank_levels(club: "models.Club") -> list:
    """Danh sách hạng hiệu lực của CLB: cấu hình riêng hoặc mặc định. 'Chưa xếp hạng' KHÔNG nằm trong đây."""
    levels = club.rank_levels
    return list(levels) if isinstance(levels, list) else list(DEFAULT_RANK_LEVELS)


def _rank_in_use(db: Session, club_id: int) -> dict:
    """Đếm số người đang mang từng hạng trong CLB: thành viên + khách mời (players.member_id IS NULL),
    theo normalize_rank (NULL/rỗng → 'Chưa xếp hạng'). Chỉ trả hạng có count > 0."""
    counts: dict = {}
    for (r,) in db.query(models.Member.rank).filter(models.Member.club_id == club_id).all():
        k = normalize_rank(r)
        counts[k] = counts.get(k, 0) + 1
    for (r,) in db.query(models.Player.rank).filter(
        models.Player.club_id == club_id, models.Player.member_id.is_(None)
    ).all():
        k = normalize_rank(r)
        counts[k] = counts.get(k, 0) + 1
    return counts


def _rank_levels_out(db: Session, club: "models.Club") -> dict:
    return {
        "rank_levels": _club_rank_levels(club),
        "unranked_label": UNRANKED,
        "in_use": _rank_in_use(db, club.id),
    }


@app.get("/api/club/rank-levels", response_model=schemas.RankLevelsOut)
def get_rank_levels(db: Session = Depends(get_db), perms: ClubPermissions = Depends(get_club_permission)):
    perms.require_view()
    club = db.query(models.Club).filter(models.Club.id == perms.club_id).first()
    if not club:
        raise HTTPException(404, "Không tìm thấy CLB")
    return _rank_levels_out(db, club)


@app.put("/api/club/rank-levels", response_model=schemas.RankLevelsOut)
def update_rank_levels(
    data: schemas.RankLevelsIn,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Lưu danh sách hạng của CLB. Không cho bỏ hạng đang có người dùng (đổi hạng của họ trước).
    Endpoint tạo/sửa thành viên/khách mời KHÔNG từ chối hạng ngoài danh sách (giữ dữ liệu cũ)."""
    perms.require_edit()
    club = db.query(models.Club).filter(models.Club.id == perms.club_id).first()
    if not club:
        raise HTTPException(404, "Không tìm thấy CLB")

    levels = []
    for raw in data.rank_levels:
        s = str(raw or "").strip()
        if not s:
            continue
        if len(s) > MAX_RANK_LEN:
            raise HTTPException(400, f"Hạng quá dài (tối đa {MAX_RANK_LEN} ký tự): {s[:MAX_RANK_LEN]}…")
        if s == UNRANKED:
            raise HTTPException(400, f"'{UNRANKED}' là hạng ngầm định, luôn có sẵn — không thêm vào danh sách")
        if s in levels:
            raise HTTPException(400, f"Hạng bị trùng: {s}")
        levels.append(s)
    if len(levels) > MAX_RANK_LEVELS:
        raise HTTPException(400, f"Tối đa {MAX_RANK_LEVELS} hạng")

    in_use = _rank_in_use(db, club.id)
    for old in _club_rank_levels(club):
        if old not in levels and in_use.get(old, 0) > 0:
            raise HTTPException(400, f"Hạng {old} đang được dùng bởi {in_use[old]} người — đổi hạng của họ trước khi xoá")

    club.rank_levels = levels
    db.commit(); db.refresh(club)
    return _rank_levels_out(db, club)


# ── SYSTEM ADMIN ─────────────────────────────────────────

@app.get("/api/admin/users", response_model=List[schemas.UserOut])
def admin_list_users(db: Session = Depends(get_db), su = Depends(require_superuser)):
    return db.query(models.User).order_by(models.User.id).all()

@app.post("/api/admin/users", response_model=schemas.UserOut)
def admin_create_user(payload: schemas.UserCreate, db: Session = Depends(get_db), su = Depends(require_superuser)):
    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(400, "Tên đăng nhập đã tồn tại")
    role = models.UserRole(payload.role) if payload.role in models.UserRole.__members__ else models.UserRole.member
    user = models.User(
        username=payload.username, full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role=role, is_superuser=payload.is_superuser,
    )
    db.add(user); db.commit(); db.refresh(user)
    return user

@app.put("/api/admin/users/{uid}", response_model=schemas.UserOut)
def admin_update_user(uid: int, payload: schemas.UserUpdate, db: Session = Depends(get_db), su = Depends(require_superuser)):
    user = db.query(models.User).filter(models.User.id == uid).first()
    if not user: raise HTTPException(404, "Không tìm thấy tài khoản")
    if payload.full_name is not None: user.full_name = payload.full_name
    if payload.role is not None and payload.role in models.UserRole.__members__:
        user.role = models.UserRole(payload.role)
    if payload.is_superuser is not None: user.is_superuser = payload.is_superuser
    if payload.password: user.password_hash = hash_password(payload.password)
    db.commit(); db.refresh(user)
    return user

@app.delete("/api/admin/users/{uid}")
def admin_delete_user(uid: int, db: Session = Depends(get_db), su = Depends(require_superuser)):
    user = db.query(models.User).filter(models.User.id == uid).first()
    if not user: raise HTTPException(404, "Không tìm thấy tài khoản")
    if user.id == su.id: raise HTTPException(400, "Không thể xóa tài khoản đang dùng")
    db.delete(user); db.commit()
    return {"ok": True}

@app.get("/api/admin/clubs", response_model=List[schemas.ClubOut])
def admin_list_clubs(db: Session = Depends(get_db), su = Depends(require_superuser)):
    return db.query(models.Club).order_by(models.Club.id).all()

@app.post("/api/admin/clubs", response_model=schemas.ClubOut)
def admin_create_club(payload: schemas.ClubUpdate, db: Session = Depends(get_db), su = Depends(require_superuser)):
    # Hệ thống đa CLB, đa bộ môn: không để cột `sport` rơi vào default "Pickleball" của model
    if not (payload.name or "").strip():
        raise HTTPException(400, "Nhập tên CLB")
    if not (payload.sport or "").strip():
        raise HTTPException(400, "Nhập môn thể thao")
    club = models.Club(**{k: v for k, v in payload.dict().items() if v is not None})
    db.add(club); db.commit(); db.refresh(club)
    return club

@app.put("/api/admin/clubs/{cid}", response_model=schemas.ClubOut)
def admin_update_club(cid: int, payload: schemas.ClubUpdate, db: Session = Depends(get_db), su = Depends(require_superuser)):
    club = db.query(models.Club).filter(models.Club.id == cid).first()
    if not club: raise HTTPException(404, "Không tìm thấy CLB")
    for k, v in payload.dict(exclude_none=True).items():
        setattr(club, k, v)
    db.commit(); db.refresh(club)
    return club

@app.delete("/api/admin/clubs/{cid}")
def admin_delete_club(cid: int, db: Session = Depends(get_db), su = Depends(require_superuser)):
    """Xoá CLB và TOÀN BỘ dữ liệu liên quan. Không thể hoàn tác.

    Nhiều bảng (members, fee_types, transactions, tournaments, club_memberships,
    public_report_tokens) không khai báo ON DELETE ở tầng DB, nên với
    PRAGMA foreign_keys=ON phải xoá tường minh theo đúng thứ tự phụ thuộc, thay vì
    để SQLite chặn bằng IntegrityError hoặc (trước đây, khi FK tắt) âm thầm để lại
    dữ liệu mồ côi. players có ON DELETE CASCADE/SET NULL sẵn ở tầng DB nên tự xử lý."""
    club = db.query(models.Club).filter(models.Club.id == cid).first()
    if not club: raise HTTPException(404, "Không tìm thấy CLB")

    for t in db.query(models.Tournament).filter(models.Tournament.club_id == cid).all():
        db.delete(t)  # cascade participants + matches qua ORM relationship
    db.flush()

    db.query(models.Transaction).filter(models.Transaction.club_id == cid).delete(synchronize_session=False)
    db.query(models.ReminderLog).filter(models.ReminderLog.club_id == cid).delete(synchronize_session=False)
    db.query(models.PublicReportToken).filter(models.PublicReportToken.club_id == cid).delete(synchronize_session=False)

    member_ids = [m.id for m in db.query(models.Member.id).filter(models.Member.club_id == cid).all()]
    if member_ids:
        db.query(models.User).filter(models.User.member_id.in_(member_ids)).update(
            {"member_id": None}, synchronize_session=False)
    db.query(models.Member).filter(models.Member.club_id == cid).delete(synchronize_session=False)
    db.query(models.FeeType).filter(models.FeeType.club_id == cid).delete(synchronize_session=False)
    db.query(models.ClubMembership).filter(models.ClubMembership.club_id == cid).delete(synchronize_session=False)

    db.delete(club)  # players.club_id (ON DELETE CASCADE) tự dọn ở đây
    db.commit()
    return {"ok": True}

@app.get("/api/admin/memberships", response_model=List[schemas.MembershipOut])
def admin_list_memberships(club_id: Optional[int] = None, db: Session = Depends(get_db), su = Depends(require_superuser)):
    q = db.query(models.ClubMembership)
    if club_id: q = q.filter(models.ClubMembership.club_id == club_id)
    return q.all()

@app.post("/api/admin/memberships", response_model=schemas.MembershipOut)
def admin_create_membership(payload: schemas.MembershipCreate, db: Session = Depends(get_db), su = Depends(require_superuser)):
    existing = db.query(models.ClubMembership).filter(
        models.ClubMembership.user_id == payload.user_id,
        models.ClubMembership.club_id == payload.club_id
    ).first()
    if existing: raise HTTPException(400, "Tài khoản đã được gán cho CLB này")
    role = models.UserRole(payload.role) if payload.role in models.UserRole.__members__ else models.UserRole.member
    m = models.ClubMembership(
        user_id=payload.user_id, club_id=payload.club_id, role=role,
        can_view=payload.can_view, can_create=payload.can_create,
        can_edit=payload.can_edit, can_delete=payload.can_delete,
    )
    db.add(m); db.commit(); db.refresh(m)
    return m

@app.put("/api/admin/memberships/{mid}", response_model=schemas.MembershipOut)
def admin_update_membership(mid: int, payload: schemas.MembershipUpdate, db: Session = Depends(get_db), su = Depends(require_superuser)):
    m = db.query(models.ClubMembership).filter(models.ClubMembership.id == mid).first()
    if not m: raise HTTPException(404, "Không tìm thấy phân quyền")
    if payload.role and payload.role in models.UserRole.__members__:
        m.role = models.UserRole(payload.role)
    for field in ["can_view", "can_create", "can_edit", "can_delete"]:
        val = getattr(payload, field)
        if val is not None: setattr(m, field, val)
    db.commit(); db.refresh(m)
    return m

@app.delete("/api/admin/memberships/{mid}")
def admin_delete_membership(mid: int, db: Session = Depends(get_db), su = Depends(require_superuser)):
    m = db.query(models.ClubMembership).filter(models.ClubMembership.id == mid).first()
    if not m: raise HTTPException(404, "Không tìm thấy phân quyền")
    db.delete(m); db.commit()
    return {"ok": True}


@app.get("/api/my-memberships", response_model=List[schemas.MembershipOut])
def my_memberships(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Tất cả các CLB mà user hiện tại có quyền truy cập."""
    if current_user.is_superuser:
        raise HTTPException(403, "Tài khoản quản trị viên không dùng chế độ thành viên")
    return db.query(models.ClubMembership).filter(
        models.ClubMembership.user_id == current_user.id,
    ).all()


# ── Club admin: cấp quyền dùng bot Telegram cho từng tài khoản trong CLB ──
# Tài khoản/membership vẫn do superuser tạo (AdminPortal); club admin chỉ bật/tắt
# quyền dùng bot — không đổi role, không xoá membership.
def _club_account_out(m: models.ClubMembership, self_membership_id: int) -> dict:
    return {
        "id": m.id,
        "user_id": m.user_id,
        "username": m.user.username if m.user else "",
        "full_name": m.user.full_name if m.user else None,
        "role": m.role.value if hasattr(m.role, "value") else str(m.role),
        "bot_enabled": bool(m.bot_enabled),
        "telegram_linked": m.telegram_chat_id is not None,
        "is_self": m.id == self_membership_id,
    }


@app.get("/api/club/memberships", response_model=List[schemas.ClubMemberAccountOut])
def list_club_memberships(
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_view()
    rows = (
        db.query(models.ClubMembership)
        .filter(models.ClubMembership.club_id == perms.club_id)
        .join(models.User, models.User.id == models.ClubMembership.user_id)
        .order_by(models.User.username)
        .all()
    )
    return [_club_account_out(m, perms.membership.id) for m in rows]


@app.patch("/api/club/memberships/{mid}/bot-enabled", response_model=schemas.ClubMemberAccountOut)
def set_club_membership_bot_enabled(
    mid: int,
    data: schemas.BotEnabledUpdate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_edit()
    m = db.query(models.ClubMembership).filter(
        models.ClubMembership.id == mid,
        models.ClubMembership.club_id == perms.club_id,
    ).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy tài khoản trong CLB này")
    if m.id == perms.membership.id and not data.enabled:
        raise HTTPException(400, "Không thể tự tắt quyền dùng bot của chính mình")
    m.bot_enabled = data.enabled
    db.commit()
    db.refresh(m)
    return _club_account_out(m, perms.membership.id)


def auto_member_code(db: Session, club_id: int) -> str:
    existing = db.query(models.Member.member_code).filter(models.Member.club_id == club_id).all()
    used = set()
    for (code,) in existing:
        if code and code.startswith("TV") and code[2:].isdigit():
            used.add(int(code[2:]))
    n = 1
    while n in used:
        n += 1
    return f"TV{str(n).zfill(4)}"


def _member_list_order():
    """Thứ tự hiển thị danh sách thành viên (dùng chung cho API list + xuất Excel):
    Hoạt động → Tạm nghỉ → Đình chỉ, trong cùng trạng thái theo mã TV tăng dần
    (mã tự sinh dạng TV#### zero-padded nên so sánh chuỗi vẫn đúng thứ tự số)."""
    status_rank = case(
        (models.Member.status == models.MemberStatus.active, 0),
        (models.Member.status == models.MemberStatus.inactive, 1),
        else_=2,
    )
    return [status_rank, models.Member.member_code.asc().nulls_last(), models.Member.id.asc()]


# ── MEMBERS ──────────────────────────────────────────────
@app.get("/api/members", response_model=List[schemas.MemberOut])
def list_members(
    search: Optional[str] = None,
    status: Optional[schemas.MemberStatus] = None,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_view()
    q = db.query(models.Member).filter(models.Member.club_id == perms.club_id)
    if search:
        q = q.filter(
            models.Member.full_name.ilike(f"%{search}%") |
            models.Member.member_code.ilike(f"%{search}%") |
            models.Member.phone.ilike(f"%{search}%")
        )
    if status:
        q = q.filter(models.Member.status == status)
    return q.order_by(*_member_list_order()).all()


@app.post("/api/members", response_model=schemas.MemberOut, status_code=201)
def create_member(
    data: schemas.MemberCreate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_create()
    if data.member_code:
        existing = db.query(models.Member).filter(
            models.Member.member_code == data.member_code,
            models.Member.club_id == perms.club_id,
        ).first()
        if existing:
            raise HTTPException(400, "Mã thành viên đã tồn tại trong CLB này")
    member_code = data.member_code or auto_member_code(db, perms.club_id)
    member = models.Member(**data.model_dump(exclude={"member_code"}), member_code=member_code, club_id=perms.club_id)
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


# ── EXCEL TEMPLATE / EXPORT / IMPORT ─────────────────────
# Phải đặt TRƯỚC {member_id} để tránh FastAPI match "template"/"export" như integer
@app.get("/api/members/template")
def download_member_template(perms: ClubPermissions = Depends(get_club_permission)):
    """Tạo và trả về file Excel mẫu để nhập thành viên."""
    perms.require_view()
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Danh sách thành viên"

    headers = ["Mã thành viên", "Họ và tên (*)", "Ngày sinh", "Số điện thoại",
               "Email", "Ngày vào CLB", "Trạng thái", "Hạng", "Địa chỉ", "Ghi chú"]
    col_widths = [15, 25, 14, 16, 28, 14, 12, 15, 30, 30]
    notes_row = ["VD: HN001", "Nguyễn Văn A", "1990-05-20", "0912345678",
                 "vana@email.com", "2024-01-01", "active", "Chuyên nghiệp",
                 "Hà Nội", "Ghi chú tùy chọn"]

    header_fill = PatternFill("solid", fgColor="1677FF")
    note_fill   = PatternFill("solid", fgColor="E6F0FF")
    header_font = Font(bold=True, color="FFFFFF", name="Arial", size=11)
    note_font   = Font(color="595959", name="Arial", size=10, italic=True)
    thin = Side(style="thin", color="CCCCCC")
    cell_border = Border(left=thin, right=thin, top=thin, bottom=thin)

    for col, (h, w) in enumerate(zip(headers, col_widths), start=1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = cell_border
        ws.column_dimensions[cell.column_letter].width = w

    for col, val in enumerate(notes_row, start=1):
        cell = ws.cell(row=2, column=col, value=val)
        cell.fill = note_fill
        cell.font = note_font
        cell.alignment = Alignment(vertical="center")
        cell.border = cell_border

    ws.row_dimensions[1].height = 30
    ws.row_dimensions[2].height = 22

    ws2 = wb.create_sheet("Hướng dẫn")
    guide = [
        ("HƯỚNG DẪN NHẬP THÀNH VIÊN TỪ EXCEL", None),
        ("", None),
        ("Cột bắt buộc:", None),
        ("  - Họ và tên (*)", "Không được để trống"),
        ("", None),
        ("Cột tùy chọn:", None),
        ("  - Mã thành viên", "Nếu để trống, hệ thống tự tạo"),
        ("  - Ngày sinh / Ngày vào CLB", "Định dạng: YYYY-MM-DD hoặc DD/MM/YYYY"),
        ("  - Trạng thái", "Nhập: active (hoạt động) hoặc inactive (nghỉ). Mặc định: active"),
        ("  - Hạng", "Mới bắt đầu / Nghiệp dư / Bán chuyên / Chuyên nghiệp"),
        ("", None),
        ("Lưu ý:", None),
        ("  - Dòng 1 là tiêu đề, dòng 2 là ví dụ — xóa dòng 2 trước khi nhập thật", None),
        ("  - Nếu Mã thành viên trùng trong CLB, hàng đó sẽ bị bỏ qua", None),
        ("  - Có thể nhập nhiều dòng cùng lúc (tối đa 500 thành viên/lần)", None),
    ]
    ws2.column_dimensions["A"].width = 40
    ws2.column_dimensions["B"].width = 50
    for r, (a, b) in enumerate(guide, start=1):
        ca = ws2.cell(row=r, column=1, value=a)
        if r == 1:
            ca.font = Font(bold=True, size=13, color="1677FF")
        elif a.endswith(":"):
            ca.font = Font(bold=True, size=11)
        if b:
            ws2.cell(row=r, column=2, value=b)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=mau_nhap_thanh_vien.xlsx"},
    )


@app.get("/api/members/export")
def export_members_excel(
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Xuất danh sách thành viên ra file Excel."""
    perms.require_view()
    members = db.query(models.Member).filter(
        models.Member.club_id == perms.club_id
    ).order_by(*_member_list_order()).all()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Danh sách thành viên"

    headers = ["Mã thành viên", "Họ và tên", "Ngày sinh", "Số điện thoại",
               "Email", "Ngày vào CLB", "Trạng thái", "Hạng", "Địa chỉ", "Ghi chú"]
    col_widths = [15, 25, 14, 16, 28, 14, 12, 15, 30, 30]

    header_fill = PatternFill("solid", fgColor="1677FF")
    header_font = Font(bold=True, color="FFFFFF", name="Arial", size=11)
    thin = Side(style="thin", color="CCCCCC")
    cell_border = Border(left=thin, right=thin, top=thin, bottom=thin)
    status_map = {"active": "Hoạt động", "inactive": "Tạm nghỉ", "suspended": "Đình chỉ"}

    for col, (h, w) in enumerate(zip(headers, col_widths), start=1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = cell_border
        ws.column_dimensions[cell.column_letter].width = w
    ws.row_dimensions[1].height = 28

    even_fill = PatternFill("solid", fgColor="F5F9FF")
    normal_font = Font(name="Arial", size=10)

    for row_idx, m in enumerate(members, start=2):
        fill = even_fill if row_idx % 2 == 0 else None
        row_data = [
            m.member_code or "",
            m.full_name,
            m.dob.strftime("%d/%m/%Y") if m.dob else "",
            m.phone or "",
            m.email or "",
            m.join_date.strftime("%d/%m/%Y") if m.join_date else "",
            status_map.get(m.status.value if hasattr(m.status, "value") else m.status, m.status),
            m.rank or "",
            m.address or "",
            m.notes or "",
        ]
        for col, val in enumerate(row_data, start=1):
            cell = ws.cell(row=row_idx, column=col, value=val)
            cell.font = normal_font
            cell.border = cell_border
            cell.alignment = Alignment(vertical="center")
            if fill:
                cell.fill = fill
        ws.row_dimensions[row_idx].height = 20

    ws.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    from datetime import date as _date
    filename = f"thanh-vien-{_date.today().strftime('%Y-%m-%d')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.post("/api/members/import")
def import_members_excel(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Import thành viên từ file Excel."""
    perms.require_create()

    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Chỉ chấp nhận file .xlsx hoặc .xls")

    content = file.file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception:
        raise HTTPException(400, "File Excel không hợp lệ hoặc bị lỗi")

    ws = wb.active
    rows = list(ws.iter_rows(min_row=2, values_only=True))

    def parse_date(val):
        if not val:
            return None
        if isinstance(val, (date, datetime)):
            return val.date() if isinstance(val, datetime) else val
        s = str(val).strip()
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
        return None

    def clean(val):
        return str(val).strip() if val is not None else None

    imported, skipped, errors = [], [], []

    for i, row in enumerate(rows, start=2):
        if not any(row):
            continue

        member_code = clean(row[0])
        full_name   = clean(row[1])
        dob         = parse_date(row[2])
        phone       = clean(row[3])
        email       = clean(row[4])
        join_date   = parse_date(row[5])
        status_raw  = clean(row[6]) or "active"
        rank        = clean(row[7])
        address     = clean(row[8])
        notes       = clean(row[9]) if len(row) > 9 else None

        if not full_name:
            errors.append({"row": i, "reason": "Thiếu Họ và tên"})
            continue

        try:
            status = models.MemberStatus(status_raw.lower())
        except ValueError:
            status = models.MemberStatus.active

        if member_code:
            exists = db.query(models.Member).filter(
                models.Member.member_code == member_code,
                models.Member.club_id == perms.club_id,
            ).first()
            if exists:
                skipped.append({"row": i, "name": full_name, "reason": f"Mã '{member_code}' đã tồn tại"})
                continue

        member = models.Member(
            club_id=perms.club_id,
            member_code=member_code,
            full_name=full_name,
            dob=dob,
            phone=phone,
            email=email,
            join_date=join_date,
            status=status,
            rank=rank,
            address=address,
            notes=notes,
        )
        db.add(member)
        imported.append({"row": i, "name": full_name})

    db.commit()

    return {
        "total_rows": len([r for r in rows if any(r)]),
        "imported": len(imported),
        "skipped": len(skipped),
        "errors": len(errors),
        "imported_list": imported,
        "skipped_list": skipped,
        "error_list": errors,
    }


@app.get("/api/members/{member_id}", response_model=schemas.MemberOut)
def get_member(
    member_id: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_view()
    m = db.query(models.Member).filter(
        models.Member.id == member_id,
        models.Member.club_id == perms.club_id,
    ).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy thành viên")
    return m


@app.put("/api/members/{member_id}", response_model=schemas.MemberOut)
def update_member(
    member_id: int,
    data: schemas.MemberUpdate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_edit()
    m = db.query(models.Member).filter(
        models.Member.id == member_id,
        models.Member.club_id == perms.club_id,
    ).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy thành viên")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(m, k, v)
    db.commit()
    db.refresh(m)
    return m


@app.delete("/api/members/{member_id}", status_code=204)
def delete_member(
    member_id: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_delete()
    m = db.query(models.Member).filter(
        models.Member.id == member_id,
        models.Member.club_id == perms.club_id,
    ).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy thành viên")
    tx_count = db.query(models.Transaction).filter(models.Transaction.member_id == member_id).count()
    if tx_count:
        raise HTTPException(400, f"Không thể xoá: thành viên có {tx_count} giao dịch. "
                                 "Hãy chuyển trạng thái sang 'Ngừng hoạt động' để giữ lịch sử thu chi.")
    in_tournament = db.query(models.TournamentParticipant).filter(
        (models.TournamentParticipant.member_id == member_id) |
        (models.TournamentParticipant.partner_member_id == member_id)
    ).first()
    if in_tournament:
        raise HTTPException(400, "Không thể xoá: thành viên đang có tên trong giải đấu")
    db.delete(m)
    db.commit()

# ── FEE TYPES ─────────────────────────────────────────────
@app.get("/api/fee-types/template")
def download_fee_type_template(perms: ClubPermissions = Depends(get_club_permission)):
    perms.require_view()
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Danh mục khoản"
    headers = ["Tên khoản (*)", "Loại (*)", "Số tiền mặc định", "Định kỳ", "Mô tả"]
    col_widths = [30, 12, 20, 10, 40]
    notes_row = ["Phí hội viên tháng", "income", "200000", "Có", "Phí đóng hàng tháng"]
    thin = Side(style="thin", color="CCCCCC")
    cb = Border(left=thin, right=thin, top=thin, bottom=thin)
    hf = PatternFill("solid", fgColor="1677FF")
    nf = PatternFill("solid", fgColor="E6F0FF")
    for col, (h, w) in enumerate(zip(headers, col_widths), start=1):
        c = ws.cell(row=1, column=col, value=h)
        c.font = Font(bold=True, color="FFFFFF", name="Arial", size=11)
        c.fill = hf; c.border = cb
        c.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[c.column_letter].width = w
    for col, val in enumerate(notes_row, start=1):
        c = ws.cell(row=2, column=col, value=val)
        c.fill = nf; c.border = cb
        c.font = Font(color="595959", name="Arial", size=10, italic=True)
    ws.row_dimensions[1].height = 28
    # Sheet hướng dẫn
    ws2 = wb.create_sheet("Hướng dẫn")
    ws2.column_dimensions["A"].width = 45
    ws2.column_dimensions["B"].width = 40
    guide = [
        ("HƯỚNG DẪN NHẬP DANH MỤC KHOẢN", None),
        ("", None),
        ("Cột bắt buộc:", None),
        ("  - Tên khoản (*)", "Không được để trống"),
        ("  - Loại (*)", "Nhập: income (thu) hoặc expense (chi)"),
        ("", None),
        ("Cột tùy chọn:", None),
        ("  - Số tiền mặc định", "Số nguyên, không dấu phẩy. VD: 200000"),
        ("  - Định kỳ", "Nhập: Có hoặc Không (mặc định: Không)"),
        ("  - Mô tả", "Ghi chú thêm về khoản"),
    ]
    for r, (a, b) in enumerate(guide, start=1):
        ca = ws2.cell(row=r, column=1, value=a)
        if r == 1: ca.font = Font(bold=True, size=13, color="1677FF")
        elif a.endswith(":"): ca.font = Font(bold=True, size=11)
        if b: ws2.cell(row=r, column=2, value=b)
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return StreamingResponse(buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=mau_danh_muc_khoan.xlsx"})


@app.get("/api/fee-types/export")
def export_fee_types_excel(db: Session = Depends(get_db), perms: ClubPermissions = Depends(get_club_permission)):
    perms.require_view()
    items = db.query(models.FeeType).filter(models.FeeType.club_id == perms.club_id).order_by(models.FeeType.id).all()
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Danh mục khoản"
    headers = ["Tên khoản", "Loại", "Số tiền mặc định", "Định kỳ", "Mô tả"]
    col_widths = [30, 12, 20, 10, 40]
    thin = Side(style="thin", color="CCCCCC")
    cb = Border(left=thin, right=thin, top=thin, bottom=thin)
    for col, (h, w) in enumerate(zip(headers, col_widths), start=1):
        c = ws.cell(row=1, column=col, value=h)
        c.font = Font(bold=True, color="FFFFFF", name="Arial", size=11)
        c.fill = PatternFill("solid", fgColor="1677FF"); c.border = cb
        c.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[c.column_letter].width = w
    ws.row_dimensions[1].height = 28
    ef = PatternFill("solid", fgColor="F5F9FF")
    for ri, item in enumerate(items, start=2):
        fill = ef if ri % 2 == 0 else None
        row_data = [item.name, "Thu" if item.type == models.FeeTypeCategory.income else "Chi",
                    float(item.default_amount or 0), "Có" if item.is_recurring else "Không", item.description or ""]
        for col, val in enumerate(row_data, start=1):
            c = ws.cell(row=ri, column=col, value=val)
            c.font = Font(name="Arial", size=10); c.border = cb
            c.alignment = Alignment(vertical="center")
            if fill: c.fill = fill
    ws.freeze_panes = "A2"
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    from datetime import date as _d
    return StreamingResponse(buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=danh-muc-khoan-{_d.today()}.xlsx"})


@app.post("/api/fee-types/import")
def import_fee_types_excel(file: UploadFile = File(...), db: Session = Depends(get_db),
                           perms: ClubPermissions = Depends(get_club_permission)):
    perms.require_create()
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Chỉ chấp nhận file .xlsx hoặc .xls")
    try:
        wb = openpyxl.load_workbook(io.BytesIO(file.file.read()), data_only=True)
    except Exception:
        raise HTTPException(400, "File Excel không hợp lệ")
    ws = wb.active
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    def clean(v): return str(v).strip() if v is not None else None
    imported, skipped, errors = [], [], []
    for i, row in enumerate(rows, start=2):
        if not any(row): continue
        name = clean(row[0]); type_raw = clean(row[1]); amount_raw = row[2]
        recurring_raw = clean(row[3]); desc = clean(row[4]) if len(row) > 4 else None
        if not name:
            errors.append({"row": i, "reason": "Thiếu tên khoản"}); continue
        type_raw_lower = (type_raw or "").lower()
        if type_raw_lower in ("income", "thu"): fee_type = models.FeeTypeCategory.income
        elif type_raw_lower in ("expense", "chi"): fee_type = models.FeeTypeCategory.expense
        else:
            errors.append({"row": i, "reason": f"Loại '{type_raw}' không hợp lệ (dùng income/expense hoặc Thu/Chi)"}); continue
        exists = db.query(models.FeeType).filter(
            models.FeeType.name == name, models.FeeType.club_id == perms.club_id).first()
        if exists:
            skipped.append({"row": i, "name": name, "reason": "Tên khoản đã tồn tại"}); continue
        try: amount = float(str(amount_raw).replace(",", "").replace(".", "")) if amount_raw else 0
        except: amount = 0
        is_recurring = str(recurring_raw or "").strip().lower() in ("có", "co", "yes", "true", "1")
        db.add(models.FeeType(club_id=perms.club_id, name=name, type=fee_type,
                               default_amount=amount, is_recurring=is_recurring, description=desc))
        imported.append({"row": i, "name": name})
    db.commit()
    return {"total_rows": len([r for r in rows if any(r)]), "imported": len(imported),
            "skipped": len(skipped), "errors": len(errors),
            "imported_list": imported, "skipped_list": skipped, "error_list": errors}


@app.get("/api/fee-types", response_model=List[schemas.FeeTypeOut])
def list_fee_types(
    type: Optional[schemas.FeeTypeCategory] = None,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_view()
    q = db.query(models.FeeType).filter(models.FeeType.club_id == perms.club_id)
    if type:
        q = q.filter(models.FeeType.type == type)
    return q.order_by(models.FeeType.id.desc()).all()


@app.post("/api/fee-types", response_model=schemas.FeeTypeOut, status_code=201)
def create_fee_type(
    data: schemas.FeeTypeCreate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_create()
    ft = models.FeeType(**data.model_dump(), club_id=perms.club_id)
    db.add(ft)
    db.commit()
    db.refresh(ft)
    return ft


@app.put("/api/fee-types/{ft_id}", response_model=schemas.FeeTypeOut)
def update_fee_type(
    ft_id: int,
    data: schemas.FeeTypeUpdate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_edit()
    ft = db.query(models.FeeType).filter(models.FeeType.id == ft_id, models.FeeType.club_id == perms.club_id).first()
    if not ft:
        raise HTTPException(404, "Không tìm thấy loại khoản")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(ft, k, v)
    db.commit()
    db.refresh(ft)
    return ft


@app.delete("/api/fee-types/{ft_id}", status_code=204)
def delete_fee_type(
    ft_id: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_delete()
    ft = db.query(models.FeeType).filter(models.FeeType.id == ft_id, models.FeeType.club_id == perms.club_id).first()
    if not ft:
        raise HTTPException(404, "Không tìm thấy loại khoản")
    tx_count = db.query(models.Transaction).filter(models.Transaction.fee_type_id == ft_id).count()
    if tx_count:
        raise HTTPException(400, f"Không thể xoá: có {tx_count} giao dịch đang dùng khoản này")
    db.query(models.ReminderLog).filter(models.ReminderLog.fee_type_id == ft_id).delete(synchronize_session=False)
    db.delete(ft)
    db.commit()


# ── TRANSACTIONS ──────────────────────────────────────────
@app.get("/api/transactions/template")
def download_transaction_template(db: Session = Depends(get_db), perms: ClubPermissions = Depends(get_club_permission)):
    perms.require_view()
    fee_types = db.query(models.FeeType).filter(models.FeeType.club_id == perms.club_id).all()
    members = db.query(models.Member).filter(models.Member.club_id == perms.club_id).all()
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Giao dịch"
    headers = ["Tên khoản (*)", "Mã thành viên", "Số tiền (*)", "Ngày giao dịch (*)", "Loại (*)", "Phương thức", "Mô tả"]
    col_widths = [30, 16, 15, 18, 12, 18, 40]
    notes_row = ["Phí hội viên tháng", "HN001", "200000",
                 date.today().strftime("%d/%m/%Y"), "income", "Tiền mặt", "Tháng 1/2025"]
    thin = Side(style="thin", color="CCCCCC")
    cb = Border(left=thin, right=thin, top=thin, bottom=thin)
    for col, (h, w) in enumerate(zip(headers, col_widths), start=1):
        c = ws.cell(row=1, column=col, value=h)
        c.font = Font(bold=True, color="FFFFFF", name="Arial", size=11)
        c.fill = PatternFill("solid", fgColor="1677FF"); c.border = cb
        c.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[c.column_letter].width = w
    for col, val in enumerate(notes_row, start=1):
        c = ws.cell(row=2, column=col, value=val)
        c.fill = PatternFill("solid", fgColor="E6F0FF"); c.border = cb
        c.font = Font(color="595959", name="Arial", size=10, italic=True)
    ws.row_dimensions[1].height = 28
    # Sheet danh mục khoản để tham khảo
    ws2 = wb.create_sheet("Danh mục khoản")
    ws2.cell(row=1, column=1, value="Tên khoản").font = Font(bold=True)
    ws2.cell(row=1, column=2, value="Loại").font = Font(bold=True)
    ws2.column_dimensions["A"].width = 35; ws2.column_dimensions["B"].width = 12
    for r, ft in enumerate(fee_types, start=2):
        ws2.cell(row=r, column=1, value=ft.name)
        ws2.cell(row=r, column=2, value="income" if ft.type == models.FeeTypeCategory.income else "expense")
    # Sheet danh sách thành viên
    ws3 = wb.create_sheet("Thành viên")
    ws3.cell(row=1, column=1, value="Mã TV").font = Font(bold=True)
    ws3.cell(row=1, column=2, value="Họ và tên").font = Font(bold=True)
    ws3.column_dimensions["A"].width = 15; ws3.column_dimensions["B"].width = 30
    for r, m in enumerate(members, start=2):
        ws3.cell(row=r, column=1, value=m.member_code or "")
        ws3.cell(row=r, column=2, value=m.full_name)
    # Sheet hướng dẫn
    ws4 = wb.create_sheet("Hướng dẫn")
    ws4.column_dimensions["A"].width = 45; ws4.column_dimensions["B"].width = 40
    guide = [
        ("HƯỚNG DẪN NHẬP GIAO DỊCH", None),
        ("", None),
        ("Cột bắt buộc:", None),
        ("  - Tên khoản (*)", "Phải khớp đúng tên trong sheet 'Danh mục khoản'"),
        ("  - Số tiền (*)", "Số dương, không dấu phẩy. VD: 200000"),
        ("  - Ngày giao dịch (*)", "Định dạng: DD/MM/YYYY hoặc YYYY-MM-DD"),
        ("  - Loại (*)", "income (thu) hoặc expense (chi)"),
        ("", None),
        ("Cột tùy chọn:", None),
        ("  - Mã thành viên", "Xem danh sách trong sheet 'Thành viên'"),
        ("  - Phương thức", "Tiền mặt / Chuyển khoản / Thẻ (mặc định: Tiền mặt)"),
        ("  - Mô tả", "Ghi chú thêm"),
    ]
    for r, (a, b) in enumerate(guide, start=1):
        ca = ws4.cell(row=r, column=1, value=a)
        if r == 1: ca.font = Font(bold=True, size=13, color="1677FF")
        elif a.endswith(":"): ca.font = Font(bold=True, size=11)
        if b: ws4.cell(row=r, column=2, value=b)
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return StreamingResponse(buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=mau_giao_dich.xlsx"})


@app.get("/api/transactions/export")
def export_transactions_excel(
    month: Optional[int] = None, year: Optional[int] = None,
    db: Session = Depends(get_db), perms: ClubPermissions = Depends(get_club_permission)
):
    perms.require_view()
    q = db.query(models.Transaction).filter(models.Transaction.club_id == perms.club_id)
    if month: q = q.filter(extract("month", models.Transaction.transaction_date) == month)
    if year:  q = q.filter(extract("year",  models.Transaction.transaction_date) == year)
    txs = q.order_by(models.Transaction.transaction_date.desc()).all()
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Giao dịch"
    headers = ["Ngày", "Tên khoản", "Loại", "Thành viên", "Số tiền", "Phương thức", "Mô tả"]
    col_widths = [14, 30, 10, 25, 15, 18, 40]
    thin = Side(style="thin", color="CCCCCC")
    cb = Border(left=thin, right=thin, top=thin, bottom=thin)
    for col, (h, w) in enumerate(zip(headers, col_widths), start=1):
        c = ws.cell(row=1, column=col, value=h)
        c.font = Font(bold=True, color="FFFFFF", name="Arial", size=11)
        c.fill = PatternFill("solid", fgColor="1677FF"); c.border = cb
        c.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[c.column_letter].width = w
    ws.row_dimensions[1].height = 28
    income_fill  = PatternFill("solid", fgColor="F6FFED")
    expense_fill = PatternFill("solid", fgColor="FFF1F0")
    for ri, tx in enumerate(txs, start=2):
        is_income = tx.type == models.FeeTypeCategory.income
        fill = income_fill if is_income else expense_fill
        member_name = tx.member.full_name if tx.member else ""
        row_data = [
            tx.transaction_date.strftime("%d/%m/%Y") if tx.transaction_date else "",
            tx.fee_type.name if tx.fee_type else "",
            "Thu" if is_income else "Chi",
            member_name,
            float(tx.amount or 0),
            tx.payment_method or "Tiền mặt",
            tx.description or "",
        ]
        for col, val in enumerate(row_data, start=1):
            c = ws.cell(row=ri, column=col, value=val)
            c.font = Font(name="Arial", size=10); c.border = cb
            c.alignment = Alignment(vertical="center"); c.fill = fill
            if col == 5:  # Số tiền — format số
                c.number_format = '#,##0'
    ws.freeze_panes = "A2"
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    from datetime import date as _d
    suffix = f"{year}-{month:02d}" if year and month else str(_d.today())
    return StreamingResponse(buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=giao-dich-{suffix}.xlsx"})


@app.post("/api/transactions/import")
def import_transactions_excel(file: UploadFile = File(...), db: Session = Depends(get_db),
                               perms: ClubPermissions = Depends(get_club_permission)):
    perms.require_create()
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Chỉ chấp nhận file .xlsx hoặc .xls")
    try:
        wb = openpyxl.load_workbook(io.BytesIO(file.file.read()), data_only=True)
    except Exception:
        raise HTTPException(400, "File Excel không hợp lệ")
    ws = wb.active
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    def clean(v): return str(v).strip() if v is not None else None
    def parse_date(val):
        if not val: return None
        if isinstance(val, (date, datetime)):
            return val.date() if isinstance(val, datetime) else val
        s = str(val).strip()
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
            try: return datetime.strptime(s, fmt).date()
            except: pass
        return None
    imported, skipped, errors = [], [], []
    for i, row in enumerate(rows, start=2):
        if not any(row): continue
        fee_name = clean(row[0]); member_code = clean(row[1])
        amount_raw = row[2]; tx_date_raw = row[3]
        type_raw = clean(row[4]); method = clean(row[5]) or "Tiền mặt"
        desc = clean(row[6]) if len(row) > 6 else None
        if not fee_name:
            errors.append({"row": i, "reason": "Thiếu tên khoản"}); continue
        if not amount_raw:
            errors.append({"row": i, "reason": "Thiếu số tiền"}); continue
        tx_date = parse_date(tx_date_raw)
        if not tx_date:
            errors.append({"row": i, "reason": "Ngày giao dịch không hợp lệ"}); continue
        type_lower = (type_raw or "").lower()
        if type_lower in ("income", "thu"): tx_type = models.FeeTypeCategory.income
        elif type_lower in ("expense", "chi"): tx_type = models.FeeTypeCategory.expense
        else:
            errors.append({"row": i, "reason": f"Loại '{type_raw}' không hợp lệ"}); continue
        fee_type = db.query(models.FeeType).filter(
            models.FeeType.name == fee_name, models.FeeType.club_id == perms.club_id).first()
        if not fee_type:
            errors.append({"row": i, "reason": f"Không tìm thấy khoản '{fee_name}'"}); continue
        member_id = None
        if member_code:
            m = db.query(models.Member).filter(
                models.Member.member_code == member_code,
                models.Member.club_id == perms.club_id).first()
            if not m:
                errors.append({"row": i, "reason": f"Không tìm thấy mã TV '{member_code}'"}); continue
            member_id = m.id
        try: amount = float(str(amount_raw).replace(",", ""))
        except: errors.append({"row": i, "reason": "Số tiền không hợp lệ"}); continue
        db.add(models.Transaction(club_id=perms.club_id, fee_type_id=fee_type.id,
            member_id=member_id, type=tx_type, amount=amount,
            transaction_date=tx_date, description=desc, payment_method=method))
        imported.append({"row": i, "name": f"{fee_name} - {amount:,.0f}đ"})
    db.commit()
    return {"total_rows": len([r for r in rows if any(r)]), "imported": len(imported),
            "skipped": len(skipped), "errors": len(errors),
            "imported_list": imported, "skipped_list": skipped, "error_list": errors}


@app.get("/api/transactions", response_model=List[schemas.TransactionOut])
def list_transactions(
    month: Optional[int] = None,
    year: Optional[int] = None,
    type: Optional[schemas.FeeTypeCategory] = None,
    member_id: Optional[int] = None,
    player_id: Optional[int] = None,
    fee_type_id: Optional[int] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    q = db.query(models.Transaction)
    if month:
        q = q.filter(extract("month", models.Transaction.transaction_date) == month)
    if year:
        q = q.filter(extract("year", models.Transaction.transaction_date) == year)
    if type:
        q = q.filter(models.Transaction.type == type)
    if member_id:
        q = q.filter(models.Transaction.member_id == member_id)
    if player_id:
        q = q.filter(models.Transaction.player_id == player_id)
    if fee_type_id:
        q = q.filter(models.Transaction.fee_type_id == fee_type_id)
    perms.require_view()
    q = q.filter(models.Transaction.club_id == perms.club_id)
    if search:
        q = q.join(models.Member, models.Transaction.member_id == models.Member.id, isouter=True)\
             .join(models.Player, models.Transaction.player_id == models.Player.id, isouter=True)\
             .join(models.FeeType, models.Transaction.fee_type_id == models.FeeType.id, isouter=True)\
             .filter(
                models.Transaction.description.ilike(f"%{search}%") |
                models.Member.full_name.ilike(f"%{search}%") |
                models.Player.name.ilike(f"%{search}%") |
                models.FeeType.name.ilike(f"%{search}%")
             )
    return q.order_by(models.Transaction.transaction_date.desc()).all()


@app.post("/api/transactions", response_model=schemas.TransactionOut, status_code=201)
def create_transaction(
    data: schemas.TransactionCreate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_create()
    ft = db.query(models.FeeType).filter(models.FeeType.id == data.fee_type_id, models.FeeType.club_id == perms.club_id).first()
    if not ft:
        raise HTTPException(404, "Loại khoản không tồn tại")
    _check_people_in_club(db, perms.club_id, data.member_id, data.player_id)
    tx = models.Transaction(**data.model_dump(), type=ft.type, club_id=perms.club_id)
    db.add(tx)
    db.commit()
    db.refresh(tx)
    db.refresh(tx)
    return db.query(models.Transaction).filter(models.Transaction.id == tx.id).first()


@app.put("/api/transactions/{tx_id}", response_model=schemas.TransactionOut)
def update_transaction(
    tx_id: int,
    data: schemas.TransactionCreate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_edit()
    tx = db.query(models.Transaction).filter(models.Transaction.id == tx_id, models.Transaction.club_id == perms.club_id).first()
    if not tx:
        raise HTTPException(404, "Không tìm thấy giao dịch")
    ft = db.query(models.FeeType).filter(models.FeeType.id == data.fee_type_id, models.FeeType.club_id == perms.club_id).first()
    if not ft:
        raise HTTPException(404, "Loại khoản không tồn tại")
    _check_people_in_club(db, perms.club_id, data.member_id, data.player_id)
    for k, v in data.model_dump().items():
        setattr(tx, k, v)
    tx.type = ft.type
    db.commit()
    return db.query(models.Transaction).filter(models.Transaction.id == tx_id).first()


@app.delete("/api/transactions/{tx_id}", status_code=204)
def delete_transaction(
    tx_id: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_delete()
    tx = db.query(models.Transaction).filter(models.Transaction.id == tx_id, models.Transaction.club_id == perms.club_id).first()
    if not tx:
        raise HTTPException(404, "Không tìm thấy giao dịch")
    db.delete(tx)
    db.commit()


# ── REPORTS ───────────────────────────────────────────────
@app.get("/api/reports/summary")
def report_summary(
    year: int = None,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_view()
    if not year:
        year = _now_vn().year
    results = []
    for month in range(1, 13):
        q = db.query(models.Transaction).filter(
            models.Transaction.club_id == perms.club_id,
            extract("year", models.Transaction.transaction_date) == year,
            extract("month", models.Transaction.transaction_date) == month
        )
        income = sum(float(t.amount) for t in q.filter(models.Transaction.type == "income").all())
        expense = sum(float(t.amount) for t in q.filter(models.Transaction.type == "expense").all())
        results.append({
            "month": month, "year": year,
            "total_income": income,
            "total_expense": expense,
            "balance": income - expense,
        })
    return results


@app.get("/api/reports/overview")
def report_overview(
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_view()
    total_members = db.query(func.count(models.Member.id)).filter(models.Member.club_id == perms.club_id).scalar()
    active_members = db.query(func.count(models.Member.id)).filter(models.Member.club_id == perms.club_id, models.Member.status == "active").scalar()
    all_tx = db.query(models.Transaction).filter(models.Transaction.club_id == perms.club_id).all()
    total_income = sum(float(t.amount) for t in all_tx if t.type == "income")
    total_expense = sum(float(t.amount) for t in all_tx if t.type == "expense")
    return {
        "total_members": total_members,
        "active_members": active_members,
        "total_income": total_income,
        "total_expense": total_expense,
        "balance": total_income - total_expense,
    }


@app.get("/api/reports/monthly-detail")
def report_monthly_detail(
    month: int,
    year: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Chi tiết thu chi trong một tháng: breakdown theo loại khoản + số dư đầu/cuối kỳ."""
    perms.require_view()

    # Dùng date (không phải datetime) để so sánh với cột Date trong SQLite.
    # SQLite lưu Date dưới dạng chuỗi "YYYY-MM-DD"; nếu so sánh với datetime
    # "YYYY-MM-DD 00:00:00" thì "2026-07-01" < "2026-07-01 00:00:00" = True,
    # khiến giao dịch ngày đầu tháng bị tính nhầm vào kỳ trước.
    from datetime import date as date_type
    start_of_month = date_type(year, month, 1)
    if month == 12:
        end_of_month = date_type(year + 1, 1, 1)
    else:
        end_of_month = date_type(year, month + 1, 1)

    # Tồn quỹ đầu kỳ: tổng đại số toàn bộ giao dịch TRƯỚC tháng này
    # Thu (income) cộng dương, Chi (expense) cộng âm để ra số dư tích lũy
    opening_income = db.query(func.sum(models.Transaction.amount)).filter(
        models.Transaction.club_id == perms.club_id,
        models.Transaction.transaction_date < start_of_month,
        models.Transaction.type == "income",
    ).scalar() or 0

    opening_expense = db.query(func.sum(models.Transaction.amount)).filter(
        models.Transaction.club_id == perms.club_id,
        models.Transaction.transaction_date < start_of_month,
        models.Transaction.type == "expense",
    ).scalar() or 0

    # Tồn quỹ đầu kỳ = tổng thu trước kỳ - tổng chi trước kỳ
    opening_balance = float(opening_income) - float(opening_expense)

    # Giao dịch trong tháng
    txs = db.query(models.Transaction).filter(
        models.Transaction.club_id == perms.club_id,
        models.Transaction.transaction_date >= start_of_month,
        models.Transaction.transaction_date < end_of_month,
    ).all()

    income_by_fee: dict = {}
    expense_by_fee: dict = {}
    for t in txs:
        name = t.fee_type.name if t.fee_type else "Khác"
        bucket = income_by_fee if t.type == "income" else expense_by_fee
        if name not in bucket:
            bucket[name] = {"fee_type": name, "count": 0, "amount": 0}
        bucket[name]["count"] += 1
        bucket[name]["amount"] += float(t.amount)

    total_income = sum(v["amount"] for v in income_by_fee.values())
    total_expense = sum(v["amount"] for v in expense_by_fee.values())

    # Tồn quỹ cuối kỳ = Đầu kỳ + Thu trong kỳ - Chi trong kỳ
    closing_balance = opening_balance + total_income - total_expense

    return {
        "month": month, "year": year,
        "opening_balance": opening_balance,   # Tồn quỹ đầu kỳ (chuyển từ tháng trước)
        "total_income": total_income,
        "total_expense": total_expense,
        "closing_balance": closing_balance,   # Tồn quỹ cuối kỳ (chuyển sang tháng sau)
        "balance": total_income - total_expense,  # Số dư trong kỳ (giữ để backward-compat)
        "transaction_count": len(txs),
        "income_breakdown": sorted(income_by_fee.values(), key=lambda x: -x["amount"]),
        "expense_breakdown": sorted(expense_by_fee.values(), key=lambda x: -x["amount"]),
    }


def _query_member_contributions(
    db: Session,
    club_id: int,
    fee_type_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
):
    """Logic dùng chung cho báo cáo đóng góp theo thành viên (admin + public)."""
    q = db.query(
        models.Member.id,
        models.Member.member_code,
        models.Member.full_name,
        models.FeeType.name.label("fee_type_name"),
        func.count(models.Transaction.id).label("transaction_count"),
        func.sum(models.Transaction.amount).label("total_amount"),
    ).join(models.Transaction, models.Transaction.member_id == models.Member.id)\
     .join(models.FeeType, models.FeeType.id == models.Transaction.fee_type_id)\
     .filter(models.Transaction.type == "income", models.Transaction.club_id == club_id)

    if fee_type_id:
        q = q.filter(models.Transaction.fee_type_id == fee_type_id)
    if year:
        q = q.filter(extract("year", models.Transaction.transaction_date) == year)
    if month:
        q = q.filter(extract("month", models.Transaction.transaction_date) == month)

    q = q.group_by(models.Member.id, models.FeeType.id).order_by(models.Member.full_name)
    result = [
        {
            "member_id": r.id,
            "player_id": None,
            "member_code": r.member_code,
            "full_name": r.full_name,
            "fee_type_name": r.fee_type_name,
            "transaction_count": r.transaction_count,
            "total_amount": float(r.total_amount or 0),
            "is_guest": False,
        }
        for r in q.all()
    ]

    # Khách mời (Player.member_id IS NULL) đóng góp cho cùng khoản thu
    gq = db.query(
        models.Player.id,
        models.Player.name,
        models.FeeType.name.label("fee_type_name"),
        func.count(models.Transaction.id).label("transaction_count"),
        func.sum(models.Transaction.amount).label("total_amount"),
    ).join(models.Transaction, models.Transaction.player_id == models.Player.id)\
     .join(models.FeeType, models.FeeType.id == models.Transaction.fee_type_id)\
     .filter(models.Transaction.type == "income", models.Transaction.club_id == club_id)

    if fee_type_id:
        gq = gq.filter(models.Transaction.fee_type_id == fee_type_id)
    if year:
        gq = gq.filter(extract("year", models.Transaction.transaction_date) == year)
    if month:
        gq = gq.filter(extract("month", models.Transaction.transaction_date) == month)

    gq = gq.group_by(models.Player.id, models.FeeType.id).order_by(models.Player.name)
    result += [
        {
            "member_id": None,
            "player_id": r.id,
            "member_code": None,
            "full_name": r.name,
            "fee_type_name": r.fee_type_name,
            "transaction_count": r.transaction_count,
            "total_amount": float(r.total_amount or 0),
            "is_guest": True,
        }
        for r in gq.all()
    ]
    return sorted(result, key=lambda r: r["full_name"])


def _query_fee_status(db: Session, club_id: int, month: Optional[int], year: int, fee_type_id: int, include_phone: bool = True):
    """Logic dùng chung: thành viên active đã/chưa đóng một khoản phí trong tháng hoặc cả năm (admin + public)."""
    members = db.query(models.Member).filter(
        models.Member.club_id == club_id,
        models.Member.status == "active",
    ).order_by(models.Member.full_name).all()
    paid_q = db.query(models.Transaction.member_id).filter(
        models.Transaction.club_id == club_id,
        models.Transaction.fee_type_id == fee_type_id,
        extract("year", models.Transaction.transaction_date) == year,
        models.Transaction.member_id.isnot(None),
    )
    if month:
        paid_q = paid_q.filter(extract("month", models.Transaction.transaction_date) == month)
    paid_ids = set(r[0] for r in paid_q.all())
    result = []
    for m in members:
        row = {
            "member_id": m.id,
            "member_code": m.member_code,
            "full_name": m.full_name,
            "rank": m.rank,
            "paid": m.id in paid_ids,
        }
        if include_phone:
            row["phone"] = m.phone
        result.append(row)
    paid_count = sum(1 for r in result if r["paid"])

    # Khách mời đã đóng khoản này trong tháng/năm (không có nghĩa vụ "chưa đóng")
    guest_q = db.query(
        models.Player.id,
        models.Player.name,
        func.count(models.Transaction.id).label("transaction_count"),
        func.sum(models.Transaction.amount).label("total_amount"),
    ).join(models.Transaction, models.Transaction.player_id == models.Player.id)\
     .filter(
        models.Transaction.club_id == club_id,
        models.Transaction.fee_type_id == fee_type_id,
        extract("year", models.Transaction.transaction_date) == year,
     )
    if month:
        guest_q = guest_q.filter(extract("month", models.Transaction.transaction_date) == month)
    guest_rows = guest_q.group_by(models.Player.id).order_by(models.Player.name).all()
    guests = [
        {
            "player_id": r.id,
            "full_name": r.name,
            "transaction_count": r.transaction_count,
            "total_amount": float(r.total_amount or 0),
        }
        for r in guest_rows
    ]

    return {
        "month": month,
        "year": year,
        "total": len(result),
        "paid": paid_count,
        "unpaid": len(result) - paid_count,
        "members": result,
        "guests": guests,
        "guest_paid_count": len(guests),
    }


@app.get("/api/reports/member-contributions")
def member_contributions(
    fee_type_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_view()
    return _query_member_contributions(db, perms.club_id, fee_type_id, year, month)


@app.get("/api/reports/fee-status")
def fee_status(
    year: int,
    fee_type_id: int,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Danh sách thành viên active đã/chưa đóng một khoản phí trong tháng (hoặc cả năm nếu không truyền month)."""
    perms.require_view()
    return _query_fee_status(db, perms.club_id, month, year, fee_type_id)


# ── PUBLIC REPORT LINKS ──────────────────────────────────

def _make_slug(club_name: str, token: str) -> str:
    """Tạo slug dạng: ten-clb-viet-lien-khong-dau-XXXXXXXX"""
    import unicodedata, re
    text = unicodedata.normalize("NFD", club_name)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    text = text[:40]  # giới hạn độ dài phần tên
    return f"{text}-{token[:8]}"


# ── PUBLIC REPORT LINKS (CRUD — yêu cầu auth) ────────────

@app.post("/api/report-links")
def create_report_link(
    data: dict,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
    current_user: models.User = Depends(get_current_user),
):
    # Link công khai phát tán toàn bộ thu chi + tên thành viên → cần quyền chỉnh sửa
    perms.require_edit()
    token_str = secrets.token_urlsafe(32)
    expires_at_val = None
    if data.get("expires_at"):
        try:
            expires_at_val = datetime.fromisoformat(data["expires_at"])
        except Exception:
            expires_at_val = None
    club = db.query(models.Club).filter(models.Club.id == perms.club_id).first()
    slug = _make_slug(club.name if club else "clb", token_str)
    rec = models.PublicReportToken(
        token=token_str,
        slug=slug,
        club_id=perms.club_id,
        label=data.get("label", "Báo cáo công khai"),
        expires_at=expires_at_val,
        created_by=current_user.username,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return {
        "id": rec.id,
        "token": rec.token,
        "slug": rec.slug,
        "label": rec.label,
        "expires_at": rec.expires_at.isoformat() if rec.expires_at else None,
        "is_active": rec.is_active,
        "view_count": rec.view_count,
        "created_at": rec.created_at.isoformat() if rec.created_at else None,
    }


@app.get("/api/report-links")
def list_report_links(
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_view()
    recs = db.query(models.PublicReportToken).filter(
        models.PublicReportToken.club_id == perms.club_id
    ).order_by(models.PublicReportToken.created_at.desc()).all()
    return [
        {
            "id": r.id,
            "token": r.token,
            "slug": r.slug,
            "label": r.label,
            "expires_at": r.expires_at.isoformat() if r.expires_at else None,
            "is_active": r.is_active,
            "view_count": r.view_count,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in recs
    ]


@app.patch("/api/report-links/{link_id}/toggle")
def toggle_report_link(
    link_id: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_edit()
    rec = db.query(models.PublicReportToken).filter(
        models.PublicReportToken.id == link_id,
        models.PublicReportToken.club_id == perms.club_id,
    ).first()
    if not rec:
        raise HTTPException(404, "Link không tồn tại")
    rec.is_active = not rec.is_active
    db.commit()
    return {"id": rec.id, "is_active": rec.is_active}


@app.delete("/api/report-links/{link_id}")
def delete_report_link(
    link_id: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_delete()
    rec = db.query(models.PublicReportToken).filter(
        models.PublicReportToken.id == link_id,
        models.PublicReportToken.club_id == perms.club_id,
    ).first()
    if not rec:
        raise HTTPException(404, "Link không tồn tại")
    db.delete(rec)
    db.commit()
    return {"ok": True}


# ── PUBLIC REPORT ENDPOINTS (không cần auth) ─────────────

def _validate_token(slug_or_token: str, db: Session, increment_view: bool = False):
    """Tìm token theo slug (mới) hoặc token đầy đủ (cũ — backward compat)."""
    rec = db.query(models.PublicReportToken).filter(
        models.PublicReportToken.is_active == True,
    ).filter(
        (models.PublicReportToken.slug == slug_or_token) |
        (models.PublicReportToken.token == slug_or_token)
    ).first()
    if not rec:
        raise HTTPException(404, "Link không tồn tại hoặc đã bị vô hiệu hóa")
    if rec.expires_at and rec.expires_at < _now_vn():
        raise HTTPException(410, "Link đã hết hạn")
    if increment_view:
        rec.view_count += 1
        db.commit()
    return rec


@app.get("/api/public/report/{slug}")
@limiter.limit("30/minute")
def public_report_meta(request: Request, slug: str, db: Session = Depends(get_db)):
    rec = _validate_token(slug, db, increment_view=True)
    club = db.query(models.Club).filter(models.Club.id == rec.club_id).first()
    return {
        "label": rec.label,
        "club_name": club.name if club else "",
        "club_sport": club.sport if club else "",
        "expires_at": rec.expires_at.isoformat() if rec.expires_at else None,
        "view_count": rec.view_count,
    }


@app.get("/api/public/report/{slug}/summary")
@limiter.limit("60/minute")
def public_report_summary(request: Request, slug: str, year: int = None, db: Session = Depends(get_db)):
    rec = _validate_token(slug, db)
    if not year:
        year = _now_vn().year
    results = []
    for month in range(1, 13):
        q = db.query(models.Transaction).filter(
            models.Transaction.club_id == rec.club_id,
            extract("year", models.Transaction.transaction_date) == year,
            extract("month", models.Transaction.transaction_date) == month
        )
        income = sum(float(t.amount) for t in q.filter(models.Transaction.type == "income").all())
        expense = sum(float(t.amount) for t in q.filter(models.Transaction.type == "expense").all())
        results.append({
            "month": month, "year": year,
            "total_income": income, "total_expense": expense, "balance": income - expense,
        })
    return results


@app.get("/api/public/report/{slug}/monthly-detail")
@limiter.limit("60/minute")
def public_report_monthly_detail(request: Request, slug: str, month: int, year: int, db: Session = Depends(get_db)):
    rec = _validate_token(slug, db)
    from datetime import date as date_type
    start_of_month = date_type(year, month, 1)
    end_of_month = date_type(year + 1, 1, 1) if month == 12 else date_type(year, month + 1, 1)
    opening_income = db.query(func.sum(models.Transaction.amount)).filter(
        models.Transaction.club_id == rec.club_id,
        models.Transaction.transaction_date < start_of_month,
        models.Transaction.type == "income",
    ).scalar() or 0
    opening_expense = db.query(func.sum(models.Transaction.amount)).filter(
        models.Transaction.club_id == rec.club_id,
        models.Transaction.transaction_date < start_of_month,
        models.Transaction.type == "expense",
    ).scalar() or 0
    opening_balance = float(opening_income) - float(opening_expense)
    txs = db.query(models.Transaction).filter(
        models.Transaction.club_id == rec.club_id,
        models.Transaction.transaction_date >= start_of_month,
        models.Transaction.transaction_date < end_of_month,
    ).all()
    income_by_fee: dict = {}
    expense_by_fee: dict = {}
    for t in txs:
        name = t.fee_type.name if t.fee_type else "Khác"
        bucket = income_by_fee if t.type == "income" else expense_by_fee
        if name not in bucket:
            bucket[name] = {"fee_type": name, "count": 0, "amount": 0}
        bucket[name]["count"] += 1
        bucket[name]["amount"] += float(t.amount)
    total_income = sum(v["amount"] for v in income_by_fee.values())
    total_expense = sum(v["amount"] for v in expense_by_fee.values())
    closing_balance = opening_balance + total_income - total_expense
    return {
        "month": month, "year": year,
        "opening_balance": opening_balance,
        "total_income": total_income, "total_expense": total_expense,
        "closing_balance": closing_balance,
        "balance": total_income - total_expense,
        "transaction_count": len(txs),
        "income_breakdown": sorted(income_by_fee.values(), key=lambda x: -x["amount"]),
        "expense_breakdown": sorted(expense_by_fee.values(), key=lambda x: -x["amount"]),
    }


@app.get("/api/public/report/{slug}/member-contributions")
@limiter.limit("60/minute")
def public_report_member_contributions(
    request: Request, slug: str,
    fee_type_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
):
    rec = _validate_token(slug, db)
    return _query_member_contributions(db, rec.club_id, fee_type_id, year, month)


@app.get("/api/public/report/{slug}/fee-status")
@limiter.limit("60/minute")
def public_report_fee_status(
    request: Request, slug: str, year: int, fee_type_id: int, month: Optional[int] = None,
    db: Session = Depends(get_db),
):
    rec = _validate_token(slug, db)
    # Public: không trả số điện thoại thành viên
    return _query_fee_status(db, rec.club_id, month, year, fee_type_id, include_phone=False)


@app.get("/api/public/report/{slug}/fee-types")
@limiter.limit("60/minute")
def public_report_fee_types(
    request: Request, slug: str,
    type: Optional[str] = None,
    db: Session = Depends(get_db),
):
    rec = _validate_token(slug, db)
    q = db.query(models.FeeType).filter(models.FeeType.club_id == rec.club_id)
    if type:
        q = q.filter(models.FeeType.type == type)
    fts = q.order_by(models.FeeType.name).all()
    return [{"id": f.id, "name": f.name, "type": f.type} for f in fts]


@app.get("/api/public/report/{slug}/transactions")
@limiter.limit("60/minute")
def public_report_transactions(
    request: Request, slug: str,
    month: Optional[int] = None,
    year: Optional[int] = None,
    db: Session = Depends(get_db),
):
    rec = _validate_token(slug, db)
    q = db.query(models.Transaction).filter(models.Transaction.club_id == rec.club_id)
    if month:
        q = q.filter(extract("month", models.Transaction.transaction_date) == month)
    if year:
        q = q.filter(extract("year", models.Transaction.transaction_date) == year)
    txs = q.order_by(models.Transaction.transaction_date.desc()).all()
    return [
        {
            "id": t.id,
            "type": t.type,
            "amount": float(t.amount),
            "transaction_date": t.transaction_date.isoformat() if t.transaction_date else None,
            "description": t.description,
            "payment_method": t.payment_method,
            "fee_type": {"id": t.fee_type.id, "name": t.fee_type.name} if t.fee_type else None,
            "member": {"id": t.member.id, "full_name": t.member.full_name} if t.member else None,
        }
        for t in txs
    ]


@app.get("/api/public/report/{slug}/tournaments")
@limiter.limit("60/minute")
def public_tournaments_list(request: Request, slug: str, db: Session = Depends(get_db)):
    rec = _validate_token(slug, db)
    # Lọc bằng Python vì quy tắc hiển thị phụ thuộc phiên ghép đội (property), không chỉ status
    # selectinload participants: unpaired_count duyệt t.participants cho từng giải → tránh N+1 trên endpoint public
    ts = [t for t in db.query(models.Tournament).filter(
        models.Tournament.club_id == rec.club_id,
    ).options(selectinload(models.Tournament.participants)).order_by(models.Tournament.id.desc()).all()
        if _is_public_visible(t)]
    return [
        {
            "id": t.id, "name": t.name, "format": t.format,
            "status": t.status, "team_type": t.team_type,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "partner_draw_status": t.partner_draw.status if t.partner_draw else None,
            "unpaired_count": t.unpaired_count,
        }
        for t in ts
    ]


@app.get("/api/public/report/{slug}/tournaments/{tid}", response_model=schemas.PublicTournamentOut)
@limiter.limit("60/minute")
def public_tournament_detail(request: Request, slug: str, tid: int, db: Session = Depends(get_db)):
    rec = _validate_token(slug, db)
    t = db.query(models.Tournament).filter(
        models.Tournament.id == tid,
        models.Tournament.club_id == rec.club_id,
    ).first()
    if not t or not _is_public_visible(t):
        raise HTTPException(404, "Không tìm thấy giải đấu")
    return t


@app.get("/api/public/report/{slug}/tournaments/{tid}/standings")
@limiter.limit("60/minute")
def public_tournament_standings(
    request: Request, slug: str, tid: int,
    group: Optional[str] = None,
    db: Session = Depends(get_db),
):
    rec = _validate_token(slug, db)
    t = db.query(models.Tournament).filter(
        models.Tournament.id == tid,
        models.Tournament.club_id == rec.club_id,
    ).first()
    if not t or not _is_public_visible(t):
        raise HTTPException(404, "Không tìm thấy giải đấu")

    matches_q = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.tournament_id == tid,
        models.TournamentMatch.phase == "group",
    )
    if group:
        matches_q = matches_q.filter(models.TournamentMatch.group_name == group)
    matches = matches_q.all()

    participants = t.participants
    if group:
        participants = [p for p in participants if p.group_name == group]

    p_dicts = [{
        "id": p.id, "member_id": p.member_id,
        "full_name": p.member.full_name if p.member else "",
        "team_name": p.team_name or (p.member.full_name if p.member else ""),
        "group_name": p.group_name,
    } for p in participants]

    m_dicts = [{
        "p1_id": m.p1_id, "p2_id": m.p2_id,
        "score1": m.score1, "score2": m.score2, "status": m.status,
        "winner_id": m.winner_id, "is_walkover": m.is_walkover,
    } for m in matches]

    return compute_standings(m_dicts, p_dicts, group=group)


@app.post("/api/public/report/{slug}/tournaments/{tid}/matches/{mid}/score", response_model=schemas.MatchOut)
@limiter.limit("10/minute")
def public_update_score(
    request: Request, slug: str, tid: int, mid: int,
    data: schemas.PublicScoreUpdate,
    db: Session = Depends(get_db),
):
    rec = _validate_token(slug, db)
    t = db.query(models.Tournament).filter(
        models.Tournament.id == tid,
        models.Tournament.club_id == rec.club_id,
    ).first()
    if not t or not _is_public_visible(t):
        raise HTTPException(404, "Không tìm thấy giải đấu")
    if not t.public_scoring_enabled or not t.score_pin_hash:
        raise HTTPException(403, "Giải đấu này chưa bật nhập điểm qua trang public")
    if not verify_password(data.pin, t.score_pin_hash):
        raise HTTPException(403, "Mã PIN không đúng")

    match = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.id == mid,
        models.TournamentMatch.tournament_id == tid,
    ).first()
    if not match: raise HTTPException(404, "Không tìm thấy trận đấu")

    _check_scorable(t, match, data.score1, data.score2)
    _apply_match_score(db, match, data.score1, data.score2)
    db.flush()
    # Người thắng vừa được đưa vào vòng sau — nếu đối thủ ở đó đã bỏ giải từ trước, xử
    # thắng ngay thay vì để trận đó treo chờ (bỏ giải xảy ra trước khi trận này có kết quả).
    _advance_byes_and_walkovers(db, tid)
    db.commit(); db.refresh(match)
    return match


def _is_public_visible(t: "models.Tournament") -> bool:
    """Quy tắc hiển thị trên trang public: giải đã bắt đầu, HOẶC giải Nháp đang/đã ghép đội bằng vòng quay
    (khán giả theo dõi trực tiếp ngay từ đầu). Nháp không có phiên, hoặc mọi phiên đều đã huỷ → ẩn."""
    if t.status != models.TournamentStatus.draft:
        return True
    # Xét MỌI phiên chứ không chỉ phiên mới nhất: đã có phiên chốt (đội đã công khai) thì huỷ một phiên
    # mở thêm sau đó không được làm giải "biến mất" khỏi public. Chỉ ẩn khi mọi phiên đều bị huỷ.
    return any(d.status in ("open", "committed", "superseded") for d in t.partner_draws)


def _public_draw_out(draw: "models.TournamentDraw", t: "models.Tournament") -> dict:
    """Bản public của DrawOut: bỏ created_by (tên đăng nhập của admin không đưa ra trang không cần đăng nhập)."""
    out = _draw_out(draw, t)
    out.pop("created_by", None)
    return out


def _public_tournament_or_404(db: Session, slug: str, tid: int) -> "models.Tournament":
    rec = _validate_token(slug, db)
    t = db.query(models.Tournament).filter(
        models.Tournament.id == tid,
        models.Tournament.club_id == rec.club_id,
    ).first()
    if not t or not _is_public_visible(t):
        raise HTTPException(404, "Không tìm thấy giải đấu")
    return t


@app.get("/api/public/report/{slug}/tournaments/{tid}/draw")
@limiter.limit("600/minute")
def public_tournament_draw(request: Request, slug: str, tid: int, db: Session = Depends(get_db)):
    """Khán giả theo dõi bốc thăm trực tiếp bằng polling 2s. Bucket rate-limit riêng theo path và
    nới rộng vì nhiều khán giả cùng Wi-Fi sân chung 1 IP. Không PII: DrawOut chỉ có participant_id."""
    t = _public_tournament_or_404(db, slug, tid)
    draw = t.draw
    return {
        "draw": _public_draw_out(draw, t) if draw is not None else None,
        "server_now_ms": int(time.time() * 1000),   # để client đồng bộ mốc dừng kim theo giờ server
    }


@app.get("/api/public/report/{slug}/tournaments/{tid}/draws")  # không response_model: dict đã bỏ created_by, tránh pydantic điền lại null
@limiter.limit("60/minute")
def public_tournament_draws(request: Request, slug: str, tid: int, db: Session = Depends(get_db)):
    """Lịch sử mọi phiên bốc thăm (seq giảm dần) kèm seed để khán giả kiểm chứng."""
    t = _public_tournament_or_404(db, slug, tid)
    return [_public_draw_out(d, t) for d in sorted(t.draws, key=lambda d: d.seq, reverse=True)]


def _public_partner_draw_out(draw: "models.TournamentPartnerDraw", t: "models.Tournament") -> dict:
    """Bản public của PartnerDrawOut: bỏ created_by (tên đăng nhập admin không ra trang public)."""
    out = _partner_draw_out(draw, t)
    out.pop("created_by", None)
    return out


@app.get("/api/public/report/{slug}/tournaments/{tid}/partner-draw")
@limiter.limit("600/minute")
def public_tournament_partner_draw(request: Request, slug: str, tid: int, db: Session = Depends(get_db)):
    """Khán giả theo dõi ghép đội trực tiếp bằng polling 2s (bucket riêng, nới rộng như /draw).
    Không PII: pool chỉ có pid/member_id/player_id/name/rank."""
    t = _public_tournament_or_404(db, slug, tid)
    pd = t.partner_draw
    return {
        "partner_draw": _public_partner_draw_out(pd, t) if pd is not None else None,
        "server_now_ms": int(time.time() * 1000),
    }


@app.get("/api/public/report/{slug}/tournaments/{tid}/partner-draws")  # không response_model: dict đã bỏ created_by
@limiter.limit("60/minute")
def public_tournament_partner_draws(request: Request, slug: str, tid: int, db: Session = Depends(get_db)):
    """Lịch sử mọi phiên ghép đội (seq giảm dần) kèm seed để khán giả kiểm chứng."""
    t = _public_tournament_or_404(db, slug, tid)
    return [_public_partner_draw_out(d, t) for d in sorted(t.partner_draws, key=lambda d: d.seq, reverse=True)]


# ── TOURNAMENTS ───────────────────────────────────────────

# ── PLAYERS ───────────────────────────────────────────────

@app.get("/api/players", response_model=List[schemas.PlayerOut])
def list_players(
    type: Optional[str] = None,   # "member" | "guest" | None = all
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_view()
    q = db.query(models.Player).filter(models.Player.club_id == perms.club_id)
    if type == "member":
        q = q.filter(models.Player.member_id.isnot(None))
    elif type == "guest":
        q = q.filter(models.Player.member_id.is_(None))
    players = q.order_by(models.Player.name).all()
    return [
        schemas.PlayerOut(
            id=p.id, name=p.name, phone=p.phone, email=p.email,
            rank=p.rank, member_id=p.member_id, club_id=p.club_id,
            is_guest=(p.member_id is None),
        )
        for p in players
    ]


@app.post("/api/players", response_model=schemas.PlayerOut, status_code=201)
def create_player(
    data: schemas.PlayerCreate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_create()
    # Nếu là thành viên CLB, kiểm tra member thuộc CLB hiện tại
    if data.member_id:
        member = db.query(models.Member).filter(
            models.Member.id == data.member_id,
            models.Member.club_id == perms.club_id,
        ).first()
        if not member:
            raise HTTPException(404, "Thành viên không tồn tại trong CLB")
        # Kiểm tra player record đã tồn tại chưa
        existing = db.query(models.Player).filter(
            models.Player.club_id == perms.club_id,
            models.Player.member_id == data.member_id,
        ).first()
        if existing:
            # Trả về record đã có thay vì báo lỗi
            return schemas.PlayerOut(
                id=existing.id, name=existing.name, phone=existing.phone,
                email=existing.email, rank=existing.rank,
                member_id=existing.member_id, club_id=existing.club_id, is_guest=False,
            )
        name = data.name or member.full_name
    else:
        if not data.name:
            raise HTTPException(422, "Tên là bắt buộc với khách mời")
        name = data.name

    p = models.Player(
        name=name, phone=data.phone, email=data.email,
        rank=data.rank or "Chưa xếp hạng",
        member_id=data.member_id, club_id=perms.club_id,
    )
    db.add(p); db.commit(); db.refresh(p)
    return schemas.PlayerOut(
        id=p.id, name=p.name, phone=p.phone, email=p.email,
        rank=p.rank, member_id=p.member_id, club_id=p.club_id,
        is_guest=(p.member_id is None),
    )


@app.put("/api/players/{pid}", response_model=schemas.PlayerOut)
def update_player(
    pid: int,
    data: schemas.PlayerCreate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_edit()
    p = db.query(models.Player).filter(
        models.Player.id == pid, models.Player.club_id == perms.club_id
    ).first()
    if not p:
        raise HTTPException(404, "Không tìm thấy player")
    p.name = data.name or p.name
    p.phone = data.phone
    p.email = data.email
    if data.rank is not None:
        p.rank = data.rank
    db.commit(); db.refresh(p)
    return schemas.PlayerOut(
        id=p.id, name=p.name, phone=p.phone, email=p.email,
        rank=p.rank, member_id=p.member_id, club_id=p.club_id,
        is_guest=(p.member_id is None),
    )


@app.delete("/api/players/{pid}", status_code=204)
def delete_player(
    pid: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_delete()
    p = db.query(models.Player).filter(
        models.Player.id == pid, models.Player.club_id == perms.club_id
    ).first()
    if not p:
        raise HTTPException(404, "Không tìm thấy player")
    # Kiểm tra player đang tham gia giải đấu nào không
    used = db.query(models.TournamentParticipant).filter(
        (models.TournamentParticipant.player_id == pid) |
        (models.TournamentParticipant.partner_player_id == pid)
    ).first()
    if used:
        raise HTTPException(400, "Không thể xóa: player đang tham gia giải đấu")
    tx_count = db.query(models.Transaction).filter(models.Transaction.player_id == pid).count()
    if tx_count:
        raise HTTPException(400, f"Không thể xóa: có {tx_count} giao dịch gắn với khách mời này")
    db.delete(p); db.commit()


@app.get("/api/players/{pid}/tournaments")
def get_player_tournaments(
    pid: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_view()
    p = db.query(models.Player).filter(
        models.Player.id == pid, models.Player.club_id == perms.club_id
    ).first()
    if not p:
        raise HTTPException(404, "Không tìm thấy player")
    parts = db.query(models.TournamentParticipant).filter(
        (models.TournamentParticipant.player_id == pid) |
        (models.TournamentParticipant.partner_player_id == pid)
    ).all()
    result = []
    for part in parts:
        t = part.tournament
        result.append({
            "tournament_id": t.id,
            "tournament_name": t.name,
            "status": t.status.value if hasattr(t.status, "value") else t.status,
            "team_type": t.team_type,
            "team_name": part.team_name,
            "as_partner": part.partner_player_id == pid,
        })
    return result


@app.post("/api/players/{pid}/convert-to-member", response_model=schemas.MemberOut, status_code=201)
def convert_player_to_member(
    pid: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_create()
    p = db.query(models.Player).filter(
        models.Player.id == pid, models.Player.club_id == perms.club_id
    ).first()
    if not p:
        raise HTTPException(404, "Không tìm thấy player")
    if p.member_id is not None:
        raise HTTPException(400, "Player này đã là thành viên CLB")

    member = models.Member(
        club_id=perms.club_id,
        member_code=auto_member_code(db, perms.club_id),
        full_name=p.name,
        phone=p.phone,
        email=p.email,
        rank=p.rank,
        status=models.MemberStatus.active,
    )
    db.add(member); db.flush()
    p.member_id = member.id
    db.commit(); db.refresh(member)
    return member


# ── TOURNAMENTS ───────────────────────────────────────────

@app.get("/api/tournaments", response_model=List[schemas.TournamentOut])
def list_tournaments(
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_view()
    return db.query(models.Tournament).filter(models.Tournament.club_id == perms.club_id).order_by(models.Tournament.id.desc()).all()


@app.post("/api/tournaments", response_model=schemas.TournamentOut, status_code=201)
def create_tournament(
    data: schemas.TournamentCreate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_create()
    if data.score_pin is not None and not re.fullmatch(r"\d{4}", data.score_pin):
        raise HTTPException(400, "Mã PIN phải gồm đúng 4 chữ số")
    if data.public_scoring_enabled and not data.score_pin:
        raise HTTPException(400, "Cần nhập mã PIN để bật nhập điểm qua trang public")
    t = models.Tournament(
        club_id=perms.club_id,
        name=data.name, format=data.format,
        team_type=data.team_type,
        pairing_mode=data.pairing_mode, rank_rules=data.rank_rules,
        partner_rules=normalize_partner_rules([r.model_dump() for r in data.partner_rules]) if data.partner_rules is not None else None,
        num_groups=data.num_groups, description=data.description,
        score_pin_hash=hash_password(data.score_pin) if data.score_pin else None,
        public_scoring_enabled=data.public_scoring_enabled,
        third_place_enabled=data.third_place_enabled,
    )
    db.add(t); db.flush()

    def _resolve_name(db, member_id=None, player_id=None) -> str:
        """Lấy tên hiển thị từ member hoặc player."""
        if member_id:
            return db.query(models.Member.full_name).filter(models.Member.id == member_id).scalar() or ""
        if player_id:
            return db.query(models.Player.name).filter(models.Player.id == player_id).scalar() or ""
        return ""

    if data.team_type == "doubles" and data.teams:
        # Doubles: mỗi team dict có thể chứa member_id/player_id cho từng vị trí
        for idx, team in enumerate(data.teams):
            m1 = team.get("member_id")
            p1 = team.get("player_id")
            m2 = team.get("partner_member_id")
            p2 = team.get("partner_player_id")
            if not (m1 or p1) or not (m2 or p2):
                raise HTTPException(400, f"Đội #{idx + 1}: đấu đôi cần đủ 2 người")
            if (m1 and p1) or (m2 and p2):
                raise HTTPException(400, f"Đội #{idx + 1}: mỗi vị trí chỉ chọn thành viên HOẶC khách mời")
            _check_people_in_club(db, perms.club_id, m1, p1)
            _check_people_in_club(db, perms.club_id, m2, p2)
            tname = team.get("team_name") or None
            if not tname:
                n1 = _resolve_name(db, m1, p1)
                n2 = _resolve_name(db, m2, p2)
                tname = f"{n1} / {n2}" if n1 and n2 else (n1 or n2)
            pt = models.TournamentParticipant(
                tournament_id=t.id,
                member_id=m1, player_id=p1,
                partner_member_id=m2, partner_player_id=p2,
                team_name=tname, seed=idx + 1,
            )
            db.add(pt)
    else:
        # Singles: kết hợp member_ids (thành viên) + player_ids (khách mời).
        # Giải ĐÔI không gửi teams cũng đi nhánh này: mỗi người là 1 participant đơn lẻ (chưa có partner),
        # ghép đội sau bằng vòng quay / ghép tay trên trang giải.
        # Cho phép tạo giải RỖNG (0 người): chọn người hàng loạt tại trang giải khi Nháp;
        # điều kiện ≥ 2 đội/người chơi được kiểm tra lúc "Bắt đầu giải".
        idx = 0
        for mid in (data.member_ids or []):
            member = _get_member_in_club(db, mid, perms.club_id)
            pt = models.TournamentParticipant(
                tournament_id=t.id, member_id=mid,
                team_name=member.full_name, seed=idx + 1,
            )
            db.add(pt); idx += 1
        for pid in (data.player_ids or []):
            pname = _get_player_in_club(db, pid, perms.club_id).name or "Khách"
            pt = models.TournamentParticipant(
                tournament_id=t.id, player_id=pid,
                team_name=pname, seed=idx + 1,
            )
            db.add(pt); idx += 1

    db.commit(); db.refresh(t)
    return t


@app.get("/api/tournaments/{tid}", response_model=schemas.TournamentOut)
def get_tournament(
    tid: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_view()
    t = db.query(models.Tournament).filter(models.Tournament.id == tid, models.Tournament.club_id == perms.club_id).first()
    if not t: raise HTTPException(404, "Không tìm thấy giải đấu")
    return t


SETUP_FIELDS = {"format", "team_type", "pairing_mode", "rank_rules", "num_groups", "third_place_enabled"}
ALLOWED_STATUS_TRANSITIONS = {
    models.TournamentStatus.draft: {models.TournamentStatus.active},
    models.TournamentStatus.active: {models.TournamentStatus.completed},
    models.TournamentStatus.completed: set(),
}


@app.put("/api/tournaments/{tid}", response_model=schemas.TournamentOut)
def update_tournament(
    tid: int,
    data: schemas.TournamentUpdate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_edit()
    t = db.query(models.Tournament).filter(models.Tournament.id == tid, models.Tournament.club_id == perms.club_id).first()
    if not t: raise HTTPException(404, "Không tìm thấy giải đấu")
    updates = data.model_dump(exclude_none=True)

    if any(k in SETUP_FIELDS for k in updates) and t.status != models.TournamentStatus.draft:
        raise HTTPException(400, "Chỉ có thể chỉnh sửa thể thức/cấu hình khi giải đấu ở trạng thái Nháp")

    new_status = updates.get("status")
    if new_status is not None and new_status != t.status:
        if new_status not in ALLOWED_STATUS_TRANSITIONS.get(t.status, set()):
            raise HTTPException(400, f"Không thể chuyển trạng thái từ '{t.status.value}' sang '{new_status.value}'")
        # Không kết thúc giải khi còn phiên bốc thăm dở — tránh phiên "mồ côi" không chốt được
        if new_status == models.TournamentStatus.completed and any(d.status == "open" for d in t.draws):
            raise HTTPException(400, "Đang có phiên bốc thăm chưa kết thúc — huỷ hoặc chốt phiên trước khi kết thúc giải")
        if new_status == models.TournamentStatus.active:
            # Bắt đầu giải = khoá danh sách; giải đôi phải ghép xong hết (không tự vét/tự loại người dư)
            if _open_partner_draw(t) is not None:
                raise HTTPException(400, "Đang có phiên ghép đội chưa kết thúc")
            if len(t.participants) < 2:
                raise HTTPException(400, "Cần ít nhất 2 đội/người chơi trước khi bắt đầu giải")
            _require_all_paired(t)

    for k, v in updates.items():
        setattr(t, k, v)
    db.commit(); db.refresh(t)
    return t


@app.patch("/api/tournaments/{tid}/score-pin", response_model=schemas.TournamentOut)
def update_score_pin(
    tid: int,
    data: schemas.ScorePinUpdate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Đặt/đổi mã PIN nhập điểm qua public và/hoặc bật-tắt tính năng.
    Độc lập với vòng đời giải đấu — sửa được ở mọi trạng thái (draft/active/completed)."""
    perms.require_edit()
    t = db.query(models.Tournament).filter(models.Tournament.id == tid, models.Tournament.club_id == perms.club_id).first()
    if not t: raise HTTPException(404, "Không tìm thấy giải đấu")

    if data.pin is not None:
        if not re.fullmatch(r"\d{4}", data.pin):
            raise HTTPException(400, "Mã PIN phải gồm đúng 4 chữ số")
        t.score_pin_hash = hash_password(data.pin)

    if data.enabled and not t.score_pin_hash:
        raise HTTPException(400, "Chưa có mã PIN — vui lòng đặt mã PIN trước khi bật")

    t.public_scoring_enabled = data.enabled
    db.commit(); db.refresh(t)
    return t


@app.patch("/api/tournaments/{tid}/third-place", response_model=schemas.TournamentOut)
def update_third_place(
    tid: int,
    data: schemas.ThirdPlaceUpdate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Bật/tắt trận tranh giải 3 ở Nháp HOẶC khi giải đang diễn ra (third_place_enabled nằm trong
    SETUP_FIELDS nên PUT /tournaments chỉ sửa được khi Nháp — endpoint này là đường riêng cho lúc
    đã bắt đầu). Bật: nếu đã có bracket knockout với 2 bán kết thì tạo trận ngay và điền người thua
    của các bán kết ĐÃ đấu; thể thức kết hợp chưa lên vòng loại thì chỉ lưu cờ (start_knockout tự
    tạo). Tắt: xoá trận tranh giải 3 nếu chưa có tỉ số thật và gỡ liên kết đường thua trên bán kết."""
    perms.require_edit()
    t = _get_club_tournament(db, tid, perms)
    if t.status == models.TournamentStatus.completed:
        raise HTTPException(400, "Giải đấu đã kết thúc — không thể đổi cài đặt tranh giải 3")
    if t.format.value not in ("knockout", "combined"):
        raise HTTPException(400, "Tranh giải 3 chỉ áp dụng cho thể thức loại trực tiếp hoặc kết hợp")
    third = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.tournament_id == tid,
        models.TournamentMatch.phase == "knockout",
        models.TournamentMatch.round_name == "Tranh giải 3",
    ).first()
    if data.enabled:
        t.third_place_enabled = True
        if third is None:
            db.flush()
            _maybe_add_third_place(db, tid, t)
            _backfill_third_place_losers(db, tid)
    else:
        if third is not None:
            if third.score1 is not None:
                raise HTTPException(400, "Trận tranh giải 3 đã có kết quả — không thể tắt. Sửa/xoá kết quả trước nếu thật sự cần.")
            for m in db.query(models.TournamentMatch).filter(models.TournamentMatch.loser_next_match_id == third.id).all():
                m.loser_next_match_id = None
                m.loser_next_match_slot = None
            db.delete(third)
        t.third_place_enabled = False
    db.commit(); db.refresh(t)
    return t


@app.post("/api/tournaments/{tid}/participants", response_model=schemas.ParticipantOut, status_code=201)
def add_participant(
    tid: int,
    data: schemas.ParticipantCreate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_edit()
    t = db.query(models.Tournament).filter(models.Tournament.id == tid, models.Tournament.club_id == perms.club_id).first()
    if not t: raise HTTPException(404, "Không tìm thấy giải đấu")
    if t.status != models.TournamentStatus.draft:
        raise HTTPException(400, "Chỉ có thể thêm người chơi khi giải đấu ở trạng thái Nháp")
    if _open_partner_draw(t) is not None:
        # Pool của phiên ghép đội là snapshot — đổi danh sách giữa chừng làm commit không toàn vẹn
        raise HTTPException(400, PARTNER_DRAW_OPEN_MSG)
    if not data.member_id and not data.player_id:
        raise HTTPException(400, "Cần chọn thành viên hoặc khách mời")
    if data.member_id and data.player_id:
        raise HTTPException(400, "Chỉ chọn 1 trong 2: thành viên hoặc khách mời")
    _check_people_in_club(db, perms.club_id, data.member_id, data.player_id)
    _check_people_in_club(db, perms.club_id, data.partner_member_id, data.partner_player_id)

    others = db.query(models.TournamentParticipant).filter(models.TournamentParticipant.tournament_id == tid).all()
    for o in others:
        for mid, plid in [(o.member_id, o.player_id), (o.partner_member_id, o.partner_player_id)]:
            if data.member_id and mid == data.member_id:
                raise HTTPException(400, "Thành viên này đã tham gia giải")
            if data.player_id and plid == data.player_id:
                raise HTTPException(400, "Khách mời này đã tham gia giải")

    team_name = data.team_name
    if not team_name:
        n1 = _resolve_display_name(db, data.member_id, data.player_id)
        n2 = _resolve_display_name(db, data.partner_member_id, data.partner_player_id)
        team_name = f"{n1} / {n2}" if n1 and n2 else (n1 or n2)

    max_seed = db.query(func.max(models.TournamentParticipant.seed)).filter(
        models.TournamentParticipant.tournament_id == tid
    ).scalar() or 0

    p = models.TournamentParticipant(
        tournament_id=tid,
        member_id=data.member_id, player_id=data.player_id,
        partner_member_id=data.partner_member_id, partner_player_id=data.partner_player_id,
        team_name=team_name, seed=max_seed + 1,
    )
    db.add(p); db.commit(); db.refresh(p)
    return p


@app.post("/api/tournaments/{tid}/participants/bulk", response_model=schemas.BulkParticipantsOut)
def add_participants_bulk(
    tid: int,
    data: schemas.BulkParticipantsIn,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Thêm hàng loạt người chơi ĐƠN LẺ (thành viên + khách mời) vào giải Nháp — dùng cho ParticipantsPanel.
    Người đã có trong giải (ở bất kỳ vị trí, kể cả người 2 của một đội) → bỏ qua, không lỗi.
    Giải đôi: mỗi người là 1 participant chưa có đội, ghép sau bằng vòng quay / ghép tay."""
    perms.require_edit()
    t = db.query(models.Tournament).filter(models.Tournament.id == tid, models.Tournament.club_id == perms.club_id).first()
    if not t: raise HTTPException(404, "Không tìm thấy giải đấu")
    if t.status != models.TournamentStatus.draft:
        raise HTTPException(400, "Chỉ có thể thêm người chơi khi giải đấu ở trạng thái Nháp")
    if _open_partner_draw(t) is not None:
        raise HTTPException(400, PARTNER_DRAW_OPEN_MSG)

    # Loại trùng trong chính request (giữ thứ tự)
    member_ids = list(dict.fromkeys(data.member_ids or []))
    player_ids = list(dict.fromkeys(data.player_ids or []))
    for mid in member_ids:
        _check_people_in_club(db, perms.club_id, member_id=mid)
    # Bản ghi Player gắn thành viên (member_id != NULL) là CÙNG MỘT NGƯỜI với thành viên đó → quy đổi sang
    # member_id để không vào giải 2 lần (một lần qua member_ids, một lần qua player_ids)
    guest_ids = []
    for plid in player_ids:
        pl = _get_player_in_club(db, plid, perms.club_id)
        if pl.member_id is not None:
            if pl.member_id not in member_ids:
                _check_people_in_club(db, perms.club_id, member_id=pl.member_id)
                member_ids.append(pl.member_id)
        else:
            guest_ids.append(plid)
    player_ids = guest_ids

    existing_members, existing_players = set(), set()
    for o in t.participants:
        for mid, plid in [(o.member_id, o.player_id), (o.partner_member_id, o.partner_player_id)]:
            if mid is not None: existing_members.add(mid)
            if plid is not None: existing_players.add(plid)

    max_seed = db.query(func.max(models.TournamentParticipant.seed)).filter(
        models.TournamentParticipant.tournament_id == tid
    ).scalar() or 0
    added, skipped = 0, []
    for mid in member_ids:
        name = _resolve_display_name(db, member_id=mid)
        if mid in existing_members:
            skipped.append(name); continue
        max_seed += 1
        db.add(models.TournamentParticipant(tournament_id=tid, member_id=mid, team_name=name, seed=max_seed))
        existing_members.add(mid); added += 1
    for plid in player_ids:
        name = _resolve_display_name(db, player_id=plid) or "Khách"
        if plid in existing_players:
            skipped.append(name); continue
        max_seed += 1
        db.add(models.TournamentParticipant(tournament_id=tid, player_id=plid, team_name=name, seed=max_seed))
        existing_players.add(plid); added += 1

    db.commit(); db.refresh(t)
    return {"added": added, "skipped": skipped, "tournament": schemas.TournamentOut.model_validate(t)}


@app.delete("/api/tournaments/{tid}/participants/{pid}", status_code=204)
def remove_participant(
    tid: int, pid: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_edit()
    t = db.query(models.Tournament).filter(models.Tournament.id == tid, models.Tournament.club_id == perms.club_id).first()
    if not t: raise HTTPException(404, "Không tìm thấy giải đấu")
    if t.status != models.TournamentStatus.draft:
        raise HTTPException(400, "Chỉ có thể xóa người chơi khi giải đấu ở trạng thái Nháp")
    if _open_partner_draw(t) is not None:
        raise HTTPException(400, PARTNER_DRAW_OPEN_MSG)
    p = db.query(models.TournamentParticipant).filter(
        models.TournamentParticipant.id == pid, models.TournamentParticipant.tournament_id == tid,
    ).first()
    if not p: raise HTTPException(404, "Không tìm thấy đội/người chơi")
    db.delete(p); db.commit()


@app.delete("/api/tournaments/{tid}", status_code=204)
def delete_tournament(
    tid: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_delete()
    t = db.query(models.Tournament).filter(models.Tournament.id == tid, models.Tournament.club_id == perms.club_id).first()
    if not t: raise HTTPException(404, "Không tìm thấy giải đấu")
    db.delete(t); db.commit()


# ── Helpers ghép đội đôi (partner draw) — dùng cho guard ở nhiều endpoint ──
PARTNER_DRAW_OPEN_MSG = "Đang có phiên ghép đội chưa kết thúc — chốt hoặc huỷ phiên trước"


def _single_participants(t: "models.Tournament") -> list:
    """Participant đơn lẻ (chưa có người 2) — chỉ có nghĩa với giải đôi."""
    return [p for p in t.participants if p.partner_member_id is None and p.partner_player_id is None]


def _open_partner_draw(t: "models.Tournament"):
    """Phiên ghép đội đang mở của giải, hoặc None."""
    for d in t.partner_draws:
        if d.status == "open":
            return d
    return None


def _require_all_paired(t: "models.Tournament") -> None:
    """Giải đôi còn người chưa có đội → 400. Người dư được ĐỂ LẠI ghép tay, không tự vét/tự loại."""
    if t.team_type == "doubles":
        n = t.unpaired_count
        if n > 0:
            raise HTTPException(400, f"Còn {n} người chưa có đội — ghép đội hoặc xoá khỏi giải trước khi bắt đầu")


def _merge_pair(db: Session, t: "models.Tournament", a: "models.TournamentParticipant",
                b: "models.TournamentParticipant") -> None:
    """Gộp 2 participant đơn lẻ thành 1 đội: a giữ lại làm người 1, b trở thành người 2 rồi bị xoá.
    Dùng chung cho chốt phiên ghép đội và ghép tay. KHÔNG commit — caller commit."""
    if a.id == b.id:
        raise HTTPException(400, "Không thể ghép một người với chính mình")
    if a.tournament_id != t.id or b.tournament_id != t.id:
        raise HTTPException(404, "Không tìm thấy người chơi trong giải")
    for x in (a, b):
        if x.partner_member_id is not None or x.partner_player_id is not None:
            raise HTTPException(400, "Người này đã có đội")
    n1 = _resolve_display_name(db, a.member_id, a.player_id)
    n2 = _resolve_display_name(db, b.member_id, b.player_id)
    a.partner_member_id = b.member_id
    a.partner_player_id = b.player_id
    a.team_name = f"{n1} / {n2}" if n1 and n2 else (n1 or n2)
    db.delete(b)
    db.flush()


def _save_matches(db, tid: int, raw_matches: list, offset_idx: int = 0):
    """Lưu list match dicts vào DB, trả về list (match, raw) đã lưu."""
    saved = []
    for m in raw_matches:
        match = models.TournamentMatch(
            tournament_id=tid,
            round_number=m["round_number"], round_name=m.get("round_name"),
            match_number=m["match_number"], phase=m.get("phase", "group"),
            group_name=m.get("group_name"),
            p1_id=m.get("p1_id"), p2_id=m.get("p2_id"),
        )
        db.add(match); db.flush()
        saved.append((match, m))

    for i, (match, m) in enumerate(saved):
        idx = m.get("_next_match_idx")
        slot = m.get("_next_slot")
        if idx is not None:
            real_idx = idx - offset_idx
            if 0 <= real_idx < len(saved):
                match.next_match_id = saved[real_idx][0].id
                match.next_match_slot = slot
    return saved


def _participant_rank(p: models.TournamentParticipant) -> str:
    """Hạng của participant: thành viên hoặc khách mời (participant có thể không có member)."""
    if p.member is not None:
        return p.member.rank or ""
    if p.player is not None:
        return p.player.rank or ""
    return ""


def _resolve_group_walkovers(db: Session, tid: int) -> int:
    """Trận vòng bảng/vòng tròn còn pending mà ĐÚNG 1 bên đã bỏ giải → xử thắng cho bên
    kia (is_walkover=True, không tính hiệu số khi xếp hạng — xem compute_standings)."""
    pending = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.tournament_id == tid,
        models.TournamentMatch.phase == "group",
        models.TournamentMatch.status == models.MatchStatus.pending,
    ).all()
    handled = 0
    for m in pending:
        p1_out = m.p1 is not None and m.p1.status == models.ParticipantStatus.withdrawn
        p2_out = m.p2 is not None and m.p2.status == models.ParticipantStatus.withdrawn
        if p1_out == p2_out:
            continue  # cả 2 cùng bỏ giải, hoặc cả 2 vẫn thi đấu — không tự xử
        m.winner_id = m.p2_id if p1_out else m.p1_id
        m.status = models.MatchStatus.completed
        m.is_walkover = True
        handled += 1
    return handled


def _advance_byes_and_walkovers(db: Session, tid: int) -> int:
    """Trận knockout tự hoàn thành khi 1 bên trống (bye cấu trúc, số đội không phải luỹ
    thừa 2) HOẶC đã bỏ giải (withdrawn) — bên còn lại tự động thắng/vào vòng sau, và nếu
    trận đó có gắn loser_next_match_id (bán kết, khi bật tranh giải 3) thì người thua cũng
    được định tuyến sang đó. Lặp tới khi không còn thay đổi vì bỏ giải có thể dây chuyền
    qua nhiều vòng liên tiếp (người vừa thắng nhờ walkover lại gặp đối thủ cũng đã bỏ giải)."""
    handled = 0
    while True:
        changed = False
        pending = db.query(models.TournamentMatch).filter(
            models.TournamentMatch.tournament_id == tid,
            models.TournamentMatch.phase == "knockout",
            models.TournamentMatch.status == models.MatchStatus.pending,
        ).order_by(models.TournamentMatch.match_number).all()
        for m in pending:
            p1_out = m.p1_id is None or (m.p1 is not None and m.p1.status == models.ParticipantStatus.withdrawn)
            p2_out = m.p2_id is None or (m.p2 is not None and m.p2.status == models.ParticipantStatus.withdrawn)
            if p1_out == p2_out:
                continue  # cả 2 hợp lệ (trận thật) hoặc cả 2 out (chưa xử được) — bỏ qua
            # Nếu là bye cấu trúc (1 bên chưa có ai, không phải do bỏ giải), chỉ xử khi
            # chắc chắn không còn trận nào khác sắp cấp người vào ô trống đó — kể cả định
            # tuyến qua đường THUA (loser_next_match_id, dùng cho trận tranh giải 3), không
            # chỉ đường THẮNG (next_match_id), nếu không sẽ tưởng nhầm slot 2 của tranh giải 3
            # là bye trong lúc bán kết còn lại chưa đấu xong.
            if (m.p1_id is None) != (m.p2_id is None):
                empty_slot = 1 if m.p1_id is None else 2
                # Chỉ tính feeder CHƯA hoàn thành: trận đã completed thì winner/loser đã được đẩy
                # sang ngay lúc có kết quả — nếu ô vẫn trống nghĩa là không có ai để đẩy (bán kết bye
                # không có người thua) → phải xử như bye, nếu không trận tranh giải 3 treo pending mãi.
                feeder = db.query(models.TournamentMatch).filter(
                    models.TournamentMatch.status != models.MatchStatus.completed,
                    or_(
                        (models.TournamentMatch.next_match_id == m.id)
                        & (models.TournamentMatch.next_match_slot == empty_slot),
                        (models.TournamentMatch.loser_next_match_id == m.id)
                        & (models.TournamentMatch.loser_next_match_slot == empty_slot),
                    )
                ).first()
                if feeder is not None:
                    continue
            winner_id = m.p2_id if p1_out else m.p1_id
            loser_id = m.p1_id if winner_id == m.p2_id else m.p2_id
            m.winner_id = winner_id
            m.status = models.MatchStatus.completed
            if m.p1_id is not None and m.p2_id is not None:
                m.is_walkover = True  # đủ 2 bên thật nhưng 1 bên bỏ giải — không phải bye
            nxt = db.get(models.TournamentMatch, m.next_match_id) if m.next_match_id else None
            if nxt is not None:
                if m.next_match_slot == 1: nxt.p1_id = winner_id
                else: nxt.p2_id = winner_id
            if loser_id is not None and m.loser_next_match_id:
                lm = db.get(models.TournamentMatch, m.loser_next_match_id)
                if lm is not None:
                    if m.loser_next_match_slot == 1: lm.p1_id = loser_id
                    else: lm.p2_id = loser_id
            db.flush()
            handled += 1
            changed = True
        if not changed:
            return handled


def _maybe_add_third_place(db: Session, tid: int, t: "models.Tournament") -> None:
    """Nếu bật 'Tranh giải 3' và bracket vừa sinh có vòng bán kết thật (đúng 2 trận ở vòng
    kế chung kết — cần ≥4 đội, không tính vòng chỉ có 1 trận chung kết duy nhất), tạo thêm
    1 trận song song với chung kết và gắn loser_next_match_id trên 2 trận bán kết để người
    thua tự động vào đây ngay khi bán kết có kết quả (qua _apply_match_score /
    _advance_byes_and_walkovers). An toàn khi gọi lại nhiều lần (không tạo trùng)."""
    if not t.third_place_enabled:
        return
    ko_matches = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.tournament_id == tid,
        models.TournamentMatch.phase == "knockout",
    ).all()
    if not ko_matches:
        return
    if any(m.round_name == "Tranh giải 3" for m in ko_matches):
        return
    max_round = max(m.round_number for m in ko_matches)
    semis = [m for m in ko_matches if m.round_number == max_round - 1]
    if len(semis) != 2:
        return  # bracket quá nhỏ (chỉ có chung kết, không có vòng bán kết) → không áp dụng được
    max_match_number = max(m.match_number for m in ko_matches)
    third = models.TournamentMatch(
        tournament_id=tid, round_number=max_round, round_name="Tranh giải 3",
        match_number=max_match_number + 1, phase="knockout", group_name=None,
    )
    db.add(third); db.flush()
    semis[0].loser_next_match_id = third.id; semis[0].loser_next_match_slot = 1
    semis[1].loser_next_match_id = third.id; semis[1].loser_next_match_slot = 2


def _backfill_third_place_losers(db: Session, tid: int) -> None:
    """Bật tranh giải 3 GIỮA giải: bán kết nào đã có kết quả (kể cả walkover) thì đưa người thua
    vào đúng ô của trận tranh giải 3 ngay (bình thường việc này xảy ra lúc nhập điểm bán kết qua
    _apply_match_score / _advance_byes_and_walkovers — nhưng khi bật muộn thì đã lỡ thời điểm đó).
    Sau đó chạy _advance_byes_and_walkovers để xử tiếp nếu người thua đã bỏ giải."""
    db.flush()  # Session autoflush=False: liên kết loser_next_match_id vừa gán trong _maybe_add_third_place phải xuống DB trước khi query
    third = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.tournament_id == tid,
        models.TournamentMatch.phase == "knockout",
        models.TournamentMatch.round_name == "Tranh giải 3",
    ).first()
    if third is None:
        return
    semis = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.tournament_id == tid,
        models.TournamentMatch.loser_next_match_id == third.id,
    ).all()
    for m in semis:
        if m.status != models.MatchStatus.completed or not m.winner_id or m.p1_id is None or m.p2_id is None:
            continue  # chưa đấu, hoặc bye cấu trúc (không có người thua thật)
        loser_id = m.p2_id if m.winner_id == m.p1_id else m.p1_id
        if m.loser_next_match_slot == 1:
            third.p1_id = loser_id
        else:
            third.p2_id = loser_id
    db.flush()
    _advance_byes_and_walkovers(db, tid)


def _check_generate_preconditions(db: Session, t: "models.Tournament", force: bool) -> list:
    """Các kiểm tra chung trước khi sinh lịch (dùng cho generate lẫn mở/chốt phiên bốc thăm).
    Trả về list participants. Thứ tự và câu báo lỗi giữ nguyên như generate cũ."""
    scored = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.tournament_id == t.id,
        models.TournamentMatch.score1.isnot(None),
    ).count()
    if scored and not force:
        raise HTTPException(400, f"Đã có {scored} trận có kết quả. Sinh lại lịch sẽ xoá toàn bộ kết quả — cần xác nhận (force=true)")

    participants = list(t.participants)
    if len(participants) < 2:
        raise HTTPException(400, "Cần ít nhất 2 đội/người chơi để sinh lịch")
    # Giải đôi còn người chưa có đội → không sinh lịch (chặn cả khi gọi thẳng API lúc draft).
    # Chỉ áp khi còn Nháp: giải đã active đã qua guard ở update_tournament; dữ liệu cũ (participant đôi
    # thiếu người 2 tạo trước tính năng này) không còn cách ghép nên không được chặn generate/bốc cặp đấu.
    if t.status == models.TournamentStatus.draft:
        _require_all_paired(t)
    if t.format.value == "combined":
        if t.num_groups < 1:
            raise HTTPException(400, "Số bảng phải ≥ 1")
        if len(participants) < 2 * t.num_groups:
            raise HTTPException(400, f"{t.num_groups} bảng cần ít nhất {2 * t.num_groups} đội (hiện có {len(participants)})")
    return participants


def _generate_from_order(db: Session, t: "models.Tournament", pid_list: list, force: bool) -> None:
    """Sinh lịch từ thứ tự participant đã chốt (pid_list KHÔNG shuffle nữa — đây là thứ tự cuối cùng,
    quyết định duy nhất cặp đấu). Dùng chung cho generate thủ công và chốt phiên bốc thăm.
    KHÔNG commit bên trong — caller commit."""
    tid = t.id
    if t.status == models.TournamentStatus.completed:
        raise HTTPException(400, "Giải đấu đã kết thúc, không thể sinh lại lịch")
    participants = _check_generate_preconditions(db, t, force)

    # Xóa matches cũ
    db.query(models.TournamentMatch).filter(models.TournamentMatch.tournament_id == tid).delete()

    if t.format.value == "combined":
        # Phân bảng theo ĐÚNG thứ tự pid_list — engine cũng chia i % num_groups
        letters = "ABCDEFGHIJKLMNOP"
        by_id = {p.id: p for p in participants}
        for i, pid in enumerate(pid_list):
            by_id[pid].group_name = letters[i % t.num_groups]
        db.flush()
        raw = generate_group_schedule(pid_list, t.num_groups, shuffle=False)
    else:
        for p in participants:
            p.group_name = None
        member_ranks = {p.id: _participant_rank(p) for p in participants}
        raw = generate_schedule(
            format=t.format.value,
            participant_ids=pid_list,
            pairing_mode=t.pairing_mode,
            rank_rules=t.rank_rules,
            member_ranks=member_ranks,
            num_groups=t.num_groups,
            shuffle=False,   # pid_list đã là thứ tự cuối
        )

    _save_matches(db, tid, raw)
    db.flush()
    _maybe_add_third_place(db, tid, t)
    _advance_byes_and_walkovers(db, tid)
    t.status = models.TournamentStatus.active


@app.post("/api/tournaments/{tid}/generate", response_model=schemas.TournamentOut)
def generate_tournament(
    tid: int,
    shuffle: bool = True,
    force: bool = False,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Sinh lịch đấu bảng (xóa lịch cũ nếu có). Với combined: chỉ sinh vòng bảng.
    force=true mới được sinh lại khi đã có trận có kết quả (xoá toàn bộ kết quả)."""
    perms.require_edit()
    t = db.query(models.Tournament).filter(models.Tournament.id == tid, models.Tournament.club_id == perms.club_id).first()
    if not t: raise HTTPException(404, "Không tìm thấy giải đấu")

    pid_list = [p.id for p in t.participants]
    if shuffle:
        import random
        random.shuffle(pid_list)

    _generate_from_order(db, t, pid_list, force)

    # Sinh lịch thủ công thì phiên bốc thăm đang dở không còn ý nghĩa → tự huỷ để không "mồ côi"
    now = _now_vn()
    for d in t.draws:
        if d.status == "open":
            d.status = "cancelled"
            d.cancel_reason = "Sinh lịch thủ công"
            d.cancelled_at = now
    db.commit(); db.refresh(t)
    return t


# ── BỐC THĂM BẰNG VÒNG QUAY (phương án C: phiên lưu DB, server random có seed, commit–reveal) ──

def _draw_out(draw: "models.TournamentDraw", t: "models.Tournament") -> dict:
    """Dựng DrawOut dùng chung cho admin & public — chỉ chứa participant_id, không PII.
    seed_hex chỉ lộ khi phiên đã kết thúc (commit–reveal): khi đang mở chỉ có seed_commit."""
    return {
        "id": draw.id,
        "tournament_id": draw.tournament_id,
        "seq": draw.seq,
        "status": draw.status,
        "format": t.format.value,
        "num_groups": t.num_groups,
        "total_steps": draw.total_steps,
        "done_steps": len(draw.steps),
        "reveal_ms": draw.reveal_ms,
        "force": bool(draw.force),
        "pool": list(draw.pool_json or []),
        "seed_commit": draw.seed_commit,
        "seed_hex": draw.seed_hex if draw.status != "open" else None,
        "steps": [
            {
                "step_index": st.step_index, "participant_id": st.participant_id,
                "slot_label": st.slot_label, "pick_index": st.pick_index,
                "spun_at": st.spun_at, "spun_at_ms": st.spun_at_ms,
            }
            for st in draw.steps
        ],
        "created_by": draw.created_by,
        "created_at": draw.created_at,
        "committed_at": draw.committed_at,
        "cancelled_at": draw.cancelled_at,
        "cancel_reason": draw.cancel_reason,
        "server_now_ms": int(time.time() * 1000),
    }


def _latest_draw(t: "models.Tournament"):
    return t.draw


def _get_club_tournament(db: Session, tid: int, perms: ClubPermissions) -> "models.Tournament":
    t = db.query(models.Tournament).filter(models.Tournament.id == tid, models.Tournament.club_id == perms.club_id).first()
    if not t: raise HTTPException(404, "Không tìm thấy giải đấu")
    return t


@app.get("/api/tournaments/{tid}/draw", response_model=schemas.DrawOut)
def get_draw(
    tid: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Phiên bốc thăm mới nhất (mọi trạng thái) — 404 nếu giải chưa bốc lần nào."""
    perms.require_view()
    t = _get_club_tournament(db, tid, perms)
    draw = _latest_draw(t)
    if draw is None:
        raise HTTPException(404, "Giải đấu chưa có phiên bốc thăm nào")
    return _draw_out(draw, t)


@app.get("/api/tournaments/{tid}/draws", response_model=List[schemas.DrawOut])
def list_draws(
    tid: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Lịch sử mọi phiên bốc thăm, seq giảm dần (mới nhất trước)."""
    perms.require_view()
    t = _get_club_tournament(db, tid, perms)
    return [_draw_out(d, t) for d in sorted(t.draws, key=lambda d: d.seq, reverse=True)]


@app.post("/api/tournaments/{tid}/draw", response_model=schemas.DrawOut, status_code=201)
def open_draw(
    tid: int,
    data: schemas.DrawOpenIn,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Mở phiên bốc thăm mới: sinh seed bí mật, công bố seed_commit = sha256(seed) ngay để khán giả
    kiểm chứng sau khi kết thúc. Pool gồm MỌI participant (kể cả đã bỏ giải — giống generate)."""
    perms.require_edit()
    t = _get_club_tournament(db, tid, perms)
    if t.status == models.TournamentStatus.draft:
        raise HTTPException(400, "Bấm 'Bắt đầu giải' để khoá danh sách trước khi bốc thăm")
    if t.status == models.TournamentStatus.completed:
        raise HTTPException(400, "Giải đấu đã kết thúc")
    if t.format.value not in DRAW_SUPPORTED_FORMATS:
        raise HTTPException(400, "Thể thức này không hỗ trợ bốc thăm bằng vòng quay")
    if t.pairing_mode == "cross_rank" and t.rank_rules:
        raise HTTPException(400, "Ghép chéo hạng chưa hỗ trợ bốc thăm")
    if any(d.status == "open" for d in t.draws):
        raise HTTPException(409, "Đang có phiên bốc thăm chưa kết thúc")
    participants = _check_generate_preconditions(db, t, data.force)

    seed_hex = secrets.token_hex(16)
    pool = sorted(p.id for p in participants)
    membership = perms.membership
    user = getattr(membership, "user", None)
    if user is None:
        user = db.query(models.User).filter(models.User.id == membership.user_id).first()
    draw = models.TournamentDraw(
        tournament_id=t.id,
        seq=(max((d.seq for d in t.draws), default=0) + 1),
        status="open",
        seed_hex=seed_hex,
        seed_commit=hashlib.sha256(seed_hex.encode()).hexdigest(),
        pool_json=pool,
        total_steps=len(pool),
        reveal_ms=data.reveal_ms,
        force=bool(data.force),
        created_by=user.username if user is not None else None,
        created_at=_now_vn(),
    )
    db.add(draw)
    try:
        db.commit()
    except IntegrityError:
        # 2 request mở phiên gần như đồng thời (bấm đúp / 2 tab) cùng qua check "đang open" ở trên
        # → UNIQUE(tournament_id, seq) chặn bản thứ hai; trả 409 để UI nạp phiên đã có thay vì 500.
        db.rollback()
        raise HTTPException(409, "Đang có phiên bốc thăm chưa kết thúc")
    db.refresh(draw); db.refresh(t)
    return _draw_out(draw, t)


@app.post("/api/tournaments/{tid}/draw/spin", response_model=schemas.DrawOut)
def spin_draw(
    tid: int,
    data: schemas.DrawSpinIn,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Quay một lượt: kết quả tất định từ seed (SHA256("{seed}:{k}") mod số đội còn lại) nên
    server không thể "chọn" kết quả sau khi đã công bố seed_commit. expected_step chống bấm trùng."""
    perms.require_edit()
    t = _get_club_tournament(db, tid, perms)
    draw = _latest_draw(t)
    if draw is None or draw.status != "open":
        raise HTTPException(409, "Không có phiên bốc thăm đang mở")
    done = len(draw.steps)
    if data.expected_step != done:
        raise HTTPException(409, "Lượt bốc không khớp — tải lại phiên")
    if done >= draw.total_steps:
        raise HTTPException(409, "Đã bốc đủ lượt — bấm 'Chốt & sinh lịch'")

    picked = {st.participant_id for st in draw.steps}
    remaining = [pid for pid in draw.pool_json if pid not in picked]
    idx = draw_pick_index(draw.seed_hex, done, len(remaining))
    step = models.TournamentDrawStep(
        draw_id=draw.id,
        step_index=done,
        participant_id=remaining[idx],
        slot_label=draw_slot_label(t.format.value, done, draw.total_steps, t.num_groups),
        pick_index=idx,
        spun_at=_now_vn(),
        spun_at_ms=int(time.time() * 1000),
    )
    db.add(step)
    try:
        db.commit()
    except IntegrityError:
        # 2 request cùng lượt chen nhau → unique (draw_id, step_index) chặn lượt thứ hai
        db.rollback()
        raise HTTPException(409, "Lượt này đã được quay (bấm trùng)")
    db.refresh(draw); db.refresh(t)
    return _draw_out(draw, t)


@app.post("/api/tournaments/{tid}/draw/commit", response_model=schemas.TournamentOut)
def commit_draw(
    tid: int,
    data: schemas.DrawCommitIn,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Chốt phiên: đổ thứ tự bốc vào hàm sinh lịch hiện có. Sau chốt seed_hex được công khai."""
    perms.require_edit()
    t = _get_club_tournament(db, tid, perms)
    draw = _latest_draw(t)
    if draw is None or draw.status != "open":
        raise HTTPException(409, "Không có phiên bốc thăm đang mở")
    steps = sorted(draw.steps, key=lambda st: st.step_index)
    if len(steps) != draw.total_steps:
        raise HTTPException(409, f"Chưa bốc đủ ({len(steps)}/{draw.total_steps} lượt)")
    if {st.participant_id for st in steps} != {p.id for p in t.participants}:
        raise HTTPException(409, "Danh sách đội đã thay đổi trong lúc bốc — huỷ phiên và bốc lại")

    picks = [st.participant_id for st in steps]
    pid_list = draw_picks_to_pid_list(t.format.value, picks, t.num_groups)
    # 400 "đã có điểm" (kết quả mới nhập sau khi mở phiên) → propagate nguyên vẹn để UI hỏi lại với force
    _generate_from_order(db, t, pid_list, force=bool(data.force or draw.force))

    now = _now_vn()
    for d in t.draws:
        if d.status == "committed" and d.id != draw.id:
            d.status = "superseded"
    draw.status = "committed"
    draw.committed_at = now
    db.commit(); db.refresh(t)
    return t


@app.post("/api/tournaments/{tid}/draw/cancel", response_model=schemas.DrawOut)
def cancel_draw(
    tid: int,
    data: schemas.DrawCancelIn,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Huỷ phiên đang mở (không có undo từng lượt — chỉ huỷ cả phiên rồi mở phiên mới).
    Phiên huỷ vẫn giữ trong lịch sử kèm seed để minh bạch."""
    perms.require_edit()
    t = _get_club_tournament(db, tid, perms)
    draw = _latest_draw(t)
    if draw is None or draw.status != "open":
        raise HTTPException(409, "Không có phiên bốc thăm đang mở")
    draw.status = "cancelled"
    draw.cancelled_at = _now_vn()
    draw.cancel_reason = data.reason
    db.commit(); db.refresh(draw); db.refresh(t)
    return _draw_out(draw, t)


# ── GHÉP ĐỘI ĐÔI BẰNG VÒNG QUAY (partner draw): bảng riêng, seed commit–reveal, chốt → gộp participant ──

def _partner_people(draw: "models.TournamentPartnerDraw") -> list:
    """Pool đã snapshot lúc mở phiên, dạng [{"pid","rank",...}] cho engine."""
    return list(draw.pool_json or [])


def _partner_step_dicts(steps) -> list:
    """Các lượt đã quay → dict cho engine replay (partner_step_context v2 cần side/phase_index/team_index)."""
    return [
        {"step_index": st.step_index, "pid": st.pid, "side": st.side,
         "phase_index": st.phase_index, "team_index": st.team_index}
        for st in sorted(steps, key=lambda s: s.step_index)
    ]


def _partner_draw_out(draw: "models.TournamentPartnerDraw", t: "models.Tournament") -> dict:
    """Dựng PartnerDrawOut dùng chung admin & public. seed_hex chỉ lộ khi phiên đã kết thúc.
    next_step = ngữ cảnh lượt kế tiếp (chỉ khi open và chưa hết lượt) để UI biết ô nào/ai đủ điều kiện.
    finished = không còn cặp hợp lệ (replay → None). stuck = lượt cuối là bên 1 mà bên 2 không còn ai
    (dữ liệu hỏng / phiên engine cũ): không quay tiếp lẫn chốt được → UI gợi ý huỷ phiên và mở lại."""
    steps = sorted(draw.steps, key=lambda st: st.step_index)
    done = len(steps)
    rules = normalize_partner_rules(draw.rules_json or [])   # phiên cũ lưu shape rank1/rank2 → luôn trả v2
    step_dicts = _partner_step_dicts(steps)
    people = _partner_people(draw)
    ctx = partner_step_context(people, rules, step_dicts)
    finished = ctx is None
    stuck = ctx is not None and not ctx["eligible_pids"]
    next_step = ctx if (draw.status == "open" and ctx is not None and not stuck) else None
    return {
        "id": draw.id,
        "tournament_id": draw.tournament_id,
        "seq": draw.seq,
        "status": draw.status,
        "total_steps": draw.total_steps,
        "done_steps": done,
        "finished": finished,
        "stuck": stuck,
        "reveal_ms": draw.reveal_ms,
        "pool": list(draw.pool_json or []),
        "rules": rules,
        "plan": _normalize_partner_plan(draw.plan_json or {}),   # phiên cũ lưu plan shape cũ → luôn trả v2
        "next_step": next_step,
        "steps": [
            {
                "step_index": st.step_index, "team_index": st.team_index, "side": st.side,
                "phase_index": st.phase_index, "pid": st.pid,
                "member_id": st.member_id, "player_id": st.player_id,
                "pick_index": st.pick_index, "auto": bool(st.auto),
                "eligible_pids": list(st.eligible_pids_json or []),
                "spun_at": st.spun_at, "spun_at_ms": st.spun_at_ms,
            }
            for st in steps
        ],
        "seed_commit": draw.seed_commit,
        "seed_hex": draw.seed_hex if draw.status != "open" else None,
        "created_by": draw.created_by,
        "created_at": draw.created_at,
        "committed_at": draw.committed_at,
        "cancelled_at": draw.cancelled_at,
        "cancel_reason": draw.cancel_reason,
        "server_now_ms": int(time.time() * 1000),
    }


@app.get("/api/tournaments/{tid}/partner-draw", response_model=schemas.PartnerDrawOut)
def get_partner_draw(
    tid: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Phiên ghép đội mới nhất (mọi trạng thái) — 404 nếu giải chưa ghép lần nào."""
    perms.require_view()
    t = _get_club_tournament(db, tid, perms)
    pd = t.partner_draw
    if pd is None:
        raise HTTPException(404, "Giải đấu chưa có phiên ghép đội nào")
    return _partner_draw_out(pd, t)


@app.get("/api/tournaments/{tid}/partner-draws", response_model=List[schemas.PartnerDrawOut])
def list_partner_draws(
    tid: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Lịch sử mọi phiên ghép đội, seq giảm dần."""
    perms.require_view()
    t = _get_club_tournament(db, tid, perms)
    return [_partner_draw_out(d, t) for d in sorted(t.partner_draws, key=lambda d: d.seq, reverse=True)]


@app.post("/api/tournaments/{tid}/partner-draw", response_model=schemas.PartnerDrawOut, status_code=201)
def open_partner_draw(
    tid: int,
    data: schemas.PartnerDrawOpenIn,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Mở phiên ghép đội: snapshot pool người đơn lẻ (kèm hạng đã normalize; khách mời chung pool),
    lập kế hoạch theo quy tắc hạng, sinh seed bí mật và công bố seed_commit."""
    perms.require_edit()
    t = _get_club_tournament(db, tid, perms)
    if t.status != models.TournamentStatus.draft:
        raise HTTPException(400, "Ghép đội bằng vòng quay chỉ thực hiện khi giải ở trạng thái Nháp")
    if t.team_type != "doubles":
        raise HTTPException(400, "Chỉ áp dụng cho giải đấu đôi")
    if _open_partner_draw(t) is not None:
        raise HTTPException(409, "Đang có phiên ghép đội chưa kết thúc")
    singles = sorted(_single_participants(t), key=lambda p: p.id)
    if len(singles) < 2:
        raise HTTPException(400, "Cần ít nhất 2 người chưa có đội")

    # Quy tắc v2: mỗi bên là DANH SÁCH hạng (rỗng = bất kỳ hạng); shape cũ rank1/rank2 được chuyển đổi
    rules = normalize_partner_rules([r.model_dump() for r in data.rules] if data.rules is not None else t.partner_rules)
    t.partner_rules = rules   # lưu lại (shape v2) để lần mở sau / UI hiển thị

    people = [
        {
            "pid": p.id, "member_id": p.member_id, "player_id": p.player_id,
            "name": p.team_name or _resolve_display_name(db, p.member_id, p.player_id),
            "rank": normalize_rank(_participant_rank(p)),
        }
        for p in singles
    ]
    plan = partner_draw_plan([{"pid": x["pid"], "rank": x["rank"]} for x in people], rules)
    if plan["total_steps_max"] == 0:
        db.rollback()
        raise HTTPException(400, "Không có quy tắc nào ghép được đội với danh sách hiện tại")

    seed_hex = secrets.token_hex(16)
    membership = perms.membership
    user = getattr(membership, "user", None)
    if user is None:
        user = db.query(models.User).filter(models.User.id == membership.user_id).first()
    pd = models.TournamentPartnerDraw(
        tournament_id=t.id,
        seq=(max((d.seq for d in t.partner_draws), default=0) + 1),
        status="open",
        seed_hex=seed_hex,
        seed_commit=hashlib.sha256(seed_hex.encode()).hexdigest(),
        pool_json=people,
        rules_json=rules,
        plan_json=plan,
        total_steps=plan["total_steps_max"],   # TRẦN THẬT số lượt (cận trên; số lượt thực tế có thể ít hơn — xem plan.total_steps_est)
        reveal_ms=data.reveal_ms,
        created_by=user.username if user is not None else None,
        created_at=_now_vn(),
    )
    db.add(pd)
    try:
        db.commit()
    except IntegrityError:
        # 2 request mở gần như đồng thời cùng qua check "đang open" → UNIQUE(tournament_id, seq) chặn bản 2
        db.rollback()
        raise HTTPException(409, "Đang có phiên ghép đội chưa kết thúc")
    db.refresh(pd); db.refresh(t)
    return _partner_draw_out(pd, t)


@app.post("/api/tournaments/{tid}/partner-draw/spin", response_model=schemas.PartnerDrawOut)
def spin_partner_draw(
    tid: int,
    data: schemas.PartnerDrawSpinIn,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Quay một lượt: idx = SHA256("{seed}:{k}") mod (số người đủ điều kiện ở lượt k).
    Đủ điều kiện (replay v2): chưa được chọn, hạng ∈ danh sách của bên (rỗng = bất kỳ); lượt bên 1 loại
    những người mà nếu chọn thì bên 2 không còn ai; quy tắc dừng khi không còn cặp hợp lệ."""
    perms.require_edit()
    t = _get_club_tournament(db, tid, perms)
    pd = t.partner_draw
    if pd is None or pd.status != "open":
        raise HTTPException(409, "Không có phiên ghép đội đang mở")
    steps = _partner_step_dicts(pd.steps)
    done = len(steps)
    people = _partner_people(pd)
    rules = normalize_partner_rules(pd.rules_json or [])
    ctx = partner_step_context(people, rules, steps)
    # Kết thúc = hết cặp hợp lệ (không so với trần total_steps: plan v2 là cận trên thật nên không thể vượt)
    if ctx is None:
        raise HTTPException(409, "Đã hết lượt hợp lệ — bấm 'Chốt & tạo đội'")
    if data.expected_step != done:
        raise HTTPException(409, "Lượt bốc không khớp — tải lại phiên")

    eligible = ctx["eligible_pids"]
    if not eligible:
        raise HTTPException(409, "Phiên bị kẹt — bên 2 không còn ai đủ điều kiện; huỷ phiên và mở lại")
    idx = draw_pick_index(pd.seed_hex, done, len(eligible))
    pid = eligible[idx]
    person = next((x for x in people if x["pid"] == pid), {})
    step = models.TournamentPartnerDrawStep(
        draw_id=pd.id,
        step_index=done,
        team_index=ctx["team_index"],
        side=ctx["side"],
        phase_index=ctx["phase_index"],
        pid=pid,
        member_id=person.get("member_id"),
        player_id=person.get("player_id"),
        pick_index=idx,
        auto=(len(eligible) == 1),
        eligible_pids_json=list(eligible),
        spun_at=_now_vn(),
        spun_at_ms=int(time.time() * 1000),
    )
    db.add(step)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Lượt này đã được quay (bấm trùng)")
    db.refresh(pd); db.refresh(t)
    return _partner_draw_out(pd, t)


@app.post("/api/tournaments/{tid}/partner-draw/commit", response_model=schemas.TournamentOut)
def commit_partner_draw(
    tid: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Chốt phiên: gộp từng cặp (người 1 + người 2) thành 1 participant đội. Người không có lượt
    (dư / không khớp quy tắc) giữ nguyên đơn lẻ để ghép tay. Sau chốt seed_hex được công khai."""
    perms.require_edit()
    t = _get_club_tournament(db, tid, perms)
    pd = t.partner_draw
    if pd is None or pd.status != "open":
        raise HTTPException(409, "Không có phiên ghép đội đang mở")
    steps = sorted(pd.steps, key=lambda st: st.step_index)
    # Điều kiện chốt v2: đã có lượt, lượt cuối là bên 2 (không có đội dở dang) và không còn cặp hợp lệ.
    # Số lượt thực tế có thể ÍT hơn trần total_steps khi hai bên trùng hạng (trần chỉ là cận trên).
    step_dicts = _partner_step_dicts(steps)
    rules = normalize_partner_rules(pd.rules_json or [])
    if partner_draw_stuck(_partner_people(pd), rules, step_dicts):
        raise HTTPException(409, "Phiên bị kẹt — bên 2 không còn ai đủ điều kiện; huỷ phiên và mở lại")
    finished = partner_draw_finished(_partner_people(pd), rules, step_dicts)
    if not steps or steps[-1].side != 2 or not finished:
        raise HTTPException(409, "Chưa hết lượt — còn người đủ điều kiện để quay")
    if t.status != models.TournamentStatus.draft:
        raise HTTPException(400, "Ghép đội bằng vòng quay chỉ thực hiện khi giải ở trạng thái Nháp")
    singles_by_id = {p.id: p for p in _single_participants(t)}
    # So cả NGƯỜI (member/player) chứ không chỉ pid: pool là snapshot lúc mở phiên, khán giả đã xem theo đó
    for x in (pd.pool_json or []):
        p = singles_by_id.get(x["pid"])
        if p is None or p.member_id != x.get("member_id") or p.player_id != x.get("player_id"):
            raise HTTPException(409, "Danh sách người đã thay đổi trong lúc ghép — huỷ phiên và mở lại")

    teams: dict = {}
    for st in steps:
        teams.setdefault(st.team_index, {})[st.side] = st.pid
    for team_index in sorted(teams):
        sides = teams[team_index]
        if 1 not in sides or 2 not in sides:
            raise HTTPException(409, "Kế hoạch ghép đội không hợp lệ")
        _merge_pair(db, t, singles_by_id[sides[1]], singles_by_id[sides[2]])

    now = _now_vn()
    for d in t.partner_draws:
        if d.status == "committed" and d.id != pd.id:
            d.status = "superseded"
    pd.status = "committed"
    pd.committed_at = now
    db.commit(); db.refresh(t)
    return t


@app.post("/api/tournaments/{tid}/partner-draw/cancel", response_model=schemas.PartnerDrawOut)
def cancel_partner_draw(
    tid: int,
    data: schemas.PartnerDrawCancelIn,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Huỷ phiên đang mở (không undo từng lượt). Phiên huỷ vẫn giữ trong lịch sử kèm seed."""
    perms.require_edit()
    t = _get_club_tournament(db, tid, perms)
    pd = t.partner_draw
    if pd is None or pd.status != "open":
        raise HTTPException(409, "Không có phiên ghép đội đang mở")
    pd.status = "cancelled"
    pd.cancelled_at = _now_vn()
    pd.cancel_reason = data.reason
    db.commit(); db.refresh(pd); db.refresh(t)
    return _partner_draw_out(pd, t)


@app.post("/api/tournaments/{tid}/participants/pair", response_model=schemas.TournamentOut)
def pair_participants(
    tid: int,
    data: schemas.PairParticipantsIn,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Ghép tay 2 người đơn lẻ thành 1 đội (cho người dư / không khớp quy tắc sau vòng quay)."""
    perms.require_edit()
    t = _get_club_tournament(db, tid, perms)
    if t.status != models.TournamentStatus.draft:
        raise HTTPException(400, "Chỉ ghép đội khi giải ở trạng thái Nháp")
    if t.team_type != "doubles":
        raise HTTPException(400, "Chỉ áp dụng cho giải đấu đôi")
    if _open_partner_draw(t) is not None:
        raise HTTPException(400, PARTNER_DRAW_OPEN_MSG)
    if data.p1_id == data.p2_id:
        raise HTTPException(400, "Không thể ghép một người với chính mình")
    by_id = {p.id: p for p in t.participants}
    a, b = by_id.get(data.p1_id), by_id.get(data.p2_id)
    if a is None or b is None:
        raise HTTPException(404, "Không tìm thấy người chơi trong giải")
    _merge_pair(db, t, a, b)
    db.commit(); db.refresh(t)
    return t


@app.post("/api/tournaments/{tid}/start-knockout", response_model=schemas.TournamentOut)
def start_knockout(
    tid: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Tính kết quả vòng bảng và sinh lịch knockout (combined format)."""
    perms.require_edit()
    t = db.query(models.Tournament).filter(models.Tournament.id == tid, models.Tournament.club_id == perms.club_id).first()
    if not t: raise HTTPException(404, "Không tìm thấy giải đấu")
    if t.format.value != "combined":
        raise HTTPException(400, "Chỉ áp dụng cho thể thức kết hợp")
    if t.status != models.TournamentStatus.active:
        raise HTTPException(400, "Giải đấu phải đang diễn ra để khởi động vòng loại trực tiếp")
    if db.query(models.TournamentMatch).filter(
        models.TournamentMatch.tournament_id == tid, models.TournamentMatch.phase == "knockout"
    ).count():
        raise HTTPException(400, "Vòng loại trực tiếp đã được khởi động rồi")
    group_total = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.tournament_id == tid, models.TournamentMatch.phase == "group"
    ).count()
    group_pending = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.tournament_id == tid, models.TournamentMatch.phase == "group",
        models.TournamentMatch.status != models.MatchStatus.completed,
    ).count()
    if group_total == 0:
        raise HTTPException(400, "Chưa sinh lịch vòng bảng")
    if group_pending:
        raise HTTPException(400, f"Còn {group_pending} trận vòng bảng chưa có kết quả")

    # Tính standings từng bảng
    participants = t.participants
    group_names = sorted(set(p.group_name for p in participants if p.group_name))
    group_standings: dict = {}
    for gname in group_names:
        gparticipants = [p for p in participants if p.group_name == gname]
        gmatches = db.query(models.TournamentMatch).filter(
            models.TournamentMatch.tournament_id == tid,
            models.TournamentMatch.phase == "group",
            models.TournamentMatch.group_name == gname,
        ).all()
        p_dicts = [{
            "id": p.id, "member_id": p.member_id,
            "full_name": p.member.full_name if p.member else "",
            "team_name": p.team_name or (p.member.full_name if p.member else ""),
            "group_name": p.group_name,
        } for p in gparticipants]
        m_dicts = [{
            "p1_id": m.p1_id, "p2_id": m.p2_id,
            "score1": m.score1, "score2": m.score2, "status": m.status,
            "winner_id": m.winner_id, "is_walkover": m.is_walkover,
        } for m in gmatches]
        group_standings[gname] = compute_standings(m_dicts, p_dicts, group=None)

    # Số trận đã có
    existing_count = db.query(func.count(models.TournamentMatch.id)).filter(
        models.TournamentMatch.tournament_id == tid
    ).scalar() or 0

    raw_ko = generate_knockout_from_groups(group_standings, existing_count)

    # Điều chỉnh index offset vì _next_match_idx tính từ 0 trong raw_ko
    saved_ko = []
    for m in raw_ko:
        match = models.TournamentMatch(
            tournament_id=tid,
            round_number=m["round_number"], round_name=m.get("round_name"),
            match_number=m["match_number"], phase="knockout",
            group_name=None,
            p1_id=m.get("p1_id"), p2_id=m.get("p2_id"),
        )
        db.add(match); db.flush()
        saved_ko.append((match, m))

    for i, (match, m) in enumerate(saved_ko):
        idx = m.get("_next_match_idx")
        slot = m.get("_next_slot")
        if idx is not None and 0 <= idx < len(saved_ko):
            match.next_match_id = saved_ko[idx][0].id
            match.next_match_slot = slot

    db.flush()
    _maybe_add_third_place(db, tid, t)
    _advance_byes_and_walkovers(db, tid)
    db.commit(); db.refresh(t)
    return t


def _reset_downstream(db: Session, match: models.TournamentMatch) -> None:
    """Kết quả của `match` thay đổi → rút đội thắng cũ khỏi trận sau (và đội thua cũ khỏi
    trận tranh giải 3 nếu có); nếu trận sau đã có kết quả thì xoá kết quả đó và lan tiếp
    (đệ quy) để bracket luôn nhất quán."""
    if match.next_match_id:
        nxt = db.get(models.TournamentMatch, match.next_match_id)
        if nxt is not None:
            if match.next_match_slot == 1:
                nxt.p1_id = None
            else:
                nxt.p2_id = None
            if nxt.status == models.MatchStatus.completed or nxt.score1 is not None:
                nxt.score1 = nxt.score2 = None
                nxt.winner_id = None
                nxt.status = models.MatchStatus.pending
                nxt.is_walkover = False
                _reset_downstream(db, nxt)
    if match.loser_next_match_id:
        lm = db.get(models.TournamentMatch, match.loser_next_match_id)
        if lm is not None:
            if match.loser_next_match_slot == 1:
                lm.p1_id = None
            else:
                lm.p2_id = None
            if lm.status == models.MatchStatus.completed or lm.score1 is not None:
                lm.score1 = lm.score2 = None
                lm.winner_id = None
                lm.status = models.MatchStatus.pending
                lm.is_walkover = False
                # Trận tranh giải 3 là chặng cuối (không có next/loser tiếp theo) — không cần đệ quy


def _check_scorable(t: models.Tournament, match: models.TournamentMatch, score1: int, score2: int) -> None:
    """Điều kiện chung cho nhập điểm (admin + public)."""
    if t.status != models.TournamentStatus.active:
        raise HTTPException(400, "Chỉ nhập điểm khi giải đấu đang diễn ra")
    if match.p1_id is None or match.p2_id is None:
        raise HTTPException(400, "Trận đấu chưa đủ 2 đội (đang chờ kết quả vòng trước)")
    if match.phase == "knockout" and score1 == score2:
        raise HTTPException(400, "Trận loại trực tiếp không được hoà")


def _apply_match_score(db: Session, match: models.TournamentMatch, score1: int, score2: int):
    if match.status == models.MatchStatus.completed or match.score1 is not None:
        _reset_downstream(db, match)   # sửa kết quả → dọn nhánh sau trước
    match.score1 = score1
    match.score2 = score2
    match.status = models.MatchStatus.completed
    match.is_walkover = False  # nhập tay có tỉ số thật — không còn là walkover

    # Xác định winner
    if score1 > score2:
        match.winner_id = match.p1_id
    elif score2 > score1:
        match.winner_id = match.p2_id
    else:
        match.winner_id = None  # hòa — knockout sẽ cần xử lý thủ công

    # Đưa winner vào trận tiếp theo (knockout)
    if match.winner_id and match.next_match_id:
        next_m = db.query(models.TournamentMatch).filter(
            models.TournamentMatch.id == match.next_match_id
        ).first()
        if next_m:
            if match.next_match_slot == 1:
                next_m.p1_id = match.winner_id
            else:
                next_m.p2_id = match.winner_id

    # Đưa người thua vào trận tranh giải 3 (chỉ set trên 2 trận bán kết khi bật tính năng)
    if match.winner_id and match.loser_next_match_id:
        loser_id = match.p2_id if match.winner_id == match.p1_id else match.p1_id
        loser_m = db.query(models.TournamentMatch).filter(
            models.TournamentMatch.id == match.loser_next_match_id
        ).first()
        if loser_m:
            if match.loser_next_match_slot == 1:
                loser_m.p1_id = loser_id
            else:
                loser_m.p2_id = loser_id


@app.post("/api/tournaments/{tid}/matches/{mid}/score", response_model=schemas.MatchOut)
def update_score(
    tid: int,
    mid: int,
    data: schemas.ScoreUpdate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_edit()
    t = db.query(models.Tournament).filter(models.Tournament.id == tid, models.Tournament.club_id == perms.club_id).first()
    if not t: raise HTTPException(404, "Không tìm thấy giải đấu")
    match = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.id == mid,
        models.TournamentMatch.tournament_id == tid
    ).first()
    if not match: raise HTTPException(404, "Không tìm thấy trận đấu")

    _check_scorable(t, match, data.score1, data.score2)
    _apply_match_score(db, match, data.score1, data.score2)
    db.flush()
    # Người thắng vừa được đưa vào vòng sau — nếu đối thủ ở đó đã bỏ giải từ trước, xử
    # thắng ngay thay vì để trận đó treo chờ (bỏ giải xảy ra trước khi trận này có kết quả).
    _advance_byes_and_walkovers(db, tid)
    db.commit(); db.refresh(match)
    return match


def _resolve_display_name(db, member_id=None, player_id=None) -> str:
    if member_id:
        return db.query(models.Member.full_name).filter(models.Member.id == member_id).scalar() or ""
    if player_id:
        return db.query(models.Player.name).filter(models.Player.id == player_id).scalar() or ""
    return ""


@app.patch("/api/tournaments/{tid}/participants/{pid}", response_model=schemas.ParticipantOut)
def replace_participant_slot(
    tid: int, pid: int,
    data: schemas.ParticipantSlotUpdate,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Thay người chơi ở 1 vị trí (main hoặc partner) trong 1 đội — dùng khi có
    người không thể tiếp tục thi đấu giữa giải. Giữ nguyên lịch sử các trận đã đấu
    (điểm/thắng-thua vẫn gắn với participant_id, chỉ đổi tên người ở vị trí đó)."""
    perms.require_edit()
    t = db.query(models.Tournament).filter(models.Tournament.id == tid, models.Tournament.club_id == perms.club_id).first()
    if not t: raise HTTPException(404, "Không tìm thấy giải đấu")
    # Pool của phiên ghép đội là snapshot (pid + member/player + tên + hạng): đổi người khi phiên đang mở
    # sẽ làm khán giả thấy một đằng, đội thật tạo ra một nẻo. Chỉ áp cho Nháp để không ảnh hưởng thay người giữa giải.
    if t.status == models.TournamentStatus.draft and _open_partner_draw(t) is not None:
        raise HTTPException(400, PARTNER_DRAW_OPEN_MSG)
    p = db.query(models.TournamentParticipant).filter(
        models.TournamentParticipant.id == pid, models.TournamentParticipant.tournament_id == tid,
    ).first()
    if not p: raise HTTPException(404, "Không tìm thấy đội/người chơi")
    if data.slot not in ("main", "partner"):
        raise HTTPException(400, "slot phải là 'main' hoặc 'partner'")
    if not data.member_id and not data.player_id:
        raise HTTPException(400, "Cần chọn thành viên hoặc khách mời để thay")
    if data.member_id and data.player_id:
        raise HTTPException(400, "Chỉ chọn 1 trong 2: thành viên hoặc khách mời")
    _check_people_in_club(db, perms.club_id, data.member_id, data.player_id)

    # Không cho trùng người đã có mặt ở vị trí khác trong cùng giải
    others = db.query(models.TournamentParticipant).filter(
        models.TournamentParticipant.tournament_id == tid,
        models.TournamentParticipant.id != pid,
    ).all()
    for o in others:
        for mid, plid in [(o.member_id, o.player_id), (o.partner_member_id, o.partner_player_id)]:
            if data.member_id and mid == data.member_id:
                raise HTTPException(400, "Thành viên này đã tham gia giải ở một đội khác")
            if data.player_id and plid == data.player_id:
                raise HTTPException(400, "Khách mời này đã tham gia giải ở một đội khác")
    same_team_other = (p.partner_member_id, p.partner_player_id) if data.slot == "main" else (p.member_id, p.player_id)
    if data.member_id and same_team_other[0] == data.member_id:
        raise HTTPException(400, "Không thể chọn trùng người còn lại trong cùng đội")
    if data.player_id and same_team_other[1] == data.player_id:
        raise HTTPException(400, "Không thể chọn trùng người còn lại trong cùng đội")

    if data.slot == "main":
        p.member_id, p.player_id = data.member_id, data.player_id
    else:
        p.partner_member_id, p.partner_player_id = data.member_id, data.player_id

    if data.team_name:
        p.team_name = data.team_name
    else:
        n1 = _resolve_display_name(db, p.member_id, p.player_id)
        n2 = _resolve_display_name(db, p.partner_member_id, p.partner_player_id)
        p.team_name = f"{n1} / {n2}" if n1 and n2 else (n1 or n2)

    db.commit(); db.refresh(p)
    return p


@app.post("/api/tournaments/{tid}/participants/{pid}/withdraw", response_model=schemas.TournamentOut)
def withdraw_participant(
    tid: int, pid: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Đánh dấu 1 đội bỏ giải giữa chừng (không đến thi đấu tiếp) — KHÔNG xoá, giữ nguyên
    lịch sử các trận đã đấu. Các trận CHƯA đấu còn lại của đội này: đối thủ được xử thắng
    (walkover) — tính thắng/thua/điểm xếp hạng như thắng thật, KHÔNG cộng vào hiệu số bàn
    thắng/bàn thua (đã thống nhất với người dùng 2026-09-18). Không thể hoàn tác."""
    perms.require_edit()
    t = db.query(models.Tournament).filter(models.Tournament.id == tid, models.Tournament.club_id == perms.club_id).first()
    if not t: raise HTTPException(404, "Không tìm thấy giải đấu")
    if t.status != models.TournamentStatus.active:
        raise HTTPException(400, "Chỉ có thể xử bỏ giải khi giải đấu đang diễn ra")
    p = db.query(models.TournamentParticipant).filter(
        models.TournamentParticipant.id == pid, models.TournamentParticipant.tournament_id == tid,
    ).first()
    if not p: raise HTTPException(404, "Không tìm thấy đội/người chơi")
    if p.status == models.ParticipantStatus.withdrawn:
        raise HTTPException(400, "Đội này đã được đánh dấu bỏ giải rồi")

    p.status = models.ParticipantStatus.withdrawn
    db.flush()
    _resolve_group_walkovers(db, tid)
    _advance_byes_and_walkovers(db, tid)

    db.commit(); db.refresh(t)
    return t


@app.get("/api/tournaments/{tid}/standings")
def get_standings(
    tid: int,
    group: Optional[str] = None,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_view()
    t = db.query(models.Tournament).filter(models.Tournament.id == tid, models.Tournament.club_id == perms.club_id).first()
    if not t: raise HTTPException(404, "Không tìm thấy giải đấu")

    matches_q = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.tournament_id == tid,
        models.TournamentMatch.phase == "group",
    )
    if group:
        matches_q = matches_q.filter(models.TournamentMatch.group_name == group)
    matches = matches_q.all()

    participants = t.participants
    if group:
        participants = [p for p in participants if p.group_name == group]

    p_dicts = [{
        "id": p.id, "member_id": p.member_id,
        "full_name": p.member.full_name if p.member else "",
        "team_name": p.team_name or (p.member.full_name if p.member else ""),
        "group_name": p.group_name,
    } for p in participants]

    m_dicts = [{
        "p1_id": m.p1_id, "p2_id": m.p2_id,
        "score1": m.score1, "score2": m.score2, "status": m.status,
        "winner_id": m.winner_id, "is_walkover": m.is_walkover,
    } for m in matches]

    return compute_standings(m_dicts, p_dicts, group=group)


# ── BOT CONFIG ────────────────────────────────────────────
def _require_superuser_club_id(
    x_club_id: Optional[int] = Header(default=None, alias="X-Club-ID"),
    current_user: models.User = Depends(get_current_user),
) -> int:
    """Chỉ superuser được ghi bot-config; club_id lấy từ header."""
    if not current_user.is_superuser:
        raise HTTPException(403, "Chỉ Quản trị viên hệ thống mới được cấu hình Bot")
    if not x_club_id:
        raise HTTPException(400, "Thiếu header X-Club-ID")
    return x_club_id


@app.get("/api/bot-config")
def get_bot_config(
    x_club_id: Optional[int] = Header(default=None, alias="X-Club-ID"),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Đọc bot-config: superuser được đọc mọi CLB; thành viên thường đọc CLB của mình."""
    if not x_club_id:
        raise HTTPException(400, "Thiếu header X-Club-ID")
    if not current_user.is_superuser:
        membership = db.query(models.ClubMembership).filter(
            models.ClubMembership.user_id == current_user.id,
            models.ClubMembership.club_id == x_club_id,
        ).first()
        if not membership:
            raise HTTPException(403, "Không có quyền truy cập CLB này")
    rows = db.query(models.BotConfig).filter(models.BotConfig.club_id == x_club_id).all()
    return {r.key: r.value for r in rows}


@app.put("/api/bot-config")
def put_bot_config(
    body: dict,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    perms.require_edit()
    club_id = perms.club_id
    for key, value in body.items():
        row = db.query(models.BotConfig).filter(
            models.BotConfig.club_id == club_id,
            models.BotConfig.key == key,
        ).first()
        if row:
            row.value = str(value) if value is not None else None
        else:
            db.add(models.BotConfig(club_id=club_id, key=key, value=str(value) if value is not None else None))
    db.commit()
    rows = db.query(models.BotConfig).filter(models.BotConfig.club_id == club_id).all()
    return {r.key: r.value for r in rows}


# ── FEE REMINDER ENDPOINTS ───────────────────────────────

import os as _os
import urllib.request as _urllib_req
import urllib.parse as _urllib_parse
import json as _json
from calendar import monthrange as _monthrange

_INTERNAL_SECRET = _os.environ.get("INTERNAL_SECRET", "")


def _check_internal_secret(x_internal_secret: str = Header(None)):
    if not _INTERNAL_SECRET or x_internal_secret != _INTERNAL_SECRET:
        raise HTTPException(403, "Forbidden")


@app.patch("/api/my-memberships/telegram-chat-id")
def save_telegram_chat_id(
    body: dict,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Bot gọi endpoint này sau khi admin chọn CLB để lưu telegram_chat_id."""
    chat_id = body.get("chat_id")
    if not chat_id:
        raise HTTPException(400, "Thiếu chat_id")
    membership = db.query(models.ClubMembership).filter(
        models.ClubMembership.user_id == perms.membership.user_id,
        models.ClubMembership.club_id == perms.club_id,
    ).first()
    if not membership:
        raise HTTPException(404, "Không tìm thấy membership")
    if not membership.bot_enabled:
        # Chỉ bot gọi endpoint này — chặn ở đây để tài khoản bị tắt bot không liên kết được
        # Telegram (và do đó không lọt vào danh sách nhận nhắc phí)
        raise HTTPException(403, "Tài khoản chưa được cấp quyền dùng bot Telegram ở CLB này")
    membership.telegram_chat_id = int(chat_id)
    db.commit()
    return {"ok": True}


def _build_reminder_data(month: int, year: int, db: Session):
    """Trả về danh sách CLB → fee_types có remind_enabled + thành viên chưa đóng + chat_id admin."""
    fee_types = db.query(models.FeeType).filter(
        models.FeeType.remind_enabled == True,
        models.FeeType.type == models.FeeTypeCategory.income,
    ).all()

    result = []
    for ft in fee_types:
        club_id = ft.club_id
        paid_ids = set(
            r[0] for r in db.query(models.Transaction.member_id).filter(
                models.Transaction.club_id == club_id,
                models.Transaction.fee_type_id == ft.id,
                extract("month", models.Transaction.transaction_date) == month,
                extract("year", models.Transaction.transaction_date) == year,
                models.Transaction.member_id.isnot(None),
            ).all()
        )
        unpaid_members = db.query(models.Member).filter(
            models.Member.club_id == club_id,
            models.Member.status == "active",
            models.Member.id.notin_(paid_ids),
        ).order_by(models.Member.full_name).all()

        # Khách mời đã đóng khoản này trong tháng (thông tin, không tính "chưa đóng")
        guests_paid = db.query(models.Player).join(
            models.Transaction, models.Transaction.player_id == models.Player.id
        ).filter(
            models.Transaction.club_id == club_id,
            models.Transaction.fee_type_id == ft.id,
            extract("month", models.Transaction.transaction_date) == month,
            extract("year", models.Transaction.transaction_date) == year,
        ).order_by(models.Player.name).all()

        admin_memberships = db.query(models.ClubMembership).filter(
            models.ClubMembership.club_id == club_id,
            models.ClubMembership.role == models.UserRole.admin,
            models.ClubMembership.telegram_chat_id.isnot(None),
            models.ClubMembership.bot_enabled.is_(True),  # tắt bot = không nhận nhắc phí
        ).all()
        chat_ids = [m.telegram_chat_id for m in admin_memberships]

        club = db.query(models.Club).filter(models.Club.id == club_id).first()
        result.append({
            "club_id": club_id,
            "club_name": club.name if club else str(club_id),
            "fee_type_id": ft.id,
            "fee_type_name": ft.name,
            "month": month,
            "year": year,
            "unpaid_count": len(unpaid_members),
            "unpaid_members": [{"id": m.id, "full_name": m.full_name, "phone": m.phone} for m in unpaid_members],
            "guest_paid_count": len(guests_paid),
            "guests_paid": [{"id": p.id, "full_name": p.name} for p in guests_paid],
            "admin_chat_ids": chat_ids,
        })
    return result


@app.get("/api/fee-reminders/preview")
def preview_fee_reminders_frontend(
    month: int,
    year: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Xem trước danh sách thành viên chưa đóng phí — admin CLB."""
    perms.require_view()
    data = _build_reminder_data(month, year, db)
    return [item for item in data if item["club_id"] == perms.club_id]


@app.post("/api/fee-reminders/send")
def send_fee_reminders_frontend(
    month: int,
    year: int,
    db: Session = Depends(get_db),
    perms: ClubPermissions = Depends(get_club_permission),
):
    """Gửi nhắc đóng phí thủ công — admin CLB."""
    perms.require_edit()
    bot_token = _os.environ.get("TELEGRAM_BOT_TOKEN") or _os.environ.get("BOT_TOKEN", "")
    if not bot_token:
        raise HTTPException(500, "BOT_TOKEN chưa được cấu hình")
    data = [item for item in _build_reminder_data(month, year, db) if item["club_id"] == perms.club_id]
    sent_count = 0
    errors = []
    for item in data:
        if not item["admin_chat_ids"]:
            continue
        for chat_id in item["admin_chat_ids"]:
            unpaid_count = item["unpaid_count"]
            guest_line = ""
            if item.get("guest_paid_count"):
                guest_names = ", ".join(g["full_name"] for g in item["guests_paid"])
                guest_line = f"\n\nKhách mời đã đóng ({item['guest_paid_count']} người): {guest_names}"
            if unpaid_count > 0:
                names = "\n".join(
                    f"  • {m['full_name']}" + (f" ({m['phone']})" if m.get("phone") else "")
                    for m in item["unpaid_members"]
                )
                text = (
                    f"🔔 *Nhắc đóng phí tháng {month}/{year}*\n"
                    f"CLB: {item['club_name']}\n"
                    f"Khoản: {item['fee_type_name']}\n\n"
                    f"Thành viên chưa đóng ({unpaid_count} người):\n{names}"
                    f"{guest_line}"
                )
            else:
                text = (
                    f"✅ *Phí tháng {month}/{year} — {item['fee_type_name']}*\n"
                    f"CLB: {item['club_name']}\n\n"
                    f"Tất cả thành viên đã đóng phí!"
                    f"{guest_line}"
                )
            try:
                payload = _json.dumps({"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}).encode()
                req = _urllib_req.Request(
                    f"https://api.telegram.org/bot{bot_token}/sendMessage",
                    data=payload,
                    headers={"Content-Type": "application/json"},
                )
                with _urllib_req.urlopen(req, timeout=10) as resp:
                    resp.read()
                sent_count += 1
            except Exception as exc:
                errors.append({"chat_id": chat_id, "error": str(exc)})
    return {"sent": sent_count, "errors": errors}


@app.get("/api/internal/fee-reminders")
def preview_fee_reminders(
    month: int,
    year: int,
    db: Session = Depends(get_db),
    _: None = Depends(_check_internal_secret),
):
    return _build_reminder_data(month, year, db)


@app.post("/api/internal/send-fee-reminder")
def send_fee_reminder(
    month: int,
    year: int,
    db: Session = Depends(get_db),
    _: None = Depends(_check_internal_secret),
):
    bot_token = _os.environ.get("TELEGRAM_BOT_TOKEN") or _os.environ.get("BOT_TOKEN", "")
    if not bot_token:
        raise HTTPException(500, "BOT_TOKEN chưa được cấu hình")

    data = _build_reminder_data(month, year, db)
    today = _now_vn().date()   # giờ VN, không phải UTC của máy chủ Fly
    sent_count = 0
    skipped_count = 0
    errors = []

    for item in data:
        if not item["admin_chat_ids"]:
            continue
        if item["unpaid_count"] == 0:
            continue

        for chat_id in item["admin_chat_ids"]:
            # Kiểm tra ĐÚNG chat_id này đã gửi hôm nay chưa (trước đây chỉ theo club/fee_type/ngày
            # nên admin thứ 2 trở đi của cùng CLB luôn bị coi là "đã gửi" ngay sau admin đầu tiên)
            existing = db.query(models.ReminderLog).filter(
                models.ReminderLog.club_id == item["club_id"],
                models.ReminderLog.fee_type_id == item["fee_type_id"],
                models.ReminderLog.month == month,
                models.ReminderLog.year == year,
                models.ReminderLog.send_date == today,
                models.ReminderLog.chat_id == chat_id,
            ).first()
            if existing:
                skipped_count += 1
                continue

            names = "\n".join(
                f"  • {m['full_name']}" + (f" ({m['phone']})" if m.get("phone") else "")
                for m in item["unpaid_members"]
            )
            guest_line = ""
            if item.get("guest_paid_count"):
                guest_names = ", ".join(g["full_name"] for g in item["guests_paid"])
                guest_line = f"\n\nKhách mời đã đóng ({item['guest_paid_count']} người): {guest_names}"
            text = (
                f"🔔 *Nhắc đóng phí tháng {month}/{year}*\n"
                f"CLB: {item['club_name']}\n"
                f"Khoản: {item['fee_type_name']}\n\n"
                f"Thành viên chưa đóng ({item['unpaid_count']} người):\n{names}"
                f"{guest_line}"
            )

            try:
                payload = _json.dumps({
                    "chat_id": chat_id,
                    "text": text,
                    "parse_mode": "Markdown",
                }).encode()
                req = _urllib_req.Request(
                    f"https://api.telegram.org/bot{bot_token}/sendMessage",
                    data=payload,
                    headers={"Content-Type": "application/json"},
                )
                with _urllib_req.urlopen(req, timeout=10) as resp:
                    resp.read()

                # Ghi log theo đúng chat_id (UNIQUE constraint tránh trùng)
                log = models.ReminderLog(
                    club_id=item["club_id"],
                    fee_type_id=item["fee_type_id"],
                    month=month,
                    year=year,
                    send_date=today,
                    chat_id=chat_id,
                )
                db.add(log)
                db.commit()
                sent_count += 1
            except Exception as exc:
                db.rollback()   # commit thất bại (vd IntegrityError) không được để rớt sang vòng lặp sau
                errors.append({"chat_id": chat_id, "error": str(exc)})

    return {
        "sent": sent_count,
        "skipped_already_sent_today": skipped_count,
        "errors": errors,
    }


# ── SERVE REACT FRONTEND ──────────────────────────────────
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        return FileResponse(STATIC_DIR / "index.html")
