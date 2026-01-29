import os


def get_proxy():
    proxy = os.getenv("OUTBOUND_PROXY")
    if not proxy:
        return None
    return {"http://": proxy, "https://": proxy}
