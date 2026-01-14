from fastapi import FastAPI
from app.api.routes import router
from app.core.logging import setup_logging


setup_logging()
app = FastAPI(title="QuickBasket AI")
app.include_router(router, prefix="/api/v1")
