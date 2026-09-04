import { useCallback, useEffect, useRef, useState } from "react";
import { api, askQuestion } from "./api";

const MAX_QUESTION = 500;

const SUGGESTIONS = [
  "Why does my container ignore SIGTERM?",
  "What is the difference between liveness and readiness probes?",
  "How do I make my Docker builds cache properly?",
  "What does exit code 137 mean?",
];

/* ------------------------------------------------------------------ auth */

function Auth({ onSignedIn }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === "register";

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = isRegister
        ? await api.register(email, password)
        : await api.login(email, password);
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>{isRegister ? "Create an account" : "Kora"}</h1>
        <p className="sub">
          {isRegister
            ? "This account lives only in your own database."
            : "Ask questions about your course notes."}
        </p>

        {error && <div className="error">{error}</div>}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={isRegister ? "new-password" : "current-password"}
          />
        </div>

        <button type="submit" disabled={busy}>
          {busy ? "Working..." : isRegister ? "Create account" : "Sign in"}
        </button>

        <p className="switch">
          {isRegister ? "Already have an account? " : "No account yet? "}
          <button
            type="button"
            onClick={() => {
              setMode(isRegister ? "login" : "register");
              setError(null);
            }}
          >
            {isRegister ? "Sign in" : "Create one"}
          </button>
        </p>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ chat */

function Message({ role, content, citations, streaming }) {
  return (
    <div className={`msg ${role}`}>
      <div className="who">{role === "user" ? "You" : "Assistant"}</div>
      <div className="bubble">
        {content}
        {streaming && <span className="cursor" />}
      </div>
      {citations?.length > 0 && (
        <div className="cites">
          {citations.map((c) => (
            <span className="cite" key={c.session_number}>
              Session {c.session_number} · {c.session_title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);

  const [draft, setDraft] = useState("");
  const [streamingText, setStreamingText] = useState(null);
  const [streamingCites, setStreamingCites] = useState([]);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  const bottomRef = useRef(null);

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
      .then((list) => {
        setActiveId((current) => current ?? list[0]?.id ?? null);
      })
      .catch(() => {});
  }, [user, refreshConversations]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    api.listMessages(activeId).then(setMessages).catch(() => setMessages([]));
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  async function newConversation() {
    const created = await api.createConversation();
    setConversations((prev) => [created, ...prev]);
    setActiveId(created.id);
    setMessages([]);
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
    setDraft("");

    const conversationId = activeId || (await newConversation());

    // Shown immediately. The server has it too, but waiting for a round trip
    // to display what someone just typed makes the whole thing feel broken.
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "user", content: question, citations: [] },
    ]);
    setStreamingText("");
    setStreamingCites([]);

    let failed = false;

    await askQuestion(conversationId, question, {
      onSources: setStreamingCites,
      onToken: (token) => setStreamingText((prev) => (prev ?? "") + token),
      onError: (message) => {
        failed = true;
        setError(message);
      },
      onDone: () => {},
    });

    setStreamingText((finalText) => {
      if (!failed && finalText) {
        setMessages((prev) => [
          ...prev,
          {
            id: `local-a-${Date.now()}`,
            role: "assistant",
            content: finalText,
            citations: streamingCitesRef.current,
          },
        ]);
      }
      return null;
    });

    setSending(false);
    refreshConversations().catch(() => {});
  }

  // Kept in a ref because the setState callback above runs after render and
  // would otherwise close over a stale value.
  const streamingCitesRef = useRef([]);
  useEffect(() => {
    streamingCitesRef.current = streamingCites;
  }, [streamingCites]);

  async function signOut() {
    await api.logout().catch(() => {});
    setUser(null);
    setConversations([]);
    setActiveId(null);
    setMessages([]);
  }

  if (loading) return null;
  if (!user) return <Auth onSignedIn={setUser} />;

  const over = draft.length > MAX_QUESTION;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>Kora</h1>
          <span className="mode">Course notes</span>
        </div>

        <div className="new">
          <button onClick={newConversation} style={{ width: "100%" }}>
            New conversation
          </button>
        </div>

        <div className="convos">
          {conversations.map((c) => (
            <div key={c.id} className={`convo ${c.id === activeId ? "active" : ""}`}>
              <button className="title" onClick={() => setActiveId(c.id)} title={c.title}>
                {c.title}
              </button>
              <button
                className="del"
                onClick={() => removeConversation(c.id)}
                aria-label={`Delete ${c.title}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-foot">
          <span className="email" title={user.email}>{user.email}</span>
          <button className="ghost" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <main className="main">
        <div className="messages">
          <div className="thread">
            {messages.length === 0 && streamingText === null ? (
              <div className="empty">
                <h2>Ask about your course notes</h2>
                <p>
                  Answers come only from the session notes. If something was not covered
                  in class, you will be told so rather than guessed at.
                </p>
                <div className="suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)}>{s}</button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((m) => (
                  <Message key={m.id} {...m} />
                ))}
                {streamingText !== null && (
                  <Message
                    role="assistant"
                    content={streamingText}
                    citations={streamingCites}
                    streaming
                  />
                )}
              </>
            )}

            {error && <div className="error">{error}</div>}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="composer">
          <div className="composer-inner">
            <textarea
              rows={1}
              value={draft}
              placeholder="Ask a question about the course..."
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={sending}
            />
            <button onClick={() => send()} disabled={sending || !draft.trim() || over}>
              {sending ? "..." : "Ask"}
            </button>
          </div>
          <div className={`count ${over ? "over" : ""}`}>
            {draft.length} / {MAX_QUESTION}
          </div>
        </div>
      </main>
    </div>
  );
}
