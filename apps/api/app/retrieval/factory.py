"""KB_MODE decides which retriever the app uses.

This function is the entire cost of supporting two knowledge bases. Every
other module depends on RetrieverPort and never learns which one it got.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.retrieval.hosted import HostedRetriever
from app.retrieval.local import LocalRetriever
from app.retrieval.port import RetrieverPort


def get_retriever(db: AsyncSession) -> RetrieverPort:
    if settings.kb_mode == "hosted":
        return HostedRetriever()
    return LocalRetriever(db)
