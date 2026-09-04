import { useEffect, useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import { Markdown } from "./markdown";

/**
 * Reading the course itself.
 *
 * Two views in one panel: the list of sessions Kora knows, and one session
 * read back in order. This is what "Open session" and "See what's covered"
 * lead to, so a student can go from an answer to the notes it came from
 * without leaving the conversation.
 *
 * Local mode only. In hosted mode the full notes are not retrievable by
 * design, and the interface never offers to open one.
 */
export function SessionPanel({ panel, kb, api, onOpenSession, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const number = panel?.type === "session" ? panel.number : null;

  useEffect(() => {
    if (number == null) {
      setData(null);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .kbSession(number)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [number, api]);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel, onClose]);

  if (!panel) return null;

  const sessions = kb?.sessions ?? [];
  const known = sessions.find((s) => s.session_number === number);

  return (
    <aside className="panel" aria-label={number != null ? `Session ${number}` : "Course sessions"}>
      <div className="panel-head">
        {number != null && sessions.length > 0 && (
          <button className="icon-btn" onClick={() => onOpenSession(null)} aria-label="All sessions">
            <ArrowLeft size={15} strokeWidth={2} />
          </button>
        )}
        <div className="panel-title">
          {number != null ? (
            <>
              <span className="eyebrow">Session {number}</span>
              <h2>{data?.session_title || known?.session_title || ""}</h2>
            </>
          ) : (
            <>
              <span className="eyebrow">Course notes</span>
              <h2>
                {sessions.length} session{sessions.length === 1 ? "" : "s"}
              </h2>
            </>
          )}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={15} strokeWidth={2} />
        </button>
      </div>

      <div className="panel-scroll">
        {number == null && (
          <ul className="session-list">
            {sessions.map((s) => (
              <li key={s.session_number}>
                <button onClick={() => onOpenSession(s.session_number)}>
                  <span className="num">Session {s.session_number}</span>
                  <span className="ttl">{s.session_title}</span>
                  <span className="cnt">
                    {s.chunks} passage{s.chunks === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {number != null && loading && <p className="panel-note">Loading…</p>}
        {number != null && error && <p className="panel-note">{error}</p>}
        {number != null &&
          data?.passages.map((text, i) => (
            <div className="panel-passage" key={i}>
              <Markdown>{text}</Markdown>
            </div>
          ))}
      </div>
    </aside>
  );
}
