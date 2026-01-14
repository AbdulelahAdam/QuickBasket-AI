import httpx


async def detect_country(ip: str | None = None) -> str:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get("https://ipapi.co/json/")
            r.raise_for_status()
            return r.json().get("country_code", "EG").lower()
    except Exception:
        return "eg"
