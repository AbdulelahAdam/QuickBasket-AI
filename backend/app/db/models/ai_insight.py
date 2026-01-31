from __future__ import annotations

from datetime import datetime
from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Index,
)
from sqlalchemy.orm import relationship

from app.db.base import Base


class AIInsight(Base):
    __tablename__ = "ai_insights"

    id = Column(Integer, primary_key=True, index=True)

    product_id = Column(
        Integer,
        ForeignKey("tracked_products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Snapshot window / context
    snapshot_count = Column(Integer, nullable=False, default=0)
    window_days = Column(Integer, nullable=False, default=30)

    # Core computed features
    last_price = Column(Float, nullable=True)
    min_price = Column(Float, nullable=True)
    max_price = Column(Float, nullable=True)
    avg_price = Column(Float, nullable=True)
    volatility = Column(Float, nullable=True)  # coefficient of variation
    slope = Column(Float, nullable=True)  # simple linear trend slope
    pct_change_7d = Column(Float, nullable=True)
    pct_change_30d = Column(Float, nullable=True)

    # Classification outputs
    trend = Column(
        String(32), nullable=False, default="unknown"
    )  # up/down/flat/unknown
    anomaly = Column(
        String(32), nullable=False, default="none"
    )  # none/drop/spike/volatile
    recommendation = Column(
        String(32), nullable=False, default="watch"
    )  # buy/wait/watch
    confidence = Column(Float, nullable=False, default=0.5)

    # UX fields
    suggested_alert_price = Column(Float, nullable=True)
    explanation = Column(Text, nullable=False, default="")

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    product = relationship("TrackedProduct", back_populates="ai_insights")


Index(
    "ix_ai_insights_product_created", AIInsight.product_id, AIInsight.created_at.desc()
)
