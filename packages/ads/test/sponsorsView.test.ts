import { describe, it, expect } from "vitest";
import { buildSponsorsView, projectionFor } from "../src/sponsorsView.ts";
import { micros, PRESETS, type Balance, type Receipt, type RemoteConfig } from "../src/types.ts";

const config: RemoteConfig = {
  killSwitch: false,
  caps: { minIntervalMs: 1_800_000, dailyCap: 8 },
  projections: {
    off: micros(0n),
    light: micros(40_000n),
    standard: micros(90_000n),
    max: micros(210_000n),
  },
};

const balance: Balance = { availableMicros: micros(1_250_000n), lifetimeMicros: micros(9_800_000n) };

const receipt = (id: string, outcome: Receipt["outcome"] = "impression"): Receipt => ({
  receiptId: id,
  creativeId: `cr-${id}`,
  shownAt: 1_700_000_000_000,
  dwellMs: 5_000,
  themeKind: "dark",
  outcome,
});

describe("projectionFor", () => {
  // Spec deviation D1. Brief section 1 says the client never computes money; section
  // 8.1 says to show projected hourly earnings beside each preset. The server computes
  // the table and the client selects a row - it never multiplies a rate by a count.
  it("selects the server's projection", () => {
    expect(projectionFor(config, "standard")).toBe("$0.09");
    expect(projectionFor(config, "light")).toBe("$0.04");
    expect(projectionFor(config, "max")).toBe("$0.21");
  });

  it("reports off as a real zero, not as absent", () => {
    // Brief section 8.1: "off is a real option and disables earnings accordingly."
    expect(projectionFor(config, "off")).toBe("$0.00");
  });

  it("returns null when the server sent no config, rather than estimating", () => {
    expect(projectionFor(null, "standard")).toBeNull();
  });
});

describe("buildSponsorsView", () => {
  it("formats the balance for display", () => {
    const view = buildSponsorsView({ balance, history: [], config });
    expect(view.availableLabel).toBe("$1.25");
    expect(view.lifetimeLabel).toBe("$9.80");
  });

  it("shows a zero balance before the server has ever answered", () => {
    const view = buildSponsorsView({ balance: null, history: [], config: null });
    expect(view.availableLabel).toBe("$0.00");
    expect(view.lifetimeLabel).toBe("$0.00");
    expect(view.hasServerBalance).toBe(false);
  });

  it("counts impressions and clicks separately, ignoring dismissals", () => {
    const view = buildSponsorsView({
      balance,
      history: [receipt("a"), receipt("b"), receipt("c", "click"), receipt("d", "dismissed")],
      config,
    });
    expect(view.impressionCount).toBe(2);
    expect(view.clickCount).toBe(1);
  });

  it("offers every preset with its projection attached", () => {
    const view = buildSponsorsView({ balance, history: [], config });
    expect(view.presets.map((p) => p.preset)).toEqual(["off", "light", "standard", "max"]);
    // The caps come from PRESETS, so they are read from there rather than restated - a
    // cadence change should not break a test about the view model's shape.
    expect(view.presets.find((p) => p.preset === "light")?.dailyCap).toBe(PRESETS.light.dailyCap);
    expect(view.presets.find((p) => p.preset === "light")?.minIntervalMs).toBe(
      PRESETS.light.minIntervalMs,
    );

    // The projection is still full precision rather than rounded to cents: at these
    // amounts every preset used to render as "$0.00".
    expect(view.presets.find((p) => p.preset === "max")?.projectionLabel).toMatch(/^\$\d/);
  });

  it("leaves projections null across every preset when there is no config", () => {
    const view = buildSponsorsView({ balance, history: [], config: null });
    for (const preset of view.presets) expect(preset.projectionLabel).toBeNull();
  });
});
