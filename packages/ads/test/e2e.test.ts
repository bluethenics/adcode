import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createMockServer, type MockServer } from "../../../mock-server/src/server.ts";
import { createAdClient } from "../src/client.ts";
import { createAdRenderer } from "../src/renderer.ts";
import { createAdService } from "../src/adService.ts";
import { createAssetCache } from "../src/assetCache.ts";
import { createReceiptQueue } from "../src/receiptQueue.ts";
import { buildSponsorsView } from "../src/sponsorsView.ts";
import { MIN_DWELL_MS, SETTLE_MS } from "../src/types.ts";
import { FakeClock, FakeFileStore, FakeIdeSignals, FakeNotificationSink, FakeTokenProvider } from "./fakes.ts";
import { BridgingHttpTransport } from "./httpBridge.ts";

/**
 * The whole slice in one flow: real mock server, real client, real queue, real asset
 * cache, real scheduler and renderer. Only the IDE-facing ports are fakes, because
 * there is no IDE yet - which is the point of building this slice first.
 */
let server: MockServer;

beforeAll(async () => {
  server = await createMockServer();
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  await fetch(`${server.url}/__test__/reset`, { method: "POST" });
});

function wire() {
  const clock = new FakeClock();
  const sink = new FakeNotificationSink();
  const ide = new FakeIdeSignals();
  const store = new FakeFileStore();
  const transport = new BridgingHttpTransport([[server.publicAssetOrigin, server.assetOrigin]]);

  const client = createAdClient({
    http: transport,
    tokens: new FakeTokenProvider(),
    clock,
    baseUrl: `${server.url}/v1`,
    assetHost: server.assetHost,
  });

  const queue = createReceiptQueue({ store });
  const renderer = createAdRenderer({ sink, clock, onReceipt: (r) => void queue.enqueue(r) });
  const assets = createAssetCache({
    http: transport,
    store,
    clock,
    allowedHost: server.assetHost,
  });

  const service = createAdService({
    clock,
    ide,
    queue,
    renderer,
    client,
    assets,
    tokens: new FakeTokenProvider(),
    settings: { adsEnabled: true, preset: "standard" },
  });

  return { clock, sink, ide, store, queue, service, client, transport };
}

describe("end to end", () => {
  it("serves, shows, receipts, acks, and mirrors the balance", async () => {
    const { clock, sink, queue, service, client } = wire();

    await service.start();
    clock.advance(SETTLE_MS + 1);
    await service.tick();

    // Shown, from real inventory the mock server served.
    expect(sink.shown).toHaveLength(1);
    expect(sink.last().logo).toMatch(/^https:\/\/cdn\.adcode\.test\//);

    // Earn the impression: painted, focused throughout, past the dwell floor.
    service.onPainted();
    clock.advance(MIN_DWELL_MS);
    service.dismiss();
    expect(await queue.size()).toBe(1);

    // Flushed and acked.
    await service.flushReceipts();
    expect(await queue.size()).toBe(0);
    expect(server.receiptCount()).toBe(1);

    // The server credited it, and the client mirrors that figure rather than deriving it.
    const balance = await client.balance();
    expect(balance.ok).toBe(true);
    if (balance.ok) {
      expect(balance.value.availableMicros).toBeGreaterThan(0n);

      const view = buildSponsorsView({
        balance: balance.value,
        history: [],
        config: service.config(),
      });
      expect(view.availableLabel).toMatch(/^\$[0-9]/);
      expect(view.presets.find((p) => p.preset === "standard")?.projectionLabel).toMatch(/^\$/);
    }
  });

  it("earns nothing when the impression rule is not met", async () => {
    const { clock, sink, queue, service } = wire();

    await service.start();
    clock.advance(SETTLE_MS + 1);
    await service.tick();
    expect(sink.shown).toHaveLength(1);

    // Never painted: discarded locally, never reported.
    clock.advance(MIN_DWELL_MS * 2);
    service.dismiss();

    await service.flushReceipts();
    expect(await queue.size()).toBe(0);
    expect(server.receiptCount()).toBe(0);
  });

  it("holds receipts through an outage and flushes them on reconnect", async () => {
    // §9: "Queue to disk... Flush on reconnect. Deduped server-side by receipt ID so
    // users do not lose earnings to flaky wifi."
    const { clock, queue, service } = wire();

    await service.start();
    clock.advance(SETTLE_MS + 1);
    await service.tick();
    service.onPainted();
    clock.advance(MIN_DWELL_MS);
    service.dismiss();

    // Exactly enough failures to exhaust one flush's retry budget, so the next flush
    // meets a server that has come back - which is what "flush on reconnect" means.
    server.failNext(3, 503);
    await service.flushReceipts();
    expect(await queue.size()).toBe(1);

    await service.flushReceipts();
    expect(await queue.size()).toBe(0);
    expect(server.receiptCount()).toBe(1);
  });

  it("never shows an ad when the server pushes the kill switch", async () => {
    const { clock, sink, service } = wire();
    server.setKillSwitch(true);

    await service.start();
    clock.advance(SETTLE_MS + 1);
    await service.tick();

    expect(sink.shown).toHaveLength(0);
    expect(service.lastReason()).toBe("kill-switch");
  });

  it("survives the server being down from the very first call", async () => {
    const { clock, sink, service } = wire();
    server.failNext(100, 500);

    await expect(service.start()).resolves.toBeUndefined();
    clock.advance(SETTLE_MS + 1);
    await expect(service.tick()).resolves.toBeUndefined();

    expect(sink.shown).toHaveLength(0);
  });

  it("sends only vocabulary tags to the network", async () => {
    // The end of the privacy chain, asserted on a real request body.
    const { clock, ide, service, transport } = wire();
    ide.files = ["C:\\Users\\alice\\acme-merger\\next.config.js", "Cargo.toml"];
    ide.languages = ["typescript"];

    await service.start();
    clock.advance(SETTLE_MS + 1);
    await service.tick();

    const serveCall = transport.calls.find((c) => c.url.endsWith("/serve"));
    expect(serveCall).toBeDefined();

    const body = JSON.parse(serveCall!.body ?? "{}");
    expect(body.tags).toEqual(["fw:next", "lang:typescript", "tool:cargo"]);
    expect(serveCall!.body).not.toMatch(/alice|acme-merger|Users/);
  });
});
