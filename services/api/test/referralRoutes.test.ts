import { describe, expect, it } from "vitest";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { DAY_MS } from "../src/referrals.ts";
import type { Store } from "../src/store.ts";

const START = Date.UTC(2026, 9, 1, 12);

const TOKENS: Record<string, { uid: string; claims: Record<string, unknown> }> = {
  sam: { uid: "sam", claims: { name: "Sam Tester" } },
  newbie: { uid: "newbie", claims: {} },
  other: { uid: "other", claims: {} },
  boss: { uid: "boss", claims: {} },
  owner: { uid: "owner", claims: { email: "owner@site.test", email_verified: true } },
};

function setup(storeOverride?: Store) {
  const store = createMemoryStore();
  let now = START;
  const handler = createFetchHandler({
    store: storeOverride ?? store,
    clock: { now: () => now },
    verifier: { async verify(token) { return TOKENS[token] ?? null; } },
  });
  const call = async (method: string, path: string, token: string | null, body?: unknown) => {
    const response = await handler(new Request(`https://site.test/v1${path}`, {
      method,
      headers: {
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a JSON reply, read the way a client reads it
    return { status: response.status, body: (await response.json()) as any };
  };
  const admin = async () => store.addAdmin({ email: "owner@site.test", addedBy: "setup", addedAt: 0 });
  return { store, call, admin, advance: (ms: number) => { now += ms; }, now: () => now };
}

describe("your own invite", () => {
  it("gives an account one code, the first time it asks, and the same one after", async () => {
    const { call } = setup();
    const first = await call("GET", "/referrals", "sam");
    expect(first.status).toBe(200);
    expect(first.body.code).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{7}$/);
    expect(first.body.link).toBe(`https://adcode.bluethenics.com/i/${first.body.code}`);
    expect((await call("GET", "/referrals", "sam")).body.code).toBe(first.body.code);
    expect(first.body).toMatchObject({
      showName: true,
      inviterPreview: "Sam invited you to ADCode",
      claimed: false,
      invitedBy: null,
      canClaim: true,
      claimEndsAt: START + 14 * DAY_MS,
      people: { claimed: 0, seen: 0, cameBack: 0 },
      advertisers: 0,
      earnedMicros: "0",
      last30Micros: "0",
      rates: { userPercent: 10, advertiserPercent: 5, windowDays: 365 },
    });
  });

  it("answers two racing first requests with one code", async () => {
    const { call } = setup();
    const [a, b] = await Promise.all([call("GET", "/referrals", "newbie"), call("GET", "/referrals", "newbie")]);
    expect(a.body.code).toBe(b.body.code);
  });

  it("lets the owner hide their name from their invite page", async () => {
    const { call } = setup();
    const { body } = await call("GET", "/referrals", "sam");
    const hidden = await call("PATCH", "/referrals", "sam", { showName: false });
    expect(hidden.body).toMatchObject({ showName: false, inviterPreview: "A developer invited you to ADCode" });
    expect((await call("GET", `/invite/${body.code}`, null)).body).toEqual({ valid: true, inviterName: null, kind: "user" });
    expect((await call("PATCH", "/referrals", "sam", { showName: "no" })).status).toBe(400);
  });

  it("says a developer invited you when the inviter has no name to show", async () => {
    const { call } = setup();
    expect((await call("GET", "/referrals", "other")).body.inviterPreview).toBe("A developer invited you to ADCode");
  });
});

describe("the public invite lookup", () => {
  it("names the inviter by first name only, and needs no account", async () => {
    const { call } = setup();
    const { body } = await call("GET", "/referrals", "sam");
    expect((await call("GET", `/invite/${body.code}`, null)).body).toEqual({ valid: true, inviterName: "Sam", kind: "user" });
    expect((await call("GET", `/invite/${body.code.toUpperCase()}`, null)).body.valid).toBe(true);
  });

  it("calls an unknown or switched-off code invalid, without saying why", async () => {
    const { call, admin } = setup();
    await admin();
    expect((await call("GET", "/invite/nope123", null)).body).toEqual({ valid: false, inviterName: null, kind: null });
    expect((await call("GET", "/invite/%20", null)).body.valid).toBe(false);
    await call("POST", "/admin/ref-codes", "owner", { code: "threads-oct06", label: "Threads" });
    expect((await call("GET", "/invite/threads-oct06", null)).body).toEqual({ valid: true, inviterName: null, kind: "campaign" });
    await call("POST", "/admin/ref-codes/threads-oct06", "owner", { active: false });
    expect((await call("GET", "/invite/threads-oct06", null)).body.valid).toBe(false);
  });
});

describe("claiming an invite", () => {
  async function samsCode(call: ReturnType<typeof setup>["call"]): Promise<string> {
    return (await call("GET", "/referrals", "sam")).body.code as string;
  }

  it("connects a new account to whoever invited it, from the clipboard line", async () => {
    const { call } = setup();
    const code = await samsCode(call);
    const claim = await call("POST", "/referrals/claim", "newbie", { code: `ADCode invite: ${code.toUpperCase()}`, how: "clipboard" });
    expect(claim).toEqual({ status: 200, body: { ok: true, inviterName: "Sam" } });

    expect((await call("GET", "/referrals", "newbie")).body).toMatchObject({ claimed: true, invitedBy: "Sam", canClaim: false });
    expect((await call("GET", "/referrals", "sam")).body.people.claimed).toBe(1);
  });

  it("refuses a second claim, your own code, and a code this machine's old account owned", async () => {
    const { call } = setup();
    const code = await samsCode(call);
    await call("POST", "/referrals/claim", "newbie", { code, how: "paste" });
    expect(await call("POST", "/referrals/claim", "newbie", { code, how: "paste" })).toEqual({ status: 409, body: { error: "already-claimed" } });
    expect(await call("POST", "/referrals/claim", "sam", { code, how: "paste" })).toEqual({ status: 409, body: { error: "own-code" } });
    expect(await call("POST", "/referrals/claim", "other", { code, how: "paste", heldUids: ["sam"] })).toEqual({ status: 409, body: { error: "own-code" } });
  });

  it("refuses an unknown code and a claim after the first two weeks", async () => {
    const { call, advance } = setup();
    const code = await samsCode(call);
    expect(await call("POST", "/referrals/claim", "newbie", { code: "zzzzzzz", how: "paste" })).toEqual({ status: 409, body: { error: "unknown-code" } });
    await call("GET", "/referrals", "other"); // the account is made now
    advance(14 * DAY_MS + 1);
    expect(await call("POST", "/referrals/claim", "other", { code, how: "paste" })).toEqual({ status: 409, body: { error: "too-late" } });
  });

  it("refuses a malformed claim", async () => {
    const { call } = setup();
    expect((await call("POST", "/referrals/claim", "newbie", { code: "hello there friend", how: "paste" })).status).toBe(400);
    expect((await call("POST", "/referrals/claim", "newbie", { code: "k7p4qzm", how: "portal" })).status).toBe(400);
    expect((await call("POST", "/referrals/claim", "newbie", { code: "k7p4qzm", how: "paste", heldUids: "sam" })).status).toBe(400);
    expect((await call("POST", "/referrals/claim", "newbie", { code: "k7p4qzm", how: "paste", heldUids: Array(21).fill("x") })).status).toBe(400);
  });
});

describe("advertisers who came through an invite", () => {
  it("remembers who brought a new advertiser", async () => {
    const { call, store } = setup();
    const code = (await call("GET", "/referrals", "sam")).body.code as string;
    const created = await call("POST", "/portal/advertiser", "boss", { name: "Acme", ref: code });
    expect(created.status).toBe(200);
    expect(await store.getAttribution("advertiser", created.body.advertiserId)).toMatchObject({ referrerUid: "sam", how: "portal", code });
    expect((await call("GET", "/referrals", "sam")).body.advertisers).toBe(1);
  });

  it("still signs the advertiser up when the code is bad or their own", async () => {
    const { call, store } = setup();
    const bad = await call("POST", "/portal/advertiser", "boss", { name: "Acme", ref: "nope123" });
    expect(bad.status).toBe(200);
    expect(await store.getAttribution("advertiser", bad.body.advertiserId)).toBeNull();

    const own = (await call("GET", "/referrals", "sam")).body.code as string;
    const self = await call("POST", "/portal/advertiser", "sam", { name: "Sam Co", ref: own });
    expect(self.status).toBe(200);
    expect(await store.getAttribution("advertiser", self.body.advertiserId)).toBeNull();
  });
});

describe("admin", () => {
  it("is admin only", async () => {
    const { call } = setup();
    for (const path of ["/admin/sources", "/admin/ref-codes", "/admin/referral-config"]) {
      expect((await call("GET", path, "sam")).status).toBe(403);
    }
  });

  it("makes, lists and edits campaign codes", async () => {
    const { call, admin } = setup();
    await admin();
    expect((await call("POST", "/admin/ref-codes", "owner", { code: "threads-oct06", label: "Threads post" })).body)
      .toMatchObject({ code: "threads-oct06", label: "Threads post", active: true, link: "https://adcode.bluethenics.com/i/threads-oct06" });
    expect(await call("POST", "/admin/ref-codes", "owner", { code: "threads-oct06", label: "" })).toEqual({ status: 409, body: { error: "code-taken" } });
    expect((await call("POST", "/admin/ref-codes", "owner", { code: "Bad Code", label: "" })).status).toBe(400);
    expect((await call("POST", "/admin/ref-codes/threads-oct06", "owner", { label: "Renamed" })).body.label).toBe("Renamed");
    expect((await call("POST", "/admin/ref-codes/missing1", "owner", { label: "x" })).status).toBe(404);
    expect((await call("GET", "/admin/ref-codes", "owner")).body.codes.map((c: { code: string }) => c.code)).toEqual(["threads-oct06"]);
  });

  it("reads and saves the programme's terms, refusing nonsense", async () => {
    const { call, admin } = setup();
    await admin();
    expect((await call("GET", "/admin/referral-config", "owner")).body)
      .toEqual({ userPercent: "10", advertiserPercent: "5", windowDays: 365, claimDays: 14, houseAdvertiserIds: [] });
    const next = { userPercent: "12", advertiserPercent: "4", windowDays: 180, claimDays: 7, houseAdvertiserIds: ["adv-house"] };
    expect((await call("POST", "/admin/referral-config", "owner", next)).body).toEqual(next);
    expect((await call("GET", "/referrals", "sam")).body.rates).toEqual({ userPercent: 12, advertiserPercent: 4, windowDays: 180 });
    expect((await call("POST", "/admin/referral-config", "owner", { ...next, userPercent: "60" })).status).toBe(400);
    expect((await call("POST", "/admin/referral-config", "owner", { ...next, windowDays: -1 })).status).toBe(400);
  });

  it("settles a finished day once, and refuses a day that has not ended", async () => {
    const { call, admin, store, advance } = setup();
    await admin();
    const code = (await call("GET", "/referrals", "sam")).body.code as string;
    await call("POST", "/referrals/claim", "newbie", { code, how: "paste" });
    await store.putAdvertiser({ advertiserId: "adv-o", name: "o", ownerUids: ["x"], status: "active", fundedMicros: 0n, reservedMicros: 0n, createdAt: 0 });
    await store.putCampaign({ campaignId: "camp-o", advertiserId: "adv-o", name: "o", createdAt: 0, cpmMicros: 8_000_000n, budgetMicros: 1n, targetTags: [], status: "active" });
    await store.createReceiptIfAbsent({ receiptId: "r1", uid: "newbie", creativeId: "c", campaignId: "camp-o", outcome: "impression", creditedMicros: 4000n, costMicros: 8000n, createdAt: START + 60_000 });
    advance(DAY_MS);

    expect((await call("POST", "/admin/referrals/settle", "owner", { day: "2026-10-01" })).body).toEqual({ day: "2026-10-01", referrers: 1, micros: "800" });
    expect((await call("POST", "/admin/referrals/settle", "owner", { day: "2026-10-01" })).body).toEqual({ day: "2026-10-01", referrers: 0, micros: "0" });
    expect((await call("POST", "/admin/referrals/settle", "owner", { day: "2026-10-02" })).status).toBe(400);
    expect((await call("POST", "/admin/referrals/settle", "owner", { day: "yesterday" })).status).toBe(400);
    expect((await call("GET", "/referrals", "sam")).body.earnedMicros).toBe("800");
    expect((await store.listAudit()).some((a) => a.action === "settle-referrals")).toBe(true);

    const sources = (await call("GET", "/admin/sources?days=30", "owner")).body;
    const users = sources.rows.find((r: { key: string }) => r.key === "users");
    expect(users).toMatchObject({ people: 1, adRevenueMicros: "8000", paidMicros: "800", keptMicros: "3200" });
    expect(sources.topReferrers[0]).toMatchObject({ referrerUid: "sam", code });
    expect(sources).toMatchObject({ days: 30, coverage: { attributedRealUsers: 0, realUsers: 0 } });
    expect((await call("GET", "/admin/sources?days=0", "owner")).body.days).toBe(0);
  });

  it("shows who invited a person and whom they invited", async () => {
    const { call, admin } = setup();
    await admin();
    const code = (await call("GET", "/referrals", "sam")).body.code as string;
    await call("POST", "/referrals/claim", "newbie", { code, how: "paste" });
    expect((await call("GET", "/admin/users/newbie/referrals", "owner")).body.invitedBy).toMatchObject({ referrerUid: "sam", code });
    expect((await call("GET", "/admin/users/sam/referrals", "owner")).body.invited).toHaveLength(1);
  });

  it("thanks a person for a report once, in their balance, and closes the report", async () => {
    const { call, admin, store } = setup();
    await admin();
    const report = await call("POST", "/reports", "newbie", { kind: "bug", title: "Save loses text", body: "Steps...", appVersion: "2.1.2", platform: "win32" });
    const reportId = report.body.reportId as string;
    expect((await call("POST", `/admin/reports/${reportId}/award`, "owner", { micros: "1000000" })).body).toEqual({ ok: true, micros: "1000000" });
    expect((await store.getBalance("newbie")).availableMicros).toBe(1_000_000n);
    expect(await call("POST", `/admin/reports/${reportId}/award`, "owner", { micros: "1000000" })).toEqual({ status: 409, body: { error: "already-awarded" } });
    expect((await store.listReports({ limit: 5, cursor: null })).rows[0]?.status).toBe("closed");
    expect((await call("POST", "/admin/reports/missing/award", "owner", { micros: "1000000" })).status).toBe(404);
    expect((await call("POST", `/admin/reports/${reportId}/award`, "owner", { micros: "200000000" })).status).toBe(400);
    expect((await call("POST", `/admin/reports/${reportId}/award`, "owner", { micros: "0" })).status).toBe(400);
  });
});

describe("before the migration is applied", () => {
  it("keeps every other endpoint working and says invites are unavailable", async () => {
    const base = createMemoryStore();
    const broken: Store = new Proxy(base, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        const referral = typeof key === "string" && /RefCode|refCode|Referral|referral|Attribution|attribution/.test(key);
        return referral ? async () => { throw new Error("relation \"ref_codes\" does not exist"); } : value;
      },
    });
    const { call } = setup(broken);
    expect(await call("GET", "/referrals", "sam")).toEqual({ status: 503, body: { error: "referrals-unavailable" } });
    expect((await call("GET", "/invite/k7p4qzm", null)).status).toBe(503);
    expect((await call("GET", "/balance", "sam")).status).toBe(200);
    expect((await call("GET", "/config", "sam")).status).toBe(200);
    expect((await call("POST", "/portal/advertiser", "boss", { name: "Acme", ref: "k7p4qzm" })).status).toBe(200);
  });
});
