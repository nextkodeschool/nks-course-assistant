"""The one LLM adapter: anything that speaks the OpenAI chat API.

Verified against Ollama and Groq. Should work unchanged with OpenAI,
Together, OpenRouter and llama.cpp's server.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

import httpx

from app.config import settings
from app.llm.port import LLMError, Message

log = logging.getLogger("nks.llm")

# Generous, because a laptop running an 8B model on CPU is genuinely slow.
# The connect timeout is short though -- if Ollama is not running we want to
# say so immediately, not make the student wait two minutes to find out.
TIMEOUT = httpx.Timeout(connect=5.0, read=300.0, write=10.0, pool=5.0)


class OpenAICompatLLM:
    """Implements LLMPort against any OpenAI-compatible /chat/completions."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
    ) -> None:
        self.base_url = (base_url or settings.llm_base_url).rstrip("/")
        self.api_key = api_key if api_key is not None else settings.llm_api_key
        self.model = model or settings.llm_model

    @property
    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        # Ollama needs no key. Sending an empty Authorization header upsets
        # some providers, so it is omitted entirely rather than sent blank.
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def stream(self, messages: list[Message]) -> AsyncIterator[str]:
        payload = {
            "model": self.model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
            "temperature": 0.2,  # This is recall, not creative writing.
        }

        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=self._headers,
                ) as response:
                    if response.status_code != 200:
                        body = (await response.aread()).decode("utf-8", "replace")[:400]
                        raise LLMError(self._explain_status(response.status_code, body))

                    async for line in response.aiter_lines():
                        chunk = self._parse_sse_line(line)
                        if chunk:
                            yield chunk

        except httpx.ConnectError as exc:
            raise LLMError(
                f"Could not reach the LLM at {self.base_url}.\n"
                "If you are using Ollama, check it is running:  ollama list\n"
                "From inside Docker the address must be host.docker.internal, "
                "not localhost -- localhost inside a container means the container."
            ) from exc
        except httpx.ReadTimeout as exc:
            raise LLMError(
                "The LLM took too long to respond. A large model on CPU can be "
                "very slow; try a smaller one, or use a hosted provider."
            ) from exc

    @staticmethod
    def _parse_sse_line(line: str) -> str | None:
        """Pull the text out of one server-sent-events line.

        The wire format is:

            data: {"choices":[{"delta":{"content":"Kub"}}]}
            data: {"choices":[{"delta":{"content":"ernetes"}}]}
            data: [DONE]

        Blank lines are keep-alives and are ignored.
        """
        if not line or not line.startswith("data:"):
            return None

        data = line[len("data:") :].strip()
        if not data or data == "[DONE]":
            return None

        try:
            parsed = json.loads(data)
        except json.JSONDecodeError:
            log.warning("Ignoring unparseable stream line: %.100s", data)
            return None

        choices = parsed.get("choices") or []
        if not choices:
            return None
        return choices[0].get("delta", {}).get("content") or None

    def _explain_status(self, status: int, body: str) -> str:
        if status == 404:
            return (
                f"The model '{self.model}' was not found at {self.base_url}.\n"
                f"With Ollama, pull it first:  ollama pull {self.model}\n"
                "Then check the name matches LLM_MODEL in your .env exactly."
            )
        if status in (401, 403):
            return (
                f"The LLM provider rejected your API key ({status}).\n"
                "Check LLM_API_KEY in your .env. Ollama needs no key; hosted "
                "providers do."
            )
        if status == 429:
            return "The LLM provider is rate limiting you. Wait a moment and try again."
        return f"The LLM returned {status}: {body}"
