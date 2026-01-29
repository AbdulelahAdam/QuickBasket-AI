import structlog
from app.models.alerts import PriceAlert

logger = structlog.get_logger(__name__)


def evaluate_alerts(snapshot, db):
    alerts = (
        db.query(PriceAlert)
        .filter(
            PriceAlert.url == snapshot.url,
            PriceAlert.triggered.is_(False),
            PriceAlert.target_price >= snapshot.price,
        )
        .all()
    )

    for alert in alerts:
        alert.triggered = True
        logger.info(
            "alert.triggered",
            url=snapshot.url,
            price=snapshot.price,
            target=alert.target_price,
        )

    db.commit()
