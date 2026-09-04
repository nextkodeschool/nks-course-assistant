"""The LLM seam.

There is exactly one implementation of this protocol, and that is not an
oversight. The OpenAI-compatible chat API *is* the abstraction -- Ollama,
Groq, OpenAI, Together, llama.cpp and most others all speak it, so one adapter
covers every provider a student might use.

Worth sitting with: a port does not exist to let you swap between several
implementations. It exists to keep a dependency from spreading through your
code. Here the seam has one implementation and still earns its place, because
without it every module that wanted an answer would need to know about HTTP,
bearer tokens, and the shape of a streaming chunk.

The same pattern appears again in app/retrieval/, where it does have two
implementations. First time it reads as a trick; second time as a principle.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

Role = Literal["system", "user", "assistant"]


@dataclass(frozen=True)
class Message:
    role: Role
    content: str


@runtime_checkable
class LLMPort(Protocol):
    """Streams an answer, token by token."""

    async def stream(self, messages: list[Message]) -> AsyncIterator[str]:
        """Yield fragments of the answer as they arrive.

        Yields text, not JSON and not protocol frames -- unpacking those is
        the adapter's job, so nothing upstream has to care which provider is
        in use.
        """
        ...


class LLMError(RuntimeError):
    """Something went wrong talking to the provider.

    Carries a message written for a student reading their terminal, because
    that is who ends up looking at it -- usually because Ollama is not
    running, or the model name in their .env is not one they have pulled.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
