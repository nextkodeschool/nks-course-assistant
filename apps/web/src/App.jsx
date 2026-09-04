import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, askQuestion } from "./api";
import {
  Conversation,
  ConversationAnchor,
  ConversationContent,
} from "./components/conversation";
import { Message, MessageAvatar, MessageContent, MessageSources } from "./components/message";
import { Response } from "./components/response";
import { ThinkingIndicator } from "./components/shimmering-text";

const MAX_QUESTION = 500;

const SUGGESTIONS = [
  "Why does my container ignore SIGTERM?",
  "What is the difference between liveness and readiness probes?",
  "How do I make my Docker builds cache properly?",
  "What does exit code 137 mean?",
];

function Wordmark() {
  return (
    <div className="wordmark">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.9" />
        <circle cx="12" cy="12" r="3.1" fill="currentColor" />
      </svg>
      <span>Kora</span>
    </div>
  );
}

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
        <div className="auth-brand">
          <Wordmark />
          <p className="tagline">Ask your course notes</p>
        </div>

        <h1>{isRegister ? "Create your account" : "Sign in"}</h1>
        <p className="sub">
          {isRegister
            ? "This account lives only in your own database, on your own machine."
            : "Answers come from your class notes, and name the session they came from."}
        </p>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

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
          {isRegister && <span className="hint">At least 8 characters.</span>}
        </div>

        <button type="submit" disabled={busy}>
          {busy ? "Working…" : isRegister ? "Create account" : "Sign in"}
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

/* --------------------------------------------------------------- composer */

function Composer({ value, onChange, onSubmit, disabled }) {
  const ref = useRef(null);
  const over = value.length > MAX_QUESTION;

  // Grow with the text, up to a ceiling. Reset to auto first, or the box can
  // only ever get taller and never shorter again.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  return (
    <div className="composer">
      <div className="composer-inner">
        <div className={`composer-box ${over ? "over" : ""}`}>
          <textarea
            ref={ref}
            rows={1}
            value={value}
            placeholder="Ask about anything covered in class…"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            disabled={disabled}
            aria-label="Your question"
          />
          <button
            onClick={onSubmit}
            disabled={disabled || !value.trim() || over}
            className="send"
            aria-label="Send question"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 12h14m0 0l-6-6m6 6l-6 6"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div className="composer-meta">
          <span className="kbd-hint">
            <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
          </span>
          <span className={`count ${over ? "over" : ""}`}>
            {value.length}/{MAX_QUESTION}
          </span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- app */

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
    // to display what someone just typed makes the app feel broken.
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
  if (!user) return <Auth onSignedIn={setUser} />;

  const activeTitle = conversations.find((c) => c.id === activeId)?.title;
  const isEmpty = messages.length === 0 && streamingText === null && !stage;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Wordmark />
        </div>

        <div className="new">
          <button onClick={newConversation}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            New conversation
          </button>
        </div>

        <nav className="convos" aria-label="Your conversations">
          {conversations.length === 0 && <p className="convos-empty">Nothing yet.</p>}
          {conversations.map((c) => (
            <div key={c.id} className={`convo ${c.id === activeId ? "active" : ""}`}>
              <button className="title" onClick={() => setActiveId(c.id)} title={c.title}>
                {c.title}
              </button>
              <button
                className="del"
                onClick={() => removeConversation(c.id)}
                aria-label={`Delete conversation: ${c.title}`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="who">
            <MessageAvatar name={user.email} />
            <span className="email" title={user.email}>
              {user.email}
            </span>
          </div>
          <button className="ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h2>{activeTitle || "New conversation"}</h2>
          <span className="badge">Grounded in course notes</span>
        </header>

        <Conversation>
          <ConversationContent>
            {isEmpty ? (
              <div className="empty">
                <div className="empty-mark">
                  <Wordmark />
                </div>
                <h2>Ask about anything covered in class</h2>
                <p>
                  Every answer comes from the session notes and names the session it came from.
                  If a topic was never taught, Kora says so instead of guessing.
                </p>
                <div className="suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)}>
                      <span>{s}</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M5 12h14m0 0l-6-6m6 6l-6 6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((m) => (
                  <Message key={m.id} from={m.role}>
                    <MessageAvatar name={m.role === "user" ? user.email : "Kora"} />
                    <div className="message-body">
                      <MessageContent variant={m.role === "user" ? "contained" : "flat"}>
                        {m.role === "assistant" ? <Response>{m.content}</Response> : m.content}
                      </MessageContent>
                      {m.role === "assistant" && <MessageSources citations={m.citations} />}
                    </div>
                  </Message>
                ))}

                {stage && (
                  <Message from="assistant">
                    <MessageAvatar name="Kora" />
                    <div className="message-body">
                      <ThinkingIndicator stage={stage} />
                    </div>
                  </Message>
                )}

                {streamingText !== null && (
                  <Message from="assistant">
                    <MessageAvatar name="Kora" />
                    <div className="message-body">
                      <MessageContent variant="flat">
                        <Response>{streamingText}</Response>
                        <span className="cursor" aria-hidden="true" />
                      </MessageContent>
                      <MessageSources citations={streamingCites} />
                    </div>
                  </Message>
                )}
              </>
            )}

            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}

            <ConversationAnchor deps={[messages.length, streamingText, stage, error]} />
          </ConversationContent>
        </Conversation>

        <Composer value={draft} onChange={setDraft} onSubmit={() => send()} disabled={sending} />
      </main>
    </div>
  );
}
