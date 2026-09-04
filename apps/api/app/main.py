"""Application wiring.

Note what does not happen here: migrations. The app does not create or alter
tables at boot. Schema changes are a separate, explicit command
(scripts/migrate.sh), because "when does the schema change relative to the
new code starting?" is a question every rolling deploy has to answer, and
hiding it inside startup means never having to think about it -- right up
until the deploy where it matters.
"""

from __future__ import annotations

import logging

from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from app.auth.routes import router as auth_router
from app.auth.service import purge_expired_sessions
from app.chat.routes import router as chat_router
from app.config import settings
from app.db.session import SessionLocal, engine
from app.health.routes import router as health_router
from app.retrieval.indexer import index_is_empty, index_seed_notes

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
log = logging.getLogger("nks")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail fast and loudly if the database is unreachable. The entrypoint
    # script already waits for Postgres to accept connections, so reaching
    # here with a broken database usually means a wrong DATABASE_URL rather
    # than a slow start.
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:
        log.error("Cannot reach the database at startup: %s", exc)
        raise

    async with SessionLocal() as db:
        removed = await purge_expired_sessions(db)
        await db.commit()
        if removed:
            log.info("Purged %d expired session(s)", removed)

    # FR-4: a fresh clone indexes the bundled sample notes by itself, so
    # "clone, copy env, up" really is the whole setup.
    if settings.kb_mode == "local":
        async with SessionLocal() as db:
            if await index_is_empty(db):
                try:
                    count = await index_seed_notes(db)
                    await db.commit()
                    log.info("Indexed %d chunk(s) from the sample notes", count)
                except Exception as exc:
                    # Not fatal. The app still starts and can still be logged
                    # into; asking a question will report the same problem
                    # with the same message.
                    await db.rollback()
                    log.warning("Could not index the sample notes: %s", exc)
                    log.warning("Is Ollama running?  ollama pull %s", settings.embedding_model)

    log.info("API ready  ·  env=%s  kb_mode=%s", settings.app_env, settings.kb_mode)

    yield

    await engine.dispose()
    log.info("Shutdown complete")


app = FastAPI(
    title="Kora",
    version="1.0.0",
    lifespan=lifespan,
    # The browser only ever talks to its own origin -- nginx serves the SPA
    # and proxies /api/* to this service -- so there is no CORS configuration
    # here and no need for any. That is also what keeps both API keys on the
    # server side, where a student's devtools cannot read them.
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(chat_router)
