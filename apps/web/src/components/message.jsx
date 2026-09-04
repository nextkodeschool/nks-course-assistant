/**
 * Message, MessageAvatar and MessageContent.
 *
 * Follows the ElevenLabs UI Message API: a `from` prop of "user" or
 * "assistant" drives alignment and styling, and MessageContent takes a
 * "contained" or "flat" variant.
 *
 * The variant split earns its place here. A user's question is short and
 * reads well in a bubble; an assistant's answer is long, contains code
 * blocks and lists, and a bubble around it just makes it harder to read.
 * So questions are contained and answers are flat.
 */

export function Message({ from, children, className = "", ...props }) {
  return (
    <div className={`message from-${from} ${className}`} data-from={from} {...props}>
      {children}
    </div>
  );
}

export function MessageAvatar({ name = "", src, className = "", ...props }) {
  const initials = name.trim().slice(0, 2).toUpperCase() || "?";

  return (
    <div className={`message-avatar ${className}`} aria-hidden="true" {...props}>
      {src ? <img src={src} alt="" /> : <span>{initials}</span>}
    </div>
  );
}

export function MessageContent({ variant = "contained", children, className = "", ...props }) {
  return (
    <div className={`message-content variant-${variant} ${className}`} {...props}>
      {children}
    </div>
  );
}

/**
 * The sessions an answer was drawn from.
 *
 * Not decoration: this is what separates a study tool from a chatbot. A
 * student can see the answer came from Session 18 and go read the original
 * rather than trusting a paraphrase. Shown as buttons because they are
 * meant to be looked up, not just admired.
 */
export function MessageSources({ citations = [], onSelect }) {
  if (!citations.length) return null;

  return (
    <div className="message-sources">
      <span className="sources-label">From</span>
      {citations.map((c) => (
        <button
          key={c.session_number}
          type="button"
          className="source-chip"
          onClick={() => onSelect?.(c)}
          title={`Session ${c.session_number}: ${c.session_title}`}
        >
          <span className="n">{c.session_number}</span>
          <span className="t">{c.session_title}</span>
        </button>
      ))}
    </div>
  );
}
