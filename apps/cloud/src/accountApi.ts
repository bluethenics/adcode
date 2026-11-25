import type { Env } from "./env.ts";

/*
 * The web version runs the desktop's own main process in the person's tab (2026-11-21), and it
 * calls the API the desktop calls - models, releases, notices, sponsored cards, usage, the
 * wallet - not only the account pages the old browser app needed. So every `/v1` path is
 * forwarded except the administrator's, which the web never needs. The API authenticates each
 * request itself, exactly as when the desktop calls it directly; this proxy adds nothing a
 * caller could not already reach at adcode.bluethenics.com, and keeps `/v1/admin` out of reach.
 */
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const API_PATH = /^\/v1\/[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,300}$/;
export function accountApiAllowed(path: string, method: string): boolean {
  if (!METHODS.has(method) || !API_PATH.test(path) || path.includes("..") || path.includes("//")) return false;
  return !(path === "/v1/admin" || path.startsWith("/v1/admin/"));
}

/** The client headers the desktop's main process sends; caller-chosen identity headers are not among them. */
const CLIENT_HEADERS = ["authorization", "content-type", "accept", "x-adcode-ai-source", "x-adcode-ai-persona", "x-adcode-paid-credits", "x-adcode-priority", "x-adcode-fallback-model", "x-adcode-account-token", "x-adcode-request-id"];

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
  for (const name of CLIENT_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null && value !== "") headers.set(name, value);
  }
  headers.set("x-adcode-platform", "web");
  try {
    const forwarded = new Request(`https://adcode.bluethenics.com${url.pathname}${url.search}`, request);
    const response = await env.ACCOUNT_API.fetch(new Request(forwarded, { headers, redirect: "manual" }));
    if (response.status >= 300 && response.status < 400) return Response.json({ error: "provider-unavailable" }, { status: 502 });
    const outgoing = new Headers({ "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    // `x-adcode-account` is how the web version's main process learns the account is banned.
    for (const name of ["x-adcode-request-id", "retry-after", "x-adcode-account"]) {
      const value = response.headers.get(name);
      if (value !== null) outgoing.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch {
    return Response.json({ error: "provider-unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
