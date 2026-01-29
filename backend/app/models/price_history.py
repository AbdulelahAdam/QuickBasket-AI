from sqlalchemy import Column, Integer, String, Float, DateTime
from sqlalchemy.sql import func
from app.db.base import Base


class PriceSnapshot(Base):
    __tablename__ = "price_snapshots"

    id = Column(Integer, primary_key=True)
    url = Column(String, index=True)
    marketplace = Column(String, index=True)
    title = Column(String)
    price = Column(Float)
    currency = Column(String)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now())
