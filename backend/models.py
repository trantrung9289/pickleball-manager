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
    round_robin_double = "round_robin_double"
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


class ParticipantStatus(str, enum.Enum):
    active = "active"
    withdrawn = "withdrawn"   # bỏ giải giữa chừng — giữ lại lịch sử các trận đã đấu


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
    player_id = Column(Integer, ForeignKey("players.id"), nullable=True)  # khách mời
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
    player = relationship("Player")


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
    # Danh sách hạng của CLB (dùng chung cho Thành viên, Khách mời, quy tắc ghép đội).
    # NULL → dùng DEFAULT_RANK_LEVELS (main.py). "Chưa xếp hạng" là hạng ngầm định, KHÔNG nằm trong danh sách.
    rank_levels = Column(JSON, nullable=True)
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
    bot_enabled = Column(Boolean, default=True)         # club admin bật/tắt quyền dùng bot Telegram
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
    # Quy tắc ghép ĐỒNG ĐỘI (giải đôi) [{"rank1","rank2"}] — TÁCH BIỆT với pairing_mode/rank_rules
    # (quy tắc ghép ĐỐI THỦ của format individual, đang dùng để chặn vòng quay cặp đấu)
    partner_rules = Column(JSON, nullable=True)
    num_groups = Column(Integer, default=2)               # for group stage
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    score_pin_hash = Column(String(100), nullable=True)          # hash mã PIN 4 số — cho phép nhập điểm qua public
    public_scoring_enabled = Column(Boolean, default=False)      # công tắc bật/tắt, độc lập với việc đã có PIN
    third_place_enabled = Column(Boolean, default=False)         # có trận tranh giải 3 (knockout/combined) không

    participants = relationship("TournamentParticipant", back_populates="tournament", cascade="all, delete-orphan")
    matches = relationship("TournamentMatch", back_populates="tournament", cascade="all, delete-orphan")
    draws = relationship("TournamentDraw", back_populates="tournament", cascade="all, delete-orphan",
                         order_by="TournamentDraw.seq", lazy="selectin")
    partner_draws = relationship("TournamentPartnerDraw", back_populates="tournament", cascade="all, delete-orphan",
                                 order_by="TournamentPartnerDraw.seq", lazy="selectin")

    @property
    def has_score_pin(self) -> bool:
        return bool(self.score_pin_hash)

    @property
    def draw(self):
        """Phiên bốc thăm mới nhất (mọi trạng thái) — để TournamentOut/PublicTournamentOut expose tóm tắt."""
        return self.draws[-1] if self.draws else None

    @property
    def partner_draw(self):
        """Phiên ghép đội (partner draw) mới nhất, mọi trạng thái — KHÔNG lẫn với phiên bốc cặp đấu (draw)."""
        return self.partner_draws[-1] if self.partner_draws else None

    @property
    def unpaired_count(self) -> int:
        """Số người chưa có đội trong giải đôi (participant đơn lẻ: không có partner). Giải đơn → 0."""
        if self.team_type != "doubles":
            return 0
        return sum(1 for p in self.participants
                   if p.partner_member_id is None and p.partner_player_id is None)


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
    status            = Column(Enum(ParticipantStatus), default=ParticipantStatus.active)

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
    is_walkover = Column(Boolean, default=False)  # thắng do đối thủ bỏ giải — không tính hiệu số khi xếp hạng

    # bracket linkage for knockout: người THẮNG đi đâu
    next_match_id = Column(Integer, ForeignKey("tournament_matches.id"), nullable=True)
    next_match_slot = Column(Integer, nullable=True)  # 1 or 2
    # người THUA đi đâu — chỉ set trên 2 trận bán kết khi bật tranh giải 3
    loser_next_match_id = Column(Integer, ForeignKey("tournament_matches.id"), nullable=True)
    loser_next_match_slot = Column(Integer, nullable=True)  # 1 or 2

    tournament = relationship("Tournament", back_populates="matches")
    p1 = relationship("TournamentParticipant", foreign_keys=[p1_id])
    p2 = relationship("TournamentParticipant", foreign_keys=[p2_id])
    winner = relationship("TournamentParticipant", foreign_keys=[winner_id])


class TournamentDraw(Base):
    """Một phiên bốc thăm bằng vòng quay của 1 giải. Nguồn sự thật nằm trong DB (sống qua deploy)."""
    __tablename__ = "tournament_draws"

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id"), nullable=False, index=True)
    seq = Column(Integer, nullable=False)                          # lần bốc thứ mấy của giải, từ 1
    status = Column(String(20), default="open", nullable=False)   # open | committed | cancelled | superseded
    seed_hex = Column(String(64), nullable=False)                  # secrets.token_hex(16); chỉ trả ra API khi status != open
    seed_commit = Column(String(64), nullable=False)               # sha256(seed_hex).hexdigest() — công bố ngay khi mở
    pool_json = Column(JSON, nullable=False)                       # [participant_id...] sắp theo id tăng dần lúc mở phiên
    total_steps = Column(Integer, nullable=False)
    reveal_ms = Column(Integer, default=5000, nullable=False)
    force = Column(Boolean, default=False)                         # mở phiên với xác nhận xoá kết quả cũ
    created_by = Column(String(50), nullable=True)
    created_at = Column(DateTime, nullable=True)                   # set bằng _now_vn() trong main.py (không server_default để cùng gốc giờ VN)
    committed_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    cancel_reason = Column(String(200), nullable=True)

    __table_args__ = (UniqueConstraint("tournament_id", "seq", name="uq_draw_tournament_seq"),)

    tournament = relationship("Tournament", back_populates="draws")
    steps = relationship("TournamentDrawStep", back_populates="draw", cascade="all, delete-orphan",
                         order_by="TournamentDrawStep.step_index", lazy="selectin")

    @property
    def done_steps(self) -> int:
        return len(self.steps)


class TournamentDrawStep(Base):
    """Một lượt quay đã chốt của phiên bốc thăm. Không có undo từng lượt — chỉ huỷ cả phiên."""
    __tablename__ = "tournament_draw_steps"

    id = Column(Integer, primary_key=True, index=True)
    draw_id = Column(Integer, ForeignKey("tournament_draws.id"), nullable=False, index=True)
    step_index = Column(Integer, nullable=False)                   # 0-based
    participant_id = Column(Integer, ForeignKey("tournament_participants.id"), nullable=False)
    slot_label = Column(String(60), nullable=False)                # nhãn ô do server sinh
    pick_index = Column(Integer, nullable=False)                   # chỉ số trong danh sách còn lại lúc quay
    spun_at = Column(DateTime, nullable=True)                      # _now_vn() để hiển thị
    spun_at_ms = Column(Integer, nullable=False)                   # epoch ms UTC (int(time.time()*1000)) — mốc đồng bộ animation

    __table_args__ = (
        UniqueConstraint("draw_id", "step_index", name="uq_draw_step_index"),
        UniqueConstraint("draw_id", "participant_id", name="uq_draw_step_participant"),
    )

    draw = relationship("TournamentDraw", back_populates="steps")
    # Khai báo quan hệ để SQLAlchemy biết xoá step TRƯỚC participant khi xoá giải (SQLite bật FK)
    participant = relationship("TournamentParticipant")


class TournamentPartnerDraw(Base):
    """Một phiên GHÉP ĐỘI ĐÔI bằng vòng quay (partner draw). Dùng BẢNG RIÊNG thay vì tái dùng
    tournament_draws vì bảng cũ đã có trên production với steps.participant_id NOT NULL FK, còn ở đây
    participant đơn lẻ bị xoá khi gộp thành đội nên không thể giữ FK."""
    __tablename__ = "tournament_partner_draws"

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id"), nullable=False, index=True)
    seq = Column(Integer, nullable=False)                          # lần ghép thứ mấy của giải, từ 1
    status = Column(String(20), default="open", nullable=False)   # open | committed | cancelled | superseded
    seed_hex = Column(String(64), nullable=False)                  # chỉ trả ra API khi status != open
    seed_commit = Column(String(64), nullable=False)               # sha256(seed_hex) — công bố ngay khi mở
    pool_json = Column(JSON, nullable=False)                       # [{"pid","member_id","player_id","name","rank"}] sắp theo pid
    rules_json = Column(JSON, nullable=False, default=list)        # [{"rank1","rank2"}] — có thể []
    plan_json = Column(JSON, nullable=False)                       # {"phases":[...], "unpaired_pids":[...]}
    total_steps = Column(Integer, nullable=False)
    reveal_ms = Column(Integer, default=5000, nullable=False)
    created_by = Column(String(50), nullable=True)
    created_at = Column(DateTime, nullable=True)                   # _now_vn() trong main.py
    committed_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    cancel_reason = Column(String(200), nullable=True)

    __table_args__ = (UniqueConstraint("tournament_id", "seq", name="uq_partner_draw_tournament_seq"),)

    tournament = relationship("Tournament", back_populates="partner_draws")
    steps = relationship("TournamentPartnerDrawStep", back_populates="draw", cascade="all, delete-orphan",
                         order_by="TournamentPartnerDrawStep.step_index", lazy="selectin")

    @property
    def done_steps(self) -> int:
        return len(self.steps)

    @property
    def finished(self) -> bool:
        """Đã hết lượt hợp lệ (không còn cặp nào ghép được theo quy tắc — replay → None; KHÔNG so với trần
        total_steps vì plan v2 là cận trên thật). Dùng cho PartnerDrawSummaryOut nhúng trong TournamentOut."""
        from tournament_engine import partner_draw_finished   # import trễ: tránh phụ thuộc vòng lúc nạp module
        steps = [
            {"step_index": st.step_index, "pid": st.pid, "side": st.side,
             "phase_index": st.phase_index, "team_index": st.team_index}
            for st in sorted(self.steps, key=lambda s: s.step_index)
        ]
        return partner_draw_finished(list(self.pool_json or []), list(self.rules_json or []), steps)

    @property
    def stuck(self) -> bool:
        """Phiên kẹt: lượt cuối là bên 1 mà bên 2 không còn ai (dữ liệu hỏng / phiên engine cũ)."""
        from tournament_engine import partner_draw_stuck
        steps = [
            {"step_index": st.step_index, "pid": st.pid, "side": st.side,
             "phase_index": st.phase_index, "team_index": st.team_index}
            for st in sorted(self.steps, key=lambda s: s.step_index)
        ]
        return partner_draw_stuck(list(self.pool_json or []), list(self.rules_json or []), steps)


class TournamentPartnerDrawStep(Base):
    """Một lượt quay đã chốt của phiên ghép đội: chọn 1 NGƯỜI vào ô (đội team_index, vị trí side)."""
    __tablename__ = "tournament_partner_draw_steps"

    id = Column(Integer, primary_key=True, index=True)
    draw_id = Column(Integer, ForeignKey("tournament_partner_draws.id"), nullable=False, index=True)
    step_index = Column(Integer, nullable=False)                   # 0-based
    team_index = Column(Integer, nullable=False)                   # 0-based toàn phiên
    side = Column(Integer, nullable=False)                         # 1 | 2
    phase_index = Column(Integer, nullable=False)
    # pid KHÔNG FK: participant đơn lẻ (người 2) bị xoá khi gộp đội lúc commit — giữ snapshot để kiểm chứng
    pid = Column(Integer, nullable=False)
    member_id = Column(Integer, nullable=True)                     # snapshot
    player_id = Column(Integer, nullable=True)                     # snapshot
    pick_index = Column(Integer, nullable=False)                   # chỉ số trong eligible lúc quay
    auto = Column(Boolean, default=False, nullable=False)          # eligible chỉ 1 người → điền tự động
    eligible_pids_json = Column(JSON, nullable=False)              # [pid...] đủ điều kiện tại lượt đó
    spun_at = Column(DateTime, nullable=True)
    spun_at_ms = Column(Integer, nullable=False)                   # epoch ms UTC — mốc đồng bộ animation

    __table_args__ = (
        UniqueConstraint("draw_id", "step_index", name="uq_partner_draw_step_index"),
        UniqueConstraint("draw_id", "pid", name="uq_partner_draw_step_pid"),
    )

    draw = relationship("TournamentPartnerDraw", back_populates="steps")


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
    chat_id     = Column(Integer, nullable=True)  # 1 dòng / admin — trước đây theo cả CLB nên chỉ admin đầu nhận được nhắc
    sent_at     = Column(DateTime, server_default=func.now())

    from sqlalchemy import UniqueConstraint as _UC
    __table_args__ = (
        _UC("club_id", "fee_type_id", "month", "year", "send_date", "chat_id", name="uq_reminder_per_day_per_admin"),
    )
