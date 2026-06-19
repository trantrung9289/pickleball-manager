from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from database import get_db
import models

SECRET_KEY = "pickleball-clb-secret-key-2024-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 ngày

from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Chưa đăng nhập")
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Token không hợp lệ")
    except JWTError:
        raise HTTPException(status_code=401, detail="Token không hợp lệ hoặc đã hết hạn")

    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Tài khoản không tồn tại")
    return user


def require_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    if current_user.role != models.UserRole.admin:
        raise HTTPException(status_code=403, detail="Yêu cầu quyền Admin")
    return current_user


def require_superuser(current_user: models.User = Depends(get_current_user)) -> models.User:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Yêu cầu quyền Quản trị viên hệ thống")
    return current_user


class ClubPermissions:
    """Quyền của một user đối với một câu lạc bộ cụ thể."""
    def __init__(self, membership: models.ClubMembership):
        self.membership = membership
        self.club_id = membership.club_id
        self.is_club_admin = membership.role == models.UserRole.admin
        self.can_view    = self.is_club_admin or membership.can_view
        self.can_create  = self.is_club_admin or membership.can_create
        self.can_edit    = self.is_club_admin or membership.can_edit
        self.can_delete  = self.is_club_admin or membership.can_delete

    def require_view(self):
        if not self.can_view:
            raise HTTPException(403, "Bạn không có quyền xem dữ liệu này")

    def require_create(self):
        if not self.can_create:
            raise HTTPException(403, "Bạn không có quyền tạo mới")

    def require_edit(self):
        if not self.can_edit:
            raise HTTPException(403, "Bạn không có quyền chỉnh sửa")

    def require_delete(self):
        if not self.can_delete:
            raise HTTPException(403, "Bạn không có quyền xóa")


def get_club_permission(
    x_club_id: Optional[int] = Header(default=None, alias="X-Club-ID"),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClubPermissions:
    """Dependency: Xác thực quyền của user với CLB được chỉ định qua header X-Club-ID."""
    if current_user.is_superuser:
        raise HTTPException(403, "Tài khoản quản trị viên hệ thống không được truy cập chế độ thành viên")

    if not x_club_id:
        raise HTTPException(400, "Thiếu header X-Club-ID")

    club = db.query(models.Club).filter(models.Club.id == x_club_id).first()
    if not club:
        raise HTTPException(404, f"Không tìm thấy câu lạc bộ #{x_club_id}")

    membership = db.query(models.ClubMembership).filter(
        models.ClubMembership.user_id == current_user.id,
        models.ClubMembership.club_id == x_club_id,
    ).first()

    if not membership:
        raise HTTPException(403, "Bạn không có quyền truy cập câu lạc bộ này")

    return ClubPermissions(membership)
