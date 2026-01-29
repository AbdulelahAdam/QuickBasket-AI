from sqlalchemy import Column, Integer, String, Float, Boolean
from app.db.base import Base


class PriceAlert(Base):
    __tablename__ = "price_alerts"

    id = Column(Integer, primary_key=True)
    url = Column(String, index=True)
    target_price = Column(Float)
    triggered = Column(Boolean, default=False)
