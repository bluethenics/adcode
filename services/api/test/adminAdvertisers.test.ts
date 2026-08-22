import { describe, it, expect, beforeEach } from "vitest";
import {
  handleListAdvertisers,
  handleSetAdvertiserStatus,
  handlePublishNotice,
  handleRetractNotice,
  handleListNotices,
  parseNotice,
} from "../src/admin.ts";
import { getMyAdvertiser, createCampaign } from "../src/advertisers.ts";
import { parseCampaign } from "../src/contract.ts";
import { createMemoryStore } from "../src/memoryStore.ts";

const NOW = 60_000;
let store: ReturnType<typeof createMemoryStore>;
let counter = 0;

const adminDeps = () => ({ store, clock: { now: () => NOW } });
const withIds = () => ({
  store,
  clock: { now: () => NOW },
  ids: { next: (p: string) => `${p}-${++counter}` },
});

beforeEach(async () => {
  counter = 0;
  store = createMemoryStore();
  await store.putAdvertiser({
    advertiserId: "adv-1",
    name: "Acme",
    ownerUids: ["u-1"],
    status: "active",
    fundedMicros: 100_000_000n,
    reservedMicros: 0n,
    createdAt: 1,
  });
});

describe("advertiser suspension", () => {
  it("lists advertisers and audits the read", async () => {
    const list = await handleListAdvertisers(adminDeps(), "admin-1");
    expect(list.map((a) => a.advertiserId)).toEqual(["adv-1"]);
    expect((await store.listAudit())[0]?.action).toBe("read-advertisers");
  });

  it("suspends an advertiser", async () => {
    const updated = await handleSetAdvertiserStatus(adminDeps(), "admin-1", "adv-1", "suspended");
    expect(updated?.status).toBe("suspended");
  });

  it("locks a suspended advertiser out of the portal", async () => {
    await handleSetAdvertiserStatus(adminDeps(), "admin-1", "adv-1", "suspended");
    expect(await getMyAdvertiser(withIds(), "u-1")).toEqual({ ok: false, error: "suspended" });
  });

  it("stops a suspended advertiser creating campaigns", async () => {
    await handleSetAdvertiserStatus(adminDeps(), "admin-1", "adv-1", "suspended");

    const created = await createCampaign(
      withIds(),
      "u-1",
      parseCampaign({
        name: "Sneaky",
        cpmMicros: "8000000",
        budgetMicros: "50000000",
        targetTags: [],
      })!,
    );
    expect(created).toEqual({ ok: false, error: "suspended" });
  });

  it("reinstates them again", async () => {
    await handleSetAdvertiserStatus(adminDeps(), "admin-1", "adv-1", "suspended");
    await handleSetAdvertiserStatus(adminDeps(), "admin-1", "adv-1", "active");

    const found = await getMyAdvertiser(withIds(), "u-1");
    expect(found.ok).toBe(true);
  });

  it("leaves the funded balance untouched - suspension is not confiscation", async () => {
    await handleSetAdvertiserStatus(adminDeps(), "admin-1", "adv-1", "suspended");
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(100_000_000n);
  });

  it("audits who suspended whom", async () => {
    await handleSetAdvertiserStatus(adminDeps(), "admin-1", "adv-1", "suspended");
    const audit = await store.listAudit();
    expect(
      audit.some((a) => a.action === "advertiser:suspended" && a.subjectUid === "adv-1"),
    ).toBe(true);
  });

  it("reports an advertiser that does not exist", async () => {
    expect(await handleSetAdvertiserStatus(adminDeps(), "admin-1", "nope", "suspended")).toBeNull();
  });
});

describe("notices", () => {
  const notice = { severity: "warning" as const, title: "Ads are down", body: "We're on it." };

  it("accepts a well-formed notice", () => {
    expect(parseNotice(notice)).toEqual(notice);
  });

  it("refuses an unknown severity or empty text", () => {
    expect(parseNotice({ ...notice, severity: "critical" })).toBeNull();
    expect(parseNotice({ ...notice, title: "  " })).toBeNull();
    expect(parseNotice({ ...notice, body: "" })).toBeNull();
  });

  it("refuses text past the limits", () => {
    expect(parseNotice({ ...notice, title: "x".repeat(101) })).toBeNull();
    expect(parseNotice({ ...notice, body: "x".repeat(501) })).toBeNull();
  });

  it("publishes a notice that clients can see", async () => {
    await handlePublishNotice(withIds(), "admin-1", notice);
    const active = await store.listNotices({ activeOnly: true });
    expect(active.map((n) => n.title)).toEqual(["Ads are down"]);
  });

  it("retracting hides it from clients but keeps the record", async () => {
    const published = await handlePublishNotice(withIds(), "admin-1", notice);
    await handleRetractNotice(adminDeps(), "admin-1", published.noticeId);

    expect(await store.listNotices({ activeOnly: true })).toHaveLength(0);
    // The admin view still shows it: what was said, and when, stays on the record.
    expect(await handleListNotices(adminDeps(), "admin-1")).toHaveLength(1);
  });

  it("records who published and when", async () => {
    const published = await handlePublishNotice(withIds(), "admin-1", notice);
    expect(published.authorUid).toBe("admin-1");
    expect(published.createdAt).toBe(NOW);
  });

  it("reports a notice that does not exist", async () => {
    expect(await handleRetractNotice(adminDeps(), "admin-1", "nope")).toBeNull();
  });
});
