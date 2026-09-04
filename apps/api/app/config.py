"""Configuration, read entirely from environment variables.

No config file, no hardcoded values, nothing baked into the image. The same
image runs on a laptop and in production; only the environment differs.

This module fails loudly at startup rather than failing quietly at request
time. A missing secret should stop the process with a message you can act on,
not produce a 500 three hours later.
"""

from __future__ import annotations

import sys
from typing import Literal

from pydantic import ValidationError, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The value shipped in .env.example. If this is still what we read, the student
# copied the file and never generated a secret -- so every session cookie in
# their app is signed with a value that is public on GitHub.
PLACEHOLDER_SECRET = "CHANGE_ME_RUN_openssl_rand_hex_32"

MIN_SECRET_LENGTH = 32


class Settings(BaseSettings):
    """Every environment variable the API reads.

    These names are frozen. See CONTRACT.md -- renaming one breaks every
    existing clone, including the ones sitting in students' portfolios.
    """

    model_config = SettingsConfigDict(
        env_file=None,  # Compose injects the environment; we never read .env directly.
        case_sensitive=False,
        extra="ignore",
    )

    # --- Knowledge base -----------------------------------------------------
    kb_mode: Literal["local", "hosted"] = "local"
    kb_api_url: str | None = None
    kb_api_key: str | None = None

    # --- LLM provider -------------------------------------------------------
    llm_base_url: str = "http://host.docker.internal:11434/v1"
    llm_api_key: str | None = None
    llm_model: str = "llama3.1:8b"

    # --- Embeddings (local KB mode only) ------------------------------------
    embedding_base_url: str | None = None
    embedding_model: str = "nomic-embed-text"

    # --- Infrastructure -----------------------------------------------------
    database_url: str
    session_secret: str

    # --- Runtime ------------------------------------------------------------
    app_env: Literal["development", "production"] = "development"
    log_level: str = "info"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def effective_embedding_base_url(self) -> str:
        """EMBEDDING_BASE_URL falls back to LLM_BASE_URL when unset.

        The common case is a student who switched generation to Groq but still
        embeds locally with Ollama -- they set this explicitly. Everyone else
        runs both on Ollama and never touches it.
        """
        return self.embedding_base_url or self.llm_base_url

    @model_validator(mode="after")
    def _check_session_secret(self) -> "Settings":
        if self.session_secret == PLACEHOLDER_SECRET:
            raise ValueError(
                "SESSION_SECRET is still the placeholder from .env.example.\n"
                "  Generate one and paste it into your .env:\n"
                "\n"
                "      openssl rand -hex 32\n"
                "\n"
                "  This signs your login cookies. The placeholder is public on\n"
                "  GitHub, so anyone could forge a session in your app."
            )
        if len(self.session_secret) < MIN_SECRET_LENGTH:
            raise ValueError(
                f"SESSION_SECRET is only {len(self.session_secret)} characters. "
                f"It needs at least {MIN_SECRET_LENGTH}.\n"
                "  Generate one with:  openssl rand -hex 32"
            )
        return self

    @model_validator(mode="after")
    def _check_database_driver(self) -> "Settings":
        """Guard the decision recorded in the README.

        This codebase is fully async. A sync driver here still connects, still
        passes tests, and then blocks the event loop under real load -- which
        is the single most common FastAPI mistake and very hard to spot after
        the fact. Cheaper to refuse at startup.
        """
        if not self.database_url.startswith("postgresql+asyncpg://"):
            raise ValueError(
                "DATABASE_URL must use the postgresql+asyncpg:// scheme.\n"
                f"  Got: {self.database_url.split('://')[0]}://...\n"
                "\n"
                "  This app is fully async. A synchronous driver blocks the\n"
                "  event loop on every query, which stalls every other user\n"
                "  while one person waits. See 'Execution model' in README.md."
            )
        return self

    @model_validator(mode="after")
    def _check_hosted_mode(self) -> "Settings":
        if self.kb_mode == "hosted":
            missing = [
                name
                for name, value in (("KB_API_URL", self.kb_api_url), ("KB_API_KEY", self.kb_api_key))
                if not value
            ]
            if missing:
                raise ValueError(
                    f"KB_MODE=hosted needs {' and '.join(missing)}.\n"
                    "  Your instructor issues the key, one per student per batch.\n"
                    "  To work without one, set KB_MODE=local -- that uses the\n"
                    "  three sample sessions bundled in seed/ and needs no key."
                )
        return self


def load_settings() -> Settings:
    """Parse and validate the environment, or exit with something readable.

    Pydantic's own error output is accurate and unpleasant to read at 11pm.
    A student staring at a stack trace learns nothing; a student who is told
    which variable is wrong and what to do about it fixes it in ten seconds.
    """
    try:
        return Settings()  # type: ignore[call-arg]
    except ValidationError as exc:
        print("\n  Configuration error -- the app cannot start.\n", file=sys.stderr)
        for error in exc.errors():
            location = ".".join(str(part) for part in error["loc"]) or "config"
            message = error["msg"].removeprefix("Value error, ")
            print(f"  {location.upper()}:", file=sys.stderr)
            for line in message.splitlines():
                print(f"    {line}", file=sys.stderr)
            print(file=sys.stderr)
        print("  Check your .env against .env.example.\n", file=sys.stderr)
        raise SystemExit(1) from exc


settings = load_settings()
