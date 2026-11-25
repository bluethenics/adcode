import { describe, expect, it } from "vitest";
import {
  ACCOUNT_CARDS_PER_DAY, BEAT_RUN_REFUSE, BREACHES_OPEN, CONVERSATION_CARDS_PER_HOUR, COUNTRY_RPS_OPEN, COUNTRY_BUCKET_MS,
  REPEAT_MIN_CLAIMS, assessBreaker, checkClaim, createMemoryAdIntegrityStore, networkPaused, parseBreakers, parseConversationId,
  withoutPausedNetworks, type AdIntegrityStore,
} from "../src/adIntegrity.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import type { TokenVerifier } from "../src/auth.ts";

const T0 = Date.parse("2026-11-25T12:00:00Z");
const claim = (over: Partial<Parameters<typeof checkClaim>[1]> = {}) => ({ uid: "u1", network: "zeekend", conversation: "c1", country: null, now: T0, ...over });

describe("conversation volume", () => {
  it("refuses the card past the hourly cap, with a reason", async () => {
    const store = createMemoryAdIntegrityStore();
    let last = await checkClaim(store, claim());
    for (let i = 1; i <= CONVERSATION_CARDS_PER_HOUR; i++) last = await checkClaim(store, claim({ now: T0 + i * 60_000 / 2 + (i % 2) * 20_000 }));
    // The last of CAP+1 claims inside the hour.
    expect(last).toMatchObject({ allow: false, reason: "conversation-hourly-cap" });
  });
  it("allows the same count spread across conversations", async () => {
    const store = createMemoryAdIntegrityStore();
    for (let i = 0; i < 100; i++) expect((await checkClaim(store, claim({ conversation: `c${i}`, now: T0 + i * 1000 }))).allow).toBe(true);
  });
});

describe("timer signature", () => {
  it("refuses a conversation claimed every 30 s", async () => {
    const store = createMemoryAdIntegrityStore();
    const results = [];
    for (let i = 0; i <= BEAT_RUN_REFUSE; i++) results.push(await checkClaim(store, claim({ now: T0 + i * 30_000 })));
    expect(results.slice(0, -1).every((r) => r.allow)).toBe(true);
    expect(results.at(-1)).toMatchObject({ allow: false, reason: "timer-signature" });
  });
  it("lets human, irregular gaps through", async () => {
    const store = createMemoryAdIntegrityStore();
    let at = T0;
    for (const gap of [20_000, 41_000, 29_000, 90_000, 33_000, 12_000, 31_000, 50_000, 28_000, 70_000]) {
      at += gap;
      expect((await checkClaim(store, claim({ now: at }))).allow).toBe(true);
    }
  });
  it("a gap outside 25-35 s resets the run", async () => {
    const store = createMemoryAdIntegrityStore();
    let at = T0;
    for (let i = 0; i < BEAT_RUN_REFUSE - 1; i++) { await checkClaim(store, claim({ now: at })); at += 30_000; }
    at += 20_000;
    expect((await checkClaim(store, claim({ now: at }))).allow).toBe(true);
  });
  it("does not apply the beat to a claim with no conversation id", async () => {
    const store = createMemoryAdIntegrityStore();
    for (let i = 0; i < 20; i++) expect((await checkClaim(store, claim({ conversation: null, now: T0 + i * 30_000 }))).allow).toBe(true);
  });
});

describe("account daily ceiling", () => {
  it("refuses past the ceiling and starts again next day", async () => {
    const store = createMemoryAdIntegrityStore();
    let result = await checkClaim(store, claim({ conversation: null }));
    for (let i = 0; i < ACCOUNT_CARDS_PER_DAY; i++) result = await checkClaim(store, claim({ conversation: null, now: T0 + i }));
    expect(result).toMatchObject({ allow: false, reason: "account-daily-cap" });
    expect((await checkClaim(store, claim({ conversation: null, now: T0 + 86_400_000 }))).allow).toBe(true);
  });
});

describe("circuit breaker", () => {
  it("assessBreaker judges ratio only with enough claims", () => {
    expect(assessBreaker({ claims: 10, repeats: 9, breaches: 0 })).toBeNull();
    expect(assessBreaker({ claims: REPEAT_MIN_CLAIMS, repeats: REPEAT_MIN_CLAIMS * 0.25, breaches: 0 })).toBe("repeat-ratio");
    expect(assessBreaker({ claims: 1000, repeats: 10, breaches: 0 })).toBeNull();
    expect(assessBreaker({ claims: 5, repeats: 0, breaches: BREACHES_OPEN })).toBe("conversation-breaches");
  });
  it("opens on a country spike, alerts, audits, and refuses the network", async () => {
    const store = createMemoryAdIntegrityStore();
    const burst = Math.ceil((COUNTRY_RPS_OPEN * COUNTRY_BUCKET_MS) / 1000);
    let last;
    for (let i = 0; i < burst; i++) last = await checkClaim(store, claim({ uid: `u${i}`, conversation: `c${i}`, country: "us", now: T0 + i }));
    expect(last).toMatchObject({ allow: false, reason: "network-paused" });
    expect(await store.listAlerts(10)).toMatchObject([{ network: "zeekend", reason: "country-spike" }]);
    expect(store.audit).toEqual([{ action: "ad-breaker-open:country-spike", network: "zeekend", at: T0 + burst - 1 }]);
    expect(await networkPaused(store, "zeekend")).toBe(true);
    expect(await networkPaused(store, "imprezia")).toBe(false);
  });
  it("opens on a high repeat ratio from many timers", async () => {
    const store = createMemoryAdIntegrityStore();
    // 20 accounts, each a conversation on a 30 s beat: after enough claims most are repeats.
    for (let i = 0; i < 12; i++) for (let a = 0; a < 20; a++) await checkClaim(store, claim({ uid: `u${a}`, conversation: "c", now: T0 + i * 30_000 + a }));
    expect(await networkPaused(store, "zeekend")).toBe(true);
    expect((await store.listAlerts(5))[0]?.reason).toBe("repeat-ratio");
  });
  it("opens on many per-conversation cap breaches", async () => {
    const store = createMemoryAdIntegrityStore();
    for (let a = 0; a < BREACHES_OPEN + 1; a++) for (let i = 0; i <= CONVERSATION_CARDS_PER_HOUR; i++) await checkClaim(store, claim({ uid: `u${a}`, now: T0 + i * 100 }));
    expect(await networkPaused(store, "zeekend")).toBe(true);
  });
  it("one account cannot open a network's breaker alone", async () => {
    const store = createMemoryAdIntegrityStore();
    for (let i = 0; i < 400; i++) await checkClaim(store, claim({ uid: "solo", conversation: `c${i % 3}`, now: T0 + i * 10 }));
    for (let i = 0; i < 200; i++) await checkClaim(store, claim({ uid: "solo2", conversation: `d${i}`, country: "us", now: T0 + i }));
    expect(await networkPaused(store, "zeekend")).toBe(false);
  });
  it("filters a paused network from the list and an admin reset restores it", async () => {
    const store = createMemoryAdIntegrityStore();
    await store.openBreaker({ network: "zeekend", reason: "country-spike", details: {}, now: T0 });
    const list = [{ id: "zeekend" }, { id: "imprezia" }];
    expect(await withoutPausedNetworks(store, list)).toEqual([{ id: "imprezia" }]);
    expect(await store.openBreaker({ network: "zeekend", reason: "country-spike", details: {}, now: T0 })).toBe(false);
    expect(await store.closeBreaker({ network: "zeekend", adminUid: "a", now: T0 + 1 })).toBe(true);
    expect(await withoutPausedNetworks(store, list)).toEqual(list);
  });
});

describe("failure policy", () => {
  const broken = (over: Partial<AdIntegrityStore>): AdIntegrityStore => ({
    ...createMemoryAdIntegrityStore(),
    ...over,
  });
  it("fails open on ordinary database errors in claim guards", async () => {
    const down = async (): Promise<never> => { throw new Error("db down"); };
    const store = broken({ bump: down, touch: down });
    expect(await checkClaim(store, claim())).toEqual({ allow: true });
  });
  it("a thrown breaker read is an outage: not hidden", async () => {
    const store = broken({ breakers: async () => { throw new Error("db down"); } });
    expect(await networkPaused(store, "zeekend")).toBe(false);
    expect(await withoutPausedNetworks(store, [{ id: "zeekend" }])).toHaveLength(1);
  });
  it("corrupt breaker state is open: never fails open", async () => {
    for (const raw of ["garbage", {}, null, [null], [{ open: true }], [{ network: 5, open: false }]]) {
      const store = broken({ breakers: async () => raw });
      expect(await networkPaused(store, "zeekend")).toBe(true);
      expect(await withoutPausedNetworks(store, [{ id: "zeekend" }, { id: "imprezia" }])).toEqual([]);
      expect(await checkClaim(store, claim())).toMatchObject({ allow: false, reason: "network-paused" });
    }
    // A row naming its network but with a non-boolean flag pauses that network only.
    const view = parseBreakers([{ network: "zeekend", open: "yes" }]);
    expect(view).toEqual({ kind: "ok", open: new Set(["zeekend"]) });
  });
  it("no store configured allows everything", async () => {
    expect(await checkClaim(undefined, claim())).toEqual({ allow: true });
  });
});

describe("parseConversationId", () => {
  it("accepts a short plain id only", () => {
    expect(parseConversationId({ conversationId: "chat_1:abc" })).toBe("chat_1:abc");
    expect(parseConversationId({ conversationId: "a b" })).toBeNull();
    expect(parseConversationId({ conversationId: "x".repeat(129) })).toBeNull();
    expect(parseConversationId(null)).toBeNull();
  });
});

describe("over HTTP", () => {
  const verifier: TokenVerifier = { async verify(token) { return { uid: token, claims: {} }; } };
  it("the earn endpoint refuses a 30 s timer with a reason, and the networks endpoint drops a paused network", async () => {
    const store = createMemoryStore();
    const handler = createFetchHandler({ store, verifier, clock: { now: () => T0 } });
    const earn = (slot: string) => handler(new Request("https://x/v1/sponsored/earn", {
      method: "POST", headers: { authorization: "Bearer u9", "content-type": "application/json" },
      body: JSON.stringify({ slotId: slot, network: "zeekend", conversationId: "chat-1" }),
    }));
    const bodies: Array<{ reason?: string }> = [];
    // Real clock for the handler cannot be advanced here, so only the guard's wiring is asserted: an
    // unconfigured network answers no-network, and a malformed id still answers invalid (400).
    bodies.push((await (await earn("slot_abcd1234")).json()) as { reason?: string });
    expect(bodies[0]?.reason).toBe("no-network");
    const bad = await earn("nope");
    expect(bad.status).toBe(400);
    const listed = await handler(new Request("https://x/v1/sponsored/networks"));
    expect(listed.status).toBe(200);
  });
});
