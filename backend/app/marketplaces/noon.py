import asyncio
import re
from abc import ABC, abstractmethod

import httpx
from httpx import RemoteProtocolError, ReadTimeout
from bs4 import BeautifulSoup
from fastapi import HTTPException

from app.core.geo import detect_country

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

        response = await self._fetch_with_protocol_downgrade(
            url=url,
            headers=headers,
            cookies=cookies,
            locale=locale,
        )

        soup = BeautifulSoup(response.text, "html.parser")

        price_raw = self._extract_price_raw(soup)
        price, currency = self._normalize_price(price_raw)

        return {
            "marketplace": "noon",
            "url": str(response.url),
            "country": country,
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
        locale: str,
    ) -> httpx.Response:
        """
        1) Try HTTP/2
        2) If Noon resets stream → retry with HTTP/1.1
        3) Warm up session to look human
        """

        timeout = httpx.Timeout(
            connect=10.0,
            read=40.0,  # Noon intentionally stalls bots
            write=10.0,
            pool=10.0,
        )

        last_exc: Exception | None = None

        # -------- Attempt 1: HTTP/2 --------
        try:
            async with httpx.AsyncClient(
                headers=headers,
                cookies=cookies,
                follow_redirects=True,
                timeout=timeout,
                http2=True,
            ) as client:
                await self._warm_up(client, locale)
                return await self._fetch_with_retries(client, url)
        except (RemoteProtocolError, ReadTimeout) as exc:
            last_exc = exc

        # -------- Attempt 2: HTTP/1.1 --------
        try:
            async with httpx.AsyncClient(
                headers=headers,
                cookies=cookies,
                follow_redirects=True,
                timeout=timeout,
                http2=False,
            ) as client:
                await self._warm_up(client, locale)
                return await self._fetch_with_retries(client, url)
        except (ReadTimeout, Exception) as exc:
            last_exc = exc

        # -------- Controlled failure --------
        raise HTTPException(
            status_code=503,
            detail="Noon temporarily unavailable (bot mitigation / throttling)",
        ) from last_exc

    async def _warm_up(self, client: httpx.AsyncClient, locale: str) -> None:
        """
        Mimic real browser behavior:
        - Visit homepage
        - Let cookies/session settle
        """
        try:
            await client.get(f"https://www.{self.BASE_DOMAIN}/{locale}/")
            await asyncio.sleep(1.5)
        except Exception:
            # Warmup failure should not kill the scrape
            pass

    async def _fetch_with_retries(
        self,
        client: httpx.AsyncClient,
        url: str,
        retries: int = 3,
    ) -> httpx.Response:
        for attempt in range(retries):
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                return resp
            except Exception:
                if attempt == retries - 1:
                    raise
                await asyncio.sleep(2**attempt)

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
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": f"https://www.{self.BASE_DOMAIN}/{locale}/",
            "Connection": "keep-alive",
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
        """
        Multiple extraction strategies because Noon markup changes often.
        """

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
