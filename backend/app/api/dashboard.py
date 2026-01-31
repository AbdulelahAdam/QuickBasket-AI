from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, aliased
from sqlalchemy import func, select, desc, and_
from datetime import datetime, timedelta

from app.db.session import get_db
from app.db.models import TrackedProduct, PriceSnapshot, AIInsight
from app.api.v1.schemas import DashboardProductOut, ProductDetailOut, PricePoint

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


from sqlalchemy.orm import Session, aliased


@router.get("/products", response_model=list[DashboardProductOut])
def list_dashboard_products(db: Session = Depends(get_db)):
    last_snap_subq = (
        select(
            PriceSnapshot.tracked_product_id.label("pid"),
            func.max(PriceSnapshot.fetched_at).label("last_time"),
        )
        .group_by(PriceSnapshot.tracked_product_id)
        .subquery()
    )

    last_snap_join = (
        select(PriceSnapshot)
        .join(
            last_snap_subq,
            and_(
                PriceSnapshot.tracked_product_id == last_snap_subq.c.pid,
                PriceSnapshot.fetched_at == last_snap_subq.c.last_time,
            ),
        )
        .subquery()
    )

    agg_subq = (
        select(
            PriceSnapshot.tracked_product_id.label("pid"),
            func.count(PriceSnapshot.id).label("snapshots"),
            func.min(PriceSnapshot.price).label("min_price"),
            func.max(PriceSnapshot.price).label("max_price"),
            func.min(PriceSnapshot.fetched_at).label("first_seen"),
            func.max(PriceSnapshot.fetched_at).label("last_seen"),
        )
        .group_by(PriceSnapshot.tracked_product_id)
        .subquery()
    )

    Agg = aliased(agg_subq)
    LastSnap = aliased(last_snap_join)

    rows = (
        db.query(TrackedProduct, Agg, LastSnap)
        .outerjoin(Agg, Agg.c.pid == TrackedProduct.id)
        .outerjoin(LastSnap, LastSnap.c.tracked_product_id == TrackedProduct.id)
        .filter(TrackedProduct.is_active.is_(True))
        .order_by(desc(TrackedProduct.updated_at))
        .all()
    )

    now = datetime.utcnow()
    since_24h = now - timedelta(hours=24)
    out: list[DashboardProductOut] = []

    for row in rows:
        product = row.TrackedProduct

        snapshots_count = int(getattr(row, "snapshots", 0) or 0)
        min_p = (
            float(getattr(row, "min_price", 0))
            if getattr(row, "min_price", None) is not None
            else None
        )
        max_p = (
            float(getattr(row, "max_price", 0))
            if getattr(row, "max_price", None) is not None
            else None
        )
        first_seen = getattr(row, "first_seen", None)
        last_seen = getattr(row, "last_seen", None)

        last_price = None
        if hasattr(row, "price"):
            last_price = float(row.price) if row.price is not None else None

        cutoff_snap = (
            db.query(PriceSnapshot)
            .filter(
                PriceSnapshot.tracked_product_id == product.id,
                PriceSnapshot.fetched_at >= since_24h,
                PriceSnapshot.price.isnot(None),
            )
            .order_by(PriceSnapshot.fetched_at.asc())
            .first()
        ) or db.query(PriceSnapshot).filter(
            PriceSnapshot.tracked_product_id == product.id
        ).order_by(
            PriceSnapshot.fetched_at.asc()
        ).first()

        change_24h = None
        if last_price is not None and cutoff_snap and cutoff_snap.price is not None:
            if snapshots_count > 1:
                change_24h = last_price - float(cutoff_snap.price)
            else:
                change_24h = 0.0

        tracked_days = 0
        if first_seen and last_seen:
            tracked_days = max(1, (last_seen.date() - first_seen.date()).days + 1)

        out.append(
            DashboardProductOut(
                id=product.id,
                url=product.url,
                marketplace=product.marketplace,
                title=product.title,
                image_url=product.image_url,
                currency=product.currency,
                last_price=last_price,
                min_price=min_p,
                max_price=max_p,
                tracked_days=tracked_days,
                snapshots=snapshots_count,
                last_updated=last_seen,
                change_24h=change_24h,
            )
        )

    return out


@router.get("/products/{product_id}", response_model=ProductDetailOut)
def get_product_detail(product_id: int, db: Session = Depends(get_db)):
    product = db.query(TrackedProduct).filter(TrackedProduct.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    clean_url = product.url.split("?")[0].split("#")[0]

    snaps = (
        db.query(PriceSnapshot)
        .join(TrackedProduct, PriceSnapshot.tracked_product_id == TrackedProduct.id)
        .filter(TrackedProduct.url.like(f"{clean_url}%"))
        .order_by(PriceSnapshot.fetched_at.asc())
        .all()
    )
    history = [
        PricePoint(
            price=float(s.price) if s.price is not None else None,
            fetched_at=s.fetched_at,
        )
        for s in snaps
    ]

    prices = [h.price for h in history if h.price is not None]
    last_price = prices[-1] if prices else None
    min_price = min(prices) if prices else None
    max_price = max(prices) if prices else None

    ai_latest = (
        db.query(AIInsight)
        .filter(AIInsight.product_id == product.id)
        .order_by(AIInsight.created_at.desc())
        .first()
    )

    ai_obj = None
    if ai_latest:
        ai_obj = {
            "trend": ai_latest.trend,
            "recommendation": ai_latest.recommendation,
            "confidence": ai_latest.confidence,
            "explanation": ai_latest.explanation,
            "snapshot_count": ai_latest.snapshot_count,
            "window_days": ai_latest.window_days,
            "last_price": ai_latest.last_price,
            "min_price": ai_latest.min_price,
            "max_price": ai_latest.max_price,
            "avg_price": ai_latest.avg_price,
            "volatility": ai_latest.volatility,
            "slope": ai_latest.slope,
            "pct_change_7d": ai_latest.pct_change_7d,
            "pct_change_30d": ai_latest.pct_change_30d,
            "anomaly": ai_latest.anomaly,
            "suggested_alert_price": ai_latest.suggested_alert_price,
            "created_at": ai_latest.created_at.isoformat(),
        }

    return ProductDetailOut(
        id=product.id,
        url=product.url,
        marketplace=product.marketplace,
        title=product.title,
        image_url=product.image_url,
        currency=product.currency,
        last_price=last_price,
        min_price=min_price,
        max_price=max_price,
        history=history,
        ai_latest=ai_obj,
    )


@router.delete("/products/{product_id}")
def deactivate_product(product_id: int, db: Session = Depends(get_db)):
    product = (
        db.query(TrackedProduct)
        .filter(TrackedProduct.id == product_id, TrackedProduct.is_active == True)
        .first()
    )
    if not product:
        raise HTTPException(
            status_code=404, detail="Product not found or already inactive"
        )

    product.is_active = False
    db.add(product)
    db.commit()
    return {"status": "success", "id": product_id}
