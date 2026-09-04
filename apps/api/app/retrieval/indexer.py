"""Chunk and index the bundled sample notes into pgvector.

Runs on first startup when KB_MODE=local and kb_chunks is empty, so a fresh
clone works without a separate command.

The chunking here matches what the hosted ingestion pipeline does to the full
44 sessions: split on markdown headings, carry the session metadata onto every
chunk. Same rules on both sides means a question behaves the same way in
either mode.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import KbChunk
from app.retrieval.embeddings import EmbeddingClient

log = logging.getLogger("nks.indexer")


def _find_seed_dir() -> Path:
    """Locate seed/knowledge-base-sample by walking up from this file.

    The depth differs between the repository (seed/ sits at the root, beside
    apps/) and the image (it is copied to /app/seed). Walking up finds it in
    both without a hardcoded number of ".." that is right in one and wrong in
    the other.
    """
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "seed" / "knowledge-base-sample"
        if candidate.is_dir():
            return candidate
    return here.parents[2] / "seed" / "knowledge-base-sample"


SEED_DIR = _find_seed_dir()

# Chunks shorter than this are headings with almost nothing under them. They
# add noise to search without ever being a useful answer.
MIN_CHUNK_CHARS = 120

FRONT_MATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)
HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)


@dataclass
class ParsedChunk:
    session_number: int
    session_title: str
    topic: str | None
    content: str
    # Order within the session, so the notes can be read back as written.
    position: int = 0


def _parse_front_matter(text: str) -> tuple[dict[str, str], str]:
    """Pull the --- block off the top. Deliberately not a YAML dependency:
    the format is three flat keys and a parser for that is four lines."""
    match = FRONT_MATTER.match(text)
    if not match:
        return {}, text

    meta: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip()
    return meta, text[match.end() :]


def chunk_document(text: str) -> list[ParsedChunk]:
    """Split one session note into chunks, one per heading.

    Splitting on headings rather than on a fixed character count is the whole
    point. A 500-character window cuts sentences in half and puts the end of
    one idea in the same chunk as the start of another, and both retrieve
    badly. A heading is an author's own statement about where one idea stops.
    """
    meta, body = _parse_front_matter(text)

    try:
        session_number = int(meta.get("session_number", "0"))
    except ValueError:
        session_number = 0

    session_title = meta.get("session_title", "Untitled session")
    topic = meta.get("topic") or None

    matches = list(HEADING.finditer(body))
    if not matches:
        stripped = body.strip()
        return (
            [ParsedChunk(session_number, session_title, topic, stripped, 0)]
            if len(stripped) >= MIN_CHUNK_CHARS
            else []
        )

    chunks: list[ParsedChunk] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        heading = match.group(2).strip()
        section = body[match.end() : end].strip()

        if len(section) < MIN_CHUNK_CHARS:
            continue

        # The heading is kept at the top of the chunk. It is often the most
        # searchable line in the whole section, and it gives the reader
        # context when the chunk is shown as a citation.
        chunks.append(
            ParsedChunk(
                session_number=session_number,
                session_title=session_title,
                topic=topic,
                content=f"{heading}\n\n{section}",
                position=len(chunks),
            )
        )

    return chunks


def load_seed_chunks(directory: Path | None = None) -> list[ParsedChunk]:
    source = directory or SEED_DIR
    if not source.is_dir():
        log.warning("No seed notes directory at %s", source)
        return []

    chunks: list[ParsedChunk] = []
    for path in sorted(source.glob("*.md")):
        found = chunk_document(path.read_text(encoding="utf-8"))
        log.info("  %s -> %d chunk(s)", path.name, len(found))
        chunks.extend(found)
    return chunks


async def index_is_empty(db: AsyncSession) -> bool:
    count = await db.scalar(select(func.count()).select_from(KbChunk))
    return not count


async def index_seed_notes(db: AsyncSession, directory: Path | None = None) -> int:
    """Embed and store the sample notes. Returns how many chunks were added."""
    chunks = load_seed_chunks(directory)
    if not chunks:
        return 0

    log.info("Embedding %d chunk(s) -- first run only, this takes a moment", len(chunks))

    embeddings = EmbeddingClient()
    vectors = await embeddings.embed([c.content for c in chunks])

    db.add_all(
        [
            KbChunk(
                session_number=chunk.session_number,
                session_title=chunk.session_title,
                topic=chunk.topic,
                position=chunk.position,
                content=chunk.content,
                embedding=vector,
            )
            for chunk, vector in zip(chunks, vectors, strict=True)
        ]
    )
    await db.flush()
    return len(chunks)
