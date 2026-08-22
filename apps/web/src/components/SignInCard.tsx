"use client";

import { useState } from "react";
import { authMessage, registerEmail, signInEmail, signInGoogle } from "@/lib/firebase";

/**
 * Sign in, or create an account.
 *
 * One card with a mode toggle rather than two pages: the two forms differ by one button
 * label, and a separate route for each doubles the surface for no gain.
 *
 * The submit button says what it will do and keeps saying it while it works, because a
 * button that changes to a spinner leaves you unsure what you pressed.
 */
export function SignInCard({ heading = "Sign in" }: { heading?: string }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(authMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    if (password.length < 6 && mode === "up") {
      setError("Use a password of at least six characters.");
      return;
    }

    void run(() => (mode === "in" ? signInEmail(email, password) : registerEmail(email, password)));
  };

  return (
    <div className="auth-card">
      <h1>{heading}</h1>
      <p className="field-hint" style={{ marginBottom: 22 }}>
        {mode === "in"
          ? "Use the email and password for your ADCode account."
          : "Creating an account takes one step. No card required."}
      </p>

      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: "100%" }}>
          {mode === "in" ? "Sign in" : "Create account"}
        </button>
      </form>

      <button
        type="button"
        className="btn btn-outline"
        style={{ width: "100%", marginTop: 10 }}
        disabled={busy}
        onClick={() => void run(signInGoogle)}
      >
        Continue with Google
      </button>

      <p className="auth-alt">
        {mode === "in" ? "No account yet? " : "Already have one? "}
        <button type="button" onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(null); }}>
          {mode === "in" ? "Create one" : "Sign in"}
        </button>
      </p>
    </div>
  );
}
