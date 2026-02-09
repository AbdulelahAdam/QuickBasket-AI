from fastapi import Depends, HTTPException, Header
from supabase import Client
from sqlalchemy.orm import Session
import os
import jwt
from typing import Optional

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

if not SUPABASE_URL:
    raise ValueError("SUPABASE_URL environment variable is not set")
if not SUPABASE_SERVICE_KEY and not SUPABASE_ANON_KEY:
    raise ValueError("Neither SUPABASE_SERVICE_ROLE_KEY nor SUPABASE_ANON_KEY is set")

_supabase_client: Optional[Client] = None


def get_supabase_client() -> Client:
    global _supabase_client

    if _supabase_client is None:
        from supabase import create_client

        try:
            if SUPABASE_SERVICE_KEY:
                _supabase_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
            else:
                _supabase_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        except Exception as e:
            if SUPABASE_ANON_KEY:
                try:
                    _supabase_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
                except Exception as e2:
                    raise RuntimeError(f"Cannot initialize Supabase client: {e}")
            else:
                raise RuntimeError(f"Cannot initialize Supabase client: {e}")

    return _supabase_client


def verify_token(authorization: str = Header(None)) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")

    try:
        token = authorization.replace("Bearer ", "").strip()
        decoded = jwt.decode(token, options={"verify_signature": False})

        user_id = decoded.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token: no user ID")

        return user_id

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")


def get_current_user(user_id: str = Depends(verify_token)) -> str:
    return user_id


def set_user_context(db: Session, user_id: str):
    try:
        from sqlalchemy import text

        db.execute(
            text("SET LOCAL app.current_user_id = :user_id"), {"user_id": user_id}
        )
    except Exception as e:
        pass
