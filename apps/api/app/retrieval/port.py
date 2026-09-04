"""The retrieval seam.

Two implementations, chosen by one environment variable:

    KB_MODE=local    embed with Ollama, search pgvector on your own machine
    KB_MODE=hosted   ask the NKS service, which holds all 44 sessions

Everything upstream -- the chat orchestrator, the routes, the UI -- knows only
this protocol. Switching between a local database and a remote HTTP service is
a config change, not a code change. That is the whole point of the seam.

The two use different embedding models in different vector spaces (768
dimensions locally, 1024 hosted). That is fine: they index different corpora
and their scores are never compared to each other.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

# Capped server-side by the hosted service regardless of what is asked for,
# so local mode matches rather than being quietly more generous.
MAX_TOP_K = 5

# Chunks are truncated to this length before they reach a prompt. Same cap on
# both sides for the same reason.
MAX_CHUNK_CHARS = 800


@dataclass(frozen=True)
class Chunk:
    """One passage of course notes, with enough metadata to cite it."""

    id: str
    text: str
    session_number: int
    session_title: str
    score: float


@runtime_checkable
class RetrieverPort(Protocol):
    async def search(
        self,
        query: str,
        top_k: int = MAX_TOP_K,
        session_range: tuple[int, int] | None = None,
    ) -> list[Chunk]:
        """Return the most relevant chunks, best first. May return none."""
        ...


class RetrievalError(RuntimeError):
    """Retrieval failed in a way the user should hear about."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class RetrievalUnavailable(RetrievalError):
    """The knowledge base could not be reached.

    Separate from RetrievalError because the caller may reasonably choose to
    carry on -- an answer built from no notes is still better than a stack
    trace, and the hosted service being down should not take the whole app
    with it.
    """
