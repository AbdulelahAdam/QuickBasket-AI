from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, desc, case
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel
from app.db.session import get_db
from app.db.models import TrackedProduct, PriceSnapshot, AIInsight
from app.api.v1.schemas import (
    DashboardProductOut,
    ProductDetailOut,
    PricePoint,
)
from app.core.auth import get_current_user, set_user_context

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/products", response_model=list[DashboardProductOut])
def list_dashboard_products(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    try:
        set_user_context(db, user_id)
        now = datetime.now(timezone.utc)
        since_24h = now - timedelta(hours=24)

        products = (
            db.query(TrackedProduct)
            .options(joinedload(TrackedProduct.snapshots))
            .filter(TrackedProduct.is_active == True, TrackedProduct.user_id == user_id)
            .order_by(desc(TrackedProduct.updated_at))
            .offset(skip)
            .limit(limit)
            .all()
        )

        if not products:
            return []

        snapshot_stats = (
            db.query(
                PriceSnapshot.tracked_product_id,
                func.count(PriceSnapshot.id).label("snapshots"),
                func.min(PriceSnapshot.price).label("min_price"),
                func.max(PriceSnapshot.price).label("max_price"),
                func.min(PriceSnapshot.fetched_at).label("first_seen"),
                func.max(PriceSnapshot.fetched_at).label("last_seen"),
            )
            .filter(PriceSnapshot.tracked_product_id.in_([p.id for p in products]))
            .group_by(PriceSnapshot.tracked_product_id)
            .all()
        )

        stats_dict = {stat.tracked_product_id: stat for stat in snapshot_stats}

        last_prices = {}
        if products:
            last_price_subquery = (
                db.query(
                    PriceSnapshot.tracked_product_id,
                    PriceSnapshot.price,
                    func.row_number()
                    .over(
                        partition_by=PriceSnapshot.tracked_product_id,
                        order_by=desc(PriceSnapshot.fetched_at),
                    )
                    .label("rn"),
                )
                .filter(
                    PriceSnapshot.tracked_product_id.in_([p.id for p in products]),
                    PriceSnapshot.price.isnot(None),
                )
                .subquery()
            )

            last_price_results = (
                db.query(
                    last_price_subquery.c.tracked_product_id,
                    last_price_subquery.c.price,
                )
                .filter(last_price_subquery.c.rn == 1)
                .all()
            )

            last_prices = {pid: float(price) for pid, price in last_price_results}

        cutoff_prices = {}
        if products:
            cutoff_subquery = (
                db.query(
                    PriceSnapshot.tracked_product_id,
                    PriceSnapshot.price,
                    PriceSnapshot.fetched_at,
                    func.row_number()
                    .over(
                        partition_by=PriceSnapshot.tracked_product_id,
                        order_by=case(
                            (
                                PriceSnapshot.fetched_at >= since_24h,
                                PriceSnapshot.fetched_at,
                            ),
                            else_=PriceSnapshot.fetched_at,
                        ).asc(),
                    )
                    .label("rn"),
                )
                .filter(
                    PriceSnapshot.tracked_product_id.in_([p.id for p in products]),
                    PriceSnapshot.price.isnot(None),
                )
                .subquery()
            )

            cutoff_results = (
                db.query(cutoff_subquery.c.tracked_product_id, cutoff_subquery.c.price)
                .filter(cutoff_subquery.c.rn == 1)
                .all()
            )

            cutoff_prices = {pid: float(price) for pid, price in cutoff_results}

        out: list[DashboardProductOut] = []

        for product in products:
            stats = stats_dict.get(product.id)

            snapshots_count = int(stats.snapshots) if stats else 0
            min_p = (
                float(stats.min_price)
                if stats and stats.min_price is not None
                else None
            )
            max_p = (
                float(stats.max_price)
                if stats and stats.max_price is not None
                else None
            )
            first_seen = stats.first_seen if stats else None
            last_seen = stats.last_seen if stats else None

            last_price = last_prices.get(product.id)

            change_24h = None
            if last_price is not None and product.id in cutoff_prices:
                cutoff_price = cutoff_prices[product.id]
                if snapshots_count > 1:
                    change_24h = last_price - cutoff_price
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
                    update_interval=product.update_interval or 1,
                    next_run_at=product.next_run_at,
                    last_availability=product.last_availability,
                )
            )

        return out

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to load products: {str(e)}"
        )


@router.get("/products/{product_id}", response_model=ProductDetailOut)
def get_product_detail(
    product_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    try:
        set_user_context(db, user_id)

        product = (
            db.query(TrackedProduct)
            .options(
                joinedload(TrackedProduct.snapshots),
                joinedload(TrackedProduct.ai_insights),
            )
            .filter(TrackedProduct.id == product_id, TrackedProduct.user_id == user_id)
            .first()
        )

        if not product:
            raise HTTPException(status_code=404, detail="Product not found")

        snaps = sorted(product.snapshots, key=lambda s: s.fetched_at)

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

        ai_latest = None
        if product.ai_insights:
            ai_latest = max(product.ai_insights, key=lambda x: x.created_at)

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
            last_scrape_time=product.last_scraped_at,
            next_run_at=product.next_run_at,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to load product details: {str(e)}"
        )


@router.delete("/products/{product_id}")
def deactivate_product(
    product_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    try:
        set_user_context(db, user_id)

        product = (
            db.query(TrackedProduct)
            .filter(
                TrackedProduct.id == product_id,
                TrackedProduct.is_active == True,
                TrackedProduct.user_id == user_id,
            )
            .first()
        )

        if not product:
            raise HTTPException(
                status_code=404, detail="Product not found or already inactive"
            )

        product.is_active = False
        db.commit()

        return {"status": "success", "id": product_id}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500, detail=f"Failed to deactivate product: {str(e)}"
        )


@router.patch("/products/{product_id}/interval")
def update_product_interval(
    product_id: int,
    update_interval: int = Body(..., ge=1, le=24, embed=True),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    try:
        set_user_context(db, user_id)

        product = (
            db.query(TrackedProduct)
            .filter(TrackedProduct.id == product_id, TrackedProduct.user_id == user_id)
            .first()
        )

        if not product:
            raise HTTPException(status_code=404, detail="Product not found")

        def ensure_utc(dt):
            if dt is None:
                return None
            if dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt

        if product.last_scraped_at and product.next_run_at:
            now = datetime.now(timezone.utc)
            next_run = ensure_utc(product.next_run_at)

            time_remaining = (next_run - now).total_seconds() / 3600  # hours

            if 0 < time_remaining < update_interval:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot set interval to {update_interval}h. "
                    f"Next snapshot is in {time_remaining:.1f}h. "
                    f"Please wait for the next snapshot or choose a shorter interval.",
                )

        old_interval = product.update_interval
        product.update_interval = update_interval

        if product.last_scraped_at:
            last_scraped = ensure_utc(product.last_scraped_at)
            product.next_run_at = last_scraped + timedelta(hours=update_interval)
        else:
            product.next_run_at = datetime.now(timezone.utc) + timedelta(
                hours=update_interval
            )

        db.commit()
        db.refresh(product)

        return {
            "status": "success",
            "id": product_id,
            "old_interval": old_interval,
            "new_interval": product.update_interval,
            "next_run_at": (
                product.next_run_at.isoformat() if product.next_run_at else None
            ),
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500, detail=f"Failed to update interval: {str(e)}"
        )
