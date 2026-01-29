from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, select, desc, and_
from datetime import datetime, timedelta

from app.db.session import get_db
from app.db.models import TrackedProduct, PriceSnapshot, AIInsight
from app.api.v1.schemas import DashboardProductOut, ProductDetailOut, PricePoint

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/products", response_model=list[DashboardProductOut])
def list_dashboard_products(db: Session = Depends(get_db)):
    # subquery: last snapshot per product
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

    # aggregates
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

    rows = (
        db.query(TrackedProduct, agg_subq, last_snap_join)
        .outerjoin(agg_subq, agg_subq.c.pid == TrackedProduct.id)
        .outerjoin(
            last_snap_join, last_snap_join.c.tracked_product_id == TrackedProduct.id
        )
        .filter(TrackedProduct.is_active.is_(True))
        .order_by(desc(TrackedProduct.updated_at))
        .all()
    )

    now = datetime.utcnow()
    since_24h = now - timedelta(hours=24)

    out: list[DashboardProductOut] = []
    for product, agg, last_snap in rows:
        # change 24h: compare last price with price at/after 24h cutoff
        cutoff_snap = (
            db.query(PriceSnapshot)
            .filter(
                PriceSnapshot.tracked_product_id == product.id,
                PriceSnapshot.fetched_at >= since_24h,
                PriceSnapshot.price.isnot(None),
            )
            .order_by(PriceSnapshot.fetched_at.asc())
            .first()
        )

        last_price = (
            float(last_snap.price)
            if last_snap and last_snap.price is not None
            else None
        )
        change_24h = None
        if last_price is not None and cutoff_snap and cutoff_snap.price is not None:
            change_24h = last_price - float(cutoff_snap.price)

        tracked_days = 0
        if agg and agg.first_seen and agg.last_seen:
            tracked_days = max(
                1, (agg.last_seen.date() - agg.first_seen.date()).days + 1
            )

        out.append(
            DashboardProductOut(
                id=product.id,
                url=product.url,
                marketplace=product.marketplace,
                title=product.title,
                image_url=product.image_url,
                currency=product.currency,
                last_price=last_price,
                min_price=(
                    float(agg.min_price) if agg and agg.min_price is not None else None
                ),
                max_price=(
                    float(agg.max_price) if agg and agg.max_price is not None else None
                ),
                tracked_days=tracked_days,
                snapshots=int(agg.snapshots) if agg else 0,
                last_updated=agg.last_seen if agg else None,
                change_24h=change_24h,
            )
        )

    return out


@router.get("/products/{product_id}", response_model=ProductDetailOut)
def get_product_detail(product_id: int, db: Session = Depends(get_db)):
    product = db.query(TrackedProduct).filter(TrackedProduct.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    snaps = (
        db.query(PriceSnapshot)
        .filter(PriceSnapshot.tracked_product_id == product.id)
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

    last_price = None
    min_price = None
    max_price = None
    prices = [float(s.price) for s in snaps if s.price is not None]
    if prices:
        last_price = prices[-1]
        min_price = min(prices)
        max_price = max(prices)

    ai_latest = (
        db.query(AIInsight)
        .filter(AIInsight.tracked_product_id == product.id)
        .order_by(AIInsight.created_at.desc())
        .first()
    )

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
        ai_latest=ai_latest.content_json if ai_latest else None,
    )
