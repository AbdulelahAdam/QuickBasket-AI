from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel


class AIInsightOut(BaseModel):
    id: int
    product_id: int

    snapshot_count: int
    window_days: int

    last_price: float | None = None
    min_price: float | None = None
    max_price: float | None = None
    avg_price: float | None = None
    volatility: float | None = None
    slope: float | None = None
    pct_change_7d: float | None = None
    pct_change_30d: float | None = None

    trend: str
    anomaly: str
    recommendation: str
    confidence: float
    suggested_alert_price: float | None = None
    explanation: str

    created_at: datetime

    class Config:
        from_attributes = True
