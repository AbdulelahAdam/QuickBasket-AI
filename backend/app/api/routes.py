from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from app.db.base import SessionLocal
from app.core.pricing import normalize_price
from app.models.price_history import PriceSnapshot
from app.services.alerts import evaluate_alerts

router = APIRouter()


class TrackRequest(BaseModel):
    url: str
    marketplace: str
    title: str | None = None
    price_raw: str | None = None


@router.post("/track/browser")
def track_from_browser(payload: TrackRequest):
    if not payload.price_raw:
        raise HTTPException(status_code=400, detail="Missing price")

    price, currency = normalize_price(payload.price_raw)

    if price is None:
        raise HTTPException(status_code=400, detail="Invalid price")

    db: Session = SessionLocal()
    try:
        snapshot = PriceSnapshot(
            url=payload.url,
            marketplace=payload.marketplace,
            title=payload.title,
            price=price,
            currency=currency,
        )
        db.add(snapshot)
        db.commit()
    finally:
        db.close()

    return {"status": "tracked"}


@router.get("/dashboard")
def dashboard():
    db = SessionLocal()
    try:
        return (
            db.query(
                PriceSnapshot.url,
                PriceSnapshot.marketplace,
                func.min(PriceSnapshot.price).label("min_price"),
                func.max(PriceSnapshot.price).label("max_price"),
            )
            .group_by(PriceSnapshot.url, PriceSnapshot.marketplace)
            .all()
        )
    finally:
        db.close()
