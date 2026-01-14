from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "QuickBasket AI"
    DATABASE_URL: str = "sqlite:///./quickbasket.db"
    GEOIP_PROVIDER: str = "ipapi"
    USER_AGENT: str = "QuickBasketAI/1.0"


settings = Settings()
