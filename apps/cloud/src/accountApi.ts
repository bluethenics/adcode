import type { Env } from "./env.ts";

const READ = new Set(["/v1/config", "/v1/balance", "/v1/ledger", "/v1/activity", "/v1/referrals", "/v1/payouts", "/v1/payout-corridors", "/v1/email-preferences", "/v1/ai/tagflow/config", "/v1/ai/tagflow/usage", "/v1/ai/tagflow/audience"]);
export function accountApiAllowed(path: string, method: string): boolean {
  if (path === "/v1/ai/account/verification") return method === "GET" || method === "POST";
  if (method === "GET") return READ.has(path);
  if (method === "PATCH") return path === "/v1/referrals" || path === "/v1/email-preferences";
  if (method === "POST") return ["/v1/serve", "/v1/receipts", "/v1/referrals/claim", "/v1/payouts/profile", "/v1/withdrawals", "/v1/ai/tagflow/chat/completions", "/v1/ai/tagflow/feedback", "/v1/ai/tagflow/audience"].includes(path) || /^\/v1\/withdrawals\/[a-zA-Z0-9_-]+\/cancel$/.test(path);
  return false;
}

/** Only the API's generated artwork keys; never a caller-supplied network destination. */
export async function forwardAdAsset(request: Request, env: Env, key: string): Promise<Response> {
  if (request.method !== "GET" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(key) || key.includes("..")) return new Response("Not found", { status: 404 });
  try {
    const response = await env.ACCOUNT_API.fetch(new Request(`https://adcode.bluethenics.com/assets/${key}`, { redirect: "manual", signal: request.signal }));
    const type = response.headers.get("content-type") ?? "";
    if (response.status !== 200 || !["image/png", "image/jpeg", "image/webp"].includes(type.split(";")[0]!.trim()) || Number(response.headers.get("content-length")) > 2_000_000) {
      await response.body?.cancel();
      return new Response("Artwork unavailable", { status: 404 });
    }
    return new Response(response.body, { headers: { "content-type": type, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
  } catch { return new Response("Artwork unavailable", { status: 503 }); }
}

/** The existing API authenticates the same Firebase token; no coding sandbox is involved. */
export async function forwardAccountApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!accountApiAllowed(url.pathname, request.method)) return Response.json({ error: "not-found" }, { status: 404 });
  const headers = new Headers();
  for (const name of ["authorization", "content-type", "accept", "x-adcode-ai-source", "x-adcode-ai-persona", "x-adcode-paid-credits"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("x-adcode-platform", "web");
  try {
    const forwarded = new Request(`https://adcode.bluethenics.com${url.pathname}${url.search}`, request);
    const response = await env.ACCOUNT_API.fetch(new Request(forwarded, { headers, redirect: "manual" }));
    if (response.status >= 300 && response.status < 400) return Response.json({ error: "provider-unavailable" }, { status: 502 });
    const outgoing = new Headers({ "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    for (const name of ["x-adcode-request-id", "retry-after"]) {
      const value = response.headers.get(name);
      if (value !== null) outgoing.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch {
    return Response.json({ error: "provider-unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
