"""Database tables.

Note what is absent: there is no `role` column on `users`, and there will not
be one. The student owns this database. Any permission model here can be
defeated with a single UPDATE, so it would look like security while providing
none. See section 6 of the PRD -- the boundary that actually matters is the
one between the student's app and the NKS retrieval service, and that is
enforced by an API key, not by anything in this file.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# nomic-embed-text produces 768 dimensions.
#
# The hosted service uses a different model in a different vector space (1024
# dimensions). That is not a conflict: this table is only ever populated when
# KB_MODE=local, and hosted mode never touches it. The two index different
# corpora and are never compared.
EMBEDDING_DIMENSIONS = 768


class Base(DeclarativeBase):
    pass


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)

    # argon2id output, which is self-describing: it carries the algorithm,
    # its parameters and the salt inside the string. That is what lets you
    # raise the cost parameters later without invalidating existing passwords.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    sessions: Mapped[list["Session"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    conversations: Mapped[list["Conversation"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Session(Base):
    """A login session, stored server-side so logout can actually revoke it.

    The primary key is a SHA-256 hash of the session token, not the token
    itself. The browser holds the raw token in its cookie; we hash whatever
    arrives and look up the hash.

    Why bother, when the student owns this database anyway? Because this is
    the pattern worth copying. If session tokens are stored raw, anyone who
    gets a read-only copy of the database -- a leaked backup, an over-broad
    log, a SQL injection that can only SELECT -- can impersonate every logged
    in user immediately. Storing the hash makes that dump useless.

    Same reasoning as password hashing, applied to the other credential in
    the system.
    """

    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="sessions")


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="New conversation")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="conversations")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )


class Message(Base):
    """One turn in a conversation.

    This table is why a student can kill their container, start it again, and
    still see their history. It is the clearest demonstration in the course
    that state lives outside the container.
    """

    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = _uuid_pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # Which notes the answer came from: session_number and session_title per
    # chunk. Empty list for user messages and for "no notes on that" answers.
    citations: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")


class KbChunk(Base):
    """A searchable piece of a course note. Populated only when KB_MODE=local.

    In hosted mode this table stays empty and the NKS retrieval service does
    the equivalent work on its own corpus.
    """

    __tablename__ = "kb_chunks"

    id: Mapped[uuid.UUID] = _uuid_pk()
    session_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    session_title: Mapped[str] = mapped_column(String(300), nullable=False)
    topic: Mapped[str | None] = mapped_column(String(100), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIMENSIONS), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# Sessions are swept by expiry; an index makes that cheap.
Index("ix_sessions_expires_at", Session.expires_at)
