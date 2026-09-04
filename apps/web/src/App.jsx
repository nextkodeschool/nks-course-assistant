import { useCallback, useEffect, useRef, useState } from "react";
import { PanelLeft, Pencil, Trash2 } from "lucide-react";
import { api, askQuestion } from "./api";
import { Auth } from "./components/auth";
import { Composer } from "./components/composer";
import { Menu } from "./components/menu";
import { SessionPanel } from "./components/session-panel";
import { Sidebar } from "./components/sidebar";
import { Thread, ThreadAnchor } from "./components/thread";
import { AssistantTurn, ErrorTurn, Thinking, UserTurn } from "./components/turn";

// Enforced server-side too; mirrored here so the limit is visible while
// typing rather than discovered as a rejected request.
const MAX_QUESTION = 500;

// How long a deleted conversation can be brought back before the delete is
// actually sent to the server.
const UNDO_MS = 6000;

// The sidebar's collapsed state survives reloads; it is a preference, not a
// per-visit choice.
const COLLAPSED_KEY = "kora.sidebar.collapsed";

// Starters are tied to sessions so the first thing a student sees teaches
// the shape of the product: questions belong to sessions. A starter whose
// session is not indexed is shown without the session line.
const STARTERS = [
  { session: 4, question: "Why doesn't SIGTERM reach my process?" },
  { session: 18, question: "How does Docker layer caching work?" },
  { session: 31, question: "How do liveness and readiness probes differ?" },
  { session: 18, question: "Why is my container image so large?" },
];

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function corpusLabel(kb) {
  if (!kb) return "";
  if (kb.mode === "hosted") return "Hosted course notes";
  const n = kb.session_count ?? 0;
  return `Local · ${n} session${n === 1 ? "" : "s"}`;
}

function capitalise(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function corpusFact(kb) {
  if (!kb) return "";
  if (kb.mode === "hosted") return "Hosted course notes";
  const sessions = kb.sessions ?? [];
  const n = sessions.length;
  const first = sessions[0]?.topic;
  const last = sessions[n - 1]?.topic;
  const span = first && last && first !== last ? ` · ${capitalise(first)} to ${capitalise(last)}` : "";
  return `${n} session${n === 1 ? "" : "s"}${span}`;
}

function dropTrailingLocalQuestion(list) {
  const last = list[list.length - 1];
  return last && last.role === "user" && String(last.id).startsWith("local-") ? list.slice(0, -1) : list;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kb, setKb] = useState(null);

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);

  const [draft, setDraft] = useState("");
  const [streamingText, setStreamingText] = useState(null);
  const [streamingCites, setStreamingCites] = useState([]);
  const [stage, setStage] = useState(null); // "searching" | "writing" | null
  const [failed, setFailed] = useState(null); // { question, message } | null
  const [sending, setSending] = useState(false);

  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [panel, setPanel] = useState(null); // { type: "sessions" } | { type: "session", number }
  const [pendingDelete, setPendingDelete] = useState(null);
  const [renamingId, setRenamingId] = useState(null);

  const isMobile = useMediaQuery("(max-width: 860px)");

  // Live values the async send() needs after awaits, without stale closures.
  const textRef = useRef("");
  const citesRef = useRef([]);
  const nearRef = useRef([]);
  const abortRef = useRef(null);
  const pendingRef = useRef(null);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    api.kb().then(setKb).catch(() => setKb(null));
  }, [user]);

  const refreshConversations = useCallback(async () => {
    const list = await api.listConversations();
    setConversations(list);
    return list;
  }, []);

  useEffect(() => {
    if (!user) return;
    // Open the most recent conversation on load. Landing on an empty screen
    // when you have history reads as "my history is gone".
    refreshConversations()
      .then((list) => setActiveId((current) => current ?? list[0]?.id ?? null))
      .catch(() => {});
  }, [user, refreshConversations]);

  useEffect(() => {
    setFailed(null);
    setPanel(null);
    if (!activeId) {
      setMessages([]);
      return;
    }
    api.listMessages(activeId).then(setMessages).catch(() => setMessages([]));
  }, [activeId]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Storage can be unavailable; the preference just does not persist.
    }
  }, [collapsed]);

  /* ---------------------------------------------------- conversations -- */

  async function newConversation() {
    const created = await api.createConversation();
    setConversations((prev) => [created, ...prev]);
    setActiveId(created.id);
    setMessages([]);
    setNavOpen(false);
    return created.id;
  }

  function flushPendingDelete() {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    api.deleteConversation(pending.conversation.id).catch(() => {});
    pendingRef.current = null;
    setPendingDelete(null);
  }

  function removeConversation(id) {
    const target = conversations.find((c) => c.id === id);
    if (!target) return;

    // One undo at a time; a second delete commits the first.
    flushPendingDelete();

    const rest = conversations.filter((c) => c.id !== id);
    setConversations(rest);
    if (activeId === id) setActiveId(rest[0]?.id ?? null);

    const timer = setTimeout(() => {
      api.deleteConversation(id).catch(() => {});
      pendingRef.current = null;
      setPendingDelete(null);
    }, UNDO_MS);

    const pending = { conversation: target, timer };
    pendingRef.current = pending;
    setPendingDelete(pending);
  }

  function undoDelete() {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRef.current = null;
    setPendingDelete(null);
    setConversations((prev) =>
      [...prev, pending.conversation].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    );
    setActiveId(pending.conversation.id);
  }

  function startRename(id) {
    if (collapsed && !isMobile) setCollapsed(false);
    if (isMobile) setNavOpen(true);
    setRenamingId(id);
  }

  async function commitRename(id, title) {
    setRenamingId(null);
    const value = title.trim().slice(0, 120);
    if (!value) return;
    const current = conversations.find((c) => c.id === id);
    if (!current || current.title === value) return;
    const updated = await api.renameConversation(id, value);
    setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
  }

  /* ---------------------------------------------------------- panels --- */

  const closePanel = useCallback(() => setPanel(null), []);

  function openSession(number) {
    setPanel(number == null ? { type: "sessions" } : { type: "session", number });
  }

  const canOpenSessions = kb?.mode === "local" && (kb.sessions?.length ?? 0) > 0;

  /* -------------------------------------------------------------- ask -- */

  async function send(text) {
    const question = (text ?? draft).trim();
    if (!question || question.length > MAX_QUESTION || sending) return;

    setFailed(null);
    setSending(true);
    setStage("searching");
    setDraft("");

    const conversationId = activeId || (await newConversation());

    // Shown immediately. The server has it too, but waiting for a round trip
    // to echo back what someone just typed makes the app feel broken.
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "user", content: question, citations: [] },
    ]);
    setStreamingText(null);
    setStreamingCites([]);
    textRef.current = "";
    citesRef.current = [];
    nearRef.current = [];

    const controller = new AbortController();
    abortRef.current = controller;

    let failure = null;
    let aborted = false;

    try {
      await askQuestion(
        conversationId,
        question,
        {
          onSources: (citations, near) => {
            citesRef.current = citations;
            nearRef.current = near;
            setStreamingCites(citations);
            setStage("writing");
          },
          onToken: (token) => {
            setStage(null);
            textRef.current += token;
            setStreamingText(textRef.current);
          },
          onError: (message) => {
            failure = message;
          },
        },
        controller.signal
      );
    } catch (err) {
      if (err?.name === "AbortError") aborted = true;
      else failure = err?.message || "Something went wrong.";
    }

    abortRef.current = null;
    const finalText = textRef.current;

    if (failure) {
      // The question stays on screen with the failure under it, and the
      // draft goes back into the composer so nothing has to be retyped.
      setFailed({ question, message: failure });
      setDraft(question);
    } else if (finalText) {
      setMessages((prev) => [
        ...prev,
        {
          id: `local-a-${Date.now()}`,
          role: "assistant",
          content: finalText,
          citations: citesRef.current,
          near: nearRef.current,
          stopped: aborted,
        },
      ]);
    } else if (aborted) {
      setFailed({ question, message: "Stopped before an answer arrived." });
      setDraft(question);
    }

    setStreamingText(null);
    setStage(null);
    setSending(false);
    refreshConversations().catch(() => {});
  }

  function stop() {
    abortRef.current?.abort();
  }

  function retryFailed() {
    const question = failed?.question;
    if (!question) return;
    setFailed(null);
    setMessages(dropTrailingLocalQuestion);
    if (draft.trim() === question) setDraft("");
    send(question);
  }

  async function signOut() {
    flushPendingDelete();
    await api.logout().catch(() => {});
    setUser(null);
    setKb(null);
    setConversations([]);
    setActiveId(null);
    setMessages([]);
    setPanel(null);
  }

  /* ----------------------------------------------------------- render -- */

  if (loading) return null;
  if (!user) return <Auth onSignedIn={setUser} api={api} />;

  const activeTitle = conversations.find((c) => c.id === activeId)?.title;
  const isEmpty = messages.length === 0 && streamingText === null && !stage && !failed;
  const sessions = kb?.sessions ?? [];
  const sessionTitle = (n) => sessions.find((s) => s.session_number === n)?.session_title;
  const effectiveCollapsed = collapsed && !isMobile;

  return (
    <div className={`shell ${effectiveCollapsed ? "collapsed" : ""}`}>
      {navOpen && (
        <button className="scrim" onClick={() => setNavOpen(false)} aria-label="Close navigation" />
      )}

      <Sidebar
        collapsed={effectiveCollapsed}
        onToggle={() => setCollapsed((c) => !c)}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        user={user}
        corpusLabel={corpusLabel(kb)}
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={newConversation}
        onDelete={removeConversation}
        onSignOut={signOut}
        pendingDelete={pendingDelete}
        onUndo={undoDelete}
        renamingId={renamingId}
        onStartRename={startRename}
        onCommitRename={commitRename}
        onCancelRename={() => setRenamingId(null)}
      />

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-btn nav-toggle" onClick={() => setNavOpen(true)} aria-label="Open navigation">
              <PanelLeft size={17} strokeWidth={2} />
            </button>
            {/* On a phone the sidebar is not visible, so the title has nowhere
                else to live. On desktop the sidebar already shows it. */}
            {isMobile && activeTitle && <span className="mobile-title">{activeTitle}</span>}
          </div>

          <div className="topbar-right">
            {activeId && (
              <Menu
                label="Conversation options"
                className="head-menu"
                items={[
                  { label: "Rename", icon: <Pencil size={13} strokeWidth={2} />, onSelect: () => startRename(activeId) },
                  {
                    label: "Delete",
                    icon: <Trash2 size={13} strokeWidth={2} />,
                    destructive: true,
                    onSelect: () => removeConversation(activeId),
                  },
                ]}
              />
            )}
          </div>
        </header>

        <Thread resetScroll={isEmpty ? activeId || "new" : null}>
          {isEmpty ? (
            <div className="empty">
              <h1>Kora</h1>
              <p className="lede">Ask your course anything.</p>
              {kb && <p className="fact">{corpusFact(kb)}</p>}

              <div className="starters">
                {STARTERS.map((s) => {
                  const title = sessionTitle(s.session);
                  return (
                    <button key={s.question} onClick={() => send(s.question)}>
                      {title && (
                        <span className="s-session">
                          Session {s.session} · {title}
                        </span>
                      )}
                      <span className="s-q">{s.question}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m) =>
                m.role === "user" ? (
                  <UserTurn key={m.id} content={m.content} />
                ) : (
                  <AssistantTurn
                    key={m.id}
                    content={m.content}
                    citations={m.citations}
                    near={m.near}
                    canOpen={canOpenSessions}
                    onOpenSession={openSession}
                    onShowSessions={canOpenSessions ? () => openSession(null) : undefined}
                    stopped={m.stopped}
                  />
                )
              )}

              {stage && <Thinking stage={stage} />}

              {streamingText !== null && (
                <AssistantTurn content={streamingText} citations={streamingCites} streaming />
              )}

              {failed && <ErrorTurn message={failed.message} onRetry={retryFailed} />}
            </>
          )}

          {!isEmpty && <ThreadAnchor deps={[messages.length, streamingText, stage, failed]} />}
        </Thread>

        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={() => send()}
          onStop={stop}
          busy={sending}
          maxLength={MAX_QUESTION}
        />

        <SessionPanel panel={panel} kb={kb} api={api} onOpenSession={openSession} onClose={closePanel} />
      </main>
    </div>
  );
}
