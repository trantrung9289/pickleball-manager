from pydantic import BaseModel
from typing import Optional, List, Any, Dict
from datetime import date, datetime
from decimal import Decimal
from enum import Enum


# ── AUTH & CLUB ────────────────────────────────────────────

class ClubSetup(BaseModel):
    club_name: str
    sport: str = "Pickleball"
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
    user: Optional[UserOut] = None
    club: Optional[ClubOut] = None
    class Config:
        from_attributes = True


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
class TournamentCreate(BaseModel):
    name: str
    format: TournamentFormat
    team_type: str = "singles"          # singles | doubles
    pairing_mode: str = "random"
    rank_rules: Optional[List[Dict[str, str]]] = None
    num_groups: int = 2
    description: Optional[str] = None
    member_ids: Optional[List[int]] = None   # singles: thành viên CLB
    player_ids: Optional[List[int]] = None   # singles: khách mời (Player.id)
    teams: Optional[List[Dict]] = None       # doubles: [{member_id?, player_id?, partner_member_id?, partner_player_id?, team_name?}]


class TournamentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TournamentStatus] = None
    format: Optional[TournamentFormat] = None
    team_type: Optional[str] = None
    pairing_mode: Optional[str] = None
    rank_rules: Optional[List[Dict[str, str]]] = None
    num_groups: Optional[int] = None


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
    next_match_id: Optional[int] = None
    next_match_slot: Optional[int] = None
    p1: Optional[ParticipantOut] = None
    p2: Optional[ParticipantOut] = None
    winner: Optional[ParticipantOut] = None

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
    num_groups: int
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    participants: List[ParticipantOut] = []
    matches: List[MatchOut] = []

    class Config:
        from_attributes = True


class ScoreUpdate(BaseModel):
    score1: int
    score2: int


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
