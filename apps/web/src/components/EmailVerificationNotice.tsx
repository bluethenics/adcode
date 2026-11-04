"use client";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { requestEmailVerification, type EmailVerificationResult } from "@/lib/firebase";

export function EmailVerificationNotice() {
  const { user } = useAuth();
  const [result, setResult] = useState<EmailVerificationResult | null>(null), [busy, setBusy] = useState(false), [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    setResult(null);
    if (!user?.email || user.emailVerified) return;
    let active = true;
    const listener = (event: Event) => { if (active) setResult((event as CustomEvent<EmailVerificationResult>).detail); };
    window.addEventListener("adcode-email-verification", listener);
    void requestEmailVerification(user, false).then(value => { if (active) setResult(value); }).catch(() => { if (active) setResult({ message: "Your email needs verification. Request a link below." }); });
    return () => { active = false; window.removeEventListener("adcode-email-verification", listener); };
  }, [user]);
  useEffect(() => { if (cooldown <= 0) return; const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value-1)),1000); return () => clearTimeout(timer); }, [cooldown]);
  async function run(send: boolean) {
    if (!user || busy) return; setBusy(true);
    try { const value = await requestEmailVerification(user,send); setResult(value); setCooldown(value.retryAfter ?? 0); }
    catch { setResult({ message: "Verification could not connect. Please try again." }); }
    finally { setBusy(false); }
  }
  if (!user?.email || user.emailVerified || result?.verified) return null;
  return <aside className="verification-notice" aria-label="Email verification">
    <div><strong>Verify your email for free AI</strong><p role="status">{result?.message ?? `Open the ADCode verification link sent to ${user.email}, then check again. If it's missing, request a new link.`}</p></div>
    <div className="verification-actions"><button className="button small" disabled={busy || cooldown > 0} onClick={() => void run(true)}>{cooldown > 0 ? `Resend in ${cooldown}s` : "Send verification link"}</button><button className="button small" disabled={busy} onClick={() => void run(false)}>I've verified</button></div>
  </aside>;
}
