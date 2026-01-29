import os


class Settings:
    DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://quickbasket:secret@db:5432/quickbasket",
    )


settings = Settings()
