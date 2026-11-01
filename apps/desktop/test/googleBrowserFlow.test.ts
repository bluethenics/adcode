import { expect, it } from "vitest";
import { browserGoogleFlow } from "../src/main/googleBrowserFlow.ts";

it.each(["https://adcode.bluethenics.com","null"])("accepts a state-bound form POST with browser Origin %s", async acceptedOrigin => {
  let ready!: (url: string) => void;
  const opened = new Promise<string>(resolve => { ready = resolve; });
  const result = browserGoogleFlow({ origin: "https://adcode.bluethenics.com", open: async url => { ready(url); }, cancellation: () => {}, timeoutMs: 5000 });
  const url = new URL(await opened), callback = `http://127.0.0.1:${url.searchParams.get("port")}/google-complete`;
  const post = (state: string, origin: string) => fetch(callback, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ state, idToken: "header.payload.signature" }) });
  expect((await post("wrong", url.origin)).status).toBe(400);
  expect((await post("wrong", "null")).status).toBe(400);
  expect((await post(url.searchParams.get("state")!, "https://attacker.test")).status).toBe(400);
  const response = await post(url.searchParams.get("state")!, acceptedOrigin);
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("header.payload.signature");
  expect(await result).toEqual({ ok: true, provider: "google.com", idToken: "header.payload.signature" });
  expect(url.searchParams.has("idToken")).toBe(false);
});

it("cancels browser sign-in without leaving a callback listener running", async () => {
  let cancel: (() => void) | null = null, ready!: () => void;
  const opened = new Promise<void>(resolve => { ready = resolve; });
  const result = browserGoogleFlow({ origin: "https://adcode.bluethenics.com", open: async () => { ready(); }, cancellation: callback => { cancel = callback; }, timeoutMs: 1000 });
  await opened; (cancel as (() => void) | null)?.();
  expect(await result).toEqual({ ok: false, reason: "Sign-in cancelled." });
  expect(cancel).toBeNull();
});
