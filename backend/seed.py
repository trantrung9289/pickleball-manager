"""Seed dữ liệu mẫu cho CLB Pickleball"""
from database import SessionLocal, engine, Base
import models
from datetime import date, timedelta
import random

Base.metadata.create_all(bind=engine)
db = SessionLocal()

# Fee types
fee_types = [
    {"name": "Quỹ CLB hàng tháng", "type": "income", "default_amount": 100000, "is_recurring": True, "description": "Đóng quỹ định kỳ hàng tháng"},
    {"name": "Lệ phí thi đấu", "type": "income", "default_amount": 50000, "is_recurring": False, "description": "Phí tham gia giải đấu"},
    {"name": "Phí đăng ký thành viên mới", "type": "income", "default_amount": 200000, "is_recurring": False},
    {"name": "Mua bóng pickleball", "type": "expense", "default_amount": 500000, "is_recurring": False},
    {"name": "Thuê sân", "type": "expense", "default_amount": 300000, "is_recurring": True},
    {"name": "Mua trang phục CLB", "type": "expense", "default_amount": 250000, "is_recurring": False},
    {"name": "Tổ chức sự kiện", "type": "expense", "default_amount": 1000000, "is_recurring": False},
]
ft_objs = []
for f in fee_types:
    ft = models.FeeType(**f)
    db.add(ft)
    ft_objs.append(ft)
db.commit()
for ft in ft_objs:
    db.refresh(ft)

# Members
names = [
    "Nguyễn Văn An", "Trần Thị Bình", "Lê Văn Cường", "Phạm Thị Dung",
    "Hoàng Văn Em", "Võ Thị Phương", "Đặng Văn Giang", "Bùi Thị Hoa",
    "Ngô Văn Inh", "Đỗ Thị Kim", "Lý Văn Long", "Mai Thị Minh",
]
members = []
for i, name in enumerate(names):
    m = models.Member(
        member_code=f"TV{str(i+1).zfill(4)}",
        full_name=name,
        phone=f"09{random.randint(10000000, 99999999)}",
        join_date=date(2024, random.randint(1, 12), random.randint(1, 28)),
        status="active" if i < 10 else "inactive",
    )
    db.add(m)
    members.append(m)
db.commit()
for m in members:
    db.refresh(m)

# Transactions - monthly fees (6 months)
import datetime
for month in range(1, 7):
    for member in members[:10]:
        tx = models.Transaction(
            fee_type_id=ft_objs[0].id,
            member_id=member.id,
            type="income",
            amount=100000,
            transaction_date=date(2026, month, random.randint(1, 15)),
            payment_method=random.choice(["Tiền mặt", "Chuyển khoản"]),
            description=f"Quỹ tháng {month}/2026",
        )
        db.add(tx)

# Some expenses
expenses = [
    (ft_objs[3].id, 500000, date(2026, 1, 5), "Mua 10 hộp bóng"),
    (ft_objs[4].id, 1500000, date(2026, 1, 10), "Thuê sân tháng 1"),
    (ft_objs[4].id, 1500000, date(2026, 2, 10), "Thuê sân tháng 2"),
    (ft_objs[6].id, 2000000, date(2026, 3, 20), "Tổ chức giải nội bộ"),
    (ft_objs[3].id, 300000, date(2026, 4, 8), "Mua thêm bóng"),
    (ft_objs[4].id, 1500000, date(2026, 5, 10), "Thuê sân tháng 5"),
]
for fee_type_id, amount, tx_date, desc in expenses:
    tx = models.Transaction(
        fee_type_id=fee_type_id,
        type="expense",
        amount=amount,
        transaction_date=tx_date,
        description=desc,
        payment_method="Tiền mặt",
    )
    db.add(tx)

db.commit()
print("Seed thành công! Đã tạo dữ liệu mẫu.")
db.close()
