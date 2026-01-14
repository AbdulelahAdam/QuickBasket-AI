def generate_price_insight(history: list[float]) -> dict:
    if not history:
        return {"insight": "No data yet", "confidence": 0.0}
    trend = history[-1] - history[0]
    return {
        "insight": "Price trending down" if trend < 0 else "Price trending up",
        "confidence": min(abs(trend) / max(history), 1.0)
    }
