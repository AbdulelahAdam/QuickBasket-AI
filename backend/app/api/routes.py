from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.pricing import normalize_price
from app.db.models.tracked_product import TrackedProduct
from app.db.models.price_snapshot import PriceSnapshot
from app.db.models.ai_insight import AIInsight
from app.services.ai_engine import AIEngine
from app.services.alerts import evaluate_alerts
from app.services.canonicalize import canonicalize_url
from app.db.session import get_db

from datetime import datetime, timedelta, timezone

router = APIRouter(tags=["browser"])

engine = AIEngine(window_days=30)


class TrackRequest(BaseModel):
    url: str
    marketplace: str
    title: str | None = None
    price_raw: str | None = None
    image_url: str | None = None
    sku: str | None = None
    availability: str = "in_stock"


@router.post("/track/browser")
def track_from_browser(payload: TrackRequest, db: Session = Depends(get_db)):
    clean_url = payload.url.split("?")[0].split("#")[0].rstrip("/")

    fingerprint = canonicalize_url(clean_url)

    # print(f"[DEBUG] Tracking product - Availability: {payload.availability}")

    # print(f"[DEBUG] Original URL: {payload.url}")
    # print(f"[DEBUG] Clean URL: {clean_url}")
    # print(f"[DEBUG] Canonical URL: {fingerprint}")

    if not payload.price_raw:
        raise HTTPException(status_code=400, detail="Missing price")

    price = None
    currency = "USD"

    if payload.price_raw:
        price, currency = normalize_price(payload.price_raw)
    elif payload.availability == "in_stock":
        raise HTTPException(
            status_code=400, detail="Product in stock but no price provided"
        )

    ai_result = None
    availability_changed = False
    previous_availability = None
    response = None

    try:
        product = (
            db.query(TrackedProduct)
            .filter(
                (TrackedProduct.canonical_url == fingerprint)
                | (TrackedProduct.url == clean_url)
            )
            .first()
        )

        if not product:
            # print(f"[DEBUG] Creating new product: {fingerprint}")

            product = TrackedProduct(
                url=clean_url,
                canonical_url=fingerprint,
                marketplace=payload.marketplace,
                title=payload.title,
                image_url=payload.image_url,
                currency=currency,
                is_active=True,
                update_interval=24,
                last_scraped_at=datetime.now(timezone.utc),
                next_run_at=datetime.now(timezone.utc) + timedelta(hours=24),
                last_availability=payload.availability,
            )
            db.add(product)
            db.flush()

            # print(f"[DEBUG] Created product ID: {product.id}")
        else:
            # print(f"[DEBUG] Found existing product ID: {product.id}")

            previous_availability = product.last_availability
            if payload.title:
                product.title = payload.title
            if payload.image_url:
                product.image_url = payload.image_url

            product.last_scraped_at = datetime.now(timezone.utc)
            product.next_run_at = product.last_scraped_at + timedelta(
                hours=product.update_interval or 24
            )

        snapshot = PriceSnapshot(
            tracked_product_id=product.id,
            price=price,
            currency=currency,
            raw_price_text=payload.price_raw,
            availability=payload.availability,
            source="extension",
            fetched_at=datetime.now(timezone.utc),
        )
        db.add(snapshot)
        db.flush()

        # print(f"[DEBUG] Created snapshot ID: {snapshot.id} for product {product.id}")

        if payload.availability == "in_stock":
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
                created_at=datetime.now(timezone.utc),
            )
            db.add(insight)

        availability_changed = (
            previous_availability is not None
            and previous_availability != payload.availability
        )
        evaluate_alerts(snapshot=snapshot, db=db)

        db.commit()
        db.refresh(product)

        response = {
            "tracked_product_id": product.id,
            "snapshot_id": snapshot.id,
            "marketplace": product.marketplace,
            "url": product.url,
            "title": product.title,
            "price": float(price) if price else None,
            "availability": payload.availability,
            "availability_changed": availability_changed,
            "previous_availability": previous_availability,
            "next_run_at": (
                product.next_run_at.isoformat() if product.next_run_at else None
            ),
        }

        if ai_result:
            response["ai"] = {
                "decision": ai_result.recommendation,
                "summary": ai_result.explanation,
            }

        return response

    except IntegrityError as e:
        db.rollback()
        print(f"[ERROR] IntegrityError: {e}")

        product = (
            db.query(TrackedProduct)
            .filter(
                (TrackedProduct.canonical_url == fingerprint)
                | (TrackedProduct.url == clean_url)
            )
            .first()
        )

        if product:
            previous_availability = product.last_availability
            availability_changed = previous_availability != payload.availability

            snapshot = PriceSnapshot(
                tracked_product_id=product.id,
                price=price,
                currency=currency,
                raw_price_text=payload.price_raw,
                availability=payload.availability,
                source="extension",
                fetched_at=datetime.now(timezone.utc),
            )
            db.add(snapshot)
            db.commit()
            db.refresh(product)

            if payload.availability == "in_stock":
                ai_result = engine.compute_for_product(db, product_id=product.id)

            response = {
                "tracked_product_id": product.id,
                "snapshot_id": snapshot.id,
                "marketplace": product.marketplace,
                "url": product.url,
                "title": product.title,
                "price": float(price) if price else None,
                "availability": payload.availability,
                "availability_changed": availability_changed,
                "previous_availability": previous_availability,
                "next_run_at": (
                    product.next_run_at.isoformat() if product.next_run_at else None
                ),
            }

            if ai_result:
                response["ai"] = {
                    "decision": ai_result.recommendation,
                    "summary": ai_result.explanation,
                }

            return response

        raise HTTPException(
            status_code=500, detail="Failed to create or find product during recovery"
        )

    except Exception as e:
        db.rollback()
        print(f"[ERROR] Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/products/pending-scrape")
def get_pending_scrape_products(force: bool = False, db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)

    query = db.query(TrackedProduct).filter(TrackedProduct.is_active == True)

    if force:
        products = query.all()
    else:
        products = query.filter(
            (TrackedProduct.last_scraped_at.is_(None))
            | (TrackedProduct.next_run_at <= now)
        ).all()

    pending_products = [
        {
            "id": product.id,
            "url": product.url,
            "marketplace": product.marketplace,
            "interval_hours": product.update_interval or 24,
            "last_scraped": (
                product.last_scraped_at.isoformat() if product.last_scraped_at else None
            ),
            "next_run_at": (
                product.next_run_at.isoformat() if product.next_run_at else None
            ),
        }
        for product in products
    ]

    return {"count": len(pending_products), "products": pending_products}


class RecordScrapeRequest(BaseModel):
    price: float | None = None
    availability: str = "in_stock"


@router.post("/products/{product_id}/record-scrape")
def record_scrape_completion(
    product_id: int, payload: RecordScrapeRequest, db: Session = Depends(get_db)
):
    product = db.query(TrackedProduct).filter(TrackedProduct.id == product_id).first()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    previous_availability = product.last_availability

    product.last_scraped_at = datetime.now(timezone.utc)
    target_hours = product.update_interval or 24
    product.next_run_at = datetime.now(timezone.utc) + timedelta(hours=target_hours)
    product.last_availability = payload.availability

    new_snapshot = PriceSnapshot(
        tracked_product_id=product_id,
        price=payload.price,
        currency=product.currency,
        availability=payload.availability,
        fetched_at=datetime.now(timezone.utc),
        source="background_job",
    )
    db.add(new_snapshot)

    ai_result = None
    if payload.availability == "in_stock":
        ai_result = engine.compute_for_product(db, product_id=product.id)
        # TODO: AIInsight record creation

    db.commit()
    db.refresh(product)

    # print(f"[DEBUG] Snapshot created for product {product_id}")

    response = {
        "success": True,
        "tracked_product_id": product.id,
        "next_run_at": product.next_run_at.isoformat(),
        "last_scraped_at": product.last_scraped_at.isoformat(),
        "availability": payload.availability,
        "availability_changed": previous_availability != payload.availability,
        "previous_availability": previous_availability,
    }

    if ai_result:
        response["ai"] = {
            "decision": ai_result.recommendation,
            "summary": ai_result.explanation,
        }

    return response
