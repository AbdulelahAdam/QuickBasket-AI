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
