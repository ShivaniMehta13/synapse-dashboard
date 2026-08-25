from typing import Optional

from fastapi import APIRouter, Header, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/auth")


class LoginRequest(BaseModel):
    email: str


def _normalize_email(email: str):
    return (email or "").strip().lower()


@router.post("/login")
def login(payload: LoginRequest):
    email = _normalize_email(payload.email)
    if not email:
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"message": "Email is required"})

    try:
        from backend.main import fetch_flows_for_email
    except ImportError:
        from main import fetch_flows_for_email

    try:
        flows = fetch_flows_for_email(email)
    except Exception as exc:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "message": "We couldn't find any agents for this email — check with your team.",
                "detail": str(exc),
            },
        )

    if flows is not None:
        return {"message": "Logged in", "email": email}

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"message": "We couldn't find any agents for this email — check with your team."},
    )


@router.post("/logout")
def logout(authorization: Optional[str] = Header(None)):
    """No-op logout maintained for compatibility while auth is email-only."""
    return {"message": "Logged out"}
