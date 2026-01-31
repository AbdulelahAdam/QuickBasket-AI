from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any
import math

from sqlalchemy.orm import Session
from sqlalchemy import select

from app.db.models.price_snapshot import PriceSnapshot
from app.db.models.tracked_product import TrackedProduct


@dataclass
class AIResult:
    trend: str
    anomaly: str
    recommendation: str
    confidence: float
    suggested_alert_price: Optional[float]
    explanation: str

    # features
    snapshot_count: int
    window_days: int
    last_price: Optional[float]
    min_price: Optional[float]
    max_price: Optional[float]
    avg_price: Optional[float]
    volatility: Optional[float]
    slope: Optional[float]
    pct_change_7d: Optional[float]
    pct_change_30d: Optional[float]


def _safe_float(x) -> Optional[float]:
    try:
        if x is None:
            return None
        v = float(x)
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    except Exception:
        return None


def _mean(xs: List[float]) -> Optional[float]:
    if not xs:
        return None
    return sum(xs) / len(xs)


def _std(xs: List[float]) -> Optional[float]:
    if len(xs) < 2:
        return 0.0
    m = _mean(xs)
    if m is None:
        return None
    var = sum((x - m) ** 2 for x in xs) / (len(xs) - 1)
    return math.sqrt(var)


def _linear_slope(prices: List[float]) -> Optional[float]:
    """
    Simple least-squares slope for equally spaced points.
    x = 0..n-1
    """
    n = len(prices)
    if n < 2:
        return 0.0

    x_mean = (n - 1) / 2.0
    y_mean = sum(prices) / n

    num = sum((i - x_mean) * (p - y_mean) for i, p in enumerate(prices))
    den = sum((i - x_mean) ** 2 for i in range(n))
    if den == 0:
        return 0.0
    return num / den


def _pct_change(old: Optional[float], new: Optional[float]) -> Optional[float]:
    if old is None or new is None:
        return None
    if old == 0:
        return None
    return ((new - old) / old) * 100.0


class AIEngine:
    """
    AI Engine v1 (no LLM):
    - trend detection using slope + pct changes
    - anomaly detection using z-score / sudden drop/spike
    - recommendation based on min/avg distance + trend
    - quite primitive, mainly rule-based with statistical features
    - can be extended later with more advanced techniques
    """

    def __init__(self, window_days: int = 30):
        self.window_days = window_days

    def compute_for_product(self, db: Session, product_id: int) -> AIResult:
        product = db.get(TrackedProduct, product_id)
        if not product:
            raise ValueError(f"Product {product_id} not found")

        since = datetime.utcnow() - timedelta(days=self.window_days)

        q = (
            select(PriceSnapshot)
            .where(PriceSnapshot.tracked_product_id == product_id)
            .where(PriceSnapshot.fetched_at >= since)
            .order_by(PriceSnapshot.fetched_at.asc())
        )
        snaps = list(db.execute(q).scalars().all())

        prices = [_safe_float(s.price) for s in snaps]
        prices = [p for p in prices if p is not None]

        snapshot_count = len(prices)

        if snapshot_count == 0:
            return AIResult(
                trend="unknown",
                anomaly="none",
                recommendation="watch",
                confidence=0.2,
                suggested_alert_price=None,
                explanation="Not enough price history yet. Keep tracking to unlock AI insights.",
                snapshot_count=0,
                window_days=self.window_days,
                last_price=None,
                min_price=None,
                max_price=None,
                avg_price=None,
                volatility=None,
                slope=None,
                pct_change_7d=None,
                pct_change_30d=None,
            )

        last_price = prices[-1]
        min_price = min(prices)
        max_price = max(prices)
        avg_price = _mean(prices)

        std = _std(prices)
        volatility = None
        if avg_price and avg_price > 0 and std is not None:
            volatility = std / avg_price

        slope = _linear_slope(prices)

        # pct change windows: use nearest index approximations
        pct_change_7d = None
        pct_change_30d = None

        now = datetime.now(timezone.utc)

        def price_at_or_after(dt: datetime) -> Optional[float]:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)

            # find first snapshot at/after dt
            for s in snaps:
                if s.price is None:
                    continue
                if s.fetched_at >= dt:
                    v = _safe_float(s.price)
                    if v is not None:
                        return v
            # fallback to earliest
            for s in snaps:
                v = _safe_float(s.price)
                if v is not None:
                    return v
            return None

        p7 = price_at_or_after(now - timedelta(days=7))
        p30 = price_at_or_after(now - timedelta(days=30))

        pct_change_7d = _pct_change(p7, last_price)
        pct_change_30d = _pct_change(p30, last_price)

        # -------------------------
        # Trend classification
        # -------------------------
        trend = "flat"
        if slope is None:
            trend = "unknown"
        else:
            rel = 0.0
            if avg_price and avg_price > 0:
                rel = slope / avg_price

            if rel > 0.002:
                trend = "up"
            elif rel < -0.002:
                trend = "down"
            else:
                trend = "flat"

        # -------------------------
        # Anomaly detection
        # -------------------------
        anomaly = "none"
        if std is not None and std > 0 and avg_price is not None:
            z = (last_price - avg_price) / std
            if z <= -2.2:
                anomaly = "drop"
            elif z >= 2.2:
                anomaly = "spike"

        if volatility is not None and volatility > 0.12:
            if anomaly == "none":
                anomaly = "volatile"

        # -------------------------
        # Recommendation
        # -------------------------
        recommendation = "watch"
        confidence = 0.5

        dist_to_min = (
            (last_price - min_price) / min_price if min_price and min_price > 0 else 0
        )

        suggested_alert_price = round(min_price * 1.01, 2) if min_price else None

        if anomaly == "spike":
            recommendation = "wait"
            confidence = 0.90
        elif anomaly == "drop":
            recommendation = "buy"
            confidence = 0.85
        elif trend == "down":
            recommendation = "wait"
            confidence = 0.72
        elif trend == "up":
            if dist_to_min <= 0.03:
                recommendation = "buy"
                confidence = 0.68
            else:
                recommendation = "watch"
                confidence = 0.62
        else:
            if dist_to_min <= 0.02:
                recommendation = "buy"
                confidence = 0.64
            else:
                recommendation = "watch"
                confidence = 0.55

        # -------------------------
        # Explanation Assembly
        # -------------------------
        explanation_parts = []
        explanation_parts.append(f"Trend: {trend}.")

        if anomaly != "none":
            explanation_parts.append(f"Anomaly detected: {anomaly}.")
            if anomaly == "spike":
                explanation_parts.append(
                    "Significant price jump detected; data may be volatile."
                )

        if avg_price is not None:
            explanation_parts.append(f"Avg: {avg_price:.2f}.")

        explanation_parts.append(f"Current: {last_price:.2f}. Min: {min_price:.2f}.")

        if pct_change_7d is not None:
            explanation_parts.append(f"7d change: {pct_change_7d:.1f}%.")

        explanation_parts.append(
            f"Recommendation: {recommendation.upper()} (confidence {confidence:.0%})."
        )

        explanation = " ".join(explanation_parts)

        return AIResult(
            trend=trend,
            anomaly=anomaly,
            recommendation=recommendation,
            confidence=float(confidence),
            suggested_alert_price=suggested_alert_price,
            explanation=explanation,
            snapshot_count=snapshot_count,
            window_days=self.window_days,
            last_price=last_price,
            min_price=min_price,
            max_price=max_price,
            avg_price=avg_price,
            volatility=volatility,
            slope=slope,
            pct_change_7d=pct_change_7d,
            pct_change_30d=pct_change_30d,
        )
