from sqlalchemy import Column, Integer, String, Date, DateTime, Numeric, Boolean, Enum, ForeignKey, Text, JSON, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from database import Base


class MemberStatus(str, enum.Enum):
    active = "active"
    inactive = "inactive"
    suspended = "suspended"


class FeeTypeCategory(str, enum.Enum):
    income = "income"
    expense = "expense"


class UserRole(str, enum.Enum):
    admin = "admin"
    treasurer = "treasurer"
    member = "member"


class TournamentFormat(str, enum.Enum):
    round_robin = "round_robin"
    knockout = "knockout"
    combined = "combined"
    individual = "individual"


class TournamentStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    completed = "completed"


class MatchStatus(str, enum.Enum):
    pending = "pending"
    completed = "completed"


class Member(Base):
    __tablename__ = "members"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=True, index=True)
    member_code = Column(String(20), index=True)   # unique per-club, enforced at app level
    full_name = Column(String(100), nullable=False)
    dob = Column(Date, nullable=True)
    phone = Column(String(15), nullable=True)
    email = Column(String(100), nullable=True)
    join_date = Column(Date, nullable=True)
    status = Column(Enum(MemberStatus), default=MemberStatus.active)
    rank = Column(String(30), nullable=True)
    address = Column(String(200), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    transactions = relationship("Transaction", back_populates="member")
    tournament_participations = relationship(
        "TournamentParticipant",
        foreign_keys="TournamentParticipant.member_id",
        back_populates="member",
    )


class FeeType(Base):
    __tablename__ = "fee_types"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=True, index=True)
    name = Column(String(100), nullable=False)
    type = Column(Enum(FeeTypeCategory), nullable=False)
    description = Column(Text, nullable=True)
    default_amount = Column(Numeric(15, 2), default=0)
    is_recurring = Column(Boolean, default=False)
    remind_enabled = Column(Boolean, default=False)   # bật nhắc đóng phí qua Telegram
    created_at = Column(DateTime, server_default=func.now())

    transactions = relationship("Transaction", back_populates="fee_type")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=True, index=True)
    fee_type_id = Column(Integer, ForeignKey("fee_types.id"), nullable=False)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)
    type = Column(Enum(FeeTypeCategory), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    transaction_date = Column(Date, nullable=False)
    description = Column(Text, nullable=True)
    payment_method = Column(String(50), default="Tiền mặt")
    created_by = Column(String(50), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    fee_type = relationship("FeeType", back_populates="transactions")
    member = relationship("Member", back_populates="transactions")


class Club(Base):
    __tablename__ = "clubs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    sport = Column(String(100), default="Pickleball")
    description = Column(Text, nullable=True)
    logo_url = Column(String(500), nullable=True)
    founded_year = Column(Integer, nullable=True)
    address = Column(String(300), nullable=True)
    phone = Column(String(20), nullable=True)
    email = Column(String(100), nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True)
    full_name = Column(String(100), nullable=True)
    password_hash = Column(String(255))
    role = Column(Enum(UserRole), default=UserRole.member)
    is_superuser = Column(Boolean, default=False)   # quản trị viên hệ thống
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    club_memberships = relationship("ClubMembership", back_populates="user", cascade="all, delete-orphan")


class ClubMembership(Base):
    """Gán quyền tài khoản cho từng câu lạc bộ."""
    __tablename__ = "club_memberships"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.member)   # admin | treasurer | member
    can_view = Column(Boolean, default=True)
    can_create = Column(Boolean, default=False)
    can_edit = Column(Boolean, default=False)
    can_delete = Column(Boolean, default=False)
    telegram_chat_id = Column(Integer, nullable=True)   # Telegram user_id của admin khi login bot
    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User", back_populates="club_memberships")
    club = relationship("Club")


# ── PLAYER MODEL (thành viên CLB + khách mời) ─────────────

class Player(Base):
    """Đại diện cho mọi người có thể tham gia giải đấu.
    member_id=NULL  → khách mời (ngoài CLB)
    member_id!=NULL → thành viên CLB
    """
    __tablename__ = "players"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String(100), nullable=False)
    phone      = Column(String(20), nullable=True)
    email      = Column(String(100), nullable=True)
    rank       = Column(String(50), nullable=True, default="Chưa xếp hạng")
    member_id  = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    club_id    = Column(Integer, ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    member = relationship("Member")

    __table_args__ = (
        # 1 thành viên chỉ có 1 player record trong cùng CLB
        UniqueConstraint("club_id", "member_id", name="uq_player_club_member"),
    )


# ── TOURNAMENT MODELS ─────────────────────────────────────

class Tournament(Base):
    __tablename__ = "tournaments"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=True, index=True)
    name = Column(String(200), nullable=False)
    format = Column(Enum(TournamentFormat), nullable=False)
    status = Column(Enum(TournamentStatus), default=TournamentStatus.draft)
    team_type = Column(String(10), default="singles")     # singles | doubles
    pairing_mode = Column(String(30), default="random")   # random | same_rank | cross_rank
    rank_rules = Column(JSON, nullable=True)              # [{"rank1":"A","rank2":"C"}]
    num_groups = Column(Integer, default=2)               # for group stage
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    participants = relationship("TournamentParticipant", back_populates="tournament", cascade="all, delete-orphan")
    matches = relationship("TournamentMatch", back_populates="tournament", cascade="all, delete-orphan")


class TournamentParticipant(Base):
    """Mỗi record = 1 đội thi đấu (đơn: 1 người, đôi: 2 người).
    Hỗ trợ cả thành viên CLB (member_id) và khách mời (player_id).
    """
    __tablename__ = "tournament_participants"

    id                = Column(Integer, primary_key=True, index=True)
    tournament_id     = Column(Integer, ForeignKey("tournaments.id"), nullable=False)
    member_id         = Column(Integer, ForeignKey("members.id"), nullable=True)         # người 1 — thành viên
    player_id         = Column(Integer, ForeignKey("players.id"), nullable=True)         # người 1 — khách mời
    partner_member_id = Column(Integer, ForeignKey("members.id"), nullable=True)         # người 2 — thành viên (đôi)
    partner_player_id = Column(Integer, ForeignKey("players.id"), nullable=True)         # người 2 — khách mời (đôi)
    team_name         = Column(String(200), nullable=True)
    seed              = Column(Integer, nullable=True)
    group_name        = Column(String(10), nullable=True)

    tournament = relationship("Tournament", back_populates="participants")
    member     = relationship("Member", foreign_keys=[member_id], back_populates="tournament_participations")
    partner    = relationship("Member", foreign_keys=[partner_member_id])
    player     = relationship("Player", foreign_keys=[player_id])
    partner_player = relationship("Player", foreign_keys=[partner_player_id])


class PublicReportToken(Base):
    """Token chia sẻ báo cáo tài chính công khai — không cần đăng nhập."""
    __tablename__ = "public_report_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(64), unique=True, index=True, nullable=False)
    slug = Column(String(120), unique=True, index=True, nullable=True)   # tên CLB-viết-liền-không-dấu + 8 ký tự token
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False)
    label = Column(String(200), nullable=False)
    expires_at = Column(DateTime, nullable=True)   # NULL = vĩnh viễn
    is_active = Column(Boolean, default=True)
    view_count = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())
    created_by = Column(String(50), nullable=True)

    club = relationship("Club")


class TournamentMatch(Base):
    __tablename__ = "tournament_matches"

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id"), nullable=False)
    round_number = Column(Integer, nullable=False)
    round_name = Column(String(50), nullable=True)
    match_number = Column(Integer, nullable=False)
    group_name = Column(String(10), nullable=True)
    phase = Column(String(20), default="group")  # group | knockout

    p1_id = Column(Integer, ForeignKey("tournament_participants.id"), nullable=True)
    p2_id = Column(Integer, ForeignKey("tournament_participants.id"), nullable=True)
    score1 = Column(Integer, nullable=True)
    score2 = Column(Integer, nullable=True)
    winner_id = Column(Integer, ForeignKey("tournament_participants.id"), nullable=True)
    status = Column(Enum(MatchStatus), default=MatchStatus.pending)

    # bracket linkage for knockout
    next_match_id = Column(Integer, ForeignKey("tournament_matches.id"), nullable=True)
    next_match_slot = Column(Integer, nullable=True)  # 1 or 2

    tournament = relationship("Tournament", back_populates="matches")
    p1 = relationship("TournamentParticipant", foreign_keys=[p1_id])
    p2 = relationship("TournamentParticipant", foreign_keys=[p2_id])
    winner = relationship("TournamentParticipant", foreign_keys=[winner_id])


class BotConfig(Base):
    __tablename__ = "bot_config"
    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False)
    key = Column(String(100), nullable=False)
    value = Column(Text, nullable=True)

    club = relationship("Club")


class ReminderLog(Base):
    """Ghi lại lần gửi nhắc để tránh gửi trùng trong cùng ngày."""
    __tablename__ = "reminder_log"

    id          = Column(Integer, primary_key=True, index=True)
    club_id     = Column(Integer, ForeignKey("clubs.id"), nullable=False)
    fee_type_id = Column(Integer, ForeignKey("fee_types.id"), nullable=False)
    month       = Column(Integer, nullable=False)
    year        = Column(Integer, nullable=False)
    send_date   = Column(Date, nullable=False)
    sent_at     = Column(DateTime, server_default=func.now())

    from sqlalchemy import UniqueConstraint as _UC
    __table_args__ = (
        _UC("club_id", "fee_type_id", "month", "year", "send_date", name="uq_reminder_per_day"),
    )
