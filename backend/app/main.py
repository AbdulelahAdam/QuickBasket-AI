from fastapi import FastAPI
from app.api.routes import router

app = FastAPI(title="QuickBasket AI")
app.include_router(router, prefix="/api/v1")
