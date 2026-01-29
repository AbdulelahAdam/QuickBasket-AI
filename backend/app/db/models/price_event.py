from sqlalchemy import DateTime, func, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class PriceEvent(Base):
    __tablename__ = "price_events"

    id: Mapped[int] = mapped_column(primary_key=True)

    tracked_product_id: Mapped[int] = mapped_column(
        ForeignKey("tracked_products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    event_type: Mapped[str] = mapped_column(
        String(32), nullable=False
    )  # drop|increase|...
    old_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    new_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False)

    created_at: Mapped[str] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    product = relationship("TrackedProduct", back_populates="events")
