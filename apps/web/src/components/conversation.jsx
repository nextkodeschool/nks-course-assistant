import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * A scroll container that sticks to the bottom while an answer streams in,
 * but lets go the moment you scroll up to read something.
 *
 * Follows the ElevenLabs UI Conversation API (Conversation /
 * ConversationContent / a scroll-to-bottom control), implemented against this
 * project's own CSS rather than Tailwind.
 *
 * The behaviour is the part worth getting right. Naively calling
 * scrollIntoView on every token yanks the page back down while someone is
 * mid-sentence reading an earlier answer -- so "am I pinned to the bottom?"
 * is tracked as state, and only a pinned view auto-scrolls.
 */

const PIN_TOLERANCE_PX = 48;

const ConversationContext = createContext({
  viewportRef: { current: null },
  pinned: true,
  scrollToBottom: () => {},
});

export function useConversation() {
  return useContext(ConversationContext);
}

export function Conversation({ children, className = "", ...props }) {
  const viewportRef = useRef(null);
  const [pinned, setPinned] = useState(true);

  const handleScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinned(distanceFromBottom <= PIN_TOLERANCE_PX);
  }, []);

  const scrollToBottom = useCallback((behavior = "smooth") => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setPinned(true);
  }, []);

  return (
    <ConversationContext.Provider value={{ viewportRef, pinned, scrollToBottom }}>
      <div className={`conversation ${className}`} {...props}>
        <div className="conversation-viewport" ref={viewportRef} onScroll={handleScroll}>
          {children}
        </div>

        <button
          type="button"
          className="scroll-to-bottom"
          onClick={() => scrollToBottom()}
          aria-label="Scroll to the latest message"
          hidden={pinned}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 5v14m0 0l-6-6m6 6l6-6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Latest
        </button>
      </div>
    </ConversationContext.Provider>
  );
}

export function ConversationContent({ children, className = "", ...props }) {
  return (
    <div className={`conversation-content ${className}`} {...props}>
      {children}
    </div>
  );
}

/**
 * Keeps a pinned view at the bottom as content grows. Render once, after the
 * message list, and pass whatever changes as `deps`.
 */
export function ConversationAnchor({ deps = [] }) {
  const { viewportRef, pinned } = useConversation();

  useEffect(() => {
    if (!pinned) return;
    const el = viewportRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return null;
}
