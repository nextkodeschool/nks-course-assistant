"""Hosted retrieval: the NKS service.

Written against CONTRACT.md, which is frozen. If this file and that document
ever disagree, the document is right.

The service does not exist yet -- it is built in a later phase -- but the
client is written now, because the contract is already fixed and writing the
consumer is how you find out whether a contract is actually usable.
"""

from __future__ import annotations

import logging

import httpx

from app.config import settings
from app.retrieval.port import (
    MAX_CHUNK_CHARS,
    MAX_TOP_K,
    Chunk,
    RetrievalError,
    RetrievalUnavailable,
)

log = logging.getLogger("nks.retrieval.hosted")

# The version this client speaks. Sent on every request; the service rejects
# anything below its MIN_CLIENT_VERSION with 426.
CLIENT_VERSION = "1.0.0"

# Short on purpose. A student mid-question should get a fast, clear failure
# and a fallback, not a thirty-second hang. The service is contracted to
# return 503 rather than sit on a slow request.
TIMEOUT = httpx.Timeout(connect=3.0, read=10.0, write=5.0, pool=3.0)


class HostedRetriever:
    """Implements RetrieverPort against POST /v1/retrieve."""

    def __init__(self, base_url: str | None = None, api_key: str | None = None) -> None:
        self.base_url = (base_url or settings.kb_api_url or "").rstrip("/")
        self.api_key = api_key or settings.kb_api_key

    async def search(
        self,
        query: str,
        top_k: int = MAX_TOP_K,
        session_range: tuple[int, int] | None = None,
    ) -> list[Chunk]:
        payload: dict = {"query": query, "top_k": max(1, min(top_k, MAX_TOP_K))}
        if session_range is not None:
            payload["session_range"] = list(session_range)

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "X-Client-Version": CLIENT_VERSION,
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                response = await client.post(
                    f"{self.base_url}/v1/retrieve", json=payload, headers=headers
                )
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            # Unavailable, not an error: the caller may fall back to local mode.
            raise RetrievalUnavailable(
                "Could not reach the NKS knowledge base. "
                "Set KB_MODE=local in your .env to keep working offline."
            ) from exc

        if response.status_code != 200:
            raise self._explain(response)

        body = response.json()
        return [
            Chunk(
                id=str(item["id"]),
                text=item["text"][:MAX_CHUNK_CHARS],
                session_number=int(item["session_number"]),
                session_title=item["session_title"],
                score=float(item["score"]),
            )
            for item in body.get("chunks", [])
        ]

    @staticmethod
    def _explain(response: httpx.Response) -> RetrievalError:
        """Turn a contract error code into something a student can act on.

        The service already sends a human-readable message; these add the
        local context it cannot know, like which variable to edit.
        """
        try:
            error = response.json().get("error", {})
            code = error.get("code", "")
            message = error.get("message", "")
        except Exception:
            code, message = "", response.text[:300]

        advice = {
            "invalid_key": "Your NKS key was not recognised. Check KB_API_KEY in your .env.",
            "key_expired": "Your NKS key has expired -- keys end with the batch. "
            "Ask your instructor for a new one.",
            "key_revoked": "Your NKS key has been switched off. Ask your instructor.",
            "query_too_long": "That question is over the 500 character limit.",
            "client_too_old": "This clone is too old for the knowledge base. "
            "Pull the latest version of the repository.",
            "rate_limited": "You have hit the rate limit. Wait a minute and try again.",
            "service_unavailable": "The knowledge base is temporarily unavailable. "
            "Set KB_MODE=local to keep working.",
        }.get(code)

        text = advice or message or f"The knowledge base returned {response.status_code}."

        if response.status_code == 503 or code == "service_unavailable":
            return RetrievalUnavailable(text)
        return RetrievalError(text)
