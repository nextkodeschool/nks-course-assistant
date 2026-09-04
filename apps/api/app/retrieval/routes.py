"""What Kora knows, so the interface can say so and let a student read it.

In local mode the notes are in the student's own database, so listing the
sessions and reading one back is reading their own data. In hosted mode
nothing about the corpus is enumerated -- FR-49 forbids it and the retrieval
contract has no call for it -- so the list is empty and a session cannot be
opened; only the passages retrieved for an answer can ever be shown.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.middleware import CurrentUser
from app.config import settings
from app.db.models import KbChunk
from app.db.session import get_db

router = APIRouter(prefix="/api/kb", tags=["kb"])

Db = Annotated[AsyncSession, Depends(get_db)]


@router.get("")
async def kb_info(user: CurrentUser, db: Db) -> dict:
    if settings.kb_mode == "hosted":
        return {"mode": "hosted", "session_count": None, "sessions": []}

    rows = (
        await db.execute(
            select(KbChunk.session_number, KbChunk.session_title, KbChunk.topic, func.count())
            .group_by(KbChunk.session_number, KbChunk.session_title, KbChunk.topic)
            .order_by(KbChunk.session_number)
        )
    ).all()

    return {
        "mode": "local",
        "session_count": len(rows),
        "sessions": [
            {"session_number": n, "session_title": title, "topic": topic, "chunks": count}
            for n, title, topic, count in rows
        ],
    }


@router.get("/sessions/{session_number}")
async def kb_session(session_number: int, user: CurrentUser, db: Db) -> dict:
    if settings.kb_mode == "hosted":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "not_available",
                "message": "Full session notes are not available in hosted mode. "
                "Only the passages retrieved for an answer can be shown.",
            },
        )

    rows = (
        await db.execute(
            select(KbChunk)
            .where(KbChunk.session_number == session_number)
            .order_by(KbChunk.position.asc().nulls_last(), KbChunk.created_at)
        )
    ).scalars().all()

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "not_found", "message": f"There are no notes for session {session_number}."},
        )

    return {
        "session_number": session_number,
        "session_title": rows[0].session_title,
        "topic": rows[0].topic,
        "passages": [row.content for row in rows],
    }
