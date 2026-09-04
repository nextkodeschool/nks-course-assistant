"""Turning text into vectors, for local mode only.

In hosted mode this file is never used -- the NKS service embeds the query
server-side, so a student never has to match its model. That is deliberate:
it means the hosted corpus can be re-embedded with a better model without
every clone in the world needing to change.
"""

from __future__ import annotations

import httpx

from app.config import settings
from app.retrieval.port import RetrievalUnavailable

TIMEOUT = httpx.Timeout(connect=5.0, read=120.0, write=10.0, pool=5.0)

# nomic-embed-text. Must match kb_chunks.embedding in the schema, or Postgres
# rejects the insert -- a good error to get, since a silent mismatch would
# mean quietly meaningless search results.
EXPECTED_DIMENSIONS = 768


class EmbeddingClient:
    """Calls an OpenAI-compatible /embeddings endpoint."""

    def __init__(self, base_url: str | None = None, model: str | None = None) -> None:
        self.base_url = (base_url or settings.effective_embedding_base_url).rstrip("/")
        self.model = model or settings.embedding_model
        self.api_key = settings.llm_api_key

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch. Order out matches order in."""
        if not texts:
            return []

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                response = await client.post(
                    f"{self.base_url}/embeddings",
                    json={"model": self.model, "input": texts},
                    headers=headers,
                )
        except httpx.ConnectError as exc:
            raise RetrievalUnavailable(
                f"Could not reach the embedding service at {self.base_url}.\n"
                "If you are using Ollama, check it is running and that you have "
                f"pulled the model:  ollama pull {self.model}"
            ) from exc

        if response.status_code == 404:
            raise RetrievalUnavailable(
                f"The embedding model '{self.model}' was not found.\n"
                f"Pull it first:  ollama pull {self.model}"
            )
        if response.status_code != 200:
            raise RetrievalUnavailable(
                f"The embedding service returned {response.status_code}: "
                f"{response.text[:300]}"
            )

        # The response sorts by index rather than guaranteeing input order.
        data = sorted(response.json()["data"], key=lambda item: item["index"])
        vectors = [item["embedding"] for item in data]

        for vector in vectors:
            if len(vector) != EXPECTED_DIMENSIONS:
                raise RetrievalUnavailable(
                    f"'{self.model}' produced {len(vector)}-dimensional vectors, but "
                    f"the kb_chunks table expects {EXPECTED_DIMENSIONS}.\n"
                    "Set EMBEDDING_MODEL back to nomic-embed-text, or change the "
                    "column and re-index everything -- vectors from different "
                    "models cannot be compared."
                )

        return vectors

    async def embed_one(self, text: str) -> list[float]:
        return (await self.embed([text]))[0]
