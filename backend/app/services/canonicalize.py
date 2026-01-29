from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

DROP_PARAMS = {
    "shareId",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
}


def canonicalize_url(url: str) -> str:
    p = urlparse(url)
    q = [
        (k, v)
        for (k, v) in parse_qsl(p.query, keep_blank_values=True)
        if k not in DROP_PARAMS
    ]
    clean = p._replace(query=urlencode(q, doseq=True), fragment="")
    return urlunparse(clean)
