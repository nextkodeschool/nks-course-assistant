import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Wordmark } from "./brand";

/**
 * Sign in and register.
 *
 * A single column, no card, no illustration. The account exists only in the
 * student's own database and protects nothing -- so this screen is a door,
 * not a destination, and it should take as little attention as possible.
 */

export function Auth({ onSignedIn, api }) {
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
        <div className="auth-head">
          <Wordmark />
          <p className="tagline">The Next Kode course, made askable.</p>
        </div>

        <h1>{isRegister ? "Create an account" : "Sign in"}</h1>
        <p className="sub">
          {isRegister
            ? "Your account lives only in the database on your own machine."
            : "Answers come from the course sessions, and name the session they came from."}
        </p>

        {error && (
          <div className="alert" role="alert">
            <AlertCircle size={14} strokeWidth={2} />
            <span>{error}</span>
          </div>
        )}

        <div className="field">
          <label htmlFor="email">Email</label>
          <div className="control">
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
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <div className="control">
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
          {isRegister && <span className="hint">At least 8 characters.</span>}
        </div>

        <button type="submit" className="btn btn-primary" disabled={busy}>
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
