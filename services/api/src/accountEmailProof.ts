import { createHash, randomBytes } from "node:crypto";

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
  const page = (title: string, content: string, status = 200): Response => new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — ADCode</title><style>body{font:18px/1.6 system-ui;margin:10vh auto;padding:24px;max-width:560px;background:#111110;color:#ebe8e1}button,a{font:inherit;color:#b2d8bd}button{background:#263b2d;border:1px solid #639978;border-radius:10px;padding:12px 22px;cursor:pointer}a{display:inline-block;margin-top:20px}</style><main><h1>${title}</h1>${content}</main></html>`,{status,headers:{...headers,"content-type":"text/html; charset=utf-8"}});
  return {
    isVerified: (uid,email) => options.store.verified(uid,email.toLowerCase()),
    async send(uid,email,now) {
      const token = randomBytes(32).toString("base64url");
      const canonical = email.toLowerCase();
      if (!await options.store.issue(uid,canonical,emailProofHash(token),now+3_600_000,now)) return false;
      return options.send({uid,email:canonical,token,url:origin.origin+path+"?token="+token});
    },
    async handle(request) {
      if (!["GET","POST"].includes(request.method)) return page("Verify your email","<p>Open the verification link from your email.</p>",405);
      let token = new URL(request.url).searchParams.get("token") ?? "";
      if (request.method === "POST") {
        if (Number(request.headers.get("content-length")) > 256) return page("Invalid link","<p>Request a new verification email in ADCode.</p>",400);
        const body = await request.text();
        if (body.length > 256) return page("Invalid link","<p>Request a new verification email in ADCode.</p>",400);
        token = new URLSearchParams(body).get("token") ?? "";
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return page("Invalid link","<p>Request a new verification email in ADCode.</p>",400);
      // GET does not consume a link: email-security scanners must not verify an account.
      if (request.method === "GET") return page("Verify your email for ADCode",`<p>Confirm that this email address belongs to you. The link expires one hour after it was requested.</p><form method="post" action="${path}"><input type="hidden" name="token" value="${token}"><button type="submit">Verify my email</button></form><p>If you did not request this, close this page. No account settings have changed.</p>`);
      const result = await options.store.confirm(emailProofHash(token),(options.now ?? Date.now)());
      return result === "verified" ? page("Your email is verified",'<p>Return to ADCode and try again. If a verification notice is open, choose “I’ve verified”.</p><a href="/ai-tokens">Open your ADCode account</a>') : page("This link is no longer valid","<p>It may have expired, already been used, or your account email changed. Request a new verification email in ADCode.</p>",410);
    },
  };
}
