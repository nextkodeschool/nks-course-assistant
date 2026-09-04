import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, BookOpen, ChevronDown, CircleSlash } from "lucide-react";
import { Markdown } from "./markdown";

/**
 * Turns.
 *
 * A question sits to the right, in a quiet neutral block. An answer starts
 * from the left edge of the reading column and uses the full measure, with
 * a small gold mark beside it. Position carries the role; there are no
 * "You" / "Kora" labels on screen, only for screen readers.
 */

export function UserTurn({ content }) {
  return (
    <article className="turn user">
      <span className="sr-only">You asked:</span>
      <div className="bubble">{content}</div>
    </article>
  );
}

function AssistantFrame({ children }) {
  return (
    <article className="turn assistant">
      <span className="glyph" aria-hidden="true">
        <BookOpen size={15} strokeWidth={2} />
      </span>
      <span className="sr-only">Kora:</span>
      <div className="turn-body">{children}</div>
    </article>
  );
}

function focusComposer() {
  document.querySelector(".composer-box textarea")?.focus();
}

/**
 * How well a passage matched, in a form a student can read.
 *
 * The raw cosine score means nothing to the audience; three segments and a
 * name do. The bands sit above the refusal threshold (0.48), so the weakest
 * thing shown is still a real match.
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
 * A bordered block with the brand rule down its edge. Each row expands to
 * the passage that was actually retrieved -- the same text the model was
 * given -- and, in local mode, on to the whole session.
 */
export function Sources({ citations = [], canOpen = false, onOpenSession }) {
  const [open, setOpen] = useState(() => new Set());
  if (!citations.length) return null;

  const toggle = (n) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });

  return (
    <section className="sources" aria-label="Sources">
      <div className="sources-head">
        <span className="label">Source</span>
        <span className="hint">
          From {citations.length} session{citations.length > 1 ? "s" : ""}
          {citations.length > 1 && " · most relevant first"}
        </span>
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
              <ChevronDown size={14} strokeWidth={2} className="chev" aria-hidden="true" />
            </button>

            {isOpen && (
              <div className="passage">
                {c.text ? (
                  <blockquote className="passage-quote">
                    <Markdown>{c.text}</Markdown>
                  </blockquote>
                ) : (
                  <p className="passage-none">The passage was not stored for this answer.</p>
                )}
                <div className="passage-foot">
                  <span className="passage-note">Retrieved from the course notes for this answer.</span>
                  {canOpen && (
                    <button type="button" className="text-link" onClick={() => onOpenSession?.(c.session_number)}>
                      Open session <ArrowRight size={13} strokeWidth={2} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * The "we never taught this" answer.
 *
 * Distinct from a grounded answer: dashed border, no source block. The
 * constraint is stated once and followed by something to do -- the nearest
 * sessions when retrieval found some, rephrasing, or the session list.
 */
export function NotCovered({ near = [], canOpen = false, onOpenSession, onShowSessions }) {
  return (
    <div className="uncovered">
      <div className="uncovered-head">
        <CircleSlash size={14} strokeWidth={2} />
        <span className="label">Not covered in the course</span>
      </div>

      <p>This topic isn't covered in the available course sessions.</p>

      {near.length > 0 && (
        <div className="near">
          <span className="near-label">Closest topics</span>
          <ul className="near-list">
            {near.map((n) =>
              canOpen ? (
                <li key={n.session_number}>
                  <button type="button" className="text-link" onClick={() => onOpenSession?.(n.session_number)}>
                    Session {n.session_number} · {n.session_title}
                  </button>
                </li>
              ) : (
                <li key={n.session_number}>
                  Session {n.session_number} · {n.session_title}
                </li>
              )
            )}
          </ul>
        </div>
      )}

      <div className="actions">
        <button type="button" className="btn" onClick={focusComposer}>
          Try rephrasing
        </button>
        {onShowSessions && (
          <button type="button" className="btn" onClick={onShowSessions}>
            See what's covered
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A question that could not be answered. Sits in Kora's slot under the
 * question it belongs to; the draft has already been put back in the
 * composer, so Retry is the only action needed here.
 */
export function ErrorTurn({ message, onRetry }) {
  return (
    <AssistantFrame>
      <div className="failed" role="alert">
        <p className="failed-title">Couldn't answer this question.</p>
        {message && <p className="failed-detail">{message}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    </AssistantFrame>
  );
}

export function AssistantTurn({
  content,
  citations,
  near = [],
  canOpen = false,
  onOpenSession,
  onShowSessions,
  streaming = false,
  stopped = false,
}) {
  // A grounded answer always carries citations; the no-notes reply never
  // does. That distinguishes the two in stored history and mid-stream alike.
  const uncovered = !streaming && Array.isArray(citations) && citations.length === 0;

  if (uncovered) {
    return (
      <AssistantFrame>
        <NotCovered near={near} canOpen={canOpen} onOpenSession={onOpenSession} onShowSessions={onShowSessions} />
      </AssistantFrame>
    );
  }

  return (
    <AssistantFrame>
      <div className="turn-text">
        <Markdown>{content}</Markdown>
        {streaming && <span className="caret" aria-hidden="true" />}
      </div>
      {stopped && <div className="stopped">Stopped before the answer finished.</div>}
      <Sources citations={citations} canOpen={canOpen} onOpenSession={onOpenSession} />
    </AssistantFrame>
  );
}

export function Thinking({ stage }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [stage]);

  return (
    <AssistantFrame>
      <div className="thinking" role="status" aria-live="polite">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{stage === "writing" ? "Writing from the notes" : "Searching the course notes"}</span>
        {slow && stage === "writing" && <span className="slow">A local model on CPU can take a while.</span>}
      </div>
    </AssistantFrame>
  );
}

export { AlertCircle };
