import re
from functools import lru_cache

AMAZON_ASIN_PATTERN = re.compile(r"/(?:dp|gp/product)/([A-Z0-9]{10})", re.IGNORECASE)
NOON_SKU_PATTERN = re.compile(r"/([A-Z0-9]+)/p/", re.IGNORECASE)


@lru_cache(maxsize=1024)
def canonicalize_url(url: str) -> str:

    base_url = url.split("?")[0].split("#")[0]

    asin_match = AMAZON_ASIN_PATTERN.search(base_url)
    if asin_match:
        asin = asin_match.group(1).upper()
        print(f"[DEBUG] Canonicalized Amazon: {url} → AMZN-{asin}")
        return f"AMZN-{asin}"

    noon_match = NOON_SKU_PATTERN.search(base_url)
    if noon_match:
        sku = noon_match.group(1).upper()
        print(f"[DEBUG] Canonicalized Noon: {url} → NOON-{sku}")
        return f"NOON-{sku}"

    fallback = base_url.lower().rstrip("/")
    print(f"[WARN] Using fallback canonicalization: {url} → {fallback}")
    return fallback


def extract_product_id(canonical_url: str) -> str | None:
    if canonical_url.startswith("AMZN-"):
        return canonical_url[5:]
    if canonical_url.startswith("NOON-"):
        return canonical_url[5:]
    return None


def is_amazon_url(url: str) -> bool:
    return "amazon." in url.lower()


def is_noon_url(url: str) -> bool:
    return "noon." in url.lower()
