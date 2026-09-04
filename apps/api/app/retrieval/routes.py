"""What Kora knows, so the interface can say so.

In local mode the notes are in the student's own database, so listing the
sessions is listing their own data. In hosted mode nothing about the corpus
is enumerated -- FR-49 forbids it and the retrieval contract has no call for
it -- so the answer is just "hosted", and the interface describes the mode
rather than the contents.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
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
            select(KbChunk.session_number, KbChunk.session_title, func.count())
            .group_by(KbChunk.session_number, KbChunk.session_title)
            .order_by(KbChunk.session_number)
        )
    ).all()

    return {
        "mode": "local",
        "session_count": len(rows),
        "sessions": [
            {"session_number": number, "session_title": title, "chunks": count}
            for number, title, count in rows
        ],
    }
