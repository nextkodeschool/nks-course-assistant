import { useLayoutEffect, useRef } from "react";
import { ArrowUp } from "lucide-react";

/**
 * The question input.
 *
 * One field and one send button. No attachment icon, no model picker, no
 * microphone -- Kora has none of those, and adding controls that do nothing
 * to make an interface look capable is the exact thing this redesign is
 * meant to remove.
 *
 * The 500 character limit comes from the backend, which rejects anything
 * longer, so it is enforced and shown here rather than discovered as a
 * server error.
 */

export function Composer({ value, onChange, onSubmit, disabled, maxLength }) {
  const ref = useRef(null);
  const over = value.length > maxLength;

  // Grow with the content up to a ceiling. Height has to be reset to auto
  // before measuring, or the box can only ever get taller and never shrink.
  //
  // Measuring once is not enough. The first pass can run before the element
  // has its final width -- while the flex row is still settling, or before
  // the web font loads -- and a narrow box wraps the placeholder over several
  // lines. That measures tall, gets clamped to the ceiling, and then sticks,
  // because the effect only re-runs when `value` changes and an untouched
  // composer never changes. So: re-measure after the next frame, and again
  // whenever the width actually changes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      // Always reset first, or the box can only ever grow.
      el.style.height = "auto";

      // With no text there is nothing to measure: rows=1 already gives the
      // right height, and asking for scrollHeight here is what made this
      // fragile. A hidden or backgrounded tab lays out at zero height and
      // returns a nonsense scrollHeight, which then gets clamped to the
      // ceiling and sticks -- the effect only re-runs when `value` changes,
      // and an untouched composer never changes. Not measuring is both
      // simpler and correct.
      if (!value) return;

      el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
    };

    fit();
    const frame = requestAnimationFrame(fit);

    const observer = new ResizeObserver(fit);
    if (el.parentElement) observer.observe(el.parentElement);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [value]);

  return (
    <div className="composer">
      <div className="composer-inner">
        <div className={`composer-box ${over ? "over" : ""}`}>
          <textarea
            ref={ref}
            rows={1}
            value={value}
            disabled={disabled}
            placeholder="Ask about anything from the course…"
            aria-label="Your question"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
          <button
            className="send"
            onClick={onSubmit}
            disabled={disabled || !value.trim() || over}
            aria-label="Send"
          >
            <ArrowUp size={16} strokeWidth={2.4} />
          </button>
        </div>

        <div className="composer-meta">
          <span className="hints">
            <kbd>Enter</kbd> send
            <span aria-hidden="true">·</span>
            <kbd>Shift</kbd>
            <kbd>Enter</kbd> new line
          </span>
          <span className={`count ${over ? "over" : ""}`}>
            {value.length}/{maxLength}
          </span>
        </div>
      </div>
    </div>
  );
}
