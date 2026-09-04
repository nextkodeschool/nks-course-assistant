"""Password hashing and session lifecycle.

Read this file more carefully than the rest of the repository.

Inside this app, authentication protects nothing -- the student owns the
database and can grant themselves anything. It exists to teach session state,
secret injection, and persistence across restarts.

But this is also the file most likely to get copied into something that does
matter. So it is written the way it should be written in production, and the
reasoning is in the comments.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from anyio import to_thread
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Session, User

SESSION_LIFETIME = timedelta(days=14)

# 32 bytes from the OS CSPRNG. Not uuid4, not random.choice, not a hash of the
# email and a timestamp -- a session token is a credential and must be
# unguessable, and this is the only function in the standard library that
# makes that promise.
SESSION_TOKEN_BYTES = 32

# argon2id with the library defaults, which track the OWASP recommendation.
#
# These parameters are deliberately expensive: ~64MB of memory and ~100ms per
# hash. That cost is the entire point -- it is what makes a stolen database of
# hashes impractical to crack. It is also why every call below goes through a
# worker thread.
_hasher = PasswordHasher()


async def hash_password(password: str) -> str:
    """Hash a password. Runs in a worker thread.

    This app is fully async, and argon2id burns ~100ms of CPU by design.
    Calling it directly in a request handler would block the event loop for
    that whole time -- meaning every other user's request, including anyone
    mid-way through a streaming answer, stops dead while one person logs in.

    Choosing async does not make everything safe to await. Anything CPU-bound
    or blocking goes through a thread, and this is the clearest example in
    the codebase.
    """
    return await to_thread.run_sync(_hasher.hash, password)


async def verify_password(password_hash: str, password: str) -> bool:
    """Check a password against its hash. Runs in a worker thread.

    Returns False rather than raising, so callers cannot accidentally leak
    which of the two failure modes occurred.
    """

    def _verify() -> bool:
        try:
            return _hasher.verify(password_hash, password)
        except (VerifyMismatchError, InvalidHashError):
            return False

    return await to_thread.run_sync(_verify)


def hash_session_token(raw_token: str) -> str:
    """Hash a session token for storage and lookup.

    Plain SHA-256, not argon2. That is not an oversight -- the two cases are
    different problems.

    Passwords are low-entropy and human-chosen, so a stolen hash must be made
    expensive to brute-force. A session token is 32 random bytes: there is
    nothing to guess, so a slow hash buys no security and would instead add
    100ms to every single authenticated request.

    Fast hash for high-entropy secrets, slow hash for human-chosen ones.
    """
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


async def register_user(db: AsyncSession, email: str, password: str) -> User:
    user = User(email=email.lower().strip(), password_hash=await hash_password(password))
    db.add(user)
    await db.flush()
    return user


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email.lower().strip()))
    return result.scalar_one_or_none()


async def authenticate(db: AsyncSession, email: str, password: str) -> User | None:
    """Return the user if the credentials are correct, else None.

    Note the dummy verify on the miss path. Without it, a login for an address
    that does not exist returns in ~1ms while a login for one that does takes
    ~100ms -- and that difference is enough to enumerate which email addresses
    have accounts, without ever guessing a password. Doing the work either way
    removes the signal.
    """
    user = await get_user_by_email(db, email)
    if user is None:
        await verify_password(
            "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$"
            "RdescudvJCsgt3ub+b+dWRWJTmaaJObG",
            password,
        )
        return None

    if not await verify_password(user.password_hash, password):
        return None

    return user


async def issue_session(db: AsyncSession, user: User) -> tuple[str, datetime]:
    """Create a session row and return the raw token plus its expiry.

    The raw token is returned once, to be put in the cookie, and is never
    stored. Only its hash goes to the database.
    """
    raw_token = secrets.token_urlsafe(SESSION_TOKEN_BYTES)
    expires_at = datetime.now(UTC) + SESSION_LIFETIME

    db.add(
        Session(
            token_hash=hash_session_token(raw_token),
            user_id=user.id,
            expires_at=expires_at,
        )
    )
    await db.flush()
    return raw_token, expires_at


async def resolve_session(db: AsyncSession, raw_token: str) -> User | None:
    """Look up the user for a session token, or None if it is invalid.

    Expiry is checked here in the query rather than by a background job, so
    an expired session stops working the moment it expires whether or not
    anything has swept the table.
    """
    result = await db.execute(
        select(User)
        .join(Session, Session.user_id == User.id)
        .where(
            Session.token_hash == hash_session_token(raw_token),
            Session.expires_at > datetime.now(UTC),
        )
    )
    return result.scalar_one_or_none()


async def revoke_session(db: AsyncSession, raw_token: str) -> None:
    """Delete the session row.

    Logout deletes server-side state. Clearing the cookie alone would leave a
    token that still works if anyone kept a copy of it -- which is exactly
    what "log out on a shared machine" is supposed to prevent.
    """
    await db.execute(delete(Session).where(Session.token_hash == hash_session_token(raw_token)))


async def revoke_all_sessions(db: AsyncSession, user: User) -> None:
    """Log a user out everywhere. Used on password change, once that exists."""
    await db.execute(delete(Session).where(Session.user_id == user.id))


async def purge_expired_sessions(db: AsyncSession) -> int:
    """Delete expired rows. Called at startup; expired sessions are already
    rejected by resolve_session, so this is housekeeping, not enforcement."""
    result = await db.execute(delete(Session).where(Session.expires_at <= datetime.now(UTC)))
    return result.rowcount or 0
