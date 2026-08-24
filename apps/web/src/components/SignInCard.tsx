"use client";

import { useState } from "react";
import {
  authMessage,
  registerEmail,
  signInEmail,
  signInGithub,
  signInGoogle,
} from "@/lib/firebase";

/**
 * Sign in, or create an account.
 *
 * One card with a mode toggle rather than two pages: the two forms differ by one button
 * label, and a separate route for each doubles the surface for no gain.
 *
 * The providers come first and the email form second, because the providers are one click
 * and the form is four fields and a password to remember. A card that leads with the slow
 * path teaches people to take it.
 *
 * The submit button says what it will do and keeps saying it while it works: a button that
 * turns into a spinner leaves you unsure what you pressed.
 */
export function SignInCard({ heading = "Sign in" }: { heading?: string }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"google" | "github" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (which: "google" | "github" | "email", action: () => Promise<void>) => {
    setBusy(which);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(authMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy !== null) return;

    if (password.length < 6 && mode === "up") {
      setError("Use a password of at least six characters.");
      return;
    }

    void run("email", () =>
      mode === "in" ? signInEmail(email, password) : registerEmail(email, password),
    );
  };

  return (
    <div className="ios-card auth-card">
      <h1>{heading}</h1>
      <p className="field-hint" style={{ marginBottom: 20 }}>
        {mode === "in"
          ? "One account covers your earnings and your campaigns."
          : "Creating an account takes one step. No card required."}
      </p>

      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}

      <div className="provider-stack">
        <button
          type="button"
          className="btn btn-provider"
          disabled={busy !== null}
          onClick={() => void run("github", signInGithub)}
        >
          <GithubMark />
          {busy === "github" ? "Opening GitHub…" : "Continue with GitHub"}
        </button>

        <button
          type="button"
          className="btn btn-provider"
          disabled={busy !== null}
          onClick={() => void run("google", signInGoogle)}
        >
          <GoogleMark />
          {busy === "google" ? "Opening Google…" : "Continue with Google"}
        </button>
      </div>

      <p className="auth-divider">
        <span>or use an email address</span>
      </p>

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

        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy !== null}
          style={{ width: "100%" }}
        >
          {mode === "in" ? "Sign in" : "Create account"}
        </button>
      </form>

      <p className="auth-alt">
        {mode === "in" ? "No account yet? " : "Already have one? "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "in" ? "up" : "in");
            setError(null);
          }}
        >
          {mode === "in" ? "Create one" : "Sign in"}
        </button>
      </p>
    </div>
  );
}

/* The two marks, inline so the card makes no request to a logo CDN - the same rule the
   fonts follow, and for the same reason: no third party learns who is signing in. */

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
