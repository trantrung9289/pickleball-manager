from pydantic import BaseModel, Field, AliasChoices, ConfigDict, field_validator
from typing import Optional, List, Any, Dict
from datetime import date, datetime
from decimal import Decimal
from enum import Enum


# ── AUTH & CLUB ────────────────────────────────────────────

class ClubSetup(BaseModel):
    club_name: str
    sport: str
    description: Optional[str] = None
    founded_year: Optional[int] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    admin_username: str
    admin_password: str
    admin_full_name: str

class ClubUpdate(BaseModel):
    name: Optional[str] = None
    sport: Optional[str] = None
    description: Optional[str] = None
    founded_year: Optional[int] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    bot_enabled: Optional[bool] = None   # superuser cấp/tắt quyền dùng bot Telegram cho cả CLB
    brand_color: Optional[str] = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")   # màu thương hiệu

class ClubOut(BaseModel):
    id: int
    name: str
    sport: str
    description: Optional[str] = None
    founded_year: Optional[int] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    bot_enabled: bool = True
    brand_color: Optional[str] = None     # "#RRGGBB" | None = mặc định
    logo_src: Optional[str] = None        # "/api/public/club-logo/{id}?v=hash" | None (2026-10-28, logo lưu trong DB)
    class Config:
        from_attributes = True


class ClubAppearanceIn(BaseModel):
    brand_color: Optional[str] = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")   # None/"" → về mặc định

class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    username: str
    password: str
    full_name: str
    role: str = "member"

class UserOut(BaseModel):
    id: int
    username: str
    full_name: Optional[str] = None
    role: str
    is_superuser: bool = False
    class Config:
        from_attributes = True

class UserCreate(BaseModel):
    username: str
    password: str
    full_name: str
    role: str = "member"
    is_superuser: bool = False

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_superuser: Optional[bool] = None
    password: Optional[str] = None

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

class MembershipCreate(BaseModel):
    user_id: int
    club_id: int
    role: str = "member"
    can_view: bool = True
    can_create: bool = False
    can_edit: bool = False
    can_delete: bool = False
    bot_enabled: bool = True

class MembershipUpdate(BaseModel):
    role: Optional[str] = None
    can_view: Optional[bool] = None
    can_create: Optional[bool] = None
    can_edit: Optional[bool] = None
    can_delete: Optional[bool] = None
    bot_enabled: Optional[bool] = None   # superuser bật/tắt bot theo tài khoản, không vướng luật "không tự tắt mình"

class MembershipOut(BaseModel):
    id: int
    user_id: int
    club_id: int
    role: str
    can_view: bool
    can_create: bool
    can_edit: bool
    can_delete: bool
    bot_enabled: bool = True
    user: Optional[UserOut] = None
    club: Optional[ClubOut] = None
    class Config:
        from_attributes = True

# Danh sách tài khoản của CLB nhìn từ phía club admin (cấp quyền dùng bot) —
# không lộ telegram_chat_id thật, chỉ báo đã liên kết hay chưa.
class ClubMemberAccountOut(BaseModel):
    id: int
    user_id: int
    username: str
    full_name: Optional[str] = None
    role: str
    bot_enabled: bool
    telegram_linked: bool
    is_self: bool

class BotEnabledUpdate(BaseModel):
    enabled: bool


class MemberStatus(str, Enum):
    active = "active"
    inactive = "inactive"
    suspended = "suspended"


class FeeTypeCategory(str, Enum):
    income = "income"
    expense = "expense"


class TournamentFormat(str, Enum):
    round_robin = "round_robin"
    round_robin_double = "round_robin_double"
    knockout = "knockout"
    combined = "combined"
    individual = "individual"


class TournamentStatus(str, Enum):
    draft = "draft"
    active = "active"
    completed = "completed"


# ── Member ────────────────────────────────────────────────
class MemberBase(BaseModel):
    full_name: str
    dob: Optional[date] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    join_date: Optional[date] = None
    status: MemberStatus = MemberStatus.active
    rank: Optional[str] = None
    gender: Optional[str] = None      # male | female | other
    address: Optional[str] = None
    notes: Optional[str] = None


class MemberCreate(MemberBase):
    member_code: Optional[str] = None


class MemberUpdate(BaseModel):
    full_name: Optional[str] = None
    dob: Optional[date] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    join_date: Optional[date] = None
    status: Optional[MemberStatus] = None
    rank: Optional[str] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


class MemberOut(MemberBase):
    id: int
    member_code: Optional[str] = None   # luôn có sau _backfill_member_codes; Optional để một dòng lỗi không làm cả danh sách 500
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── FeeType ───────────────────────────────────────────────
class FeeTypeBase(BaseModel):
    name: str
    type: FeeTypeCategory
    description: Optional[str] = None
    default_amount: Optional[Decimal] = None
    is_recurring: bool = False


class FeeTypeCreate(FeeTypeBase):
    pass


class FeeTypeUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[FeeTypeCategory] = None
    description: Optional[str] = None
    default_amount: Optional[Decimal] = None
    is_recurring: Optional[bool] = None


class FeeTypeOut(FeeTypeBase):
    id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Player (thành viên + khách mời) ──────────────────────

class PlayerCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    rank: Optional[str] = "Chưa xếp hạng"
    gender: Optional[str] = None      # male | female | other
    member_id: Optional[int] = None  # NULL = khách mời


class PlayerOut(BaseModel):
    id: int
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    rank: Optional[str] = "Chưa xếp hạng"
    gender: Optional[str] = None
    member_id: Optional[int] = None
    club_id: int
    is_guest: bool = False  # computed field

    class Config:
        from_attributes = True


# ── Transaction ───────────────────────────────────────────
class TransactionBase(BaseModel):
    fee_type_id: int
    member_id: Optional[int] = None
    player_id: Optional[int] = None  # gán khoản thu cho khách mời (Player.member_id IS NULL)
    amount: Decimal
    transaction_date: date
    description: Optional[str] = None
    payment_method: str = "Chuyển khoản"


class TransactionCreate(TransactionBase):
    pass


class TransactionOut(TransactionBase):
    id: int
    type: FeeTypeCategory
    created_at: Optional[datetime] = None
    fee_type: Optional[FeeTypeOut] = None
    member: Optional[MemberOut] = None
    player: Optional[PlayerOut] = None

    class Config:
        from_attributes = True


# ── Tournament ────────────────────────────────────────────
class PartnerRule(BaseModel):
    """Một quy tắc ghép ĐỒNG ĐỘI theo hạng (giải đôi), shape v2: người 1 có hạng ∈ ranks1, người 2 có hạng ∈ ranks2.
    Bên rỗng = bất kỳ hạng. rank1/rank2 (chuỗi) là shape cũ — được normalize_partner_rules gộp vào ranks1/ranks2."""
    ranks1: List[str] = []
    ranks2: List[str] = []
    rank1: Optional[str] = None
    rank2: Optional[str] = None


class PartnerRuleOut(BaseModel):
    """Quy tắc ghép đội đã chuẩn hoá (đầu ra) — chỉ shape v2, không kèm rank1/rank2 cũ."""
    ranks1: List[str] = []
    ranks2: List[str] = []


class RankLevelsIn(BaseModel):
    """Cấu hình danh sách hạng của CLB (không gồm 'Chưa xếp hạng' — hạng ngầm định)."""
    rank_levels: List[str]


class RankLevelsOut(BaseModel):
    rank_levels: List[str]
    unranked_label: str
    in_use: Dict[str, int] = {}   # hạng → số người (thành viên + khách mời của CLB) đang mang hạng đó


class BulkParticipantsIn(BaseModel):
    """Thêm hàng loạt người chơi đơn lẻ vào giải (Nháp)."""
    member_ids: List[int] = []
    player_ids: List[int] = []


class TournamentCreate(BaseModel):
    name: str
    format: TournamentFormat
    team_type: str = "singles"          # singles | doubles
    pairing_mode: str = "random"
    rank_rules: Optional[List[Dict[str, str]]] = None
    num_groups: int = Field(default=2, ge=1, le=16)
    description: Optional[str] = None
    member_ids: Optional[List[int]] = None   # singles: thành viên CLB
    player_ids: Optional[List[int]] = None   # singles: khách mời (Player.id)
    teams: Optional[List[Dict]] = None       # doubles: [{member_id?, player_id?, partner_member_id?, partner_player_id?, team_name?}]
    partner_rules: Optional[List[PartnerRule]] = None   # doubles không teams: quy tắc ghép đội cho vòng quay sau này
    score_pin: Optional[str] = None          # PIN 4 số — cho phép nhập điểm qua public
    public_scoring_enabled: bool = False
    third_place_enabled: bool = False        # có trận tranh giải 3 không (knockout/combined, cần ≥4 đội)
    placement_matches_enabled: bool = False  # tranh hạng 5-6 / 7-8 (combined đúng 2 bảng)
    team_rules: Optional[Dict[str, Any]] = None   # bắt buộc khi team_type == "team" (xem normalize_team_rules)


class TournamentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TournamentStatus] = None
    format: Optional[TournamentFormat] = None
    team_type: Optional[str] = None
    pairing_mode: Optional[str] = None
    rank_rules: Optional[List[Dict[str, str]]] = None
    num_groups: Optional[int] = Field(default=None, ge=1, le=16)
    third_place_enabled: Optional[bool] = None
    placement_matches_enabled: Optional[bool] = None
    team_rules: Optional[Dict[str, Any]] = None


class ParticipantSlotUpdate(BaseModel):
    slot: str                              # "main" | "partner"
    member_id: Optional[int] = None
    player_id: Optional[int] = None
    team_name: Optional[str] = None        # nếu bỏ trống sẽ tự tính lại


class ParticipantCreate(BaseModel):
    member_id: Optional[int] = None
    player_id: Optional[int] = None
    partner_member_id: Optional[int] = None
    partner_player_id: Optional[int] = None
    team_name: Optional[str] = None


class ParticipantOut(BaseModel):
    id: int
    member_id: Optional[int] = None
    player_id: Optional[int] = None
    partner_member_id: Optional[int] = None
    partner_player_id: Optional[int] = None
    team_name: Optional[str] = None
    seed: Optional[int] = None
    group_name: Optional[str] = None
    status: str = "active"   # active | withdrawn (bỏ giải)
    member: Optional[MemberOut] = None
    partner: Optional[MemberOut] = None
    player: Optional[PlayerOut] = None
    partner_player: Optional[PlayerOut] = None

    class Config:
        from_attributes = True


class MatchOut(BaseModel):
    id: int
    round_number: int
    round_name: Optional[str] = None
    match_number: int
    group_name: Optional[str] = None
    phase: str
    p1_id: Optional[int] = None
    p2_id: Optional[int] = None
    btc_note: Optional[str] = None     # ghi chú BTC (giải đồng đội)
    score1: Optional[int] = None
    score2: Optional[int] = None
    winner_id: Optional[int] = None
    status: str
    is_walkover: bool = False   # thắng do đối thủ bỏ giải — không có tỉ số thật
    next_match_id: Optional[int] = None
    next_match_slot: Optional[int] = None
    loser_next_match_id: Optional[int] = None
    loser_next_match_slot: Optional[int] = None
    rubber_draw_seed: Optional[str] = None   # giải đồng đội: đã bốc thăm thứ tự trận thành phần chưa
    rubbers: List["MatchRubberOut"] = []     # giải đồng đội: trận thành phần (relationship selectin) — giải thường: []
    p1: Optional[ParticipantOut] = None
    p2: Optional[ParticipantOut] = None
    winner: Optional[ParticipantOut] = None

    class Config:
        from_attributes = True


class MatchRubberOut(BaseModel):
    """Trận thành phần nhúng trong MatchOut/PublicMatchOut (đọc thẳng ORM) — lịch/nhánh hiện chi tiết không cần mở biên bản."""
    id: int
    order_index: int
    code: str
    label: str
    side1_players: List[int] = []
    side2_players: List[int] = []
    score1: Optional[int] = None
    score2: Optional[int] = None
    status: str = "pending"
    is_walkover: bool = False
    court: Optional[str] = None
    start1: int = 0
    start2: int = 0

    @field_validator("side1_players", "side2_players", mode="before")
    @classmethod
    def _none_to_list(cls, v):
        return list(v or [])

    model_config = ConfigDict(from_attributes=True)


# ── Bốc thăm bằng vòng quay ────────────────────────────────
class DrawStepOut(BaseModel):
    step_index: int
    participant_id: int
    slot_label: str
    pick_index: int
    spun_at: Optional[datetime] = None
    spun_at_ms: int

    class Config:
        from_attributes = True


class DrawSummaryOut(BaseModel):
    """Tóm tắt phiên bốc thăm mới nhất — nhúng vào TournamentOut / PublicTournamentOut."""
    id: int
    seq: int
    status: str
    total_steps: int
    done_steps: int
    reveal_ms: int

    class Config:
        from_attributes = True


class DrawOut(BaseModel):
    """Trả bởi các endpoint draw (build bằng hàm _draw_out trong main.py, không from_orm trực tiếp).
    Chỉ chứa participant_id — không có PII, dùng chung cho admin lẫn public."""
    id: int
    tournament_id: int
    seq: int
    status: str
    format: str
    num_groups: int
    total_steps: int
    done_steps: int
    reveal_ms: int
    force: bool = False
    pool: List[int]
    seed_commit: str
    seed_hex: Optional[str] = None      # chỉ lộ khi status != open (commit–reveal)
    steps: List[DrawStepOut] = []
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    committed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    cancel_reason: Optional[str] = None
    server_now_ms: int


class DrawOpenIn(BaseModel):
    force: bool = False
    reveal_ms: int = Field(5000, ge=1500, le=15000)


class DrawSpinIn(BaseModel):
    expected_step: int = Field(ge=0)


class DrawCommitIn(BaseModel):
    force: bool = False


class DrawCancelIn(BaseModel):
    reason: Optional[str] = Field(None, max_length=200)


# ── Ghép đội đôi bằng vòng quay (partner draw) ─────────────
# (PartnerRule khai báo phía trên TournamentCreate vì được dùng ở đó)
class PartnerDrawOpenIn(BaseModel):
    rules: Optional[List[PartnerRule]] = None   # None → dùng tournament.partner_rules; [] → ngẫu nhiên toàn bộ
    reveal_ms: int = Field(5000, ge=1500, le=15000)


class PartnerDrawSpinIn(BaseModel):
    expected_step: int = Field(ge=0)


class PartnerDrawCancelIn(BaseModel):
    reason: Optional[str] = Field(None, max_length=200)


class PairParticipantsIn(BaseModel):
    """Ghép tay 2 người đơn lẻ thành 1 đội."""
    p1_id: int
    p2_id: int


class PartnerPoolPersonOut(BaseModel):
    pid: int
    member_id: Optional[int] = None
    player_id: Optional[int] = None
    name: str
    rank: str


class PartnerDrawStepOut(BaseModel):
    step_index: int
    team_index: int
    side: int
    phase_index: int
    pid: int
    member_id: Optional[int] = None
    player_id: Optional[int] = None
    pick_index: int
    auto: bool = False
    eligible_pids: List[int] = []
    spun_at: Optional[datetime] = None
    spun_at_ms: int


class PartnerDrawNextOut(BaseModel):
    step_index: int
    team_index: int
    side: int
    phase_index: int
    eligible_pids: List[int] = []


class PartnerDrawOut(BaseModel):
    """Build bằng hàm _partner_draw_out(draw, t) trong main.py, không from_orm.
    Pool chỉ có pid/member_id/player_id/name/rank — không PII, dùng chung admin & public."""
    id: int
    tournament_id: int
    seq: int
    status: str
    total_steps: int
    done_steps: int
    reveal_ms: int
    finished: bool = False                            # hết lượt hợp lệ (replay → không còn cặp); số lượt có thể < total_steps (trần)
    stuck: bool = False                               # lượt cuối bên 1 mà bên 2 không còn ai (dữ liệu hỏng/phiên cũ) → huỷ phiên và mở lại
    pool: List[PartnerPoolPersonOut] = []
    rules: List[PartnerRuleOut] = []                  # luôn shape v2 (ranks1/ranks2) kể cả phiên cũ
    plan: Dict[str, Any] = {}                         # luôn v2 (phiên cũ được _normalize_partner_plan): phases[{index, ranks1, ranks2, team_max (dự kiến), team_cap (trần), overlap}], total_steps_max (trần thật), total_steps_est (dự kiến), unpaired_pids, estimated
    next_step: Optional[PartnerDrawNextOut] = None   # None khi finished/stuck hoặc phiên không còn open
    steps: List[PartnerDrawStepOut] = []
    seed_commit: str
    seed_hex: Optional[str] = None      # chỉ lộ khi status != open (commit–reveal)
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    committed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    cancel_reason: Optional[str] = None
    server_now_ms: int


# ── Vòng quay PHÂN VĐV VÀO ĐỘI (giải đồng đội, 2026-10-22) ──
class TeamDrawRuleIn(BaseModel):
    """Một vòng phân bổ: lọc theo hạng (rỗng = mọi hạng) và giới tính (rỗng = mọi giới), per_team = trần mỗi đội
    trong vòng (None = chia đều tới hết)."""
    ranks: List[str] = []
    genders: List[str] = []
    per_team: Optional[int] = Field(default=None, ge=1, le=50)


class TeamDrawOpenIn(BaseModel):
    rules: List[TeamDrawRuleIn] = []
    reveal_ms: int = Field(5000, ge=1500, le=15000)


class TeamDrawSpinIn(BaseModel):
    expected_step: int = Field(ge=0)


class TeamDrawCancelIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=200)


class TeamDrawSummaryOut(BaseModel):
    """Tóm tắt phiên phân đội mới nhất — nhúng vào TournamentOut / PublicTournamentOut."""
    id: int
    seq: int
    status: str
    total_steps: int
    done_steps: int
    finished: bool = False
    reveal_ms: int

    class Config:
        from_attributes = True


class PartnerDrawSummaryOut(BaseModel):
    """Tóm tắt phiên ghép đội mới nhất — nhúng vào TournamentOut / PublicTournamentOut."""
    id: int
    seq: int
    status: str
    total_steps: int
    done_steps: int
    finished: bool = False   # property TournamentPartnerDraw.finished
    stuck: bool = False      # property TournamentPartnerDraw.stuck
    reveal_ms: int

    class Config:
        from_attributes = True


class TeamPlayerLiteOut(BaseModel):
    """VĐV của giải đồng đội nhúng trong TournamentOut/PublicTournamentOut (from_attributes trực tiếp từ ORM) —
    để lịch/nhánh/public tra tên cho trận thành phần mà không gọi thêm API."""
    id: int
    participant_id: Optional[int] = None
    member_id: Optional[int] = None
    player_id: Optional[int] = None
    display_name: str
    gender: Optional[str] = Field(default=None, validation_alias=AliasChoices("gender", "gender_snapshot"))
    rank: Optional[str] = Field(default=None, validation_alias=AliasChoices("rank", "rank_snapshot"))
    is_captain: bool = False

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class TournamentOut(BaseModel):
    id: int
    name: str
    format: TournamentFormat
    status: TournamentStatus
    team_type: str = "singles"
    pairing_mode: str
    rank_rules: Optional[Any] = None
    partner_rules: Optional[Any] = None     # quy tắc ghép đồng đội (giải đôi) — độc lập với rank_rules
    num_groups: int
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    public_scoring_enabled: bool = False
    third_place_enabled: bool = False
    placement_matches_enabled: bool = False
    has_score_pin: bool = False
    team_rules: Optional[Any] = None        # quy tắc giải đồng đội (team_type == "team")
    participants: List[ParticipantOut] = []
    matches: List[MatchOut] = []
    draw: Optional[DrawSummaryOut] = None   # phiên bốc thăm mới nhất (property Tournament.draw)
    partner_draw: Optional[PartnerDrawSummaryOut] = None   # phiên ghép đội mới nhất (property Tournament.partner_draw)
    unpaired_count: int = 0                 # số người chưa có đội (giải đôi)
    team_players: List[TeamPlayerLiteOut] = []   # giải đồng đội: mọi VĐV (participant_id None = chưa phân đội)
    team_pool_count: int = 0                # giải đồng đội: số VĐV tham dự chưa phân đội
    team_draw: Optional[TeamDrawSummaryOut] = None   # phiên phân VĐV vào đội mới nhất (property Tournament.team_draw)

    class Config:
        from_attributes = True


class BulkParticipantsOut(BaseModel):
    """Kết quả thêm hàng loạt: số người đã thêm, tên những người bị bỏ qua (đã có trong giải), giải sau khi thêm."""
    added: int
    skipped: List[str] = []
    tournament: TournamentOut


# ── Public (không đăng nhập): chỉ tên + hạng, KHÔNG có SĐT/email/địa chỉ/ghi chú ──
class PublicPersonOut(BaseModel):
    id: int
    full_name: str
    rank: Optional[str] = None

    class Config:
        from_attributes = True


class PublicPlayerOut(BaseModel):
    id: int
    name: str
    rank: Optional[str] = None

    class Config:
        from_attributes = True


class PublicParticipantOut(BaseModel):
    id: int
    member_id: Optional[int] = None
    player_id: Optional[int] = None
    partner_member_id: Optional[int] = None
    partner_player_id: Optional[int] = None
    team_name: Optional[str] = None
    seed: Optional[int] = None
    group_name: Optional[str] = None
    status: str = "active"
    member: Optional[PublicPersonOut] = None
    partner: Optional[PublicPersonOut] = None
    player: Optional[PublicPlayerOut] = None
    partner_player: Optional[PublicPlayerOut] = None

    class Config:
        from_attributes = True


class PublicMatchOut(BaseModel):
    id: int
    round_number: int
    round_name: Optional[str] = None
    match_number: int
    group_name: Optional[str] = None
    phase: str
    p1_id: Optional[int] = None
    p2_id: Optional[int] = None
    btc_note: Optional[str] = None     # ghi chú BTC (giải đồng đội)
    score1: Optional[int] = None
    score2: Optional[int] = None
    winner_id: Optional[int] = None
    status: str
    is_walkover: bool = False
    next_match_id: Optional[int] = None
    next_match_slot: Optional[int] = None
    rubbers: List[MatchRubberOut] = []   # giải đồng đội: trận thành phần (id VĐV → tra PublicTournamentOut.team_players)
    p1: Optional[PublicParticipantOut] = None
    p2: Optional[PublicParticipantOut] = None
    winner: Optional[PublicParticipantOut] = None

    class Config:
        from_attributes = True


class PublicTournamentOut(BaseModel):
    id: int
    name: str
    format: TournamentFormat
    status: TournamentStatus
    team_type: str = "singles"
    num_groups: int
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    public_scoring_enabled: bool = False
    third_place_enabled: bool = False
    placement_matches_enabled: bool = False
    has_score_pin: bool = False
    team_rules: Optional[Any] = None
    participants: List[PublicParticipantOut] = []
    matches: List[PublicMatchOut] = []
    draw: Optional[DrawSummaryOut] = None   # phiên bốc thăm mới nhất (property Tournament.draw)
    partner_draw: Optional[PartnerDrawSummaryOut] = None   # phiên ghép đội mới nhất
    unpaired_count: int = 0
    team_players: List[TeamPlayerLiteOut] = []   # chỉ tên/giới tính/hạng — không SĐT
    team_pool_count: int = 0
    team_draw: Optional[TeamDrawSummaryOut] = None

    class Config:
        from_attributes = True


class ScoreUpdate(BaseModel):
    score1: int = Field(ge=0, le=999)
    score2: int = Field(ge=0, le=999)


class ScorePinUpdate(BaseModel):
    enabled: bool
    pin: Optional[str] = None    # 4 chữ số — bỏ trống nếu chỉ đổi enabled, giữ nguyên PIN cũ


class ThirdPlaceUpdate(BaseModel):
    """Bật/tắt trận tranh giải 3 — được phép cả khi giải đang diễn ra (khác SETUP_FIELDS chỉ sửa khi Nháp)."""
    enabled: bool


class PublicScoreUpdate(BaseModel):
    pin: str
    score1: int = Field(ge=0, le=999)
    score2: int = Field(ge=0, le=999)


# ── Reports ───────────────────────────────────────────────
class MonthlySummary(BaseModel):
    month: int
    year: int
    total_income: Decimal
    total_expense: Decimal
    balance: Decimal


class Token(BaseModel):
    access_token: str
    token_type: str


class LoginRequest(BaseModel):
    username: str
    password: str


# ── SỰ KIỆN THÀNH TÍCH CÁ NHÂN (Mini game) ────────────────
class PointEventCreate(BaseModel):
    name: Optional[str] = None           # rỗng/khoảng trắng → "Mini game dd/mm/yyyy" (giờ VN)
    description: Optional[str] = None
    member_ids: List[int] = []
    player_ids: List[int] = []


class PointEventUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TournamentStatus] = None


class PointEventBulkIn(BaseModel):
    member_ids: List[int] = []
    player_ids: List[int] = []


class PointDeltaIn(BaseModel):
    delta: int
    client_op_id: str = Field(min_length=1, max_length=40)   # chống ghi trùng khi client retry


class PointParticipantOut(BaseModel):
    id: int
    member_id: Optional[int] = None
    player_id: Optional[int] = None
    display_name: str
    rank_snapshot: Optional[str] = None
    seq: int
    points: int = 0
    status: str = "active"          # active | removed

    class Config:
        from_attributes = True


class PointEventListOut(BaseModel):
    """Bản nhẹ cho danh sách: KHÔNG nhúng participants. Dựng bằng helper _point_event_out(ev) trong main.py."""
    id: int
    kind: str = "mini_game"
    name: str
    description: Optional[str] = None
    status: TournamentStatus
    version: int = 0
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    participant_count: int = 0      # số participant status == "active"
    log_count: int = 0              # số log kind == "score"


class PointEventOut(PointEventListOut):
    participants: List[PointParticipantOut] = []


class PointStateParticipantOut(BaseModel):
    id: int
    points: int
    status: str


class PointEventStateOut(BaseModel):
    """Trạng thái gọn để poll: chỉ version + status + điểm từng người."""
    version: int
    status: TournamentStatus
    log_count: int = 0          # số lượt chấm (kind=score) — để máy quan sát cập nhật "N lượt chấm" khi poll
    participants: List[PointStateParticipantOut] = []


class PointLogOut(BaseModel):
    id: int
    kind: str
    participant_id: Optional[int] = None
    display_name: Optional[str] = None   # lấy từ participant (None với log trạng thái)
    delta: int = 0
    points_after: int = 0
    note: Optional[str] = None
    actor_name: Optional[str] = None     # KHÔNG đưa ra public
    created_at: Optional[datetime] = None


class PointEventBulkOut(BaseModel):
    added: int
    skipped: List[str] = []
    event: PointEventOut


# ── Giải ĐỒNG ĐỘI (team_type="team") ─────────────────────────────────────────

class TeamCreate(BaseModel):
    team_name: str = Field(min_length=1, max_length=200)


class TeamUpdate(BaseModel):
    team_name: Optional[str] = Field(default=None, min_length=1, max_length=200)


class TeamPlayersBulkIn(BaseModel):
    member_ids: List[int] = []
    player_ids: List[int] = []
    participant_id: Optional[int] = None   # endpoint cấp giải: None = thêm vào "VĐV tham dự" (chưa phân đội)


class TeamPlayerPatch(BaseModel):
    is_captain: Optional[bool] = None
    gender: Optional[str] = None      # sửa snapshot giới tính khi chưa khai
    rank: Optional[str] = None        # sửa snapshot hạng ("" → xoá hạng)
    # Endpoint cấp giải: có mặt trong body → phân vào đội (int) hoặc gỡ về danh sách tham dự (null);
    # phân biệt "vắng" / null bằng model_fields_set
    participant_id: Optional[int] = None


class TeamPlayerOut(BaseModel):
    id: int
    participant_id: Optional[int] = None   # None = VĐV tham dự chưa phân đội
    member_id: Optional[int] = None
    player_id: Optional[int] = None
    display_name: str
    gender: Optional[str] = None      # = gender_snapshot
    rank: Optional[str] = None        # = rank_snapshot
    is_captain: bool = False

    class Config:
        from_attributes = True


class TeamBulkCreateIn(BaseModel):
    count: int = Field(ge=1, le=64)
    prefix: str = Field(default="Đội", max_length=100)


class TeamOut(BaseModel):
    participant: ParticipantOut
    players: List[TeamPlayerOut] = []


class TeamPlayersAddOut(BaseModel):
    """Kết quả thêm VĐV cấp giải: vào đội (team) hoặc vào danh sách tham dự (team = None)."""
    added: int
    skipped: List[str] = []
    team: Optional[TeamOut] = None
    pool_count: int = 0


class TeamPlayerAssignItem(BaseModel):
    tpid: int
    participant_id: Optional[int] = None   # None = gỡ về danh sách tham dự


class TeamPlayersAssignIn(BaseModel):
    """Phân đội thủ công theo lô (bảng phân đội): nhiều VĐV → đội / gỡ, áp dụng nguyên tử."""
    assignments: List[TeamPlayerAssignItem] = Field(min_length=1, max_length=500)


class TeamPlayersAssignOut(BaseModel):
    updated: List[TeamPlayerOut]
    pool_count: int = 0


class TeamPlayersBulkOut(BaseModel):
    added: int
    skipped: List[str] = []
    team: TeamOut


class LineupIn(BaseModel):
    slots: Dict[str, List[int]]       # {"Đôi Nam 1": [team_player_id, ...]}


class LineupUnlockIn(BaseModel):
    note: str = Field(min_length=1, max_length=200)


class LineupOut(BaseModel):
    stage_key: str
    slots: Dict[str, List[int]] = {}
    locked: bool = False
    locked_at: Optional[datetime] = None
    unlock_note: Optional[str] = None
    warnings: List[str] = []
    over_limit: List[int] = []        # team_player_id xuất hiện quá max_rubbers_per_player


class RubberPlayersIn(BaseModel):
    side1_players: Optional[List[int]] = None
    side2_players: Optional[List[int]] = None
    court: Optional[str] = None       # sân thi đấu ("" → xoá); đổi được cả khi trận đã có điểm


class MatchNoteIn(BaseModel):
    note: Optional[str] = Field(default=None, max_length=1000)   # ghi chú BTC cho trận đồng đội (null/"" → xoá)


class RubberScoreIn(BaseModel):
    score1: int = Field(ge=0, le=999)
    score2: int = Field(ge=0, le=999)


class RubberWalkoverIn(BaseModel):
    side: int = Field(ge=1, le=2)     # bên THUA (đến trễ / bỏ trận thành phần)


class RubberOut(BaseModel):
    id: int
    order_index: int
    code: str
    label: str
    side1_players: List[int] = []
    side2_players: List[int] = []
    score1: Optional[int] = None
    score2: Optional[int] = None
    status: str = "pending"
    is_walkover: bool = False
    start1: int = 0
    start2: int = 0
    court: Optional[str] = None
    target: int = 0                   # mốc điểm của trận thành phần này (PA2: cộng dồn)


class TieResultOut(BaseModel):
    score1: int = 0
    score2: int = 0
    winner_side: Optional[int] = None
    decided: bool = False
    finished: bool = False
    detail: Optional[str] = None


class TieOut(BaseModel):
    match: Any                        # MatchOut (admin) hoặc PublicMatchOut (public)
    stage_key: str
    rules: Dict[str, Any]
    rubbers: List[RubberOut] = []
    team1: Optional[TeamOut] = None
    team2: Optional[TeamOut] = None
    lineup1: Optional[LineupOut] = None
    lineup2: Optional[LineupOut] = None
    result: TieResultOut
    warnings: List[str] = []
    over_limit: List[int] = []
    draw_seed: Optional[str] = None
    can_edit: bool = True             # false khi giải không active / trận không còn thi đấu
    blocked_reason: Optional[str] = None   # lý do trận không nhập biên bản được (xử thắng bỏ giải, đội bỏ giải)


class TeamLogOut(BaseModel):
    id: int
    match_id: Optional[int] = None
    participant_id: Optional[int] = None
    kind: str
    note: Optional[str] = None
    actor_name: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── ANNOUNCEMENTS (thông báo trang public / chuông, 2026-10-27) ──────────────

class AnnouncementKind(str, Enum):
    schedule = "schedule"
    fee = "fee"


class AnnouncementRecurrence(str, Enum):
    none = "none"
    weekly = "weekly"
    monthly = "monthly"


class AnnouncementBase(BaseModel):
    kind: AnnouncementKind = AnnouncementKind.schedule
    title: str = Field(min_length=1, max_length=200)
    body: Optional[str] = None
    fee_type_id: Optional[int] = None
    recurrence: AnnouncementRecurrence = AnnouncementRecurrence.none
    weekdays: Optional[List[int]] = None
    day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    start_time: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    duration_min: Optional[int] = Field(default=None, ge=0, le=1440)
    lead_days: int = Field(default=3, ge=0, le=60)
    repeat_daily: bool = False
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_active: bool = True
    show_public: bool = True
    push_telegram: bool = False

    @field_validator("weekdays")
    @classmethod
    def _weekdays_valid(cls, v):
        if v is None:
            return v
        v = sorted(set(int(x) for x in v))
        if any(x < 0 or x > 6 for x in v):
            raise ValueError("weekdays phải trong 0..6 (0 = Thứ 2)")
        return v


def _check_announcement_rule(m):
    """Ràng buộc chéo giữa recurrence và các trường kèm theo."""
    if m.recurrence == AnnouncementRecurrence.weekly and not m.weekdays:
        raise ValueError("Lặp hàng tuần cần chọn ít nhất một thứ trong tuần")
    if m.recurrence == AnnouncementRecurrence.monthly and not m.day_of_month:
        raise ValueError("Lặp hàng tháng cần ngày trong tháng")
    if m.recurrence == AnnouncementRecurrence.none and not m.start_date:
        raise ValueError("Thông báo một lần cần ngày (start_date)")
    if m.kind == AnnouncementKind.fee and not m.fee_type_id:
        raise ValueError("Thông báo khoản thu cần fee_type_id")
    if m.start_date and m.end_date and m.end_date < m.start_date:
        raise ValueError("end_date phải sau start_date")
    return m


class AnnouncementCreate(AnnouncementBase):
    @field_validator("push_telegram", mode="after")
    @classmethod
    def _noop(cls, v):
        return v

    def model_post_init(self, __context):
        _check_announcement_rule(self)


class AnnouncementUpdate(BaseModel):
    kind: Optional[AnnouncementKind] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    body: Optional[str] = None
    fee_type_id: Optional[int] = None
    recurrence: Optional[AnnouncementRecurrence] = None
    weekdays: Optional[List[int]] = None
    day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    start_time: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    duration_min: Optional[int] = Field(default=None, ge=0, le=1440)
    lead_days: Optional[int] = Field(default=None, ge=0, le=60)
    repeat_daily: Optional[bool] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_active: Optional[bool] = None
    show_public: Optional[bool] = None
    push_telegram: Optional[bool] = None


class AnnouncementOut(AnnouncementBase):
    id: int
    club_id: int
    fee_type_name: Optional[str] = None
    recurrence_label: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ── WEB PUSH (người xem public, 2026-10-28) ──────────────────────────────────

class PushKeys(BaseModel):
    p256dh: str = Field(min_length=10, max_length=200)
    auth: str = Field(min_length=5, max_length=60)


class PushSubscribeIn(BaseModel):
    endpoint: str = Field(min_length=20, max_length=2000, pattern=r"^https://")
    keys: PushKeys
    user_agent: Optional[str] = Field(default=None, max_length=300)


class PushUnsubscribeIn(BaseModel):
    endpoint: str = Field(min_length=20, max_length=2000)


class PublicLinkPinIn(BaseModel):
    """Mã PIN link công khai: 4 hoặc 6 chữ số; None = bỏ PIN."""
    pin: Optional[str] = Field(default=None, pattern=r"^(\d{4}|\d{6})$")


# ── TRÒ CHUYỆN PUBLIC (2026-10-28) ──────────────────────────────────────────

class ChatJoinIn(BaseModel):
    display_name: str = Field(min_length=2, max_length=40)


class ChatMessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=500)
    reply_to_id: Optional[int] = None
    mention_ids: Optional[List[int]] = Field(default=None, max_length=10)


class ChatPollIn(BaseModel):
    question: str = Field(min_length=3, max_length=200)
    options: List[str] = Field(min_length=2, max_length=10)
    multi: bool = False
    anonymous: bool = False
    allow_add: bool = False
    closes_at: Optional[datetime] = None

    @field_validator("options")
    @classmethod
    def _opts(cls, v):
        cleaned = [str(x).strip()[:80] for x in v if str(x).strip()]
        if len(cleaned) < 2:
            raise ValueError("Cần ít nhất 2 lựa chọn")
        if len(set(c.lower() for c in cleaned)) != len(cleaned):
            raise ValueError("Lựa chọn trùng nhau")
        return cleaned


class ChatVoteIn(BaseModel):
    option_ids: List[str] = Field(max_length=10)


class ChatOptionIn(BaseModel):
    text: str = Field(min_length=1, max_length=80)

