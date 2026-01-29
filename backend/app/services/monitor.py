import asyncio
from sqlalchemy.orm import Session
from app.db.models import TrackedProduct, PriceSnapshot, PriceEvent
from app.services.pricing import parse_price_to_decimal
from app.marketplaces.amazon import AmazonAdapter
from app.marketplaces.noon import NoonAdapter

adapters = [AmazonAdapter(), NoonAdapter()]


def pick_adapter(url: str):
    for a in adapters:
        if a.can_handle(url):
            return a
    return None


async def monitor_one(db: Session, product: TrackedProduct):
    adapter = pick_adapter(product.url)
    if not adapter:
        return

    data = await adapter.fetch(product.url)
    price_raw = data.get("price_raw")
    title = data.get("title") or product.title
    currency = data.get("currency") or product.currency or "EGP"

    price_dec = parse_price_to_decimal(price_raw)
    price_value = float(price_dec) if price_dec is not None else None

    # last snapshot
    last = (
        db.query(PriceSnapshot)
        .filter(PriceSnapshot.tracked_product_id == product.id)
        .order_by(PriceSnapshot.fetched_at.desc())
        .first()
    )

    snap = PriceSnapshot(
        tracked_product_id=product.id,
        price=price_value,
        currency=currency,
        raw_price_text=price_raw,
        availability=data.get("availability"),
        source="monitor",
    )
    db.add(snap)

    # update product title/image if changed
    product.title = title
    if data.get("image_url"):
        product.image_url = data["image_url"]
    db.add(product)

    # event detection
    if last and last.price is not None and price_value is not None:
        old = float(last.price)
        new = price_value
        if new != old:
            ev_type = "drop" if new < old else "increase"
            db.add(
                PriceEvent(
                    tracked_product_id=product.id,
                    event_type=ev_type,
                    old_price=old,
                    new_price=new,
                    currency=currency,
                )
            )

    db.commit()


async def run_monitor_cycle(db: Session):
    products = db.query(TrackedProduct).filter(TrackedProduct.is_active.is_(True)).all()

    for p in products:
        try:
            await monitor_one(db, p)
        except Exception as e:
            # keep cycle alive
            print(f"[monitor] failed for {p.id}: {e}")
