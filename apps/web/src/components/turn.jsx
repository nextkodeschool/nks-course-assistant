import { BookOpen, CircleSlash, CornerDownRight, User } from "lucide-react";
import { Markdown } from "./markdown";

/**
 * One turn in the conversation.
 *
 * Turns are separated by a hairline rule rather than wrapped in cards. A
 * chat where every message sits in its own rounded box wastes horizontal
 * space and flattens the hierarchy -- the reader has to work out which block
 * is the question. A small mono role label and a rule does the same job with
 * far less furniture, and keeps long technical answers readable.
 */

export function Turn({ role, children }) {
  const isUser = role === "user";
  return (
    <article className={`turn ${role}`}>
      <div className="turn-role">
        <span className="glyph">
          {isUser ? <User size={13} strokeWidth={2} /> : <BookOpen size={13} strokeWidth={2} />}
        </span>
        <span className="who">{isUser ? "You" : "Kora"}</span>
      </div>
      {children}
    </article>
  );
}

/**
 * Where an answer came from.
 *
 * This is the part that separates Kora from a general chatbot, so it is a
 * real block with the brand rule down its edge -- not a row of pills tacked
 * under the text. The score is shown because it is honest data the backend
 * already returns, and it tells a student how strong the match was.
 *
 * The rows are not links. There is no session viewer in the product yet, and
 * a link to nowhere would be worse than no link.
 */
export function Sources({ citations = [] }) {
  if (!citations.length) return null;

  return (
    <div className="sources">
      <div className="sources-head">
        <span className="label">Source</span>
        <span className="count">
          {citations.length} session{citations.length > 1 ? "s" : ""}
        </span>
      </div>
      {citations.map((c) => (
        <div className="source-row" key={c.session_number}>
          <span className="sn">SESSION {c.session_number}</span>
          <span className="st">{c.session_title}</span>
          {typeof c.score === "number" && <span className="score">{c.score.toFixed(2)}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * The "we never taught this" answer.
 *
 * Deliberately does not look like a grounded answer. No source block, a
 * dashed border rather than a solid one, and muted text -- so a student can
 * tell at a glance that this is a boundary of the course rather than a
 * conclusion drawn from it.
 *
 * The constraint is the product feature, so it is stated plainly instead of
 * being softened into an apology.
 */
export function NotCovered({ text }) {
  return (
    <div className="uncovered">
      <div className="uncovered-head">
        <CircleSlash size={13} strokeWidth={2} />
        <span className="label">Not covered in the course</span>
      </div>
      <p>{text}</p>
      <p className="why">
        Kora only answers from the course sessions. It will not fall back to general knowledge.
      </p>
    </div>
  );
}

export function AssistantTurn({ content, citations, streaming = false }) {
  // A grounded answer always carries citations; the no-notes reply always has
  // none. That is what distinguishes the two in stored history as well as
  // mid-stream, without needing a new field from the backend.
  const uncovered = !streaming && Array.isArray(citations) && citations.length === 0;

  if (uncovered) {
    return (
      <Turn role="assistant">
        <NotCovered text={content} />
      </Turn>
    );
  }

  return (
    <Turn role="assistant">
      <div className="turn-text">
        <Markdown>{content}</Markdown>
        {streaming && <span className="caret" aria-hidden="true" />}
      </div>
      <Sources citations={citations} />
    </Turn>
  );
}

export function UserTurn({ content }) {
  return (
    <Turn role="user">
      <div className="turn-text">{content}</div>
    </Turn>
  );
}

export function Thinking({ stage }) {
  return (
    <Turn role="assistant">
      <div className="thinking" role="status" aria-live="polite">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {stage === "writing" ? "Writing from the notes" : "Searching the course notes"}
      </div>
    </Turn>
  );
}

export { CornerDownRight };
