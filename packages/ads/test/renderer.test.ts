import { describe, it, expect, beforeEach } from "vitest";
import { createAdRenderer, type AdRenderer } from "../src/renderer.ts";
import { AUTO_DISMISS_MS, MIN_DWELL_MS, type Creative, type Receipt } from "../src/types.ts";
import { FakeClock, FakeNotificationSink } from "./fakes.ts";

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

let sink: FakeNotificationSink;
let clock: FakeClock;
let receipts: Receipt[];
let renderer: AdRenderer;

beforeEach(() => {
  sink = new FakeNotificationSink();
  clock = new FakeClock();
  receipts = [];
  renderer = createAdRenderer({
    sink,
    clock,
    onReceipt: (r) => receipts.push(r),
    newId: (() => {
      let n = 0;
      return () => `receipt-${++n}`;
    })(),
  });
});

describe("presentation", () => {
  it("shows the creative through the sink", () => {
    renderer.present(creative, "dark");

    expect(sink.shown).toHaveLength(1);
    expect(sink.last().advertiser).toBe("Sentry");
    expect(sink.last().headline).toBe("catch errors before users");
    expect(sink.last().autoDismissMs).toBe(AUTO_DISMISS_MS);
  });

  it("resolves the logo for the current theme", () => {
    renderer.present(creative, "dark");
    expect(sink.last().logo).toBe(creative.logoDark);

    renderer.dismiss();
    renderer.present(creative, "light");
    expect(sink.last().logo).toBe(creative.logoLight);
  });

  it("swaps the logo live when the OS theme flips mid-toast", () => {
    // §8.3: "subscribe to theme changes so a toast on screen when the OS flips at
    // sunset swaps its logo live rather than going invisible."
    renderer.present(creative, "light");
    expect(sink.last().logo).toBe(creative.logoLight);

    renderer.onThemeChange("dark");
    expect(sink.last().logo).toBe(creative.logoDark);
  });

  it("ignores a theme change when nothing is on screen", () => {
    expect(() => renderer.onThemeChange("dark")).not.toThrow();
    expect(sink.shown).toHaveLength(0);
  });
});

describe("the three-part impression rule", () => {
  // §1: "An impression requires all three: the toast actually painted, the window
  // focused for the full duration, and at least 4 seconds on screen. Anything else is
  // discarded locally and never reported."

  it("reports an impression when all three hold", () => {
    renderer.present(creative, "dark");
    renderer.onPainted();
    clock.advance(MIN_DWELL_MS);
    renderer.dismiss();

    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.outcome).toBe("impression");
    expect(receipts[0]!.dwellMs).toBe(MIN_DWELL_MS);
    expect(receipts[0]!.creativeId).toBe("cr-1");
  });

  it("reports nothing when the toast never painted", () => {
    renderer.present(creative, "dark");
    clock.advance(MIN_DWELL_MS * 2);
    renderer.dismiss();

    expect(receipts).toHaveLength(0);
  });

  it("reports nothing when dwell falls one millisecond short", () => {
    renderer.present(creative, "dark");
    renderer.onPainted();
    clock.advance(MIN_DWELL_MS - 1);
    renderer.dismiss();

    expect(receipts).toHaveLength(0);
  });

  it("reports nothing when the window lost focus during the dwell", () => {
    renderer.present(creative, "dark");
    renderer.onPainted();
    clock.advance(1_000);
    renderer.onFocusChange(false);
    clock.advance(MIN_DWELL_MS);
    renderer.dismiss();

    expect(receipts).toHaveLength(0);
  });

  it("reports nothing when focus was lost and regained - the duration must be unbroken", () => {
    renderer.present(creative, "dark");
    renderer.onPainted();
    renderer.onFocusChange(false);
    renderer.onFocusChange(true);
    clock.advance(MIN_DWELL_MS * 3);
    renderer.dismiss();

    expect(receipts).toHaveLength(0);
  });

  it("discards locally rather than reporting a rejected impression", () => {
    renderer.present(creative, "dark");
    renderer.dismiss();

    expect(receipts).toHaveLength(0);
    expect(sink.shown[0]!.dismissed).toBe(true);
  });
});

describe("clicks", () => {
  it("reports a click even when the dwell was short", () => {
    // A click is a stronger signal of attention than any dwell threshold.
    renderer.present(creative, "dark");
    renderer.onPainted();
    clock.advance(500);
    renderer.click();

    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.outcome).toBe("click");
  });

  it("hands back the click URL so the caller can open the system browser", () => {
    // §1: "Ad clicks open via the system browser, https only. Never a webview, never
    // in-editor navigation." This module returns the URL; it never navigates.
    renderer.present(creative, "dark");
    renderer.onPainted();

    expect(renderer.click()).toBe("https://sentry.io/");
  });

  it("reports at most one receipt per toast", () => {
    renderer.present(creative, "dark");
    renderer.onPainted();
    clock.advance(MIN_DWELL_MS);
    renderer.click();
    renderer.dismiss();

    expect(receipts).toHaveLength(1);
  });
});

describe("suppression at render time", () => {
  it("refuses to present in zen, full-screen, or presentation mode", () => {
    // §8.3: "a second layer beneath the scheduler, so a bug in the scheduler still
    // cannot put an ad over a demo."
    for (const mode of ["zen", "fullScreen", "presentation"] as const) {
      const guarded = createAdRenderer({
        sink,
        clock,
        onReceipt: (r) => receipts.push(r),
        isSuppressed: () => mode !== null,
      });

      guarded.present(creative, "dark");
    }

    expect(sink.shown).toHaveLength(0);
    expect(receipts).toHaveLength(0);
  });

  it("does not replace a toast that is already on screen", () => {
    renderer.present(creative, "dark");
    renderer.present({ ...creative, creativeId: "cr-2" }, "dark");

    expect(sink.shown).toHaveLength(1);
    expect(sink.last().creativeId).toBe("cr-1");
  });
});
