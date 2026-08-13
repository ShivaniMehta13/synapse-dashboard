import json
import secrets
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, status, Header
from fastapi.responses import JSONResponse
from passlib.context import CryptContext
from pydantic import BaseModel

router = APIRouter(prefix="/api/auth")
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
USERS_FILE = Path(__file__).with_name("users.json")

# In-memory session store mapping token -> email
SESSIONS: dict[str, str] = {}


class AuthRequest(BaseModel):
    email: str
    password: str


def _read_users():
    if not USERS_FILE.exists():
        return {}
    try:
        with USERS_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_users(users):
    with USERS_FILE.open("w", encoding="utf-8") as f:
        json.dump(users, f, indent=2)


def _normalize_email(email: str):
    return email.strip().lower()


@router.post("/signup", status_code=status.HTTP_201_CREATED)
def signup(payload: AuthRequest):
    email = _normalize_email(payload.email)
    password = payload.password
    if not email or not password:
        return JSONResponse(status_code=400, content={"message": "Email and password are required"})

    users = _read_users()
    if email in users:
        return JSONResponse(status_code=409, content={"message": "Email already registered"})

    users[email] = {"password_hash": pwd_context.hash(password)}
    _write_users(users)
    return {"message": "User created"}


@router.post("/signin")
def signin(payload: AuthRequest):
    email = _normalize_email(payload.email)
    users = _read_users()
    user = users.get(email)
    if not user or not pwd_context.verify(payload.password, user.get("password_hash", "")):
        return JSONResponse(status_code=401, content={"message": "Invalid email or password"})
    token = secrets.token_urlsafe(32)
    SESSIONS[token] = email
    return {"message": "Signed in", "token": token}


def get_current_user(authorization_header: Optional[str]) -> Optional[str]:
    """Return the email associated with the provided Authorization header token."""
    if not authorization_header:
        return None
    parts = authorization_header.split()
    token = parts[-1] if parts else None
    if not token:
        return None
    return SESSIONS.get(token)


@router.post("/logout")
def logout(authorization: Optional[str] = Header(None)):
    """Remove the session token if present. Idempotent."""
    if authorization:
        parts = authorization.split()
        token = parts[-1] if parts else None
        if token and token in SESSIONS:
            try:
                del SESSIONS[token]
            except KeyError:
                pass
    return {"message": "Logged out"}
