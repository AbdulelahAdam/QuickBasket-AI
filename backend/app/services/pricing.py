import re
from decimal import Decimal


def parse_price_to_decimal(price_raw: str | None) -> Decimal | None:
    if not price_raw:
        return None

    # Examples:
    # "EGP 2,013.50"
    # "2,013.50 EGP"
    # "2,013"
    s = price_raw.strip()

    s = s.replace("\u00a0", " ")
    s = re.sub(r"[^\d.,]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()

    # take last number-like token
    tokens = re.findall(r"\d[\d.,]*", s)
    if not tokens:
        return None

    num = tokens[-1]

    # normalize
    if num.count(",") > 0 and num.count(".") == 0:
        # maybe comma is decimal or thousands
        # if last comma has 2 digits after => decimal
        if re.search(r",\d{2}$", num):
            num = num.replace(".", "").replace(",", ".")
        else:
            num = num.replace(",", "")
    else:
        # assume comma thousands
        num = num.replace(",", "")

    try:
        return Decimal(num)
    except:
        return None
