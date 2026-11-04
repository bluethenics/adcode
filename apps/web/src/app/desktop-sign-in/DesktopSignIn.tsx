"use client";
import { useEffect, useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth, authMessage, firebaseConfigured } from "@/lib/firebase";

export function DesktopSignIn() {
  const [callback, setCallback] = useState<{ port: string; state: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
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
  return <section className="band"><div className="wrap" style={{ maxWidth: 520 }}><div className="ios-card" style={{ padding: 32 }}>
    <p className="eyebrow">ADCODE DESKTOP</p><h1>Sign in to your workspace.</h1>
    <p>Your browser handles Google sign-in. Return to ADCode after approving it to finish connecting your account.</p>
    <button className="button primary" disabled={!callback || busy || !firebaseConfigured} onClick={() => void signIn()}>{busy ? "Connecting to ADCode…" : "Continue with Google"}</button>
    {error && <p role="alert">{error}</p>}{!firebaseConfigured && <p role="alert">Browser sign-in is temporarily unavailable. Use GitHub in ADCode or contact support.</p>}
  </div></div></section>;
}
