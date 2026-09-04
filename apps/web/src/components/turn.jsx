import { useEffect, useState } from "react";
import { AlertCircle, BookOpen, ChevronDown, CircleSlash, User } from "lucide-react";
import { Markdown } from "./markdown";

/**
 * One turn in the conversation.
 *
 * Turns are separated by a hairline rule rather than wrapped in cards. A
 * chat where every message sits in its own rounded box wastes horizontal
 * space and flattens the hierarchy; a small mono role label and a rule does
 * the same job with far less furniture.
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

function focusComposer() {
  document.querySelector(".composer-box textarea")?.focus();
}

function SessionTags({ sessions }) {
  return (
    <div className="session-tags">
      {sessions.map((s) => (
        <span className="stag" key={s.session_number}>
          <b>{s.session_number}</b>
          {s.session_title}
        </span>
      ))}
    </div>
  );
}

/**
 * How well a passage matched, in a form a student can read.
 *
 * The raw cosine score means nothing to the audience -- "0.67" is not
 * information. Three segments and a name are. The bands sit above the
 * refusal threshold (0.48), so the weakest thing shown is still a real
 * match; anything below never reaches this component.
 */
function strengthOf(score) {
  if (typeof score !== "number") return null;
  if (score >= 0.7) return { level: 3, label: "Strong match" };
  if (score >= 0.58) return { level: 2, label: "Good match" };
  return { level: 1, label: "Partial match" };
}

/**
 * Where an answer came from.
 *
 * This is the product's promise made visible, so it is a real block with the
 * brand rule down its edge. Each row expands to the passage that was
 * actually retrieved -- the same text the model was given -- which is the
 * honest link back to the notes. In hosted mode the full session is not
 * retrievable by design, so the passage is the whole of what can be shown.
 */
export function Sources({ citations = [] }) {
  const [open, setOpen] = useState(() => new Set());
  if (!citations.length) return null;

  const toggle = (n) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });

  return (
    <div className="sources">
      <div className="sources-head">
        <span className="label">
          From {citations.length} session{citations.length > 1 ? "s" : ""}
        </span>
        {citations.length > 1 && <span className="hint">most relevant first</span>}
      </div>

      {citations.map((c) => {
        const strength = strengthOf(c.score);
        const isOpen = open.has(c.session_number);
        return (
          <div className="source" data-session={c.session_number} key={c.session_number}>
            <button
              type="button"
              className="source-row"
              aria-expanded={isOpen}
              onClick={() => toggle(c.session_number)}
            >
              <span className="sn">Session {c.session_number}</span>
              <span className="st">{c.session_title}</span>
              {strength && (
                <span className="strength" title={strength.label} aria-label={strength.label}>
                  <i className={strength.level >= 1 ? "on" : ""} />
                  <i className={strength.level >= 2 ? "on" : ""} />
                  <i className={strength.level >= 3 ? "on" : ""} />
                </span>
              )}
              <ChevronDown size={13} strokeWidth={2} className="chev" aria-hidden="true" />
            </button>

            {isOpen && (
              <div className="passage">
                {c.text ? (
                  // The notes are markdown, so the passage is rendered as
                  // markdown: a fenced block in the source shows as code, not
                  // as three backticks.
                  <div className="passage-md">
                    <Markdown>{c.text}</Markdown>
                  </div>
                ) : (
                  <p className="none">The passage was not stored for this answer.</p>
                )}
                <span className="passage-note">Retrieved from the course notes for this answer.</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The "we never taught this" answer.
 *
 * Deliberately does not look like a grounded answer: dashed border, no
 * source block. The constraint is stated once, plainly, and followed by
 * something to do about it -- rephrase, look at what is covered, or start
 * from the nearest sessions when retrieval found some.
 */
export function NotCovered({ near = [], sessions = [] }) {
  const [showSessions, setShowSessions] = useState(false);

  return (
    <div className="uncovered">
      <div className="uncovered-head">
        <CircleSlash size={13} strokeWidth={2} />
        <span className="label">Not covered in the course</span>
      </div>

      <p>
        This topic does not appear in the course sessions Kora has. Kora answers only from those
        sessions and will not fall back to general knowledge.
      </p>

      {near.length > 0 && (
        <div className="near">
          <span className="near-label">Closest sessions</span>
          <SessionTags sessions={near} />
        </div>
      )}

      <div className="actions">
        <button type="button" className="btn" onClick={focusComposer}>
          Try rephrasing
        </button>
        {sessions.length > 0 && (
          <button
            type="button"
            className="btn"
            onClick={() => setShowSessions((s) => !s)}
            aria-expanded={showSessions}
          >
            {showSessions ? "Hide sessions" : "See what's covered"}
          </button>
        )}
      </div>

      {showSessions && <SessionTags sessions={sessions} />}
    </div>
  );
}

/**
 * A question that could not be answered.
 *
 * Rendered in the assistant's slot rather than as a floating alert, so the
 * failure sits under the question it belongs to. Retry re-sends it; Edit puts
 * it back in the composer. Either way the student does not retype.
 */
export function ErrorTurn({ message, onRetry, onEdit }) {
  return (
    <Turn role="assistant">
      <div className="failed" role="alert">
        <div className="failed-head">
          <AlertCircle size={13} strokeWidth={2} />
          <span className="label">Could not answer</span>
        </div>
        <p>{message}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onRetry}>
            Retry
          </button>
          <button type="button" className="btn" onClick={onEdit}>
            Edit question
          </button>
        </div>
      </div>
    </Turn>
  );
}

export function AssistantTurn({
  content,
  citations,
  near = [],
  sessions = [],
  streaming = false,
  stopped = false,
}) {
  // A grounded answer always carries citations; the no-notes reply always has
  // none. That is what distinguishes the two in stored history as well as
  // mid-stream, without needing a new field from the backend.
  const uncovered = !streaming && Array.isArray(citations) && citations.length === 0;

  if (uncovered) {
    return (
      <Turn role="assistant">
        <NotCovered near={near} sessions={sessions} />
      </Turn>
    );
  }

  return (
    <Turn role="assistant">
      <div className="turn-text">
        <Markdown>{content}</Markdown>
        {streaming && <span className="caret" aria-hidden="true" />}
      </div>
      {stopped && <div className="stopped">Stopped before the answer finished.</div>}
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
  // Honest about the wait. A local model on CPU can sit in "writing" for
  // half a minute, and with no explanation that reads as hung.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [stage]);

  return (
    <Turn role="assistant">
      <div className="thinking" role="status" aria-live="polite">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{stage === "writing" ? "Writing from the notes" : "Searching the course notes"}</span>
        {slow && stage === "writing" && (
          <span className="slow">A local model on CPU can take a while.</span>
        )}
      </div>
    </Turn>
  );
}
