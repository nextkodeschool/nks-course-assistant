import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";

/**
 * The scrolling conversation area.
 *
 * Sticks to the bottom while an answer streams, and releases the moment the
 * reader scrolls up. Yanking someone back down mid-sentence because a token
 * arrived is worse than not auto-scrolling at all, so "am I at the bottom?"
 * is tracked and only a pinned view follows.
 */

const PIN_TOLERANCE_PX = 48;

const ThreadContext = createContext({ viewportRef: { current: null }, pinned: true });

export function Thread({ children, resetScroll = null }) {
  const viewportRef = useRef(null);
  const [pinned, setPinned] = useState(true);

  const onScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_TOLERANCE_PX);
  }, []);

  // An empty conversation should start at the top -- otherwise the anchor
  // pins to the bottom and scrolls the heading out of view, which reads as a
  // broken screen rather than a starting point.
  useEffect(() => {
    if (resetScroll === null) return;
    const el = viewportRef.current;
    if (el) el.scrollTop = 0;
  }, [resetScroll]);

  const toBottom = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setPinned(true);
  }, []);

  return (
    <ThreadContext.Provider value={{ viewportRef, pinned }}>
      <div className="thread">
        <div className="thread-scroll" ref={viewportRef} onScroll={onScroll}>
          <div className="thread-inner">{children}</div>
        </div>
        <button type="button" className="jump" onClick={toBottom} hidden={pinned}>
          <ArrowDown size={13} strokeWidth={2} />
          Latest
        </button>
      </div>
    </ThreadContext.Provider>
  );
}

/** Keeps a pinned view at the bottom as content grows. */
export function ThreadAnchor({ deps = [] }) {
  const { viewportRef, pinned } = useContext(ThreadContext);

  useEffect(() => {
    if (!pinned) return;
    const el = viewportRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return null;
}
