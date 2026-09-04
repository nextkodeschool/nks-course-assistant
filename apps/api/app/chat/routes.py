"""Conversations, messages, and the streaming answer endpoint."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.middleware import CurrentUser
from app.chat import orchestrator
from app.db.models import Conversation, Message as MessageRow
from app.db.session import SessionLocal, get_db
from app.llm.openai_compat import OpenAICompatLLM
from app.llm.port import LLMError
from app.retrieval.factory import get_retriever
from app.retrieval.port import RetrievalError

log = logging.getLogger("nks.chat.routes")

router = APIRouter(prefix="/api/chat", tags=["chat"])

Db = Annotated[AsyncSession, Depends(get_db)]


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    created_at: datetime


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    role: str
    content: str
    citations: list | None
    created_at: datetime


class RenameBody(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class AskBody(BaseModel):
    question: str = Field(min_length=1, max_length=orchestrator.MAX_QUESTION_CHARS)
    # Present from day one because it is in the frozen contract, even though
    # the UI for it may arrive later.
    session_range: tuple[int, int] | None = None


async def _owned_conversation(db: AsyncSession, conversation_id: UUID, user_id: UUID) -> Conversation:
    conversation = await db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id,
            # Scoped to the owner. Not because the student cannot read their
            # own database anyway, but because "filter by the current user"
            # is the habit worth building.
            Conversation.user_id == user_id,
        )
    )
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "not_found", "message": "That conversation does not exist."},
        )
    return conversation


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(user: CurrentUser, db: Db):
    return (
        await db.execute(
            select(Conversation)
            .where(Conversation.user_id == user.id)
            .order_by(Conversation.created_at.desc())
        )
    ).scalars().all()


@router.post("/conversations", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
async def create_conversation(user: CurrentUser, db: Db):
    conversation = Conversation(user_id=user.id, title="New conversation")
    db.add(conversation)
    await db.flush()
    return conversation


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(conversation_id: UUID, user: CurrentUser, db: Db):
    await _owned_conversation(db, conversation_id, user.id)
    return (
        await db.execute(
            select(MessageRow)
            .where(MessageRow.conversation_id == conversation_id)
            .order_by(MessageRow.created_at)
        )
    ).scalars().all()


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut)
async def rename_conversation(conversation_id: UUID, body: RenameBody, user: CurrentUser, db: Db):
    conversation = await _owned_conversation(db, conversation_id, user.id)
    conversation.title = body.title.strip()
    await db.flush()
    return conversation


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(conversation_id: UUID, user: CurrentUser, db: Db):
    conversation = await _owned_conversation(db, conversation_id, user.id)
    await db.delete(conversation)
    return None


def _sse(event: str, data: dict) -> str:
    """One server-sent event.

    The blank line at the end is not optional -- it is what tells the browser
    the event is complete. Omitting it produces a stream that never delivers
    anything, with no error to explain why.
    """
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/conversations/{conversation_id}/messages")
async def ask(conversation_id: UUID, body: AskBody, user: CurrentUser, db: Db):
    """Ask a question. Responds as a stream of server-sent events.

    Events: `sources`, then many `token`, then `done`. Or `error`.
    """
    await _owned_conversation(db, conversation_id, user.id)

    question = body.question.strip()
    if not question:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "empty_question", "message": "Ask something first."},
        )

    history = await orchestrator.recent_history(db, conversation_id)

    user_message = MessageRow(conversation_id=conversation_id, role="user", content=question)
    db.add(user_message)
    # The first question names the conversation, whatever happens next --
    # answered, refused, failed or stopped. Titling only on success left
    # every other outcome sitting in the sidebar as "New conversation".
    await _maybe_title(db, conversation_id, question)
    await db.commit()
    user_message_id = user_message.id

    async def event_stream():
        # A fresh session for the stream. The request-scoped one is closed
        # when the handler returns, and the handler returns as soon as the
        # StreamingResponse is handed back -- long before this generator has
        # finished running.
        async with SessionLocal() as stream_db:
            try:
                retriever = get_retriever(stream_db)
                outcome = await orchestrator.retrieve(retriever, question, body.session_range)

                if not outcome.grounded:
                    # Step 3. No LLM call happens on this path at all.
                    #
                    # Near misses are sent without their passage text: they
                    # were judged not relevant, so quoting them would invite
                    # reading meaning into noise. Session numbers are enough
                    # to say "look here instead".
                    near = [
                        {k: v for k, v in c.items() if k != "text"}
                        for c in orchestrator.citations_for(outcome.near)[:3]
                    ]
                    yield _sse("sources", {"citations": [], "near": near})
                    for word in orchestrator.NO_NOTES_REPLY.split(" "):
                        yield _sse("token", {"text": word + " "})
                    stream_db.add(
                        MessageRow(
                            conversation_id=conversation_id,
                            role="assistant",
                            content=orchestrator.NO_NOTES_REPLY,
                            citations=[],
                        )
                    )
                    # A refused first question still names the conversation.
                    # Without this, every conversation that opened with an
                    # off-topic question stayed "New conversation" forever
                    # and the sidebar filled with identical rows.
                    await _maybe_title(stream_db, conversation_id, question)
                    await stream_db.commit()
                    yield _sse("done", {"grounded": False})
                    return

                citations = orchestrator.citations_for(outcome.chunks)
                yield _sse("sources", {"citations": citations})

                messages = orchestrator.build_messages(question, outcome.chunks, history)

                collected: list[str] = []
                async for token in orchestrator.stream_answer(OpenAICompatLLM(), messages):
                    collected.append(token)
                    yield _sse("token", {"text": token})

                answer = "".join(collected).strip()
                if answer:
                    stream_db.add(
                        MessageRow(
                            conversation_id=conversation_id,
                            role="assistant",
                            content=answer,
                            citations=citations,
                        )
                    )
                    await _maybe_title(stream_db, conversation_id, question)
                    await stream_db.commit()

                yield _sse("done", {"grounded": True})

            except (LLMError, RetrievalError) as exc:
                # These carry messages written for a student, so they are
                # shown as-is rather than replaced with "something went wrong".
                log.warning("chat failed: %s", exc)
                await _discard_unanswered(stream_db, user_message_id)
                yield _sse("error", {"message": exc.message})
            except Exception:
                log.exception("unexpected failure while answering")
                await _discard_unanswered(stream_db, user_message_id)
                yield _sse("error", {"message": "Something went wrong. Check the api logs."})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Tells nginx not to buffer. Without it the proxy holds the whole
            # response until the generator finishes, and the answer arrives
            # in one lump -- which looks exactly like streaming being broken.
            "X-Accel-Buffering": "no",
        },
    )


async def _discard_unanswered(db: AsyncSession, message_id: UUID) -> None:
    """Remove a question that never got an answer.

    The user message is written before the LLM is called, so that a stream
    dying halfway does not lose what was asked. But if the answer never
    arrives at all, leaving the question behind corrupts the conversation:
    the next request sends the model a history full of questions with no
    replies, and it starts answering the wrong one.

    Retrying is the normal response to an error here, so without this a
    student who retries three times ends up with their question stored three
    times over.
    """
    try:
        await db.execute(delete(MessageRow).where(MessageRow.id == message_id))
        await db.commit()
    except Exception:
        # Already failing; a cleanup failure must not replace the real error
        # message with a less useful one.
        log.exception("could not discard the unanswered question")
        await db.rollback()


async def _maybe_title(db: AsyncSession, conversation_id: UUID, question: str) -> None:
    """Name the conversation after its first question.

    Trimmed to the question rather than asking the model for a title -- that
    would be a second inference call, on the student's budget, for a sidebar
    label.
    """
    conversation = await db.get(Conversation, conversation_id)
    if conversation and conversation.title == "New conversation":
        conversation.title = question[:80] + ("..." if len(question) > 80 else "")
