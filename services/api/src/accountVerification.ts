import { authenticate, bearerFrom, type AuthDeps } from "./auth.ts";
import type { AccountIdentity } from "./accountIdentity.ts";
import type { AccountEmailProof } from "./accountEmailProof.ts";
import { corsHeaders } from "./cors.ts";

interface VerificationDependencies extends AuthDeps { identity?: AccountIdentity; emailProof?: AccountEmailProof }

/** A user-controlled resend path, independent of whether AI models are configured. */
export async function accountVerification(request: Request, deps: VerificationDependencies): Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { ...corsHeaders(request.headers.get("origin") ?? undefined), "cache-control": "no-store" } });
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Use GET to check verification or POST to send a link." },405);
  try {
    const auth = await authenticate(deps, request.headers.get("authorization") ?? undefined);
    if (!auth.ok) return json({ message: "Sign in before verifying your email." },401);
    const token = bearerFrom(request.headers.get("authorization") ?? undefined), identity = deps.identity;
    if (!token || !identity) return json({ message: "Email verification is temporarily unavailable. Please try again shortly." },503);
    const live = await identity.lookup(token);
    if (!live) return json({ message: "Your verification status could not be checked. Please try again." },503);
    const stored = await deps.store.getUser(auth.uid);
    if (live.emailVerified || (stored?.emailVerified === true && stored.email === live.email) || (live.email !== null && await deps.emailProof?.isVerified?.(auth.uid,live.email))) {
      const user = await deps.store.getUser(auth.uid);
      if (user && live.email) await deps.store.putUser({ ...user, email: live.email, emailVerified: true });
      return json({ verified: true, sent: false, email: live.email, retryAfter: 0, message: "Your email is verified. You can use free AI now." });
    }
    if (!live.email) return json({ verified: false, sent: false, message: "Add an email or sign in with Google before verifying this account." },409);
    if (request.method === "GET") return json({ verified: false, sent: false, email: live.email, retryAfter: 0, message: "Verify your email to use free AI. Open the ADCode verification link in your inbox, or request a new one." });
    const now = deps.clock.now(), gap = 60_000;
    if (!await deps.store.claimVerificationSend(auth.uid, now, gap)) return json({ verified: false, sent: false, retryAfter: 60, message: "A verification link was requested recently. Check spam or junk, or try again in a minute." },429);
    const result = deps.emailProof ? { sent: await deps.emailProof.send(auth.uid,live.email,now), reason: null } : identity.testVerification ? await identity.testVerification(token) : { sent: await identity.sendVerification(token), reason: null };
    if (!result.sent) {
      await deps.store.retryFailedVerificationSend(auth.uid, now, 60_000, gap);
      // Codes only. Never log the email address, ID token, link, or provider response body.
      console.warn("Verification email not accepted", { code: result.reason ?? "DELIVERY_FAILED" });
      return json({ verified: false, sent: false, retryAfter: 60, message: result.reason === "QUOTA_EXCEEDED" || result.reason === "TOO_MANY_ATTEMPTS_TRY_LATER" ? "The email service is temporarily limiting verification messages. Wait a minute and try again, or use Google sign-in to verify your address." : "The verification email could not be sent. Please try again in a minute." },503);
    }
    return json({ verified: false, sent: true, email: live.email, retryAfter: 60, message: `A verification link was sent to ${live.email}. Check spam or junk too. After opening it, choose “I've verified”.` });
  } catch { return json({ message: "Email verification is temporarily unavailable. Please try again shortly." },503); }
}
