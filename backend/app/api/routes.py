from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.marketplaces.noon import NoonAdapter
from app.marketplaces.amazon import AmazonAdapter

router = APIRouter()

adapters = [
    NoonAdapter(),
    AmazonAdapter(),
]


class TrackRequest(BaseModel):
    url: str


@router.post("/track")
async def track_product(payload: TrackRequest):
    url = payload.url

    for adapter in adapters:
        if adapter.can_handle(url):
            return await adapter.fetch(url)

    raise HTTPException(status_code=400, detail="Unsupported marketplace")


@router.post("/track/browser")
async def track_from_browser(payload: dict):
    """
    Browser-sourced data:
    - Already rendered
    - Already human-authenticated
    """

    # Normalize price here
    price, currency = normalize_price(payload.get("price_raw"))

    # Persist immediately
    save_price_point(
        url=payload["url"],
        marketplace=payload["marketplace"],
        price=price,
        currency=currency,
    )

    return {"status": "tracked"}
