import { createHash, randomBytes } from "node:crypto";
import { doneCardDocument, type DoneCardContent } from "./doneCard.ts";

export interface AccountEmailProofStore {
  verified(uid: string, email: string): Promise<boolean>;
  issue(uid: string, email: string, hash: string, expiresAt: number, now: number): Promise<boolean>;
  confirm(hash: string, now: number): Promise<"verified" | "invalid" | "expired" | "changed-account">;
}
export interface AccountEmailProof {
  isVerified?(uid: string, email: string): Promise<boolean>;
  send(uid: string, email: string, now: number): Promise<boolean>;
  handle(request: Request): Promise<Response>;
}
export const emailProofHash = (token: string): string => createHash("sha256").update(token).digest("hex");

/** Verify ADCode email ownership without relying on Firebase's shared email-delivery quota.
 * Only the hash is stored. Confirmation never changes Firebase credentials or administrator claims.
 */
export function createAccountEmailProof(options: {
  store: AccountEmailProofStore;
  origin: string;
  send: (input: { uid: string; email: string; token: string; url: string }) => Promise<boolean>;
  now?: () => number;
}): AccountEmailProof {
  const origin = new URL(options.origin);
  if (origin.protocol !== "https:") throw new Error("Verification requires HTTPS");
  const path = "/v1/ai/account/verify-email";
  const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" };
  // The shared success card (doneCard.ts), so this page looks like every other ADCode "done" page.
  const page = (content: DoneCardContent, status = 200): Response => new Response(doneCardDocument(content),{status,headers:{...headers,"content-type":"text/html; charset=utf-8"}});
  const invalid = (status: number): Response => page({ tone: "warn", title: "This link doesn’t work", notes: ["Request a new verification email in ADCode."] }, status);
  return {
    isVerified: (uid,email) => options.store.verified(uid,email.toLowerCase()),
    async send(uid,email,now) {
      const token = randomBytes(32).toString("base64url");
      const canonical = email.toLowerCase();
      if (!await options.store.issue(uid,canonical,emailProofHash(token),now+3_600_000,now)) return false;
      return options.send({uid,email:canonical,token,url:origin.origin+path+"?token="+token});
    },
    async handle(request) {
      if (!["GET","POST"].includes(request.method)) return page({ tone: "warn", title: "Verify your email", notes: ["Open the verification link from your email."] },405);
      let token = new URL(request.url).searchParams.get("token") ?? "";
      if (request.method === "POST") {
        if (Number(request.headers.get("content-length")) > 256) return invalid(400);
        const body = await request.text();
        if (body.length > 256) return invalid(400);
        token = new URLSearchParams(body).get("token") ?? "";
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return invalid(400);
      // GET does not consume a link: email-security scanners must not verify an account.
      if (request.method === "GET") return page({
        tone: "info",
        title: "Verify your email for ADCode",
        rows: [{ label: "Confirms", value: "This email address is yours" }, { label: "Link expires", value: "One hour after it was sent" }],
        notes: ["If you did not request this, close this page. No account settings have changed."],
        action: { kind: "post", label: "Verify my email", action: path, fields: { token } },
      });
      const result = await options.store.confirm(emailProofHash(token),(options.now ?? Date.now)());
      return result === "verified"
        ? page({
          title: "Your email is verified",
          rows: [{ label: "Email", value: "Verified" }, { label: "In ADCode", value: "Choose “I’ve verified”, or try again" }],
          notes: ["Return to ADCode to carry on. You can close this tab."],
          action: { kind: "link", label: "Open your ADCode account", href: "/ai-tokens" },
        })
        : page({ tone: "warn", title: "This link is no longer valid", notes: ["It may have expired, already been used, or your account email changed. Request a new verification email in ADCode."] }, 410);
    },
  };
}
