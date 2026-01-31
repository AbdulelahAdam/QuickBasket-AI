from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.base import SessionLocal
from app.core.pricing import normalize_price

from app.db.models.tracked_product import TrackedProduct
from app.db.models.price_snapshot import PriceSnapshot
from app.db.models.ai_insight import AIInsight

from app.services.ai_engine import AIEngine
from app.services.alerts import evaluate_alerts

router = APIRouter(tags=["browser"])

engine = AIEngine(window_days=30)


class TrackRequest(BaseModel):
    url: str
    marketplace: str
    title: str | None = None
    price_raw: str = Field(..., description="Raw price string, e.g. 'EGP 61499.00'")
    image_url: str | None = None
    sku: str | None = None


@router.post("/track/browser")
def track_from_browser(payload: TrackRequest):
    if not payload.price_raw:
        raise HTTPException(status_code=400, detail="Missing price")

    price, currency = normalize_price(payload.price_raw)
    if price is None:
        raise HTTPException(status_code=400, detail="Invalid price")

    db: Session = SessionLocal()
    try:
        # 1) Upsert tracked product (unique by url)
        product = (
            db.query(TrackedProduct).filter(TrackedProduct.url == payload.url).first()
        )

        if not product:
            product = TrackedProduct(
                url=payload.url,
                marketplace=payload.marketplace,
                title=payload.title,
                image_url=payload.image_url,
                currency=currency,
                is_active=True,
            )
            db.add(product)
            db.flush()  # get product.id
        else:
            # update metadata
            product.marketplace = payload.marketplace or product.marketplace
            product.title = payload.title or product.title
            product.image_url = payload.image_url or product.image_url
            product.currency = currency or product.currency
            product.is_active = True

        # 2) Insert snapshot linked to tracked_product_id
        snapshot = PriceSnapshot(
            tracked_product_id=product.id,
            price=price,
            currency=currency,
            raw_price_text=payload.price_raw,
            source="extension",
        )
        db.add(snapshot)
        db.flush()

        ai_result = engine.compute_for_product(db, product_id=product.id)

        insight = AIInsight(
            product_id=product.id,
            snapshot_count=ai_result.snapshot_count,
            window_days=ai_result.window_days,
            last_price=ai_result.last_price,
            min_price=ai_result.min_price,
            max_price=ai_result.max_price,
            avg_price=ai_result.avg_price,
            volatility=ai_result.volatility,
            slope=ai_result.slope,
            pct_change_7d=ai_result.pct_change_7d,
            pct_change_30d=ai_result.pct_change_30d,
            trend=ai_result.trend,
            anomaly=ai_result.anomaly,
            recommendation=ai_result.recommendation,
            confidence=ai_result.confidence,
            suggested_alert_price=ai_result.suggested_alert_price,
            explanation=ai_result.explanation,
        )
        db.add(insight)

        evaluate_alerts(snapshot=snapshot, db=db)

        db.commit()

        decision = (
            "buy" if ai_result.recommendation.lower().startswith("buy") else "wait"
        )
        wait_days = getattr(ai_result, "wait_days", None)

        # detect drop
        drop_detected = False
        drop_percent = None
        if ai_result.avg_price and ai_result.last_price:
            try:
                drop_percent = round(
                    ((ai_result.avg_price - ai_result.last_price) / ai_result.avg_price)
                    * 100,
                    2,
                )
                drop_detected = drop_percent > 0
            except Exception:
                drop_percent = None

        summary = ai_result.explanation or ai_result.recommendation

        return {
            "tracked_product_id": product.id,
            "snapshot_id": snapshot.id,
            "marketplace": product.marketplace,
            "canonical_url": product.url,
            "title": product.title,
            "currency": product.currency,
            "price": float(price),
            "ai": {
                "decision": decision,
                "wait_days": wait_days,
                "confidence": (
                    float(ai_result.confidence)
                    if ai_result.confidence is not None
                    else None
                ),
                "drop_detected": drop_detected,
                "drop_percent": drop_percent,
                "summary": summary,
            },
        }

    finally:
        db.close()
