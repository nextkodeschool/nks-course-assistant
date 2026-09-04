// Every call goes to this page's own origin. nginx forwards /api/* to the
// api container, which is what keeps the LLM key and the NKS key on the
// server. If the browser called those services directly, both keys would
// ship inside this JavaScript file and be visible in devtools.

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
  });

  if (response.status === 204) return null;

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    // The API returns { detail: { code, message } } with a message written
    // for a person, so it is shown rather than replaced.
    const detail = body?.detail;
    const message =
      typeof detail === "object" && detail?.message
        ? detail.message
        : typeof detail === "string"
          ? detail
          : "Something went wrong.";
    const error = new Error(message);
    error.status = response.status;
    error.code = detail?.code;
    throw error;
  }

  return body;
}

export const api = {
  register: (email, password) =>
    request("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),

  login: (email, password) =>
    request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  logout: () => request("/api/auth/logout", { method: "POST" }),

  me: () => request("/api/auth/me"),

  // What Kora knows: mode, session count, and (local mode only) the sessions.
  kb: () => request("/api/kb"),

  // A whole session, in order. Local mode only; hosted mode returns 404.
  kbSession: (sessionNumber) => request(`/api/kb/sessions/${sessionNumber}`),

  listConversations: () => request("/api/chat/conversations"),

  createConversation: () => request("/api/chat/conversations", { method: "POST" }),

  renameConversation: (id, title) =>
    request(`/api/chat/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),

  deleteConversation: (id) => request(`/api/chat/conversations/${id}`, { method: "DELETE" }),

  listMessages: (id) => request(`/api/chat/conversations/${id}/messages`),
};

/**
 * Ask a question and receive the answer as it is written.
 *
 * fetch is used rather than EventSource because EventSource can only issue
 * GET requests, and the question needs a POST body. The trade is that the
 * server-sent-events framing has to be parsed by hand, which is the loop
 * below.
 *
 * Aborting the signal rejects with an AbortError; the caller decides what to
 * do with whatever text had arrived by then.
 */
export async function askQuestion(conversationId, question, handlers, signal) {
  const response = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ question }),
    signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    handlers.onError?.(body?.detail?.message || `Request failed (${response.status})`);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Events are separated by a blank line. Anything after the last blank
    // line is a partial event and stays in the buffer for the next chunk --
    // network reads split wherever they like, not on event boundaries.
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const raw of events) {
      let name = "message";
      let data = "";

      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }

      if (!data) continue;

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      if (name === "sources") handlers.onSources?.(parsed.citations || [], parsed.near || []);
      else if (name === "token") handlers.onToken?.(parsed.text || "");
      else if (name === "error") handlers.onError?.(parsed.message);
      else if (name === "done") handlers.onDone?.(parsed);
    }
  }
}
