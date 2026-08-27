import { describe, it, expect, beforeEach } from "vitest";
import { assetKey, assetUrl, isDataUrl, isSafeAssetKey, parseDataUrl } from "../src/assets.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { createAdvertiser, createCampaign, createCreative } from "../src/advertisers.ts";
import { handleRehostAssets } from "../src/admin.ts";
import { parseCampaign, parseCreative } from "../src/contract.ts";

/**
 * Artwork storage, and the failure it exists to prevent.
 *
 * The rule these tests defend is not a style preference: a `data:` logo in the creatives
 * row made `/v1/serve` cost ~3,089ms against the editor's 3,000ms timeout, and the editor
 * rejects the value even when it arrives. Both are silent - the server records a serve
 * either way - so nothing but an assertion on the stored value catches a regression here.
 */

// A real 1x1 PNG, so the content type is not merely asserted but genuinely decodable.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_1X1}`;

describe("parseDataUrl", () => {
  it("decodes a png data URL to real bytes", () => {
    const parsed = parseDataUrl(PNG_DATA_URL);
    expect(parsed).not.toBeNull();
    expect(parsed?.contentType).toBe("image/png");
    // The PNG magic number: proof it decoded rather than merely matched a regex.
    expect([...(parsed?.bytes.slice(0, 4) ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("refuses svg, which can execute script wherever the card is drawn", () => {
    expect(parseDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBeNull();
  });

  it("refuses anything that is not one of the three raster types", () => {
    expect(parseDataUrl("data:text/html;base64,PGgxPmhpPC9oMT4=")).toBeNull();
    expect(parseDataUrl("data:application/javascript;base64,YWxlcnQoMSk=")).toBeNull();
  });

  it("refuses a plain https URL, which is already hosted", () => {
    expect(parseDataUrl("https://cdn.test/logo.png")).toBeNull();
  });
});

describe("asset keys", () => {
  it("names a key after the creative, so resubmitting replaces its own artwork", () => {
    expect(assetKey("cr-1", "light", "image/png")).toBe("cr-1-light.png");
    expect(assetKey("cr-1", "dark", "image/webp")).toBe("cr-1-dark.webp");
  });

  it("builds a URL on the service's own origin", () => {
    expect(assetUrl("https://api.test", "cr-1-light.png")).toBe(
      "https://api.test/assets/cr-1-light.png",
    );
  });

  /** Keys come back over the network on the read path, so traversal is a real concern. */
  it("accepts only filenames, never a path", () => {
    expect(isSafeAssetKey("cr-1-light.png")).toBe(true);
    expect(isSafeAssetKey("../../../etc/passwd")).toBe(false);
    expect(isSafeAssetKey("a/b.png")).toBe(false);
    expect(isSafeAssetKey("cr-1-light.svg")).toBe(false);
    expect(isSafeAssetKey("cr-1-light")).toBe(false);
  });
});

describe("isDataUrl", () => {
  it("tells a stored logo that needs moving from one that does not", () => {
    expect(isDataUrl(PNG_DATA_URL)).toBe(true);
    expect(isDataUrl("https://api.test/assets/cr-1-light.png")).toBe(false);
  });
});

/* ── Through the advertiser path ────────────────────────────────────────── */

let store: ReturnType<typeof createMemoryStore>;
let counter = 0;
const deps = () => ({
  store,
  clock: { now: () => 1_000 },
  ids: { next: (p: string) => `${p}-${++counter}` },
});

const ORIGIN = "https://api.test";

const CAMPAIGN = {
  name: "Acme · Aug",
  cpmMicros: "8000000",
  budgetMicros: "100000000",
  targetTags: [],
};

async function campaign(): Promise<string> {
  await createAdvertiser(deps(), "u-1", { name: "Acme" });
  const created = await createCampaign(deps(), "u-1", parseCampaign(CAMPAIGN)!);
  if (!created.ok) throw new Error("campaign not created");
  return created.value.campaignId;
}

beforeEach(() => {
  counter = 0;
  store = createMemoryStore();
});

describe("createCreative", () => {
  it("stores the artwork and puts a short https URL in the row", async () => {
    const campaignId = await campaign();

    const created = await createCreative(
      deps(),
      "u-1",
      parseCreative({
        campaignId,
        advertiser: "Acme",
        headline: "Ship faster",
        body: null,
        clickUrl: "https://acme.test/",
        logoLight: PNG_DATA_URL,
        logoDark: PNG_DATA_URL,
      })!,
      ORIGIN,
    );

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // The whole point: nothing `data:`-shaped survives into the row.
    expect(created.value.logoLight.startsWith("https://api.test/assets/")).toBe(true);
    expect(created.value.logoDark.startsWith("https://api.test/assets/")).toBe(true);

    // Comfortably under the editor's 2,048-character cap, which the 31 kB original was not.
    expect(created.value.logoLight.length).toBeLessThan(2048);

    const stored = await store.getCreative(created.value.creativeId);
    expect(stored?.logoLight).toBe(created.value.logoLight);
    expect(isDataUrl(stored?.logoLight ?? "")).toBe(false);
  });

  it("keeps the bytes, addressable by the key in the URL", async () => {
    const campaignId = await campaign();

    const created = await createCreative(
      deps(),
      "u-1",
      parseCreative({
        campaignId,
        advertiser: "Acme",
        headline: "Ship faster",
        body: null,
        clickUrl: "https://acme.test/",
        logoLight: PNG_DATA_URL,
        logoDark: PNG_DATA_URL,
      })!,
      ORIGIN,
    );
    if (!created.ok) return;

    const key = created.value.logoLight.slice(`${ORIGIN}/assets/`.length);
    const asset = await store.getAsset(key);

    expect(asset).not.toBeNull();
    expect(asset?.contentType).toBe("image/png");
    expect([...(asset?.bytes.slice(0, 4) ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("leaves an already-hosted https logo alone", async () => {
    const campaignId = await campaign();

    const created = await createCreative(
      deps(),
      "u-1",
      parseCreative({
        campaignId,
        advertiser: "Acme",
        headline: "Ship faster",
        body: null,
        clickUrl: "https://acme.test/",
        logoLight: "https://cdn.test/light.png",
        logoDark: "https://cdn.test/dark.png",
      })!,
      ORIGIN,
    );
    if (!created.ok) return;

    expect(created.value.logoLight).toBe("https://cdn.test/light.png");
  });
});

describe("handleRehostAssets", () => {
  it("repairs a row that was written with its artwork inline", async () => {
    const campaignId = await campaign();

    // A row as the old code wrote them - straight to the store, bypassing createCreative.
    await store.putCreative({
      creativeId: "cr-legacy",
      campaignId,
      advertiser: "venet",
      headline: "you a founder?",
      body: null,
      clickUrl: "https://venet.test/",
      logoLight: PNG_DATA_URL,
      logoDark: PNG_DATA_URL,
      status: "approved",
    });

    const result = await handleRehostAssets(deps(), "admin-1", ORIGIN);
    expect(result.rehosted).toBe(1);

    const fixed = await store.getCreative("cr-legacy");
    expect(isDataUrl(fixed?.logoLight ?? "")).toBe(false);
    expect(fixed?.logoLight).toBe("https://api.test/assets/cr-legacy-light.png");
    expect(await store.getAsset("cr-legacy-light.png")).not.toBeNull();
  });

  it("is idempotent, so running it twice is safe", async () => {
    const campaignId = await campaign();
    await store.putCreative({
      creativeId: "cr-legacy",
      campaignId,
      advertiser: "venet",
      headline: "you a founder?",
      body: null,
      clickUrl: "https://venet.test/",
      logoLight: PNG_DATA_URL,
      logoDark: PNG_DATA_URL,
      status: "approved",
    });

    await handleRehostAssets(deps(), "admin-1", ORIGIN);
    const second = await handleRehostAssets(deps(), "admin-1", ORIGIN);

    expect(second.rehosted).toBe(0);
  });
});
