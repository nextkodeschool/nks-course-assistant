"""Liveness.

Only /healthz exists so far. It answers one question: is this process alive?
No database call, no dependency check -- if it needed the database to answer,
a database blip would get the container killed and restarted, which does not
fix a database blip.

/readyz ("should traffic be sent to me right now?") arrives alongside the
deployment work, because that is where the difference between the two starts
to have consequences.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
