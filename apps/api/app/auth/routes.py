"""Register, login, logout, and who-am-I."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.middleware import SESSION_COOKIE_NAME, CurrentUser
from app.config import settings
from app.db.models import User
from app.db.session import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])

Db = Annotated[AsyncSession, Depends(get_db)]


class Credentials(BaseModel):
    email: EmailStr
    # 8 is a floor, not a policy. Length is the only password rule that
    # reliably helps; character-class rules mostly produce Passw0rd!.
    password: str = Field(min_length=8, max_length=200)


class UserOut(BaseModel):
    # id is a UUID column, not a string. Declaring it as str here does not
    # coerce -- Pydantic validates the response too, and rejects it.
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    created_at: datetime


def _set_session_cookie(response: Response, raw_token: str, expires_at: datetime) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=raw_token,
        expires=expires_at,
        httponly=True,  # JavaScript cannot read it, so XSS cannot steal it.
        samesite="lax",  # Not sent on cross-site POSTs, which blocks basic CSRF.
        # Secure means "HTTPS only". Enabling it in development would break
        # login on http://localhost, so it follows the environment. In
        # production this must be on -- without it the cookie travels in
        # plaintext on any accidental http:// request.
        secure=settings.is_production,
        path="/",
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(body: Credentials, response: Response, db: Db) -> User:
    existing = await service.get_user_by_email(db, body.email)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "email_taken",
                "message": "An account with that email already exists. Try signing in instead.",
            },
        )

    user = await service.register_user(db, body.email, body.password)
    raw_token, expires_at = await service.issue_session(db, user)
    _set_session_cookie(response, raw_token, expires_at)
    return user


@router.post("/login", response_model=UserOut)
async def login(body: Credentials, response: Response, db: Db) -> User:
    user = await service.authenticate(db, body.email, body.password)
    if user is None:
        # One message for both "no such account" and "wrong password". Saying
        # which would let anyone check whether an address has an account here.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "invalid_credentials",
                "message": "That email and password do not match an account.",
            },
        )

    raw_token, expires_at = await service.issue_session(db, user)
    _set_session_cookie(response, raw_token, expires_at)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def logout(
    db: Db,
    nks_session: Annotated[str | None, Cookie()] = None,
) -> Response:
    """Delete the session row, then clear the cookie.

    Order matters. Clearing the cookie is cosmetic -- it only asks the browser
    to forget the token. Deleting the row is what actually ends the session,
    so that a copy of the token taken beforehand stops working too.

    The Response is built here rather than injected, because a 204 carries no
    body and FastAPI refuses to attach a response model to one.
    """
    if nks_session:
        await service.revoke_session(db, nks_session)

    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return response


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> User:
    return user
