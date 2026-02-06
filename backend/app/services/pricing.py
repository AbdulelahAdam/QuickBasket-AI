import re
from decimal import Decimal


def parse_price_to_decimal(price_raw: str | None) -> Decimal | None:
    if not price_raw:
        return None

    s = price_raw.strip()

    s = s.replace("\u00a0", " ")
    s = re.sub(r"[^\d.,]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()

    tokens = re.findall(r"\d[\d.,]*", s)
    if not tokens:
        return None

    num = tokens[-1]

    if num.count(",") > 0 and num.count(".") == 0:
        if re.search(r",\d{2}$", num):
            num = num.replace(".", "").replace(",", ".")
        else:
            num = num.replace(",", "")
    else:
        num = num.replace(",", "")

    try:
        return Decimal(num)
    except:
        return None
