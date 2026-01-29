import asyncio
from app.db.session import SessionLocal
from app.services.monitor import run_monitor_cycle


def main():
    db = SessionLocal()
    try:
        asyncio.run(run_monitor_cycle(db))
    finally:
        db.close()


if __name__ == "__main__":
    main()
