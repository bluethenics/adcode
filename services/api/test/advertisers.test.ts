import { describe, it, expect, beforeEach } from "vitest";
import {
  createAdvertiser,
  getMyAdvertiser,
  listCampaigns,
  createCampaign,
  setCampaignStatus,
  createCreative,
  listCreatives,
} from "../src/advertisers.ts";
import { parseCampaign, parseCreative, parseCreateAdvertiser } from "../src/contract.ts";
import { createMemoryStore } from "../src/memoryStore.ts";

let store: ReturnType<typeof createMemoryStore>;
let counter = 0;
const deps = () => ({
  store,
  clock: { now: () => 9_000 },
  ids: { next: (p: string) => `${p}-${++counter}` },
});

const CAMPAIGN = {
  name: "Rust developers, Q3",
  cpmMicros: "8000000",
  budgetMicros: "50000000",
  targetTags: ["lang:rust"],
};

const CREATIVE = {
  campaignId: "camp-2",
  advertiser: "Acme",
  headline: "Ship faster",
  body: "A tool for Rust teams",
  clickUrl: "https://acme.test/x",
  logoLight: "https://cdn.test/l.png",
  logoDark: "https://cdn.test/d.png",
};

beforeEach(() => {
  counter = 0;
  store = createMemoryStore();
});

/** Sign up, create a campaign, approve its creative. Returns the campaign id. */
async function withCampaign(uid = "u-1"): Promise<string> {
  await createAdvertiser(deps(), uid, { name: "Acme" });
  const created = await createCampaign(deps(), uid, parseCampaign(CAMPAIGN)!);
  if (!created.ok) throw new Error("campaign not created");

  const campaignId = created.value.campaignId;
  await createCreative(deps(), uid, { ...parseCreative({ ...CREATIVE, campaignId })! }, "https://api.test");

  const pending = await store.allCreativesForCampaign(campaignId);
  for (const creative of pending) {
    await store.putCreative({ ...creative, status: "approved" });
  }

  return campaignId;
}

/* ── Parsing ────────────────────────────────────────────────────────────── */

describe("parseCampaign", () => {
  it("accepts a well-formed campaign", () => {
    expect(parseCampaign(CAMPAIGN)).toEqual(CAMPAIGN);
  });

  it("refuses a CPM outside the sane band", () => {
    expect(parseCampaign({ ...CAMPAIGN, cpmMicros: "1" })).toBeNull();
    expect(parseCampaign({ ...CAMPAIGN, cpmMicros: "999999999999" })).toBeNull();
  });

  it("refuses a budget below the minimum", () => {
    expect(parseCampaign({ ...CAMPAIGN, budgetMicros: "10" })).toBeNull();
  });

  it("refuses money that is not a decimal string", () => {
    expect(parseCampaign({ ...CAMPAIGN, cpmMicros: 8_000_000 })).toBeNull();
    expect(parseCampaign({ ...CAMPAIGN, budgetMicros: "1e9" })).toBeNull();
  });

  it("drops unknown tags and de-duplicates the rest", () => {
    const parsed = parseCampaign({
      ...CAMPAIGN,
      targetTags: ["lang:rust", "lang:rust", "lang:elvish"],
    });
    expect(parsed?.targetTags).toEqual(["lang:rust"]);
  });
});

describe("parseCreative", () => {
  it("accepts a well-formed creative", () => {
    expect(parseCreative(CREATIVE)).toEqual(CREATIVE);
  });

  it("allows an absent body, which the client permits", () => {
    expect(parseCreative({ ...CREATIVE, body: null })?.body).toBeNull();
  });

  it("refuses a non-https link or logo", () => {
    expect(parseCreative({ ...CREATIVE, clickUrl: "http://acme.test/x" })).toBeNull();
    expect(parseCreative({ ...CREATIVE, logoLight: "javascript:alert(1)" })).toBeNull();
  });

  it("accepts an inline logo, which is what the portal uploads", () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    expect(parseCreative({ ...CREATIVE, logoLight: png, logoDark: png })?.logoLight).toBe(png);
  });

  it("refuses an inline logo that could carry script", () => {
    // `data:` is a URL scheme that carries a payload, and SVG and HTML payloads carry
    // script - which would run wherever the card is rendered. Only raster formats pass.
    for (const hostile of [
      "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pjwvc2NyaXB0Pjwvc3ZnPg==",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "data:image/png,<script>alert(1)</script>",
      "data:image/png;base64,not base64 at all",
    ]) {
      expect(parseCreative({ ...CREATIVE, logoLight: hostile })).toBeNull();
    }
  });

  it("refuses an inline logo past the size ceiling", () => {
    const huge = `data:image/png;base64,${"A".repeat(100_000)}`;
    expect(parseCreative({ ...CREATIVE, logoLight: huge })).toBeNull();
  });

  it("refuses text past the limits the ad client enforces", () => {
    expect(parseCreative({ ...CREATIVE, headline: "x".repeat(81) })).toBeNull();
    expect(parseCreative({ ...CREATIVE, body: "x".repeat(161) })).toBeNull();
    expect(parseCreative({ ...CREATIVE, advertiser: "x".repeat(41) })).toBeNull();
  });
});

/* ── Sign-up ────────────────────────────────────────────────────────────── */

describe("createAdvertiser", () => {
  it("creates an advertiser with nothing funded", async () => {
    const result = await createAdvertiser(deps(), "u-1", parseCreateAdvertiser({ name: "Acme" })!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Acme");
    expect(result.value.fundedMicros).toBe("0");
    expect(result.value.availableMicros).toBe("0");
  });

  it("refuses a second advertiser for the same user", async () => {
    await createAdvertiser(deps(), "u-1", { name: "Acme" });
    const again = await createAdvertiser(deps(), "u-1", { name: "Acme Two" });
    expect(again).toEqual({ ok: false, error: "already-advertiser" });
  });

  it("reports no advertiser for a user who never signed up", async () => {
    expect(await getMyAdvertiser(deps(), "u-nobody")).toEqual({ ok: false, error: "no-advertiser" });
  });

  it("refuses a suspended advertiser", async () => {
    await createAdvertiser(deps(), "u-1", { name: "Acme" });
    const record = await store.advertiserForOwner("u-1");
    await store.putAdvertiser({ ...record!, status: "suspended" });

    expect(await getMyAdvertiser(deps(), "u-1")).toEqual({ ok: false, error: "suspended" });
  });
});

/* ── Campaigns ──────────────────────────────────────────────────────────── */

describe("createCampaign", () => {
  it("creates it paused, so a fat-fingered budget cannot start spending", async () => {
    await createAdvertiser(deps(), "u-1", { name: "Acme" });
    const created = await createCampaign(deps(), "u-1", parseCampaign(CAMPAIGN)!);

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.status).toBe("paused");
    expect(created.value.budgetMicros).toBe("50000000");
    expect(created.value.spentMicros).toBe("0");
  });

  it("refuses a user with no advertiser", async () => {
    const created = await createCampaign(deps(), "u-nobody", parseCampaign(CAMPAIGN)!);
    expect(created).toEqual({ ok: false, error: "no-advertiser" });
  });
});

describe("listCampaigns", () => {
  it("returns only this advertiser's campaigns", async () => {
    await withCampaign("u-1");
    await withCampaign("u-2");

    const mine = await listCampaigns(deps(), "u-1");
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    expect(mine.value).toHaveLength(1);
  });
});

describe("setCampaignStatus", () => {
  it("refuses to activate without funding", async () => {
    const campaignId = await withCampaign();
    const activated = await setCampaignStatus(deps(), "u-1", campaignId, "active");
    expect(activated).toEqual({ ok: false, error: "insufficient-funds" });
  });

  it("refuses to activate with no approved creative", async () => {
    await createAdvertiser(deps(), "u-1", { name: "Acme" });
    const created = await createCampaign(deps(), "u-1", parseCampaign(CAMPAIGN)!);
    if (!created.ok) return;

    const advertiser = await store.advertiserForOwner("u-1");
    await store.putAdvertiser({ ...advertiser!, fundedMicros: 100_000_000n });

    const activated = await setCampaignStatus(deps(), "u-1", created.value.campaignId, "active");
    expect(activated).toEqual({ ok: false, error: "no-approved-creative" });
  });

  it("activates and reserves the budget once funded", async () => {
    const campaignId = await withCampaign();
    const advertiser = await store.advertiserForOwner("u-1");
    await store.putAdvertiser({ ...advertiser!, fundedMicros: 100_000_000n });

    const activated = await setCampaignStatus(deps(), "u-1", campaignId, "active");
    expect(activated.ok).toBe(true);

    const after = await getMyAdvertiser(deps(), "u-1");
    if (!after.ok) return;
    expect(after.value.reservedMicros).toBe("50000000");
    expect(after.value.availableMicros).toBe("50000000");
  });

  it("stops two campaigns promising the same dollar", async () => {
    const first = await withCampaign();
    const advertiser = await store.advertiserForOwner("u-1");
    await store.putAdvertiser({ ...advertiser!, fundedMicros: 60_000_000n });

    await setCampaignStatus(deps(), "u-1", first, "active");

    const second = await createCampaign(deps(), "u-1", parseCampaign(CAMPAIGN)!);
    if (!second.ok) return;
    await createCreative(deps(), "u-1", parseCreative({ ...CREATIVE, campaignId: second.value.campaignId })!, "https://api.test");
    for (const creative of await store.allCreativesForCampaign(second.value.campaignId)) {
      await store.putCreative({ ...creative, status: "approved" });
    }

    const activated = await setCampaignStatus(deps(), "u-1", second.value.campaignId, "active");
    expect(activated).toEqual({ ok: false, error: "insufficient-funds" });
  });

  it("atomically stops concurrent activations from promising the same credits", async () => {
    const first = await withCampaign();
    const advertiser = await store.advertiserForOwner("u-1");
    await store.putAdvertiser({ ...advertiser!, fundedMicros: 60_000_000n });
    const second = await createCampaign(deps(), "u-1", parseCampaign(CAMPAIGN)!);
    if (!second.ok) return;
    await createCreative(
      deps(),
      "u-1",
      parseCreative({ ...CREATIVE, campaignId: second.value.campaignId })!,
      "https://api.test",
    );
    for (const creative of await store.allCreativesForCampaign(second.value.campaignId)) {
      await store.putCreative({ ...creative, status: "approved" });
    }

    const results = await Promise.all([
      setCampaignStatus(deps(), "u-1", first, "active"),
      setCampaignStatus(deps(), "u-1", second.value.campaignId, "active"),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect((await store.campaignsForAdvertiser(advertiser!.advertiserId)).filter((c) => c.status === "active"))
      .toHaveLength(1);
  });

  it("releases only the unspent budget when paused", async () => {
    const campaignId = await withCampaign();
    const advertiser = await store.advertiserForOwner("u-1");
    await store.putAdvertiser({ ...advertiser!, fundedMicros: 100_000_000n });

    await setCampaignStatus(deps(), "u-1", campaignId, "active");
    await store.addSpend(campaignId, 20_000_000n);
    await setCampaignStatus(deps(), "u-1", campaignId, "paused");

    const after = await getMyAdvertiser(deps(), "u-1");
    if (!after.ok) return;
    // 20 spent stays committed; the other 30 comes back.
    expect(after.value.reservedMicros).toBe("20000000");
    expect(after.value.availableMicros).toBe("80000000");
  });

  it("refuses to reopen an ended campaign", async () => {
    const campaignId = await withCampaign();
    await setCampaignStatus(deps(), "u-1", campaignId, "ended");
    expect(await setCampaignStatus(deps(), "u-1", campaignId, "active")).toEqual({
      ok: false,
      error: "invalid-state",
    });
  });

  it("reports another advertiser's campaign as missing, not forbidden", async () => {
    const mine = await withCampaign("u-1");
    await createAdvertiser(deps(), "u-2", { name: "Rival" });

    expect(await setCampaignStatus(deps(), "u-2", mine, "active")).toEqual({
      ok: false,
      error: "not-found",
    });
  });
});

/* ── Creatives ──────────────────────────────────────────────────────────── */

describe("createCreative", () => {
  it("submits pending, never approved", async () => {
    await createAdvertiser(deps(), "u-1", { name: "Acme" });
    const created = await createCampaign(deps(), "u-1", parseCampaign(CAMPAIGN)!);
    if (!created.ok) return;

    const creative = await createCreative(
      deps(),
      "u-1",
      parseCreative({ ...CREATIVE, campaignId: created.value.campaignId })!,
      "https://api.test",
    );

    expect(creative.ok).toBe(true);
    if (!creative.ok) return;
    expect(creative.value.status).toBe("pending");
  });

  it("gives it an id the ad client will accept", async () => {
    await createAdvertiser(deps(), "u-1", { name: "Acme" });
    const created = await createCampaign(deps(), "u-1", parseCampaign(CAMPAIGN)!);
    if (!created.ok) return;

    const creative = await createCreative(
      deps(),
      "u-1",
      parseCreative({ ...CREATIVE, campaignId: created.value.campaignId })!,
      "https://api.test",
    );
    if (!creative.ok) return;

    expect(creative.value.creativeId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it("refuses a creative for a campaign the user does not own", async () => {
    const mine = await withCampaign("u-1");
    await createAdvertiser(deps(), "u-2", { name: "Rival" });

    const creative = await createCreative(deps(), "u-2", parseCreative({ ...CREATIVE, campaignId: mine })!, "https://api.test");
    expect(creative).toEqual({ ok: false, error: "not-found" });
  });
});

describe("listCreatives", () => {
  it("shows pending ones too, so the advertiser can see what is waiting", async () => {
    await createAdvertiser(deps(), "u-1", { name: "Acme" });
    const created = await createCampaign(deps(), "u-1", parseCampaign(CAMPAIGN)!);
    if (!created.ok) return;

    await createCreative(
      deps(),
      "u-1",
      parseCreative({ ...CREATIVE, campaignId: created.value.campaignId })!,
      "https://api.test",
    );

    const listed = await listCreatives(deps(), "u-1", created.value.campaignId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]?.status).toBe("pending");
  });
});
