FROM python:3.11-slim

# -------------------------
# Environment hardening
# -------------------------
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# -------------------------
# System dependencies
# -------------------------
# build-essential + python3-dev:
# - needed for potential C extensions
# - safe to keep for scraping stacks
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3-dev \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# -------------------------
# Python dependencies
# (cached layer)
# -------------------------
COPY requirements.txt .

RUN pip install --upgrade pip && \
    pip install --default-timeout=100 -r requirements.txt

# -------------------------
# Application code
# -------------------------
COPY app ./app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
