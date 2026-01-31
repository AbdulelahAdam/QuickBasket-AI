from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.ai_routes import router as ai_router
from app.api.dashboard import router as dashboard_router
from app.api.routes import router as base_router
from app.api.alerts_routes import router as alerts_router
from app.db.base import Base, engine
from app.db.models import price_snapshot

app = FastAPI(title="QuickBasket AI")

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
Base.metadata.create_all(bind=engine)
