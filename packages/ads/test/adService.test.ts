import { describe, it, expect, beforeEach } from "vitest";
import { createAdService, type AdService, type AdServiceDeps } from "../src/adService.ts";
import { createReceiptQueue } from "../src/receiptQueue.ts";
import { createAdRenderer } from "../src/renderer.ts";
import { MIN_DWELL_MS, PRESETS, SETTLE_MS, micros, type Creative } from "../src/types.ts";
import {
  FakeClock,
  FakeFileStore,
  FakeIdeSignals,
  FakeNotificationSink,
  FakeTokenProvider,
} from "./fakes.ts";

const creative: Creative = {
  creativeId: "cr-1",
  advertiser: "Sentry",
  headline: "catch errors before users",
  body: null,
  clickUrl: "https://sentry.io/",
  logoLight: "https://cdn.adcode.test/light.png",
  logoDark: "https://cdn.adcode.test/dark.png",
  ttlMs: 600_000,
};

function stubClient(overrides: Partial<AdServiceDeps["client"]> = {}): AdServiceDeps["client"] {
  return {
    serve: async () => ({ ok: true, value: [creative] }),
    postReceipts: async (receipts) => ({ ok: true, value: receipts.map((r) => r.receiptId) }),
    balance: async () => ({
      ok: true,
      value: { availableMicros: micros(1_500n), lifetimeMicros: micros(1_500n) },
    }),
    config: async () => ({
      ok: true,
      value: {
        killSwitch: false,
        caps: {},
        projections: {
          off: micros(0n),
          light: micros(40_000n),
          standard: micros(90_000n),
          max: micros(210_000n),
        },
      },
    }),
    ...overrides,
  };
}

let clock: FakeClock;
let sink: FakeNotificationSink;
let ide: FakeIdeSignals;
let store: FakeFileStore;

function build(overrides: Partial<AdServiceDeps> = {}): AdService {
  const queue = createReceiptQueue({ store });
  const renderer = createAdRenderer({
    sink,
    clock,
    onReceipt: (r) => void queue.enqueue(r),
  });

  return createAdService({
    clock,
    ide,
    queue,
    renderer,
    client: stubClient(),
    tokens: new FakeTokenProvider(),
    assets: { get: async () => ({ ok: true, value: new Uint8Array([1]) }), has: async () => true },
    settings: { adsEnabled: true, preset: "standard" },
    ...overrides,
  });
}

beforeEach(() => {
  clock = new FakeClock();
  sink = new FakeNotificationSink();
  ide = new FakeIdeSignals();
  store = new FakeFileStore();
});

describe("failure containment", () => {
  // Brief §9, the governing rule: "the ad client may fail in any way. The worst
  // permitted outcome is that the user sees no ad." Nothing below may throw.

  it("contains a client that throws on every call", async () => {
    const exploding = stubClient({
      serve: async () => {
        throw new Error("boom");
      },
      config: async () => {
        throw new Error("boom");
      },
      balance: async () => {
        throw new Error("boom");
      },
      postReceipts: async () => {
        throw new Error("boom");
      },
    });
    const service = build({ client: exploding });

    await expect(service.start()).resolves.toBeUndefined();
    clock.advance(SETTLE_MS + 1);
    await expect(service.tick()).resolves.toBeUndefined();

    expect(sink.shown).toHaveLength(0);
  });

  it("contains a renderer that throws", async () => {
    const service = build({
      renderer: {
        present: () => {
          throw new Error("render failed");
        },
        onThemeChange: () => {},
        onPainted: () => {},
        onFocusChange: () => {},
        click: () => null,
        dismiss: () => {},
        isShowing: () => false,
      },
    });

    await service.start();
    clock.advance(SETTLE_MS + 1);
    await expect(service.tick()).resolves.toBeUndefined();
  });

  it("contains IDE signals that throw", async () => {
    const hostile = new FakeIdeSignals();
    hostile.windowFocused = () => {
      throw new Error("ipc died");
    };

    const service = build({ ide: hostile });
    await service.start();
    clock.advance(SETTLE_MS + 1);

    await expect(service.tick()).resolves.toBeUndefined();
    expect(sink.shown).toHaveLength(0);
  });

  it("contains a queue that throws", async () => {
    const service = build({
      queue: {
        enqueue: async () => {
          throw new Error("disk full");
        },
        all: async () => {
          throw new Error("disk full");
        },
        ack: async () => {},
        size: async () => 0,
        load: async () => {
          throw new Error("disk full");
        },
      },
    });

    await expect(service.start()).resolves.toBeUndefined();
    await expect(service.tick()).resolves.toBeUndefined();
  });
});

describe("scheduling", () => {
  it("shows nothing during the 60s settle period", async () => {
    const service = build();
    await service.start();

    clock.advance(SETTLE_MS - 1);
    await service.tick();
    expect(sink.shown).toHaveLength(0);

    clock.advance(2);
    await service.tick();
    expect(sink.shown).toHaveLength(1);
  });

  it("respects the minimum interval between impressions", async () => {
    const service = build();
    await service.start();
    clock.advance(SETTLE_MS + 1);

    await service.tick();
    expect(sink.shown).toHaveLength(1);
    service.onPainted();
    clock.advance(MIN_DWELL_MS);
    service.dismiss();

    clock.advance(PRESETS.standard.minIntervalMs - MIN_DWELL_MS - 1);
    await service.tick();
    expect(sink.shown).toHaveLength(1);

    clock.advance(2);
    await service.tick();
    expect(sink.shown).toHaveLength(2);
  });

  it("shows nothing when the window is unfocused", async () => {
    const service = build();
    await service.start();
    clock.advance(SETTLE_MS + 1);

    ide.focused = false;
    await service.tick();

    expect(sink.shown).toHaveLength(0);
    expect(service.lastReason()).toBe("window-unfocused");
  });

  it("shows nothing while a debug session is active", async () => {
    const service = build();
    await service.start();
    clock.advance(SETTLE_MS + 1);

    ide.debugging = true;
    await service.tick();

    expect(service.lastReason()).toBe("debug-active");
  });

  it("shows nothing when ads are switched off in settings", async () => {
    const service = build({ settings: { adsEnabled: false, preset: "standard" } });
    await service.start();
    clock.advance(SETTLE_MS + 1);
    await service.tick();

    expect(service.lastReason()).toBe("ads-disabled");
    expect(sink.shown).toHaveLength(0);
  });
});

describe("remote config", () => {
  it("tightens local caps but never loosens them", async () => {
    const tightening = stubClient({
      config: async () => ({
        ok: true,
        value: {
          killSwitch: false,
          // Hostile: a far looser interval and a much larger cap.
          caps: { minIntervalMs: 1, dailyCap: 9999 },
          projections: {
            off: micros(0n),
            light: micros(1n),
            standard: micros(1n),
            max: micros(1n),
          },
        },
      }),
    });

    const service = build({ client: tightening });
    await service.start();

    expect(service.effectiveCaps().minIntervalMs).toBe(PRESETS.standard.minIntervalMs);
    expect(service.effectiveCaps().dailyCap).toBe(PRESETS.standard.dailyCap);
  });

  it("honours the remote kill switch", async () => {
    const killed = stubClient({
      config: async () => ({
        ok: true,
        value: {
          killSwitch: true,
          caps: {},
          projections: {
            off: micros(0n),
            light: micros(1n),
            standard: micros(1n),
            max: micros(1n),
          },
        },
      }),
    });

    const service = build({ client: killed });
    await service.start();
    clock.advance(SETTLE_MS + 1);
    await service.tick();

    expect(service.lastReason()).toBe("kill-switch");
    expect(sink.shown).toHaveLength(0);
  });
});

describe("receipts", () => {
  it("flushes the queue and acks what the server confirmed", async () => {
    const queue = createReceiptQueue({ store });
    const renderer = createAdRenderer({ sink, clock, onReceipt: (r) => void queue.enqueue(r) });
    const service = build({ queue, renderer });

    await service.start();
    clock.advance(SETTLE_MS + 1);
    await service.tick();

    service.onPainted();
    clock.advance(MIN_DWELL_MS);
    service.dismiss();
    expect(await queue.size()).toBe(1);

    await service.flushReceipts();
    expect(await queue.size()).toBe(0);
  });

  it("keeps receipts queued when the flush fails", async () => {
    const queue = createReceiptQueue({ store });
    const renderer = createAdRenderer({ sink, clock, onReceipt: (r) => void queue.enqueue(r) });
    const service = build({
      queue,
      renderer,
      client: stubClient({
        postReceipts: async () => ({ ok: false, error: { kind: "network", detail: "offline" } }),
      }),
    });

    await service.start();
    clock.advance(SETTLE_MS + 1);
    await service.tick();
    service.onPainted();
    clock.advance(MIN_DWELL_MS);
    service.dismiss();

    await service.flushReceipts();
    expect(await queue.size()).toBe(1);
  });
});

describe("prefetch", () => {
  it("does not call serve on every tick once it holds inventory", async () => {
    let serveCalls = 0;
    const counting = stubClient({
      serve: async () => {
        serveCalls += 1;
        return { ok: true, value: [creative, { ...creative, creativeId: "cr-2" }] };
      },
    });

    const service = build({ client: counting });
    await service.start();
    clock.advance(SETTLE_MS + 1);

    await service.tick();
    await service.tick();
    await service.tick();

    expect(serveCalls).toBe(1);
  });
});
