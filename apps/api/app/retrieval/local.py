"""Local retrieval: Ollama embeddings against pgvector.

This is the default, so a fresh clone works offline with no NKS key. It is
also the fallback if the hosted service is ever down mid-class.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import KbChunk
from app.retrieval.embeddings import EmbeddingClient
from app.retrieval.port import MAX_CHUNK_CHARS, MAX_TOP_K, Chunk

log = logging.getLogger("nks.retrieval.local")


class LocalRetriever:
    """Implements RetrieverPort against the kb_chunks table."""

    def __init__(self, db: AsyncSession, embeddings: EmbeddingClient | None = None) -> None:
        self.db = db
        self.embeddings = embeddings or EmbeddingClient()

    async def search(
        self,
        query: str,
        top_k: int = MAX_TOP_K,
        session_range: tuple[int, int] | None = None,
    ) -> list[Chunk]:
        # Clamped, not rejected -- the hosted service does the same, so both
        # modes behave identically for a client that asks for more.
        top_k = max(1, min(top_k, MAX_TOP_K))

        query_vector = await self.embeddings.embed_one(query)

        # cosine_distance is 0 for identical, 2 for opposite. Similarity is
        # 1 - distance, which puts scores on the same 0..1 scale the hosted
        # service returns, so the relevance threshold means the same thing in
        # both modes.
        distance = KbChunk.embedding.cosine_distance(query_vector)

        statement = select(KbChunk, distance.label("distance")).order_by(distance).limit(top_k)

        if session_range is not None:
            low, high = session_range
            statement = statement.where(
                KbChunk.session_number >= low,
                KbChunk.session_number <= high,
            )

        rows = (await self.db.execute(statement)).all()

        return [
            Chunk(
                id=str(chunk.id),
                text=chunk.content[:MAX_CHUNK_CHARS],
                session_number=chunk.session_number,
                session_title=chunk.session_title,
                score=round(1.0 - float(dist), 4),
            )
            for chunk, dist in rows
        ]
