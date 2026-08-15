import { describe, it, expect, beforeEach } from "vitest";
import { createAssetCache, type AssetCache } from "../src/assetCache.ts";
import { FakeClock, FakeFileStore, FakeHttpTransport } from "./fakes.ts";

const HOST = "cdn.adcode.test";
const ASSET = `https://${HOST}/sentry-light.png`;

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

let http: FakeHttpTransport;
let store: FakeFileStore;
let cache: AssetCache;

beforeEach(() => {
  http = new FakeHttpTransport([], { bytes: png, headers: { "content-type": "image/png" } });
  store = new FakeFileStore();
  cache = createAssetCache({ http, store, clock: new FakeClock(), allowedHost: HOST });
});

describe("fetching", () => {
  it("fetches an allowlisted asset and returns its bytes", async () => {
    const result = await cache.get(ASSET);

    expect(result.ok).toBe(true);
    if (result.ok) expect([...result.value]).toEqual([...png]);
  });

  it("fetches once and serves the second call from the store", async () => {
    // §1: assets are "fetched and cached by us. Never hot-linked from advertiser
    // servers." Re-fetching per impression would leak a request per view.
    await cache.get(ASSET);
    await cache.get(ASSET);

    expect(http.calls).toHaveLength(1);
  });

  it("serves from a store populated by an earlier run", async () => {
    await cache.get(ASSET);

    const revived = createAssetCache({
      http: new FakeHttpTransport(),
      store,
      clock: new FakeClock(),
      allowedHost: HOST,
    });

    const result = await revived.get(ASSET);
    expect(result.ok).toBe(true);
  });

  it("reports whether an asset is already cached", async () => {
    expect(await cache.has(ASSET)).toBe(false);
    await cache.get(ASSET);
    expect(await cache.has(ASSET)).toBe(true);
  });
});

describe("host and scheme rules", () => {
  it("refuses a host that merely suffixes the allowed host", async () => {
    const result = await cache.get(`https://evil-${HOST}/a.png`);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("disallowed-host");
    expect(http.calls).toHaveLength(0);
  });

  it("refuses a subdomain of the allowed host", async () => {
    expect((await cache.get(`https://a.${HOST}/a.png`)).ok).toBe(false);
  });

  it("refuses plain http", async () => {
    const result = await cache.get(`http://${HOST}/a.png`);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("insecure-scheme");
  });

  it("refuses non-http schemes outright", async () => {
    expect((await cache.get("data:image/png;base64,AAAA")).ok).toBe(false);
    expect((await cache.get("file:///etc/passwd")).ok).toBe(false);
    expect((await cache.get("javascript:alert(1)")).ok).toBe(false);
  });

  it("refuses a malformed URL", async () => {
    expect((await cache.get("not a url")).ok).toBe(false);
  });

  it("never contacts the network for a rejected URL", async () => {
    await cache.get("http://evil.test/a.png");
    await cache.get("data:image/png;base64,AAAA");

    expect(http.calls).toHaveLength(0);
  });
});

describe("failure", () => {
  it("returns an error rather than throwing when the fetch fails", async () => {
    const failing = createAssetCache({
      http: new FakeHttpTransport([{ throws: new Error("offline") }]),
      store,
      clock: new FakeClock(),
      allowedHost: HOST,
    });

    const result = await failing.get(ASSET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("network");
  });

  it("returns an error on a non-200", async () => {
    const missing = createAssetCache({
      http: new FakeHttpTransport([{ status: 404, bytes: new Uint8Array(0) }]),
      store,
      clock: new FakeClock(),
      allowedHost: HOST,
    });

    expect((await missing.get(ASSET)).ok).toBe(false);
  });

  it("refuses an asset larger than the cap, without storing it", async () => {
    const huge = createAssetCache({
      http: new FakeHttpTransport([{ bytes: new Uint8Array(3_000_000) }]),
      store,
      clock: new FakeClock(),
      allowedHost: HOST,
    });

    const result = await huge.get(ASSET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("too-large");
    expect(store.files.size).toBe(0);
  });

  it("does not cache a failure - a later call can still succeed", async () => {
    const flaky = new FakeHttpTransport([{ throws: new Error("offline") }, { bytes: png }]);
    const cacheFlaky = createAssetCache({
      http: flaky,
      store,
      clock: new FakeClock(),
      allowedHost: HOST,
    });

    expect((await cacheFlaky.get(ASSET)).ok).toBe(false);
    expect((await cacheFlaky.get(ASSET)).ok).toBe(true);
  });
});

describe("cache keys", () => {
  it("gives different URLs different keys", async () => {
    await cache.get(ASSET);
    await cache.get(`https://${HOST}/sentry-dark.png`);

    expect(store.files.size).toBe(2);
    expect(http.calls).toHaveLength(2);
  });

  it("never uses the URL path as a filesystem path", async () => {
    // A creative controls this string. Writing it straight to disk would be a path
    // traversal handed to whoever can serve a creative.
    await cache.get(`https://${HOST}/../../etc/passwd.png`);

    for (const key of store.files.keys()) {
      expect(key).not.toContain("..");
      expect(key).toMatch(/^ads\/assets\/[a-z0-9]+$/);
    }
  });
});
