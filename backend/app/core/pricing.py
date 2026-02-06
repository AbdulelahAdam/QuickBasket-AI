import re


def normalize_price(raw: str | None) -> tuple[float | None, str | None]:
    if not raw:
        return None, None

    text = raw.replace(",", "").strip().lower()

    if "egp" in text or "جنيه" in text:
        currency = "EGP"
    elif "sar" in text or "ريال" in text:
        currency = "SAR"
    elif "aed" in text or "درهم" in text:
        currency = "AED"
    else:
        currency = "USD"

    match = re.search(r"(\d+(\.\d+)?)", text)
    if not match:
        return None, currency

    return float(match.group(1)), currency
