from sqlalchemy import Column, Integer, String, Boolean, DateTime, Numeric, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class PriceEvent(Base):
    __tablename__ = "price_events"

    id = Column(Integer, primary_key=True, index=True)

    url = Column(String, index=True, nullable=False)
    marketplace = Column(String, nullable=True)
    title = Column(String, nullable=True)

    target_price = Column(Numeric, nullable=True)
    product_id = Column(Integer, ForeignKey("tracked_products.id"), nullable=False)
    product = relationship("TrackedProduct", back_populates="events")

    # delivery state
    triggered = Column(Boolean, default=False, nullable=False)
    triggered_at = Column(DateTime(timezone=True), nullable=True)

    acknowledged = Column(Boolean, default=False, nullable=False)
    ack_source = Column(String, nullable=True)

    # alert content
    event_type = Column(String, default="target_price", nullable=False)
    message = Column(String, nullable=True)

    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
