from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import (
    GZipMiddleware,
)
from sqlalchemy.orm import Session

from app.api.ai_routes import router as ai_router
from app.api.dashboard import router as dashboard_router
from app.api.routes import router as base_router
from app.api.alerts_routes import router as alerts_router
from app.db.session import get_db

app = FastAPI(
    title="QuickBasket AI API",
    description="Price tracking and AI-powered shopping insights",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)


app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "chrome-extension://lgagakhkbicledkhnhmmodncefilennd",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(base_router, prefix="/api/v1")
app.include_router(dashboard_router)
app.include_router(ai_router)
app.include_router(alerts_router)


@app.api_route("/health", methods=["GET", "HEAD"])
def health_check():
    try:
        from app.db.session import engine

        with engine.connect() as connection:
            connection.execute("SELECT 1")

        return {
            "status": "healthy",
            "service": "quickbasket-api",
            "database": "connected",
        }
    except Exception as e:
        return {
            "status": "degraded",
            "service": "quickbasket-api",
            "database": "disconnected",
            "error": str(e),
        }


@app.on_event("startup")
async def startup_event():
    # TODO: Redis connection, DB connection pool, etc.
    pass


@app.on_event("shutdown")
async def shutdown_event():
    # TODO: Close Redis, close DB connections, etc.
    pass
