from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.db.base import get_db
from app.db.models.ai_insight import AIInsight
from app.db.models.tracked_product import TrackedProduct
from app.api.schemas.ai import AIInsightOut
from app.services.ai_engine import AIEngine

router = APIRouter(prefix="/api/v1/ai", tags=["AI"])

engine = AIEngine(window_days=30)


@router.post("/products/{product_id}/insight", response_model=AIInsightOut)
def compute_insight(product_id: int, db: Session = Depends(get_db)):
    product = db.get(TrackedProduct, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    try:
        result = engine.compute_for_product(db, product_id=product_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    insight = AIInsight(
        product_id=product_id,
        snapshot_count=result.snapshot_count,
        window_days=result.window_days,
        last_price=result.last_price,
        min_price=result.min_price,
        max_price=result.max_price,
        avg_price=result.avg_price,
        volatility=result.volatility,
        slope=result.slope,
        pct_change_7d=result.pct_change_7d,
        pct_change_30d=result.pct_change_30d,
        trend=result.trend,
        anomaly=result.anomaly,
        recommendation=result.recommendation,
        confidence=result.confidence,
        suggested_alert_price=result.suggested_alert_price,
        explanation=result.explanation,
    )

    db.add(insight)
    db.commit()
    db.refresh(insight)

    return insight


@router.get("/products/{product_id}/insight/latest", response_model=AIInsightOut)
def get_latest_insight(product_id: int, db: Session = Depends(get_db)):
    product = db.get(TrackedProduct, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    q = (
        select(AIInsight)
        .where(AIInsight.product_id == product_id)
        .order_by(AIInsight.created_at.desc())
        .limit(1)
    )
    insight = db.execute(q).scalars().first()
    if not insight:
        raise HTTPException(
            status_code=404, detail="No insight found yet. Compute one first."
        )

    return insight


@router.post("/refresh")
def refresh_all(db: Session = Depends(get_db)):
    products = db.execute(select(TrackedProduct)).scalars().all()

    created = 0
    for p in products:
        result = engine.compute_for_product(db, product_id=p.id)

        insight = AIInsight(
            product_id=p.id,
            snapshot_count=result.snapshot_count,
            window_days=result.window_days,
            last_price=result.last_price,
            min_price=result.min_price,
            max_price=result.max_price,
            avg_price=result.avg_price,
            volatility=result.volatility,
            slope=result.slope,
            pct_change_7d=result.pct_change_7d,
            pct_change_30d=result.pct_change_30d,
            trend=result.trend,
            anomaly=result.anomaly,
            recommendation=result.recommendation,
            confidence=result.confidence,
            suggested_alert_price=result.suggested_alert_price,
            explanation=result.explanation,
        )
        db.add(insight)
        created += 1

    db.commit()
    return {"ok": True, "created": created}
