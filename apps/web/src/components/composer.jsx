import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

/**
 * The question input.
 *
 * One field, one button. The button is Send until an answer is in flight,
 * then it is Stop -- a laptop model can take half a minute, and being unable
 * to abandon a question is worse than any amount of waiting.
 *
 * The hints and the counter are not shown by default. The hints appear while
 * the field has focus, when they might be read; the counter appears only in
 * the last hundred characters, when it matters. Their row keeps its height
 * either way, so nothing jumps when they come and go.
 */

const NEAR_LIMIT = 100;

export function Composer({ value, onChange, onSubmit, onStop, busy, maxLength }) {
  const ref = useRef(null);
  const [focused, setFocused] = useState(false);

  const over = value.length > maxLength;
  const nearLimit = value.length >= maxLength - NEAR_LIMIT;
  const showMeta = focused || nearLimit || over || busy;

  // Grow with the content up to a ceiling. Reset to auto before measuring,
  // or the box can only ever grow. Do not measure at all when empty: rows=1
  // is already right, and measuring a backgrounded tab returns nonsense that
  // then sticks, because the effect only re-runs when the text changes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    if (!value) return;
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
  }, [value]);

  return (
    <div className="composer">
      <div className="composer-inner">
        <div className={`composer-box ${over ? "over" : ""} ${busy ? "busy" : ""}`}>
          <textarea
            ref={ref}
            rows={1}
            value={value}
            disabled={busy}
            placeholder={busy ? "Kora is answering…" : "Ask about anything from the course…"}
            aria-label="Your question"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
          />

          {busy ? (
            <button className="stop" onClick={onStop} aria-label="Stop answering" title="Stop">
              <Square size={11} strokeWidth={2.6} />
            </button>
          ) : (
            <button
              className="send"
              onClick={onSubmit}
              disabled={!value.trim() || over}
              aria-label="Send"
              title="Send"
            >
              <ArrowUp size={16} strokeWidth={2.4} />
            </button>
          )}
        </div>

        <div className={`composer-meta ${showMeta ? "show" : ""}`} aria-hidden={!showMeta}>
          <span className="hints">
            {busy ? (
              "Answering — press Stop to abandon"
            ) : (
              <>
                <kbd>Enter</kbd> send <span aria-hidden="true">·</span> <kbd>Shift</kbd>
                <kbd>Enter</kbd> new line
              </>
            )}
          </span>
          {(nearLimit || over) && (
            <span className={`count ${over ? "over" : ""}`}>
              {value.length}/{maxLength}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
