"use client";

import { useEffect, useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth, authMessage, firebaseConfigured } from "@/lib/firebase";
import { AuthAscii } from "@/components/AuthAscii";
import { Mark } from "@/components/Mark";
import { Icon } from "@/components/Icon";
import { ArrowUpRight } from "lucide";

/*
 * The page the desktop app opens in your browser when you press Continue with Google.
 *
 * It is a handoff, not a marketing page: one decision, one button, and the job is done. It
 * used to sit between the site's navigation and its full footer, which turned a five-second
 * task into a 1172px page with a dozen ways to leave it. The nav and the footer are hidden
 * here (see the `.desktop-handoff` rule in auth.css) and the card is the same one the website
 * uses to sign in, so arriving from the app does not feel like landing on another product.
 *
 * The logic below is unchanged on purpose: the state parameter is still required, the idToken
 * still returns by a form POST to the loopback port, and the token never goes in a URL.
 */
export function DesktopSignIn() {
  const [callback, setCallback] = useState<{ port: string; state: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), port = params.get("port") ?? "", state = params.get("state") ?? "";
    if (/^\d{4,5}$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535 && /^[a-f0-9]{64}$/.test(state)) setCallback({ port, state });
    else setError("Open sign-in from the ADCode desktop app to continue.");
  }, []);
  async function signIn() {
    if (!callback || busy) return;
    setBusy(true); setError("");
    try {
      const result = await signInWithPopup(auth(), new GoogleAuthProvider());
      const idToken = GoogleAuthProvider.credentialFromResult(result)?.idToken;
      if (!idToken) throw new Error("Google did not return a sign-in credential. Please try again.");
      const form = document.createElement("form"); form.method = "POST"; form.action = `http://127.0.0.1:${callback.port}/google-complete`;
      for (const [name, value] of Object.entries({ state: callback.state, idToken })) {
        const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.append(input);
      }
      document.body.append(form); form.submit();
    } catch (cause) { setError(authMessage(cause)); setBusy(false); }
  }

  // A link without valid parameters is the app's own message, not a Google failure.
  const expired = callback === null;
  const canSignIn = callback !== null && firebaseConfigured;

  return (
    <div className="auth-screen desktop-handoff">
      <div className="wrap">
        <div className="ios-card auth-card auth-workspace auth-upgrade" data-state={expired ? "expired" : busy ? "busy" : error ? "error" : "ready"}>
          <section className="auth-context" aria-label="Signing in to ADCode desktop">
            <div className="auth-brand">
              <span className="auth-brand-mark" aria-hidden="true"><Mark size={30} /></span>
              <span>ADCode</span>
              <span className="auth-brand-caption">Account connection</span>
            </div>
            <AuthAscii />
            <div className="auth-context-copy">
              <h2>
                {expired ? "Start again." : "Almost there."}
                <br />
                <span>{expired ? "The link was single use." : "Finish in this tab."}</span>
              </h2>
              <p>
                {expired
                  ? "This page only listens while ADCode is waiting for it. Press Continue with Google in the app and a fresh tab opens here."
                  : "Google approves the account here. ADCode is waiting in the background, and this tab closes itself once the connection lands."}
              </p>
            </div>
            {!expired && (
              <ol className="auth-context-list auth-context-steps">
                <li><span aria-hidden="true">1</span>Pick the Google account you use for ADCode</li>
                <li><span aria-hidden="true">2</span>Approve it on Google&apos;s screen</li>
                <li><span aria-hidden="true">3</span>Return to ADCode, already signed in</li>
              </ol>
            )}
            <p className="auth-context-note">ADCode never sees your password. Only a short-lived token returns to the app you started from.</p>
          </section>

          <section className="auth-form-panel" aria-labelledby="handoff-heading">
            <header className="auth-form-heading">
              <p className="auth-eyebrow">ADCode desktop</p>
              <h1 id="handoff-heading">{expired ? "This sign-in link has expired." : "Sign in to your workspace."}</h1>
              <p>
                {expired
                  ? "A link only works for the sign-in that created it, and only while that sign-in is waiting. Start again from ADCode and this page reopens by itself."
                  : "Continue with the Google account you use for ADCode. Nothing to install, no password to remember."}
              </p>
            </header>

            {expired ? (
              <div className="auth-handoff-panel">
                <p className="auth-handoff-label">To get a fresh link</p>
                <ol className="auth-handoff-list">
                  <li>Open the ADCode desktop app.</li>
                  <li>Choose <strong>Continue with Google</strong> in the sign-in window.</li>
                  <li>Keep the tab that opens here, and approve it there.</li>
                </ol>
                <p className="auth-handoff-alt">No ADCode on this computer yet? <a href="/versions">Download it</a>, or <a href="/">see what it does</a>.</p>
              </div>
            ) : (
              <div className="provider-stack">
                <button type="button" className="btn btn-provider auth-provider-primary" disabled={busy || !canSignIn} onClick={() => void signIn()}>
                  <GoogleMark />
                  {busy ? "Connecting to ADCode..." : "Continue with Google"}
                  <span className={busy ? "auth-spinner" : "auth-provider-arrow"} aria-hidden="true">{busy ? null : <Icon node={ArrowUpRight} />}</span>
                </button>
              </div>
            )}

            {!firebaseConfigured && <p className="auth-error notice" role="alert">Browser sign-in is temporarily unavailable. Use GitHub in ADCode, or contact support.</p>}
            {error !== "" && !expired && <p className="auth-error notice" role="alert">{error}</p>}

            <p className="sr-only" role="status">{busy ? "Waiting for Google, then connecting to ADCode…" : ""}</p>
            <p className="auth-privacy">
              {busy ? "Leave this open until ADCode confirms. It usually takes a moment." : "Your account. Your control."}
              <br /><a href="/privacy">Privacy policy</a><span aria-hidden="true"> · </span><a href="/terms">Terms of service</a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

/* Inline mark, so signing in never waits on a logo CDN. */
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
