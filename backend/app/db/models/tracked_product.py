from sqlalchemy import String, DateTime, func, Boolean, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class TrackedProduct(Base):
    __tablename__ = "tracked_products"

    id: Mapped[int] = mapped_column(primary_key=True)

    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )

    marketplace: Mapped[str] = mapped_column(
        String(32), index=True, nullable=False
    )  # noon|amazon
    url: Mapped[str] = mapped_column(Text, nullable=False)
    canonical_url: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)

    external_id: Mapped[str | None] = mapped_column(
        String(128), nullable=True, index=True
    )  # ASIN or SKU
    title: Mapped[str] = mapped_column(Text, nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="EGP")

    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )

    created_at: Mapped[str] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[str] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    snapshots = relationship(
        "PriceSnapshot", back_populates="product", cascade="all, delete-orphan"
    )
    events = relationship(
        "PriceEvent", back_populates="product", cascade="all, delete-orphan"
    )
    insights = relationship(
        "AIInsight", back_populates="product", cascade="all, delete-orphan"
    )
