import { describe, expect, it } from "vitest";
import { cached, cachedBy, createBreaker, DatabaseUnavailableError } from "../adapters/dbGuard.ts";

describe("database guard", () => {
  it("opens after a run of gateway failures, fails fast, then lets one probe through", async () => {
    let now = 0;
    let calls = 0;
    let status = 522;
    const breaker = createBreaker(async () => { calls += 1; return new Response("", { status }); }, { timeoutMs: 1000, threshold: 3, coolDownMs: 10_000, now: () => now });
    for (let i = 0; i < 3; i++) expect((await breaker.fetch("https://db.test")).status).toBe(522);
    expect(breaker.state().open).toBe(true);
    await expect(breaker.fetch("https://db.test")).rejects.toBeInstanceOf(DatabaseUnavailableError);
    expect(calls).toBe(3);
    now = 10_001;
    status = 200;
    expect((await breaker.fetch("https://db.test")).status).toBe(200);
    expect(breaker.state()).toMatchObject({ open: false, failures: 0 });
  });

  it("counts a deadline as a failure but never the caller's own abort", async () => {
    const breaker = createBreaker((_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))), { timeoutMs: 20, threshold: 1, coolDownMs: 1000 });
    const mine = new AbortController();
    const pending = breaker.fetch("https://db.test", { signal: mine.signal });
    mine.abort();
    await expect(pending).rejects.toThrow();
    expect(breaker.state().failures).toBe(0);
    await expect(breaker.fetch("https://db.test")).rejects.toThrow();
    expect(breaker.state().open).toBe(true);
  });

  it("lets a later probe through when the last one never answered", async () => {
    // On Cloudflare a probe's own deadline dies with the request that sent it, so a probe from a
    // cancelled request may never settle - and must not hold the circuit shut for the isolate's life.
    let now = 0;
    let answer: "gateway" | "never" | "ok" = "gateway";
    const breaker = createBreaker(async () => answer === "never" ? new Promise<Response>(() => undefined) : new Response("", { status: answer === "ok" ? 200 : 522 }), { timeoutMs: 1000, threshold: 1, coolDownMs: 5000, now: () => now });
    expect((await breaker.fetch("https://db.test")).status).toBe(522);
    now = 5001; answer = "never";
    void breaker.fetch("https://db.test");
    await expect(breaker.fetch("https://db.test")).rejects.toBeInstanceOf(DatabaseUnavailableError);
    now = 6002; answer = "ok";
    expect((await breaker.fetch("https://db.test")).status).toBe(200);
  });

  it("never makes one request wait on another request's load", async () => {
    // A load another request started may never settle on Cloudflare (its request was cancelled),
    // so a request only ever shares a finished value, never an in-flight load.
    let loads = 0;
    const value = cached(async () => { loads += 1; return loads === 1 ? new Promise<number>(() => undefined) : loads; }, { ttlMs: 100, staleMs: 1000, now: () => 0 });
    void value.get();
    expect(await value.get()).toBe(2);
  });

  it("serves a fresh copy and keeps the last good value through a failure", async () => {
    let now = 0;
    let loads = 0;
    let broken = false;
    const value = cached(async () => { loads += 1; if (broken) throw new Error("down"); return loads; }, { ttlMs: 100, staleMs: 1000, now: () => now });
    expect(await value.get()).toBe(1);
    now = 50;
    expect(await value.get()).toBe(1);
    now = 200;
    broken = true;
    expect(await value.get()).toBe(1);
    now = 2000;
    await expect(value.get()).rejects.toThrow("down");
    broken = false;
    value.clear();
    expect(await value.get()).toBe(loads);
  });

  it("caches per key and forgets the oldest past its size", async () => {
    let loads = 0;
    const admins = cachedBy(async (email) => { loads += 1; return email === "a@x"; }, { ttlMs: 1000, staleMs: 1000, max: 2 });
    expect(await admins.get("a@x")).toBe(true);
    expect(await admins.get("a@x")).toBe(true);
    expect(await admins.get("b@x")).toBe(false);
    await admins.get("c@x");
    await admins.get("a@x");
    expect(loads).toBe(4);
  });
});
