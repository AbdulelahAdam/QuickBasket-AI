from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class DashboardProductOut(BaseModel):
    id: int
    url: str
    marketplace: str
    title: str
    image_url: Optional[str] = None
    currency: str

    last_price: Optional[float] = None
    min_price: Optional[float] = None
    max_price: Optional[float] = None

    tracked_days: int
    snapshots: int
    last_updated: Optional[datetime] = None
    change_24h: Optional[float] = None


class PricePoint(BaseModel):
    price: Optional[float]
    fetched_at: datetime


class ProductDetailOut(BaseModel):
    id: int
    url: str
    marketplace: str
    title: str
    image_url: Optional[str] = None
    currency: str

    last_price: Optional[float] = None
    min_price: Optional[float] = None
    max_price: Optional[float] = None

    history: list[PricePoint]
    ai_latest: Optional[dict] = None
