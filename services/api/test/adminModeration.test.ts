import { describe, it, expect, beforeEach } from "vitest";
import {
  handleListUsers,
  handleReviewQueue,
  handleSetCreativeStatus,
  handleQueueTestServe,
  handleSavePost,
  handleListPosts,
  parsePost,
} from "../src/admin.ts";
import { handleServe } from "../src/serve.ts";
import { handleReceipts } from "../src/receipts.ts";
import { createMemoryStore } from "../src/memoryStore.ts";

let store: ReturnType<typeof createMemoryStore>;
let counter = 0;
const NOW = 50_000;

const adminDeps = () => ({ store, clock: { now: () => NOW } });
const serveDeps = () => ({
  store,
  clock: { now: () => NOW },
  ids: { next: (p: string) => `${p}-${++counter}` },
});

beforeEach(async () => {
  counter = 0;
  store = createMemoryStore();

  await store.putCampaign({
    campaignId: "camp-1",
    advertiserId: "adv-1",
    name: "Test campaign",
    createdAt: 0,
    cpmMicros: 8_000_000n,
    budgetMicros: 1_000_000n,
    targetTags: ["lang:rust"],
    // Paused on purpose: a test serve must work even when the campaign cannot serve.
    status: "paused",
  });
  await store.putCreative({
    creativeId: "c-1",
    campaignId: "camp-1",
    advertiser: "Acme",
    headline: "Ship faster",
    body: null,
    clickUrl: "https://acme.test/x",
    logoLight: "https://cdn.test/l.png",
    logoDark: "https://cdn.test/d.png",
    status: "pending",
  });
});

describe("handleListUsers", () => {
  it("lists users and audits the read", async () => {
    await store.putUser({ uid: "u-1", status: "active", createdAt: 1 });
    await store.putUser({ uid: "u-2", status: "banned", createdAt: 2 });

    const page = await handleListUsers(adminDeps(), "admin-1", { limit: 10, cursor: null });
    expect(page.rows).toHaveLength(2);
    expect((await store.listAudit())[0]?.action).toBe("read-users");
  });
});

describe("creative review", () => {
  it("shows pending creatives in the queue", async () => {
    const queue = await handleReviewQueue(adminDeps(), "admin-1");
    expect(queue.map((c) => c.creativeId)).toEqual(["c-1"]);
  });

  it("approving takes it out of the queue and into serving", async () => {
    await handleSetCreativeStatus(adminDeps(), "admin-1", "c-1", "approved");

    expect(await handleReviewQueue(adminDeps(), "admin-1")).toHaveLength(0);
    expect(await store.creativesForCampaign("camp-1")).toHaveLength(1);
  });

  it("rejecting keeps it out of serving", async () => {
    await handleSetCreativeStatus(adminDeps(), "admin-1", "c-1", "rejected");
    expect(await store.creativesForCampaign("camp-1")).toHaveLength(0);
  });

  it("audits who decided, against the campaign", async () => {
    await handleSetCreativeStatus(adminDeps(), "admin-1", "c-1", "approved");
    const audit = await store.listAudit();
    expect(audit.some((a) => a.action === "creative:approved:c-1" && a.adminUid === "admin-1")).toBe(true);
  });

  it("reports a creative that does not exist", async () => {
    expect(await handleSetCreativeStatus(adminDeps(), "admin-1", "nope", "approved")).toBeNull();
  });
});

describe("test serves", () => {
  it("serves the queued creative even though its campaign is paused", async () => {
    await handleQueueTestServe(adminDeps(), "admin-1", "u-1", "c-1");

    const res = await handleServe(serveDeps(), "u-1", { tags: [], themeKind: "dark", count: 1 });
    expect(res.creatives.map((c) => c.creativeId)).toEqual(["c-1"]);
  });

  it("ignores targeting - a test must not depend on the tester's tags", async () => {
    await handleQueueTestServe(adminDeps(), "admin-1", "u-1", "c-1");

    const res = await handleServe(serveDeps(), "u-1", { tags: ["lang:php"], themeKind: "dark", count: 1 });
    expect(res.creatives).toHaveLength(1);
  });

  it("fires exactly once", async () => {
    await handleQueueTestServe(adminDeps(), "admin-1", "u-1", "c-1");

    await handleServe(serveDeps(), "u-1", { tags: [], themeKind: "dark", count: 1 });
    const second = await handleServe(serveDeps(), "u-1", { tags: [], themeKind: "dark", count: 1 });
    expect(second.creatives).toHaveLength(0);
  });

  it("goes only to the targeted user", async () => {
    await handleQueueTestServe(adminDeps(), "admin-1", "u-1", "c-1");

    const other = await handleServe(serveDeps(), "u-2", { tags: [], themeKind: "dark", count: 1 });
    expect(other.creatives).toHaveLength(0);
  });

  it("credits nobody and bills nobody", async () => {
    await handleQueueTestServe(adminDeps(), "admin-1", "u-1", "c-1");
    await handleServe(serveDeps(), "u-1", { tags: [], themeKind: "dark", count: 1 });

    const acked = await handleReceipts(serveDeps(), "u-1", {
      receipts: [
        {
          receiptId: "r-test",
          creativeId: "c-1",
          shownAt: NOW - 3_000,
          dwellMs: 4_200,
          themeKind: "dark",
          outcome: "impression",
        },
      ],
    });

    expect(acked.acked).toEqual(["r-test"]);
    expect((await store.getBalance("u-1")).availableMicros).toBe(0n);
    expect(await store.getSpend("camp-1")).toBe(0n);
  });

  it("writes no ledger row for a test", async () => {
    await handleQueueTestServe(adminDeps(), "admin-1", "u-1", "c-1");
    await handleServe(serveDeps(), "u-1", { tags: [], themeKind: "dark", count: 1 });
    await handleReceipts(serveDeps(), "u-1", {
      receipts: [
        {
          receiptId: "r-test",
          creativeId: "c-1",
          shownAt: NOW - 3_000,
          dwellMs: 4_200,
          themeKind: "dark",
          outcome: "impression",
        },
      ],
    });

    const page = await store.listEntries("u-1", { limit: 10, cursor: null });
    expect(page.rows).toHaveLength(0);
  });

  it("refuses to queue a creative that does not exist", async () => {
    expect(await handleQueueTestServe(adminDeps(), "admin-1", "u-1", "nope")).toEqual({
      ok: false,
      error: "not-found",
    });
  });
});

describe("blog posts", () => {
  const post = {
    slug: "hello-world",
    title: "Hello world",
    description: "A first post.",
    body: "## Heading\n\nSome text.",
    status: "published" as const,
  };

  it("accepts a well-formed post", () => {
    expect(parsePost(post)).toEqual(post);
  });

  it("refuses a slug that would break a URL", () => {
    expect(parsePost({ ...post, slug: "Hello World" })).toBeNull();
    expect(parsePost({ ...post, slug: "hello/world" })).toBeNull();
    expect(parsePost({ ...post, slug: "-leading" })).toBeNull();
  });

  it("refuses an unknown status", () => {
    expect(parsePost({ ...post, status: "live" })).toBeNull();
  });

  it("saves and lists a post", async () => {
    await handleSavePost(adminDeps(), "admin-1", post);
    const all = await handleListPosts(adminDeps(), "admin-1");
    expect(all.map((p) => p.slug)).toEqual(["hello-world"]);
  });

  it("keeps drafts out of the public list", async () => {
    await handleSavePost(adminDeps(), "admin-1", { ...post, slug: "draft-one", status: "draft" });
    await handleSavePost(adminDeps(), "admin-1", post);

    const publicPosts = await store.listPosts({ publishedOnly: true });
    expect(publicPosts.map((p) => p.slug)).toEqual(["hello-world"]);
  });

  it("stamps publishedAt on first publish and keeps it afterwards", async () => {
    const first = await handleSavePost(adminDeps(), "admin-1", post);
    expect(first.publishedAt).toBe(NOW);

    const later = { ...adminDeps(), clock: { now: () => NOW + 90_000 } };
    const second = await handleSavePost(later, "admin-1", { ...post, title: "Hello world, edited" });

    // Editing a live post does not restamp its publication date.
    expect(second.publishedAt).toBe(NOW);
    expect(second.updatedAt).toBe(NOW + 90_000);
  });

  it("keeps the original author when someone else edits", async () => {
    await handleSavePost(adminDeps(), "admin-1", post);
    const edited = await handleSavePost(adminDeps(), "admin-2", { ...post, title: "Edited" });
    expect(edited.authorUid).toBe("admin-1");
  });
});
