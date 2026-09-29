from pydantic import BaseModel, Field
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

class ClubOut(BaseModel):
    id: int
    name: str
    sport: str
    description: Optional[str] = None
    founded_year: Optional[int] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    class Config:
        from_attributes = True

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

class MembershipUpdate(BaseModel):
    role: Optional[str] = None
    can_view: Optional[bool] = None
    can_create: Optional[bool] = None
    can_edit: Optional[bool] = None
    can_delete: Optional[bool] = None

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
    address: Optional[str] = None
    notes: Optional[str] = None


class MemberOut(MemberBase):
    id: int
    member_code: str
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
    remind_enabled: bool = False


class FeeTypeCreate(FeeTypeBase):
    pass


class FeeTypeUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[FeeTypeCategory] = None
    description: Optional[str] = None
    default_amount: Optional[Decimal] = None
    is_recurring: Optional[bool] = None
    remind_enabled: Optional[bool] = None


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
    member_id: Optional[int] = None  # NULL = khách mời


class PlayerOut(BaseModel):
    id: int
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    rank: Optional[str] = "Chưa xếp hạng"
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
    score1: Optional[int] = None
    score2: Optional[int] = None
    winner_id: Optional[int] = None
    status: str
    is_walkover: bool = False   # thắng do đối thủ bỏ giải — không có tỉ số thật
    next_match_id: Optional[int] = None
    next_match_slot: Optional[int] = None
    loser_next_match_id: Optional[int] = None
    p1: Optional[ParticipantOut] = None
    p2: Optional[ParticipantOut] = None
    winner: Optional[ParticipantOut] = None

    class Config:
        from_attributes = True


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
    has_score_pin: bool = False
    participants: List[ParticipantOut] = []
    matches: List[MatchOut] = []
    draw: Optional[DrawSummaryOut] = None   # phiên bốc thăm mới nhất (property Tournament.draw)
    partner_draw: Optional[PartnerDrawSummaryOut] = None   # phiên ghép đội mới nhất (property Tournament.partner_draw)
    unpaired_count: int = 0                 # số người chưa có đội (giải đôi)

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
    score1: Optional[int] = None
    score2: Optional[int] = None
    winner_id: Optional[int] = None
    status: str
    is_walkover: bool = False
    next_match_id: Optional[int] = None
    next_match_slot: Optional[int] = None
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
    has_score_pin: bool = False
    participants: List[PublicParticipantOut] = []
    matches: List[PublicMatchOut] = []
    draw: Optional[DrawSummaryOut] = None   # phiên bốc thăm mới nhất (property Tournament.draw)
    partner_draw: Optional[PartnerDrawSummaryOut] = None   # phiên ghép đội mới nhất
    unpaired_count: int = 0

    class Config:
        from_attributes = True


class ScoreUpdate(BaseModel):
    score1: int = Field(ge=0, le=999)
    score2: int = Field(ge=0, le=999)


class ScorePinUpdate(BaseModel):
    enabled: bool
    pin: Optional[str] = None    # 4 chữ số — bỏ trống nếu chỉ đổi enabled, giữ nguyên PIN cũ


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
