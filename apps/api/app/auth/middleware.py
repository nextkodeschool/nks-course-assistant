"""Cookie -> session lookup -> current user.

Implemented as FastAPI dependencies rather than as ASGI middleware, because a
dependency can inject the database session it needs and can be applied per
route. The job is the same one the PRD names: turn a cookie into a user, or
reject the request.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.db.models import User
from app.db.session import get_db

SESSION_COOKIE_NAME = "nks_session"


async def get_current_user_optional(
    db: Annotated[AsyncSession, Depends(get_db)],
    nks_session: Annotated[str | None, Cookie()] = None,
) -> User | None:
    """The current user, or None if not signed in. Never raises."""
    if not nks_session:
        return None
    return await service.resolve_session(db, nks_session)


async def get_current_user(
    user: Annotated[User | None, Depends(get_current_user_optional)],
) -> User:
    """The current user, or 401.

    Use this on anything that touches a specific person's data.
    """
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "not_authenticated",
                "message": "You are not signed in, or your session has expired. Sign in again.",
            },
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_current_user_optional)]
