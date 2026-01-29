import asyncio
import httpx
from bs4 import BeautifulSoup
from app.marketplaces.base import get_proxy


class AmazonAdapter:
    BASE_DOMAIN = "amazon."

    def can_handle(self, url: str) -> bool:
        return self.BASE_DOMAIN in url

    async def fetch(self, url: str) -> dict:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            )
        }

        proxy = get_proxy()

        async with httpx.AsyncClient(
            headers=headers,
            proxies=proxy,
            timeout=10,
            follow_redirects=True,
        ) as client:
            for attempt in range(3):
                try:
                    r = await client.get(url)
                    r.raise_for_status()
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    await asyncio.sleep(2**attempt)

        soup = BeautifulSoup(r.text, "html.parser")

        title = soup.select_one("productTitle")
        price = soup.select_one("span.a-price > span.a-offscreen")

        return {
            "marketplace": "amazon",
            "url": url,
            "title": title.text.strip() if title else None,
            "price_raw": price.text.strip() if price else None,
        }
