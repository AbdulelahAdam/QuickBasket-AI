from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import (
    GZipMiddleware,
)

from app.api.ai_routes import router as ai_router
from app.api.dashboard import router as dashboard_router
from app.api.routes import router as base_router
from app.api.alerts_routes import router as alerts_router

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
    """Health check for monitoring"""
    return {"status": "healthy", "service": "quickbasket-api"}


@app.on_event("startup")
async def startup_event():
    # TODO: Redis connection, DB connection pool, etc.
    pass


@app.on_event("shutdown")
async def shutdown_event():
    # TODO: Close Redis, close DB connections, etc.
    pass
