from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.db.session import get_db
from app.db.models.price_event import PriceEvent

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"])


class AckRequest(BaseModel):
    source: str | None = "extension"


@router.get("/pending")
def pending_alerts(
    source: str = "extension", limit: int = 50, db: Session = Depends(get_db)
):
    alerts = (
        db.query(PriceEvent)
        .filter(
            PriceEvent.triggered.is_(True),
            PriceEvent.acknowledged.is_(False),
        )
        .order_by(desc(PriceEvent.triggered_at))
        .limit(limit)
        .all()
    )

    out = []
    for a in alerts:
        out.append(
            {
                "id": a.id,
                "type": getattr(a, "event_type", "target_price"),
                "title": getattr(a, "title", None),
                "marketplace": getattr(a, "marketplace", None),
                "url": a.url,
                "drop_percent": getattr(a, "drop_percent", None),
                "wait_days": getattr(a, "wait_days", None),
                "message": a.message or f"Target price reached: {a.target_price}",
                "created_at": a.triggered_at,
            }
        )

    return out


@router.post("/{alert_id}/ack")
def ack_alert(alert_id: int, payload: AckRequest, db: Session = Depends(get_db)):
    alert = db.get(PriceEvent, alert_id)
    if not alert:
        return {"ok": False, "error": "not_found"}

    alert.acknowledged = True
    alert.ack_source = payload.source
    db.commit()

    return {"ok": True}
