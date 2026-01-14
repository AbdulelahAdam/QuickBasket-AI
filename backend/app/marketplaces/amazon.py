import asyncio
import re
from bs4 import BeautifulSoup
import httpx

from app.marketplaces.noon import MarketplaceAdapter
from app.core.geo import detect_country


class AmazonAdapter(MarketplaceAdapter):
    BASE_DOMAIN = "amazon."

    def can_handle(self, url: str) -> bool:
        return self.BASE_DOMAIN in url

    async def fetch(self, url: str, country: str | None = None) -> dict:
        country = country or await detect_country()

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        }

        async with httpx.AsyncClient(headers=headers, timeout=10) as client:
            response = await self._fetch_with_retries(client, url)

        soup = BeautifulSoup(response.text, "html.parser")

        title = self._safe_text(soup, "#productTitle")
        price_raw = self._extract_price_raw(soup)
        price, currency = self._normalize_price(price_raw)

        return {
            "marketplace": "amazon",
            "url": url,
            "title": title,
            "price_raw": price_raw,
            "price": price,
            "currency": currency,
        }

    async def _fetch_with_retries(self, client, url, retries=3):
        for attempt in range(retries):
            try:
                r = await client.get(url)
                r.raise_for_status()
                return r
            except Exception:
                if attempt == retries - 1:
                    raise
                await asyncio.sleep(2**attempt)

    def _safe_text(self, soup, selector):
        el = soup.select_one(selector)
        return el.text.strip() if el else None

    def _extract_price_raw(self, soup):
        selectors = [
            "#priceblock_ourprice",
            "#priceblock_dealprice",
            "span.a-price > span.a-offscreen",
        ]
        for sel in selectors:
            el = soup.select_one(sel)
            if el:
                return el.text.strip()
        return None

    def _normalize_price(self, raw):
        if not raw:
            return None, None
        raw = raw.replace(",", "")
        match = re.search(r"(\d+(\.\d+)?)", raw)
        if not match:
            return None, None
        return float(match.group(1)), "USD"
