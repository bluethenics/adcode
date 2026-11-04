import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { resultPage, RESULT_PAGE_HEADERS } from "./oauthResultPage.ts";

/** Google credentials return through a state-bound form POST, never through a URL or log. */
export function browserGoogleFlow(options: {
  origin: string; open: (url: string) => Promise<void>; cancellation: (cancel: (() => void) | null) => void; timeoutMs?: number;
}): Promise<{ ok: true; provider: "google.com"; idToken: string } | { ok: false; reason: string }> {
  const state = randomBytes(32).toString("hex"), origin = new URL(options.origin).origin;
  return new Promise(resolve => {
    let settled = false;
    const server = createServer(async (request, response) => {
      const reject = (status: number) => { response.writeHead(status, RESULT_PAGE_HEADERS); response.end("This sign-in callback is not valid. Return to the sign-in tab."); };
      // Privacy-preserving HTML form navigations send Origin:null with no-referrer.
      // The unpredictable, single-use state below remains required for every callback.
      const allowedOrigin=request.headers.origin===origin||request.headers.origin==="null";
      if (request.method !== "POST" || request.url !== "/google-complete" || !allowedOrigin || !request.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) { reject(400); return; }
      let body = "";
      try { for await (const part of request) { body += part.toString(); if (Buffer.byteLength(body) > 20_000) { reject(413); return; } } } catch { reject(400); return; }
      const data = new URLSearchParams(body), token = data.get("idToken");
      if (data.get("state") !== state || token === null || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) || token.length > 16_000) { reject(400); return; }
      response.writeHead(200, RESULT_PAGE_HEADERS);
      response.end(resultPage("Sign-in approved", "Return to ADCode to finish connecting your account.", true), () => finish({ ok: true, provider: "google.com", idToken: token }));
    });
    const finish = (result: { ok: true; provider: "google.com"; idToken: string } | { ok: false; reason: string }) => {
      if (settled) return; settled = true; clearTimeout(timer); options.cancellation(null); server.close(); server.closeAllConnections(); resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "Sign-in timed out. Please try again." }), options.timeoutMs ?? 180_000);
    options.cancellation(() => finish({ ok: false, reason: "Sign-in cancelled." }));
    server.on("error", () => finish({ ok: false, reason: "Could not open the sign-in callback. Please try again." }));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address(); if (!address || typeof address === "string") return;
      const url = new URL("/desktop-sign-in", origin); url.searchParams.set("port", String(address.port)); url.searchParams.set("state", state);
      void options.open(url.href).catch(() => finish({ ok: false, reason: "Could not open your browser. Please try again." }));
    });
  });
}
