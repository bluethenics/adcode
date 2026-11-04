"use client";

import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { AuthAscii } from "./AuthAscii";
import { Mark } from "./Mark";
import { trackWebsiteEvent } from "@/lib/websiteAnalytics";
import { Icon } from "@/components/Icon";
import { ArrowRight, ArrowUpRight } from "lucide";
import {
  authMessage,
  registerEmail,
  signInEmail,
  signInGithub,
  signInGoogle,
} from "@/lib/firebase";

/** One responsive account surface shared by the dashboard, admin, and campaign flow. */
/**
 * Who is arriving decides what the left half says and which tab opens.
 *
 * An advertiser from "Advertiser portal" is almost always new, and used to meet "Welcome back"
 * and a list about earnings - the developer's pitch, and no price. They now land on Create
 * account with what a campaign costs and what happens after signing up.
 */
export type SignInAudience = "developer" | "advertiser";

export function SignInCard({ heading = "Sign in", audience = "developer", headingTag: HeadingTag = "h1" }: { heading?: string; audience?: SignInAudience; headingTag?: "h1" | "h2" }) {
  const advertiser = audience === "advertiser";
  const [mode, setMode] = useState<"in" | "up">(advertiser ? "up" : "in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"google" | "github" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();
  const signInTabId = `${panelId}-sign-in`;
  const createTabId = `${panelId}-create`;
  const signInTab = useRef<HTMLButtonElement>(null);
  const createTab = useRef<HTMLButtonElement>(null);

  const run = async (
    which: "google" | "github" | "email",
    action: () => Promise<boolean>,
  ) => {
    setBusy(which);
    setError(null);
    try {
      const created = await action();
      trackWebsiteEvent(created ? "sign_up" : "sign_in");
    } catch (cause) {
      setError(authMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const submit = (event: FormEvent) => {
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

  const chooseMode = (next: "in" | "up") => {
    if (busy !== null) return;
    setMode(next);
    setError(null);
  };

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (busy !== null || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "in" : event.key === "End" ? "up" : mode === "in" ? "up" : "in";
    chooseMode(next);
    (next === "in" ? signInTab : createTab).current?.focus();
  };

  return (
    <div className="ios-card auth-card auth-workspace auth-upgrade" data-mode={mode}>
      <section className="auth-context" aria-label="Your ADCode account">
        <div className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true"><Mark size={30} /></span>
          <span>ADCode</span>
          <span className="auth-brand-caption">YOUR WORKSPACE</span>
        </div>
        <AuthAscii />
        {advertiser ? (
          <>
            <div className="auth-context-copy">
              <h2>Reach developers<br /><span>while they build.</span></h2>
              <p>Your card appears inside ADCode, beside the code people are writing.</p>
            </div>
            <ol className="auth-context-list auth-context-steps">
              <li><span aria-hidden="true">1</span>Create your account - free, no card to sign up</li>
              <li><span aria-hidden="true">2</span>Write your ad and set a bid, from $1 per 500 verified impressions</li>
              <li><span aria-hidden="true">3</span>We review it, then it runs - you pay only for verified views</li>
            </ol>
          </>
        ) : (
          <>
            <div className="auth-context-copy">
              <h2>One account.<br /><span>More possibilities.</span></h2>
              <p>A place for your ideas, your earnings, and what comes next.</p>
            </div>
            <ul className="auth-context-list">
              <li><span aria-hidden="true">&#10003;</span>Earnings stay attached to you</li>
              <li><span aria-hidden="true">&#10003;</span>Campaigns continue across devices</li>
              <li><span aria-hidden="true">&#10003;</span>No payment card required</li>
            </ul>
          </>
        )}
        <p className="auth-context-note">Built for the way you work. Web + desktop.</p>
      </section>

      <section
        className="auth-form-panel"
        aria-labelledby={`${panelId}-heading`}
      >
        <header className="auth-form-heading">
          <p className="auth-eyebrow" key={mode}>{mode === "in" ? "WELCOME BACK" : "MAKE YOURSELF AT HOME"}</p>
          <HeadingTag id={`${panelId}-heading`}>{mode === "in" ? heading : advertiser ? "Start advertising" : "Create your account"}</HeadingTag>
          <p>Choose how you&apos;d like to {mode === "in" ? "continue." : "get started."}</p>
        </header>
        <div className="auth-mode" data-mode={mode} role="tablist" aria-label="Account action" onKeyDown={onTabKey}>
          <button
            ref={signInTab}
            id={signInTabId}
            type="button"
            role="tab"
            aria-controls={panelId}
            aria-selected={mode === "in"}
            tabIndex={mode === "in" ? 0 : -1}
            disabled={busy !== null}
            onClick={() => chooseMode("in")}
          >
            Sign in
          </button>
          <button
            ref={createTab}
            id={createTabId}
            type="button"
            role="tab"
            aria-controls={panelId}
            aria-selected={mode === "up"}
            tabIndex={mode === "up" ? 0 : -1}
            disabled={busy !== null}
            onClick={() => chooseMode("up")}
          >
            Create account
          </button>
        </div>
        <div id={panelId} role="tabpanel" aria-labelledby={mode === "in" ? signInTabId : createTabId} aria-busy={busy !== null}>
        {error !== null && (
          <div className="notice auth-error" data-tone="error" role="alert">{error}</div>
        )}

        <div className="provider-stack">
          <button
            type="button"
            className="btn btn-provider"
            disabled={busy !== null}
            onClick={() => void run("github", signInGithub)}
          >
            <GithubMark />
            {busy === "github" ? "Opening GitHub..." : "Continue with GitHub"}
            <span className={busy === "github" ? "auth-spinner" : "auth-provider-arrow"} aria-hidden="true">{busy === "github" ? null : <Icon node={ArrowUpRight} />}</span>
          </button>
          <button
            type="button"
            className="btn btn-provider"
            disabled={busy !== null}
            onClick={() => void run("google", signInGoogle)}
          >
            <GoogleMark />
            {busy === "google" ? "Opening Google..." : "Continue with Google"}
            <span className={busy === "google" ? "auth-spinner" : "auth-provider-arrow"} aria-hidden="true">{busy === "google" ? null : <Icon node={ArrowUpRight} />}</span>
          </button>
        </div>

        <p className="auth-divider"><span>or continue with email</span></p>

        <form className="auth-email-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor={`${panelId}-email`}>Email</label>
            <input
              id={`${panelId}-email`}
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              disabled={busy !== null}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor={`${panelId}-password`}>Password</label>
            <div className="auth-password-field">
              <input
                id={`${panelId}-password`}
                className="input"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                minLength={mode === "up" ? 6 : undefined}
                required
                disabled={busy !== null}
                aria-describedby={`${panelId}-password-hint`}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="auth-password-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((shown) => !shown)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <p className="auth-password-hint" id={`${panelId}-password-hint`}>{mode === "up" ? "Use at least 6 characters." : "Use the password linked to your account."}</p>
          </div>

          <button type="submit" className="btn btn-primary auth-submit" disabled={busy !== null}>
            {busy === "email" && <span className="auth-spinner" aria-hidden="true" />}
            {busy === "email"
              ? mode === "in" ? "Signing in..." : "Creating account..."
              : mode === "in" ? "Sign in" : "Create account"}
            {busy === null && <span className="auth-submit-arrow" aria-hidden="true"><Icon node={ArrowRight} /></span>}
          </button>
        </form>
        <p className="sr-only" role="status">{busy === "email" ? mode === "in" ? "Signing in…" : "Creating account…" : busy ? `Opening ${busy === "github" ? "GitHub" : "Google"}…` : ""}</p>
        </div>
        <p className="auth-privacy">Your account. Your control.<br /><Link href="/privacy">Privacy policy</Link><span aria-hidden="true"> · </span><Link href="/terms">Terms of service</Link></p>
      </section>
    </div>
  );
}

/* Inline provider marks avoid a logo-CDN request during authentication. */
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
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}
