import structlog
from datetime import datetime, timezone

from app.db.models.price_event import PriceEvent

logger = structlog.get_logger(__name__)


def evaluate_alerts(snapshot, db):
    alerts = (
        db.query(PriceEvent)
        .filter(
            PriceEvent.url == snapshot.product.url,
            PriceEvent.triggered.is_(False),
            PriceEvent.target_price >= snapshot.price,
        )
        .all()
    )

    for alert in alerts:
        alert.triggered = True
        alert.triggered_at = datetime.now(timezone.utc)
        alert.message = (
            alert.message
            or f"BUY NOW — price reached target: {float(snapshot.price)} {snapshot.currency}"
        )

        logger.info(
            "alert.triggered",
            url=snapshot.product.url,
            price=float(snapshot.price),
            target=(
                float(alert.target_price) if alert.target_price is not None else None
            ),
        )

    db.commit()
