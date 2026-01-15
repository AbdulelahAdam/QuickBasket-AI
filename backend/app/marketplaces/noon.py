import asyncio
import re
import time
from abc import ABC, abstractmethod

import httpx
import structlog
from bs4 import BeautifulSoup

from app.core.geo import detect_country

logger = structlog.get_logger(__name__)

COUNTRY_MAP = {
    "eg": "egypt-en",
    "sa": "saudi-en",
    "ae": "uae-en",
}


class MarketplaceAdapter(ABC):
    @abstractmethod
    def can_handle(self, url: str) -> bool: ...

    @abstractmethod
    async def fetch(self, url: str) -> dict: ...


class NoonAdapter(MarketplaceAdapter):
    BASE_DOMAIN = "noon.com"

    def can_handle(self, url: str) -> bool:
        return self.BASE_DOMAIN in url

    # -------------------------
    # Public API
    # -------------------------

    async def fetch(self, url: str) -> dict:
        country = await detect_country()
        locale = COUNTRY_MAP.get(country, "egypt-en")

        headers = self._build_headers(locale)
        cookies = self._build_cookies(country, locale)

        try:
            response = await self._fetch_with_protocol_downgrade(
                url=url,
                headers=headers,
                cookies=cookies,
            )
        except Exception as exc:
            logger.error(
                "noon.fetch.giveup",
                url=url,
                error_type=type(exc).__name__,
                error_repr=repr(exc),
            )

            # 🔑 IMPORTANT: graceful degradation
            return {
                "marketplace": "noon",
                "url": url,
                "country": country,
                "status": "timeout",
                "title": None,
                "price_raw": None,
                "price": None,
                "currency": None,
            }

        soup = BeautifulSoup(response.text, "html.parser")

        price_raw = self._extract_price_raw(soup)
        price, currency = self._normalize_price(price_raw)

        return {
            "marketplace": "noon",
            "url": str(response.url),
            "country": country,
            "status": "ok",
            "title": self._safe_text(soup, "h1"),
            "price_raw": price_raw,
            "price": price,
            "currency": currency,
        }

    # -------------------------
    # Transport layer
    # -------------------------

    async def _fetch_with_protocol_downgrade(
        self,
        url: str,
        headers: dict,
        cookies: dict,
    ) -> httpx.Response:
        last_exc = None

        # Attempt 1: HTTP/2
        try:
            async with httpx.AsyncClient(
                headers=headers,
                cookies=cookies,
                follow_redirects=True,
                timeout=httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0),
                http2=True,
            ) as client:
                return await self._fetch_with_retries(client, url)
        except Exception as exc:
            last_exc = exc
            logger.warning(
                "noon.fetch.http2_failed",
                url=url,
                error_type=type(exc).__name__,
                error_repr=repr(exc),
            )

        # Attempt 2: HTTP/1.1
        async with httpx.AsyncClient(
            headers=headers,
            cookies=cookies,
            follow_redirects=True,
            timeout=httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0),
            http2=False,
        ) as client:
            return await self._fetch_with_retries(client, url)

    async def _fetch_with_retries(
        self,
        client: httpx.AsyncClient,
        url: str,
        retries: int = 3,
    ) -> httpx.Response:
        start = time.monotonic()

        for attempt in range(1, retries + 1):
            logger.info(
                "noon.fetch.attempt",
                url=url,
                attempt=attempt,
            )

            try:
                resp = await client.get(url)
                resp.raise_for_status()
                return resp

            except Exception as exc:
                elapsed = round(time.monotonic() - start, 2)

                logger.warning(
                    "noon.fetch.retry",
                    url=url,
                    attempt=attempt,
                    elapsed=elapsed,
                    error_type=type(exc).__name__,
                    error_repr=repr(exc),
                )

                # ⛔ Hard stop at ~15s total
                if elapsed > 15 or attempt == retries:
                    raise

                await asyncio.sleep(min(2**attempt, 4))

    # -------------------------
    # Headers / cookies
    # -------------------------

    def _build_headers(self, locale: str) -> dict:
        return {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": f"https://{self.BASE_DOMAIN}/{locale}/",
        }

    def _build_cookies(self, country: str, locale: str) -> dict:
        return {
            "NNCountry": country.upper(),
            "NNLocale": locale,
        }

    # -------------------------
    # Parsing helpers
    # -------------------------

    def _safe_text(self, soup: BeautifulSoup, selector: str) -> str | None:
        el = soup.select_one(selector)
        return el.text.strip() if el else None

    def _extract_price_raw(self, soup: BeautifulSoup) -> str | None:
        el = soup.select_one('[data-qa="product-price"]')
        if el:
            return el.text.strip()

        meta = soup.select_one('meta[property="product:price:amount"]')
        if meta and meta.get("content"):
            return meta["content"]

        for script in soup.find_all("script"):
            if script.string and "price" in script.string.lower():
                match = re.search(r'"price"\s*:\s*"([^"]+)"', script.string)
                if match:
                    return match.group(1)

        return None

    def _normalize_price(self, raw: str | None) -> tuple[float | None, str | None]:
        if not raw:
            return None, None

        raw = raw.replace(",", "").strip()
        lowered = raw.lower()

        currency = "EGP"
        if "sar" in lowered:
            currency = "SAR"
        elif "aed" in lowered:
            currency = "AED"

        match = re.search(r"(\d+(\.\d+)?)", raw)
        if not match:
            return None, currency

        return float(match.group(1)), currency
