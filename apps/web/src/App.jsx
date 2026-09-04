import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, PanelLeft } from "lucide-react";
import { api, askQuestion } from "./api";
import { Auth } from "./components/auth";
import { Composer } from "./components/composer";
import { Sidebar } from "./components/sidebar";
import { Thread, ThreadAnchor } from "./components/thread";
import { AssistantTurn, Thinking, UserTurn } from "./components/turn";

// Enforced server-side too; mirrored here so the limit is visible while
// typing rather than discovered as a rejected request.
const MAX_QUESTION = 500;

// The bundled corpus. Three sample sessions today, forty-four once the real
// notes are ingested -- read from the answers rather than hardcoded would be
// better, but the backend does not expose a corpus size and inventing an
// endpoint for a subtitle is not worth it.
const CORPUS_LABEL = "Course-grounded";

const STARTERS = [
  "Why does my container ignore SIGTERM?",
  "What is the difference between liveness and readiness probes?",
  "How do I make my Docker builds cache properly?",
  "What does exit code 137 mean?",
];

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);

  const [draft, setDraft] = useState("");
  const [streamingText, setStreamingText] = useState(null);
  const [streamingCites, setStreamingCites] = useState([]);
  const [stage, setStage] = useState(null); // "searching" | "writing" | null
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // Kept in a ref because the setStreamingText callback below runs after
  // render and would otherwise close over a stale citations value.
  const citesRef = useRef([]);
  useEffect(() => {
    citesRef.current = streamingCites;
  }, [streamingCites]);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

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
    if (!activeId) {
      setMessages([]);
      return;
    }
    api.listMessages(activeId).then(setMessages).catch(() => setMessages([]));
  }, [activeId]);

  async function newConversation() {
    const created = await api.createConversation();
    setConversations((prev) => [created, ...prev]);
    setActiveId(created.id);
    setMessages([]);
    setError(null);
    setNavOpen(false);
    return created.id;
  }

  async function removeConversation(id) {
    await api.deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }

  async function send(text) {
    const question = (text ?? draft).trim();
    if (!question || question.length > MAX_QUESTION || sending) return;

    setError(null);
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

    let failed = false;

    await askQuestion(conversationId, question, {
      onSources: (citations) => {
        setStreamingCites(citations);
        setStage("writing");
      },
      onToken: (token) => {
        setStage(null);
        setStreamingText((prev) => (prev ?? "") + token);
      },
      onError: (message) => {
        failed = true;
        setError(message);
      },
    });

    setStreamingText((finalText) => {
      if (!failed && finalText) {
        setMessages((prev) => [
          ...prev,
          {
            id: `local-a-${Date.now()}`,
            role: "assistant",
            content: finalText,
            citations: citesRef.current,
          },
        ]);
      }
      return null;
    });

    setStage(null);
    setSending(false);
    refreshConversations().catch(() => {});
  }

  async function signOut() {
    await api.logout().catch(() => {});
    setUser(null);
    setConversations([]);
    setActiveId(null);
    setMessages([]);
  }

  if (loading) return null;
  if (!user) return <Auth onSignedIn={setUser} api={api} />;

  const activeTitle = conversations.find((c) => c.id === activeId)?.title;
  const isEmpty = messages.length === 0 && streamingText === null && !stage;

  return (
    <div className="shell">
      {navOpen && <button className="scrim" onClick={() => setNavOpen(false)} aria-label="Close navigation" />}

      <Sidebar
        open={navOpen}
        onClose={() => setNavOpen(false)}
        user={user}
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={newConversation}
        onDelete={removeConversation}
        onSignOut={signOut}
      />

      <main className="main">
        <header className="topbar">
          <button className="menu" onClick={() => setNavOpen(true)} aria-label="Open navigation">
            <PanelLeft size={16} strokeWidth={2} />
          </button>
          <span className="title">{activeTitle || "New conversation"}</span>
          <span className="corpus">
            <span className="dot" aria-hidden="true" />
            {CORPUS_LABEL}
          </span>
        </header>

        <Thread resetScroll={isEmpty ? activeId || "new" : null}>
          {isEmpty ? (
            <div className="empty">
              <h1>Kora</h1>
              <p>Ask your course anything.</p>
              <div className="meta">
                <span>Course sessions</span>
                <span className="sep" aria-hidden="true" />
                <span>Answers cite their source</span>
              </div>

              <div className="starters">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)}>
                    <span>{s}</span>
                    <ArrowRight size={14} strokeWidth={2} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m) =>
                m.role === "user" ? (
                  <UserTurn key={m.id} content={m.content} />
                ) : (
                  <AssistantTurn key={m.id} content={m.content} citations={m.citations} />
                )
              )}

              {stage && <Thinking stage={stage} />}

              {streamingText !== null && (
                <AssistantTurn content={streamingText} citations={streamingCites} streaming />
              )}
            </>
          )}

          {error && (
            <div className="alert" role="alert" style={{ marginTop: 18 }}>
              <AlertCircle size={14} strokeWidth={2} />
              <span>{error}</span>
            </div>
          )}

          {!isEmpty && <ThreadAnchor deps={[messages.length, streamingText, stage, error]} />}
        </Thread>

        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={() => send()}
          disabled={sending}
          maxLength={MAX_QUESTION}
        />
      </main>
    </div>
  );
}
