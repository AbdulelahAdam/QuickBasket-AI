import asyncio
import time
import httpx
import structlog
from bs4 import BeautifulSoup
from app.marketplaces.base import get_proxy

logger = structlog.get_logger(__name__)


class NoonAdapter:
    BASE_DOMAIN = "noon.com"

    def can_handle(self, url: str) -> bool:
        return self.BASE_DOMAIN in url

    async def fetch(self, url: str) -> dict:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        }

        proxy = get_proxy()

        async with httpx.AsyncClient(
            headers=headers,
            proxies=proxy,
            follow_redirects=True,
            timeout=httpx.Timeout(10.0),
            http2=True,
        ) as client:
            start = time.monotonic()

            for attempt in range(3):
                try:
                    resp = await client.get(url)
                    resp.raise_for_status()
                    break
                except Exception as e:
                    logger.warning(
                        "noon.fetch.retry",
                        attempt=attempt + 1,
                        error=str(e),
                    )
                    if time.monotonic() - start > 15:
                        raise
                    await asyncio.sleep(2**attempt)

        soup = BeautifulSoup(resp.text, "html.parser")

        title_el = soup.select_one("h1")
        price_el = soup.select_one('[data-qa="product-price"]')

        result = {
            "marketplace": "noon",
            "url": url,
            "title": title_el.text.strip() if title_el else None,
            "price_raw": price_el.text.strip() if price_el else None,
            "source": "backend",
        }

        if not result["price_raw"]:
            logger.info(
                "noon.fetch.no_price",
                url=url,
                note="Price likely JS-rendered; browser extension required",
            )

        return result
