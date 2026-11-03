/**
 * An account's live state at Firebase, read with the person's own ID token.
 *
 * Why the API asks Firebase rather than trusting the token alone: an ID token's
 * `email_verified` claim is a snapshot from when the token was minted, and desktops refresh
 * theirs about once an hour. Someone who opens the verification link would otherwise stay
 * refused for up to an hour after doing exactly what they were told. `accounts:lookup` with
 * their own token reads the account as it is now, from Google, so it is as trustworthy as the
 * token itself - and it can only ever describe the account the token belongs to.
 *
 * `sendVerification` asks Firebase to send its own verification email (from the project's
 * Firebase sender, with Firebase's link) to the address on that account. Nothing here chooses an
 * address: it is always the one Firebase holds for the token's account.
 *
 * Both calls use the project's public web API key, the same one every browser holds.
 */
export interface AccountIdentity {
  lookup(idToken: string): Promise<{ email: string | null; emailVerified: boolean } | null>;
  sendVerification(idToken: string): Promise<boolean>;
  testVerification?(idToken: string): Promise<{ sent: boolean; reason: string | null }>;
}

const IDENTITY_TOOLKIT = "https://identitytoolkit.googleapis.com/v1/accounts:";

export function createFirebaseIdentity(apiKey: () => string, fetchImpl: typeof fetch = fetch): AccountIdentity {
  const post = (method: "lookup" | "sendOobCode", body: Record<string, unknown>): Promise<Response> =>
    fetchImpl(`${IDENTITY_TOOLKIT}${method}?key=${encodeURIComponent(apiKey())}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
  const testVerification = async (idToken: string): Promise<{ sent: boolean; reason: string | null }> => {
    if (!apiKey().trim()) return { sent: false, reason: "NOT_CONFIGURED" };
    try {
      const response = await post("sendOobCode", { requestType: "VERIFY_EMAIL", idToken });
      if (response.ok) return { sent: true, reason: null };
      const data = await response.json() as { error?: { message?: unknown } };
      const code = typeof data.error?.message === "string" ? data.error.message.split(/[ :]/)[0] ?? "" : "";
      return { sent: false, reason: /^[A-Z][A-Z_]{0,79}$/.test(code) ? code : `HTTP_${response.status}` };
    } catch { return { sent: false, reason: "UNREACHABLE" }; }
  };
  return {
    testVerification,
    async lookup(idToken) {
      if (apiKey().length === 0) return null;
      try {
        const response = await post("lookup", { idToken });
        if (!response.ok) return null;
        const data = await response.json() as { users?: { email?: unknown; emailVerified?: unknown; providerUserInfo?: { email?: unknown }[] }[] };
        const user = data.users?.[0];
        if (user === undefined) return null;
        const own = typeof user.email === "string" && user.email.length > 0 ? user.email.toLowerCase() : null;
        if (own !== null) return { email: own, emailVerified: user.emailVerified === true };
        // Reported (2.4.10, 1 November 2026): GitHub sign-ins whose account carried no top-level
        // email could never verify - there was no address to send the link to. The provider's
        // address is only where ADCode's own link is sent; opening that link is still the proof.
        const provided = user.providerUserInfo?.map((info) => info.email).find((email): email is string => typeof email === "string" && email.includes("@"));
        return { email: provided?.toLowerCase() ?? null, emailVerified: false };
      } catch {
        return null;
      }
    },
    async sendVerification(idToken) {
      return (await testVerification(idToken)).sent;
    },
  };
}
