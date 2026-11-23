"use client";

import { useEffect, useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth, authMessage, firebaseConfigured } from "@/lib/firebase";
import { DoneCard } from "@/components/DoneCard";

/*
 * The page the desktop app opens in your browser when you press Continue with Google.
 *
 * It is a handoff, not a marketing page: one decision, one button, and the job is done. It
 * used to sit between the site's navigation and its full footer, which turned a five-second
 * task into a 1172px page with a dozen ways to leave it. The nav and the footer are hidden
 * here (see the `.done-page` rule in auth.css) and the card is the one every ADCode success
 * and connected page uses (`components/DoneCard.tsx`), so the whole round trip, this tab and
 * the "Sign-in approved" page the app answers with, looks like one product.
 *
 * The logic below is unchanged on purpose: the state parameter is still required, the idToken
 * still returns by a form POST to the loopback port, and the token never goes in a URL.
 */
export function DesktopSignIn() {
  const [callback, setCallback] = useState<{ port: string; state: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The link is read after hydration; until then draw the ready card, not the expired one.
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), port = params.get("port") ?? "", state = params.get("state") ?? "";
    if (/^\d{4,5}$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535 && /^[a-f0-9]{64}$/.test(state)) setCallback({ port, state });
    else setError("Open sign-in from the ADCode desktop app to continue.");
    setChecked(true);
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
  const expired = checked && callback === null;
  const canSignIn = callback !== null && firebaseConfigured;
  const footer = <><a href="/privacy">Privacy policy</a><span aria-hidden="true"> · </span><a href="/terms">Terms of service</a></>;

  if (expired) {
    return (
      <DoneCard
        tone="warn"
        title="This sign-in link has expired"
        rows={[
          { label: "In ADCode", value: "Choose Continue with Google" },
          { label: "Then", value: "Approve it in the tab that opens" },
        ]}
        notes={["A link only works while ADCode is waiting for it. Start again from the app and this page reopens by itself."]}
        action={{ kind: "link", label: "Download ADCode", href: "/versions" }}
        secondary={{ label: "See what ADCode does", href: "/" }}
        footer={footer}
      />
    );
  }

  return (
    <>
      <DoneCard
        tone="info"
        title="Finish signing in to ADCode"
        rows={[
          { label: "App", value: "ADCode desktop" },
          { label: "Sign-in provider", value: "Google" },
          { label: "Returns to", value: "ADCode on this computer" },
        ]}
        notes={busy
          ? ["Leave this open until ADCode confirms. It usually takes a moment."]
          : ["If you didn't start this in the ADCode app, close this tab. ADCode never sees your password."]}
        alert={!firebaseConfigured ? "Browser sign-in is temporarily unavailable. Use GitHub in ADCode, or contact support." : error !== "" ? error : undefined}
        action={{ kind: "button", label: busy ? "Connecting to ADCode..." : <><GoogleMark />Continue with Google</>, busy, disabled: !canSignIn, onClick: () => void signIn() }}
        footer={footer}
      />
      <p className="sr-only" role="status">{busy ? "Waiting for Google, then connecting to ADCode…" : ""}</p>
    </>
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
