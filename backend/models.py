from sqlalchemy import Column, Integer, String, Date, DateTime, Numeric, Boolean, Enum, ForeignKey, Text, JSON, UniqueConstraint, LargeBinary
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
    gender = Column(String(10), nullable=True)   # male | female | other | NULL — dùng cho thể thức đồng đội (Đôi Nam/Nữ/Nam Nữ)
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
    remind_enabled = Column(Boolean, default=False)   # CŨ (nhắc phí Telegram, gỡ 2026-10-28): giữ cột, đã chuyển thành quy tắc thông báo
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
    # AUTOINCREMENT: id CLB đã xoá KHÔNG bao giờ được cấp lại. Sự cố 2026-10-08: CLB thử nghiệm id=2 bị xoá lúc FK
    # còn tắt để lại dữ liệu mồ côi club_id=2; CLB mới sau đó nhận lại id=2 và "kế thừa" thành viên/khoản/giao dịch.
    # DB cũ: migrations/add_clubs_autoincrement.py tạo lại bảng; main._purge_orphan_club_rows dọn mồ côi lúc khởi động.
    __table_args__ = ({"sqlite_autoincrement": True},)

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    sport = Column(String(100), default="Pickleball")
    description = Column(Text, nullable=True)
    logo_url = Column(String(500), nullable=True)   # cột cũ, không dùng; logo nay lưu trong DB (logo_png) — xem logo_url_public
    logo_png = Column(LargeBinary, nullable=True)   # 2026-10-28: logo CLB đã chuẩn hoá PNG ≤512px (Pillow), ≤ ~300KB
    logo_hash = Column(String(16), nullable=True)   # sha1 rút gọn → tham số ?v= để trình duyệt cache đúng khi đổi logo
    founded_year = Column(Integer, nullable=True)
    address = Column(String(300), nullable=True)
    phone = Column(String(20), nullable=True)
    email = Column(String(100), nullable=True)
    # Danh sách hạng của CLB (dùng chung cho Thành viên, Khách mời, quy tắc ghép đội).
    # NULL → dùng DEFAULT_RANK_LEVELS (main.py). "Chưa xếp hạng" là hạng ngầm định, KHÔNG nằm trong danh sách.
    rank_levels = Column(JSON, nullable=True)
    # Màu thương hiệu của CLB ("#RRGGBB") — lớp 1 đổi giao diện 2026-10-26: NULL = xanh lá mặc định; frontend tự
    # tối màu cho đủ tương phản và sinh bản nhạt làm nền chip (utils/color.js)
    brand_color = Column(String(9), nullable=True)
    # Superuser cấp/tắt quyền dùng bot Telegram cho CẢ CLB (mặc định bật). Tắt → mọi tài khoản của CLB
    # không vào được bot ở CLB này, không liên kết Telegram, không nhận nhắc phí — bất kể cờ theo tài khoản.
    bot_enabled = Column(Boolean, default=True, nullable=False)
    chat_locked = Column(Boolean, default=False, nullable=False)   # 2026-10-28: admin khoá kênh trò chuyện public
    # 2026-10-30: Zalo Bot Platform (chính thức, miễn phí) — mỗi CLB một bot, gửi thông báo vào nhóm Zalo đã nhận diện (bảng zalo_groups)
    zalo_bot_token_enc = Column(Text, nullable=True)            # token bot mã hoá Fernet (zalo_bot.encrypt_token), không trả ra API
    zalo_bot_id = Column(String(40), nullable=True)
    zalo_bot_name = Column(String(100), nullable=True)
    zalo_webhook_secret = Column(String(64), nullable=True)      # header X-Bot-Api-Secret-Token
    zalo_webhook_ok = Column(Boolean, default=False, nullable=False)
    zalo_show_unpaid_names = Column(Boolean, default=True, nullable=False)   # tin nhắc phí vào nhóm có liệt kê tên chưa đóng
    created_at = Column(DateTime, server_default=func.now())

    @property
    def logo_src(self):
        """Đường dẫn ảnh logo (public, không cần đăng nhập) kèm ?v= để cache; None khi chưa có logo."""
        return f"/api/public/club-logo/{self.id}?v={self.logo_hash}" if self.logo_hash else None


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
    gender     = Column(String(10), nullable=True)   # male | female | other | NULL
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
    team_type = Column(String(10), default="singles")     # singles | doubles | team (đồng đội nhiều VĐV)
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
    # 2026-10-26: tranh hạng 5-6 (hạng Ba bảng A gặp hạng Ba bảng B) và 7-8 (hạng Tư) — chỉ combined 2 bảng,
    # tạo khi "Lên vòng loại trực tiếp"
    placement_matches_enabled = Column(Boolean, default=False)
    # Thể thức ĐỒNG ĐỘI (team_type="team"): cách tính điểm, mẫu trận thành phần, điểm/trận, mốc tổng...
    # Xem tournament_engine.normalize_team_rules. NULL với giải đơn/đôi.
    team_rules = Column(JSON, nullable=True)

    participants = relationship("TournamentParticipant", back_populates="tournament", cascade="all, delete-orphan")
    matches = relationship("TournamentMatch", back_populates="tournament", cascade="all, delete-orphan")
    draws = relationship("TournamentDraw", back_populates="tournament", cascade="all, delete-orphan",
                         order_by="TournamentDraw.seq", lazy="selectin")
    partner_draws = relationship("TournamentPartnerDraw", back_populates="tournament", cascade="all, delete-orphan",
                                 order_by="TournamentPartnerDraw.seq", lazy="selectin")
    # Giải đồng đội: MỌI VĐV đã đăng ký (participant_id NULL = "VĐV tham dự" chưa phân đội — đợt 2026-10-22).
    # selectin để TournamentOut/PublicTournamentOut tra tên VĐV cho trận thành phần mà không N+1.
    team_players = relationship("TournamentTeamPlayer", back_populates="tournament", cascade="all, delete-orphan",
                                order_by="TournamentTeamPlayer.id", lazy="selectin")
    # Giải đồng đội: phiên VÒNG QUAY PHÂN VĐV VÀO ĐỘI (2026-10-22)
    team_draws = relationship("TournamentTeamDraw", back_populates="tournament", cascade="all, delete-orphan",
                              order_by="TournamentTeamDraw.seq", lazy="selectin")

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

    @property
    def team_draw(self):
        """Phiên phân VĐV vào đội (giải đồng đội) mới nhất, mọi trạng thái."""
        return self.team_draws[-1] if self.team_draws else None

    @property
    def team_pool_count(self) -> int:
        """Giải đồng đội: số VĐV đã đăng ký nhưng chưa phân vào đội (không thi đấu nếu giải bắt đầu)."""
        if self.team_type != "team":
            return 0
        return sum(1 for tp in self.team_players if tp.participant_id is None)


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
    pin_hash = Column(String(64), nullable=True)   # 2026-10-28: mã PIN 4/6 số bảo vệ link (sha256(token + pin)); NULL = không PIN
    pin_length = Column(Integer, nullable=True)    # 4 | 6 — trả trong lỗi 401 để màn nhập hiện đúng số ô

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
    # Giải đồng đội: seed xáo thứ tự trận thành phần của trận này (NULL = chưa bốc thăm thứ tự)
    rubber_draw_seed = Column(String(64), nullable=True)
    # Giải đồng đội: ghi chú của BTC cho trận này (xử thua, đổi sân, sự cố...) — hiện cả trên public
    btc_note = Column(Text, nullable=True)

    tournament = relationship("Tournament", back_populates="matches")
    rubbers = relationship("TournamentTieRubber", back_populates="match", cascade="all, delete-orphan",
                           order_by="TournamentTieRubber.order_index", lazy="selectin")
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


# ── SỰ KIỆN THÀNH TÍCH CÁ NHÂN (Mini game) ────────────────
# Bảng mới tự tạo bởi Base.metadata.create_all ở main.py — không cần _run_migration.

class PointEvent(Base):
    """Sự kiện thành tích cá nhân (Mini game): cộng/trừ điểm từng người bằng nút +/−, không có trận đấu."""
    __tablename__ = "point_events"
    __table_args__ = ({"sqlite_autoincrement": True},)

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(30), default="mini_game", nullable=False)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(Enum(TournamentStatus), default=TournamentStatus.draft, nullable=False)  # dùng lại enum giải
    version = Column(Integer, default=0, nullable=False)          # +1 mỗi lần đổi điểm/người/trạng thái → poll rẻ
    created_by = Column(String(50), nullable=True)                # username admin
    created_at = Column(DateTime, nullable=True)                  # _now_vn() (mẫu TournamentDraw.created_at)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    participants = relationship("PointEventParticipant", back_populates="event", cascade="all, delete-orphan",
                                order_by="PointEventParticipant.seq", lazy="selectin")
    logs = relationship("PointLog", back_populates="event", cascade="all, delete-orphan", order_by="PointLog.id")


class PointEventParticipant(Base):
    """Một người trong sự kiện. Thành viên (member_id) HOẶC khách mời (player_id, Player.member_id IS NULL).
    Người đã có điểm rời đi → status="removed", giữ nguyên điểm và lịch sử."""
    __tablename__ = "point_event_participants"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("point_events.id", ondelete="CASCADE"), nullable=False, index=True)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True, index=True)   # thành viên
    player_id = Column(Integer, ForeignKey("players.id"), nullable=True, index=True)   # khách mời (Player.member_id IS NULL)
    display_name = Column(String(200), nullable=False)   # snapshot tên lúc thêm
    rank_snapshot = Column(String(50), nullable=True)    # member.rank / player.rank lúc thêm
    seq = Column(Integer, nullable=False)                # thứ tự thêm, từ 1
    points = Column(Integer, default=0, nullable=False)
    status = Column(String(20), default="active", nullable=False)   # active | removed

    # sqlite_autoincrement: id KHÔNG được tái dùng sau khi xoá cứng (client theo dõi người/log theo id —
    # tái dùng id làm máy khác hiển thị nhầm người hoặc bỏ sót log khi tải theo after_id).
    # UNIQUE(event_id, seq): 2 request thêm người song song không được cấp trùng seq (retry ở endpoint).
    __table_args__ = (UniqueConstraint("event_id", "member_id", name="uq_pep_event_member"),
                      UniqueConstraint("event_id", "player_id", name="uq_pep_event_player"),
                      UniqueConstraint("event_id", "seq", name="uq_pep_event_seq"),
                      {"sqlite_autoincrement": True})

    event = relationship("PointEvent", back_populates="participants")
    member = relationship("Member")
    player = relationship("Player")


class PointLog(Base):
    """Nhật ký chỉ-ghi-thêm: từng lần bấm điểm, đổi trạng thái sự kiện, thêm/rời người."""
    __tablename__ = "point_logs"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("point_events.id", ondelete="CASCADE"), nullable=False, index=True)
    participant_id = Column(Integer, ForeignKey("point_event_participants.id", ondelete="CASCADE"), nullable=True, index=True)  # None với log trạng thái
    kind = Column(String(20), default="score", nullable=False)   # score | status | participant
    delta = Column(Integer, default=0, nullable=False)           # ±1 với score, 0 với loại khác
    points_after = Column(Integer, default=0, nullable=False)
    note = Column(String(200), nullable=True)                    # status: "Bắt đầu" | "Kết thúc" | "Mở lại"; participant: "Thêm" | "Rời" | "Thêm lại"
    client_op_id = Column(String(40), nullable=True)             # chống ghi trùng khi client retry
    actor_name = Column(String(100), nullable=True)              # username admin — KHÔNG đưa ra public
    created_at = Column(DateTime, nullable=True)                 # _now_vn()

    __table_args__ = (UniqueConstraint("event_id", "client_op_id", name="uq_plog_event_op"),
                      {"sqlite_autoincrement": True})   # id không tái dùng: client tải log tăng dần theo after_id

    event = relationship("PointEvent", back_populates="logs")
    participant = relationship("PointEventParticipant")


# ── GIẢI ĐỒNG ĐỘI (team_type="team"): đội nhiều VĐV, trận đồng đội = TournamentMatch, trận thành phần = rubber ──

class TournamentTeamPlayer(Base):
    """VĐV của một đội trong giải đồng đội. UNIQUE theo giải: một người chỉ thuộc một đội (điều lệ 5.2)."""
    __tablename__ = "tournament_team_players"
    __table_args__ = (UniqueConstraint("tournament_id", "member_id", name="uq_ttp_tournament_member"),
                      UniqueConstraint("tournament_id", "player_id", name="uq_ttp_tournament_player"),
                      {"sqlite_autoincrement": True})

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False, index=True)
    # NULL = "VĐV tham dự" chưa phân đội (pool chung của giải); bảng được dựng lại ở _migrate_team_players_pool
    participant_id = Column(Integer, ForeignKey("tournament_participants.id", ondelete="CASCADE"), nullable=True, index=True)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True, index=True)
    player_id = Column(Integer, ForeignKey("players.id"), nullable=True, index=True)
    display_name = Column(String(200), nullable=False)      # snapshot tên lúc thêm
    gender_snapshot = Column(String(10), nullable=True)     # male | female | other | NULL (chưa khai)
    rank_snapshot = Column(String(50), nullable=True)       # hạng lúc thêm (member.rank / player.rank), sửa được tại giải
    is_captain = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, nullable=True)

    tournament = relationship("Tournament", back_populates="team_players")
    participant = relationship("TournamentParticipant")
    member = relationship("Member")
    player = relationship("Player")


class TournamentTieRubber(Base):
    """Trận thành phần (Đôi Nam 1, Đơn Nữ 1...) bên trong một trận đồng đội (TournamentMatch)."""
    __tablename__ = "tournament_tie_rubbers"
    __table_args__ = (UniqueConstraint("match_id", "order_index", name="uq_rubber_match_order"),
                      {"sqlite_autoincrement": True})

    id = Column(Integer, primary_key=True, index=True)
    match_id = Column(Integer, ForeignKey("tournament_matches.id", ondelete="CASCADE"), nullable=False, index=True)
    order_index = Column(Integer, nullable=False)           # 1..n theo thứ tự thi đấu (sau bốc thăm)
    code = Column(String(4), nullable=False)                # MD | WD | XD | MS | WS
    label = Column(String(50), nullable=False)              # "Đôi Nam 1"
    side1_players = Column(JSON, nullable=True)             # [tournament_team_players.id, ...] của đội p1
    side2_players = Column(JSON, nullable=True)             # ... của đội p2
    score1 = Column(Integer, nullable=True)
    score2 = Column(Integer, nullable=True)
    status = Column(String(20), default="pending", nullable=False)   # pending | completed
    is_walkover = Column(Boolean, default=False, nullable=False)
    start1 = Column(Integer, default=0, nullable=False)     # điểm xuất phát (PA2 cộng dồn); PA1 luôn 0
    start2 = Column(Integer, default=0, nullable=False)
    court = Column(String(30), nullable=True)               # sân thi đấu của trận thành phần (2026-10-26)
    created_at = Column(DateTime, nullable=True)

    match = relationship("TournamentMatch", back_populates="rubbers")


class TournamentStageLineup(Base):
    """Đội hình đăng ký theo GIAI ĐOẠN (leg1 lượt đi / leg2 lượt về / knockout). Khoá khi giai đoạn có điểm."""
    __tablename__ = "tournament_stage_lineups"
    __table_args__ = (UniqueConstraint("participant_id", "stage_key", name="uq_lineup_participant_stage"),
                      {"sqlite_autoincrement": True})

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False, index=True)
    participant_id = Column(Integer, ForeignKey("tournament_participants.id", ondelete="CASCADE"), nullable=False, index=True)
    stage_key = Column(String(20), nullable=False)          # leg1 | leg2 | knockout
    slots = Column(JSON, nullable=True)                     # {"Đôi Nam 1": [team_player_id, ...], ...}
    locked = Column(Boolean, default=False, nullable=False)
    locked_at = Column(DateTime, nullable=True)
    unlock_note = Column(String(200), nullable=True)
    updated_at = Column(DateTime, nullable=True)


class TournamentTeamLog(Base):
    """Nhật ký thao tác của giải đồng đội: mở khoá đội hình, sửa VĐV trận thành phần, điểm, xử thua, bốc thăm."""
    __tablename__ = "tournament_team_logs"
    __table_args__ = ({"sqlite_autoincrement": True},)

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False, index=True)
    match_id = Column(Integer, nullable=True)
    participant_id = Column(Integer, nullable=True)
    kind = Column(String(30), nullable=False)               # lineup_unlock | lineup_set | rubber_players | score | score_reset | walkover | draw_order
    note = Column(String(300), nullable=True)
    actor_name = Column(String(100), nullable=True)
    created_at = Column(DateTime, nullable=True)


class TournamentTeamDraw(Base):
    """Phiên VÒNG QUAY PHÂN VĐV VÀO ĐỘI của giải đồng đội (2026-10-22). Pool = VĐV tham dự chưa phân đội
    (snapshot lúc mở: tpid/tên/giới tính/hạng), teams = đội đang hoạt động; luật = các vòng theo hạng/giới tính;
    seed commit–reveal như hai vòng quay kia; chốt → gán participant_id cho từng VĐV theo lượt."""
    __tablename__ = "tournament_team_draws"
    __table_args__ = (UniqueConstraint("tournament_id", "seq", name="uq_team_draw_tournament_seq"),
                      {"sqlite_autoincrement": True})

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False, index=True)
    seq = Column(Integer, nullable=False)
    status = Column(String(20), default="open", nullable=False)   # open | committed | cancelled | superseded
    seed_hex = Column(String(64), nullable=False)
    seed_commit = Column(String(64), nullable=False)
    pool_json = Column(JSON, nullable=False)                       # [{"tpid","name","gender","rank"}] sắp theo tpid
    teams_json = Column(JSON, nullable=False)                      # [{"pid","name"}] theo seed/id
    rules_json = Column(JSON, nullable=False, default=list)        # normalize_team_draw_rules
    plan_json = Column(JSON, nullable=False)                       # team_draw_plan
    total_steps = Column(Integer, nullable=False)
    reveal_ms = Column(Integer, default=5000, nullable=False)
    created_by = Column(String(50), nullable=True)
    created_at = Column(DateTime, nullable=True)
    committed_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    cancel_reason = Column(String(200), nullable=True)

    tournament = relationship("Tournament", back_populates="team_draws")
    steps = relationship("TournamentTeamDrawStep", back_populates="draw", cascade="all, delete-orphan",
                         order_by="TournamentTeamDrawStep.step_index", lazy="selectin")

    @property
    def done_steps(self) -> int:
        return len(self.steps)

    @property
    def finished(self) -> bool:
        from tournament_engine import team_draw_finished   # import trễ: tránh phụ thuộc vòng lúc nạp module
        steps = [{"tpid": st.tpid, "team_pid": st.team_pid} for st in sorted(self.steps, key=lambda s: s.step_index)]
        return team_draw_finished(list(self.pool_json or []), [x["pid"] for x in (self.teams_json or [])],
                                  list(self.rules_json or []), steps)


class TournamentTeamDrawStep(Base):
    """Một lượt quay đã chốt của phiên phân đội: VĐV `tpid` vào đội `team_pid` ở vòng/pass nào."""
    __tablename__ = "tournament_team_draw_steps"
    __table_args__ = (UniqueConstraint("draw_id", "step_index", name="uq_team_draw_step_index"),
                      UniqueConstraint("draw_id", "tpid", name="uq_team_draw_step_tpid"),
                      {"sqlite_autoincrement": True})

    id = Column(Integer, primary_key=True, index=True)
    draw_id = Column(Integer, ForeignKey("tournament_team_draws.id", ondelete="CASCADE"), nullable=False, index=True)
    step_index = Column(Integer, nullable=False)
    tpid = Column(Integer, nullable=False)                  # tournament_team_players.id (không FK: VĐV có thể bị xoá sau)
    team_pid = Column(Integer, nullable=False)              # tournament_participants.id
    round_index = Column(Integer, nullable=False)
    pass_index = Column(Integer, nullable=False)
    pick_index = Column(Integer, nullable=False)
    auto = Column(Boolean, default=False, nullable=False)   # chỉ còn 1 người đủ điều kiện → điền không quay
    eligible_json = Column(JSON, nullable=True)             # [tpid] đủ điều kiện lúc quay (kiểm chứng)
    spun_at = Column(DateTime, nullable=True)
    spun_at_ms = Column(Integer, nullable=False)

    draw = relationship("TournamentTeamDraw", back_populates="steps")


class Announcement(Base):
    """Thông báo trên trang public / chuông (2026-10-27, đợt 1): quy tắc lặp, tính lần xuất hiện lúc đọc (announcements.py).
    kind: schedule (lịch sinh hoạt) | fee (khoản thu, nội dung tự sinh từ người chưa đóng).
    recurrence: none (một lần, start_date) | weekly (weekdays: [0..6], 0 = Thứ 2) | monthly (day_of_month, kẹp cuối tháng).
    lead_days: hiện trước bao nhiêu ngày. push_telegram: đợt 3 (cron). Không có bảng log vì public là kéo, không đẩy."""
    __tablename__ = "announcements"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    kind = Column(String(20), nullable=False, default="schedule")
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=True)
    fee_type_id = Column(Integer, ForeignKey("fee_types.id"), nullable=True)
    recurrence = Column(String(20), nullable=False, default="none")
    weekdays = Column(JSON, nullable=True)
    day_of_month = Column(Integer, nullable=True)
    start_time = Column(String(5), nullable=True)      # "HH:MM" giờ VN
    duration_min = Column(Integer, nullable=True)
    lead_days = Column(Integer, nullable=False, default=3)
    repeat_daily = Column(Boolean, nullable=False, default=False)   # đẩy lại MỖI NGÀY trong cửa sổ hiện trước (thay nhắc phí cũ)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    show_public = Column(Boolean, nullable=False, default=True)
    push_telegram = Column(Boolean, nullable=False, default=False)
    # 2026-10-30: giờ đẩy "HH:MM" giờ VN — cron 15 phút chỉ gửi khi đã qua giờ này; KHÔNG có mặc định (bật đẩy thì bắt buộc đặt)
    push_time = Column(String(5), nullable=True)
    # 2026-10-30: nhắc thêm một lần trước giờ bắt đầu (phút), chỉ lịch có start_time, gửi đúng ngày diễn ra; NULL = không nhắc
    remind_before_min = Column(Integer, nullable=True)
    # 2026-10-30: kind="report" — BÁO CÁO ĐỊNH KỲ qua kênh đã chọn (không hiện chuông/public). Nội dung tự sinh từ thu chi lúc gửi.
    # report_type: summary | transactions; report_range: yesterday|last7|last_week|this_month|last_month|last_quarter|this_year|last_n|fixed
    # (kết thúc hết hôm qua; last_n dùng report_range_days; fixed dùng report_from/report_to và chỉ gửi một lần);
    # report_channels: JSON ["telegram","zalo","web"], mặc định ["telegram"]; report_hide_names: bỏ tên người + ghi chú trong danh sách giao dịch
    report_type = Column(String(20), nullable=True)
    report_range = Column(String(20), nullable=True)
    report_range_days = Column(Integer, nullable=True)
    report_from = Column(Date, nullable=True)
    report_to = Column(Date, nullable=True)
    report_channels = Column(JSON, nullable=True)   # LEGACY: đã thay bằng push_channels (2026-10-30), giữ cột để không phải dựng lại bảng
    push_channels = Column(JSON, nullable=True)     # kênh gửi mọi loại: ["telegram","zalo","web"]; NULL → báo cáo chỉ telegram, loại khác đủ ba kênh
    report_hide_names = Column(Boolean, nullable=False, default=False)
    # đợt 2: report_type contributions (lọc khoản, tuỳ chọn) | fee_status (bắt buộc). Số nguyên thường, KHÔNG khoá ngoại: xoá khoản bị chặn ở delete_fee_type
    report_fee_type_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    fee_type = relationship("FeeType")


class AnnouncementPushLog(Base):
    """Đợt 3 (2026-10-27): log đẩy Telegram cho từng lần xuất hiện của thông báo — chống gửi trùng trong ngày theo chat_id.
    Bảng riêng (không mở rộng reminder_log vì fee_type_id ở đó NOT NULL và khoá theo tháng)."""
    __tablename__ = "announcement_push_log"

    id = Column(Integer, primary_key=True, index=True)
    announcement_id = Column(Integer, ForeignKey("announcements.id"), nullable=False, index=True)
    occurrence_date = Column(Date, nullable=False)
    chat_id = Column(Integer, nullable=False)
    send_date = Column(Date, nullable=False)
    sent_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("announcement_id", "occurrence_date", "chat_id", "send_date", name="uq_announcement_push_per_day"),
    )


class PushSubscription(Base):
    """Web Push (2026-10-28): đăng ký nhận đẩy của người xem trang public (ẩn danh), gắn CLB + link public đã mở."""
    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    token_id = Column(Integer, ForeignKey("public_report_tokens.id"), nullable=True)
    endpoint = Column(Text, nullable=False, unique=True)
    p256dh = Column(String(200), nullable=False)
    auth = Column(String(60), nullable=False)
    user_agent = Column(String(300), nullable=True)
    failures = Column(Integer, nullable=False, default=0)
    participant_id = Column(Integer, ForeignKey("chat_participants.id"), nullable=True)   # thiết bị đã vào trò chuyện → đẩy khi được nhắc tên
    # 2026-10-29: thông báo TRÒ CHUYỆN tách riêng khỏi nhắc nhở — chat_mode: all | mentions | off; giờ yên tĩnh theo thiết bị (giờ VN);
    # chat_pushed_at: chống dồn 30s cho tin thường (nhắc tên/bình chọn không bị chống dồn, không bị giờ yên tĩnh)
    chat_mode = Column(String(10), nullable=False, default="all")
    quiet_enabled = Column(Boolean, nullable=False, default=True)
    quiet_start = Column(Integer, nullable=False, default=22)
    quiet_end = Column(Integer, nullable=False, default=7)
    chat_pushed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    last_seen_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    token = relationship("PublicReportToken")


class AnnouncementPreRemindLog(Base):
    """2026-10-30: chống trùng cho lần NHẮC TRƯỚC GIỜ BẮT ĐẦU (một lần cho mỗi lần xuất hiện, mỗi kênh/đích).
    Bảng riêng vì hai log ngày có UNIQUE (thông báo, ngày, đích, ngày gửi) trùng khoá với lần đẩy đúng ngày.
    channel: tg (target_id = chat_id Telegram) | wp (target_id = push_subscriptions.id)."""
    __tablename__ = "announcement_pre_remind_log"

    id = Column(Integer, primary_key=True, index=True)
    announcement_id = Column(Integer, ForeignKey("announcements.id"), nullable=False, index=True)
    occurrence_date = Column(Date, nullable=False)
    channel = Column(String(2), nullable=False)
    target_id = Column(Integer, nullable=False)
    sent_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("announcement_id", "occurrence_date", "channel", "target_id", name="uq_announcement_pre_remind"),
    )


class WebPushLog(Base):
    """Chống gửi trùng Web Push theo (thông báo, ngày xuất hiện, subscription, ngày gửi)."""
    __tablename__ = "web_push_log"

    id = Column(Integer, primary_key=True, index=True)
    announcement_id = Column(Integer, ForeignKey("announcements.id"), nullable=False, index=True)
    occurrence_date = Column(Date, nullable=False)
    subscription_id = Column(Integer, ForeignKey("push_subscriptions.id"), nullable=False)
    send_date = Column(Date, nullable=False)
    sent_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("announcement_id", "occurrence_date", "subscription_id", "send_date", name="uq_web_push_per_day"),
    )


# ── TRÒ CHUYỆN TRANG PUBLIC (2026-10-28, đợt 1) ─────────────────────────────
# Danh tính theo THIẾT BỊ (phương án A): mỗi trình duyệt nhận device_id bí mật khi "vào trò chuyện" với biệt danh; không file/ảnh.

class ChatParticipant(Base):
    __tablename__ = "chat_participants"
    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    token_id = Column(Integer, ForeignKey("public_report_tokens.id"), nullable=True)
    device_id = Column(String(64), unique=True, nullable=False, index=True)
    display_name = Column(String(40), nullable=False)
    muted = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=func.now())
    last_seen_at = Column(DateTime, server_default=func.now())


class ChatMessage(Base):
    """kind: text | poll (poll_id) | system. Xoá mềm bằng deleted_at (admin xoá theo khoảng thời gian thì xoá cứng)."""
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    participant_id = Column(Integer, ForeignKey("chat_participants.id"), nullable=True)
    kind = Column(String(10), nullable=False, default="text")
    body = Column(Text, nullable=True)
    reply_to_id = Column(Integer, ForeignKey("chat_messages.id"), nullable=True)
    poll_id = Column(Integer, ForeignKey("chat_polls.id"), nullable=True)
    mention_ids = Column(JSON, nullable=True)
    pinned = Column(Boolean, nullable=False, default=False)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    participant = relationship("ChatParticipant")
    poll = relationship("ChatPoll", foreign_keys=[poll_id])


class ChatPoll(Base):
    """Bình chọn kiểu Zalo: options = [{"id": "a1", "text": "..."}], multi, anonymous, allow_add, closes_at."""
    __tablename__ = "chat_polls"
    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    participant_id = Column(Integer, ForeignKey("chat_participants.id"), nullable=True)
    question = Column(String(200), nullable=False)
    options = Column(JSON, nullable=False)
    multi = Column(Boolean, nullable=False, default=False)
    anonymous = Column(Boolean, nullable=False, default=False)
    allow_add = Column(Boolean, nullable=False, default=False)
    closes_at = Column(DateTime, nullable=True)
    closed = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=func.now())

    creator = relationship("ChatParticipant")


class ChatVote(Base):
    __tablename__ = "chat_votes"
    id = Column(Integer, primary_key=True, index=True)
    poll_id = Column(Integer, ForeignKey("chat_polls.id"), nullable=False, index=True)
    participant_id = Column(Integer, ForeignKey("chat_participants.id"), nullable=False)
    option_id = Column(String(16), nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    __table_args__ = (UniqueConstraint("poll_id", "participant_id", "option_id", name="uq_chat_vote"),)


class ClubBotMessage(Base):
    """Lịch sử hội thoại BOT CLB (2026-10-29): lưu máy chủ theo (club, user) — quyết định người dùng: KHÔNG lưu trên thiết bị.
    role: bot | me; rows: bảng tóm tắt (JSON [[k, v], …]); kind: result | error | None. created_at UTC (ghi bằng utcnow)."""
    __tablename__ = "club_bot_messages"
    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role = Column(String(5), nullable=False)
    text = Column(Text, nullable=False)
    rows = Column(JSON, nullable=True)
    kind = Column(String(10), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now(), index=True)   # main ghi utcnow tường minh


class ZaloGroup(Base):
    """2026-10-30: nhóm Zalo đích của CLB. Nhận diện tự động khi bot được thêm vào nhóm và được @nhắc tên (webhook/getUpdates).
    Sự kiện Zalo không kèm tên nhóm → admin đặt nhãn; enabled do admin; failures/last_error để tự tắt khi chat_id hỏng (410)."""
    __tablename__ = "zalo_groups"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    chat_id = Column(String(60), nullable=False)
    label = Column(String(200), nullable=True)
    added_by = Column(String(100), nullable=True)      # display_name người @nhắc bot lần đầu
    first_text = Column(Text, nullable=True)           # nội dung tin @nhắc đầu tiên (giúp admin nhận ra nhóm)
    enabled = Column(Boolean, default=True, nullable=False)
    failures = Column(Integer, default=0, nullable=False)
    last_error = Column(String(300), nullable=True)
    last_sent_at = Column(DateTime, nullable=True)
    # 2026-10-30: duyệt nhóm — mọi thành viên trong nhóm có bot đều @nhắc được (đã kiểm chứng), nên nhóm mới KHÔNG tự nhận thông báo:
    # pending (chờ duyệt, tắt) | approved (đã duyệt, enabled do admin) | blocked (đã chặn, bỏ qua sự kiện). Nhóm cũ (trước đợt này) = approved.
    status = Column(String(10), default="approved", nullable=False, server_default="approved")
    added_by_id = Column(String(60), nullable=True)    # from.id Zalo của người @nhắc lần đầu (để "tin cậy người này")
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("club_id", "chat_id", name="uq_zalo_group_per_club"),)


class ZaloAllowedSender(Base):
    """2026-10-30: người được phép tự thêm nhóm — @nhắc bot trong nhóm mới thì nhóm được duyệt luôn (theo from.id Zalo, do Zalo ký qua webhook).
    Người khác @nhắc → nhóm vào hàng chờ duyệt. Xoá khi ngắt kết nối bot."""
    __tablename__ = "zalo_allowed_senders"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    sender_id = Column(String(60), nullable=False)
    display_name = Column(String(100), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("club_id", "sender_id", name="uq_zalo_allowed_per_club"),)


class ZaloPushLog(Base):
    """Chống gửi trùng Zalo theo (thông báo, ngày xuất hiện, nhóm, ngày gửi) — như web_push_log. Nhắc trước giờ bắt đầu dùng
    announcement_pre_remind_log channel 'zl' (target_id = zalo_groups.id)."""
    __tablename__ = "zalo_push_log"

    id = Column(Integer, primary_key=True, index=True)
    announcement_id = Column(Integer, ForeignKey("announcements.id"), nullable=False, index=True)
    occurrence_date = Column(Date, nullable=False)
    group_id = Column(Integer, ForeignKey("zalo_groups.id"), nullable=False)
    send_date = Column(Date, nullable=False)
    sent_at = Column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("announcement_id", "occurrence_date", "group_id", "send_date", name="uq_zalo_push_per_day"),)


class AnnouncementPushHistory(Base):
    """2026-10-30: LỊCH SỬ ĐẨY thông báo để admin tra "tin này ai gửi, lúc nào, kênh nào". Mỗi dòng = một thông báo × một kênh trong một lượt gửi
    (gộp theo người nhận: sent_count/error_count; detail = ✔/✖ từng nhóm Zalo hoặc lỗi). Không ghi lượt bị bỏ qua vì đã gửi.
    Tự xoá: chỉ giữ PUSH_HISTORY_DAYS (7) ngày theo lịch VN gần nhất (hôm nay và 6 ngày trước), xoá ngày xa nhất.
    announcement_id KHÔNG khoá ngoại + title chụp lại → xoá quy tắc vẫn giữ dòng lịch sử cho tới khi hết hạn."""
    __tablename__ = "announcement_push_history"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    announcement_id = Column(Integer, nullable=True, index=True)
    title = Column(String(200), nullable=False)
    kind = Column(String(20), nullable=False, default="schedule")
    channel = Column(String(10), nullable=False)      # telegram | web | zalo
    source = Column(String(10), nullable=False)       # cron (tự động) | save (khi lưu quy tắc) | manual (nút Gửi ngay)
    pre = Column(Boolean, nullable=False, default=False)   # lần nhắc trước giờ bắt đầu
    sent_count = Column(Integer, nullable=False, default=0)
    error_count = Column(Integer, nullable=False, default=0)
    detail = Column(String(400), nullable=True)
    sent_at = Column(DateTime, nullable=False, index=True)   # UTC (suy ra từ _now_vn() − 7h để test điều khiển được đồng hồ)
