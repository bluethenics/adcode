import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Creative } from "../../../packages/ads/src/types.ts";
import type { Account } from "../src/account.ts";
import type { AppContext } from "../src/context.ts";
import { TerminalAds } from "../src/tui/adsChrome.ts";
import type { Key } from "../src/tui/keyboard.ts";
import { createUI } from "../src/tui/ui.ts";
import { removeDir, tempDir } from "./helpers.ts";

let dataDir = "";
let previous: string | undefined;

beforeEach(() => {
  previous = process.env["ADCODE_CLI_DATA_DIR"];
  dataDir = tempDir();
  process.env["ADCODE_CLI_DATA_DIR"] = dataDir;
});

afterEach(() => {
  if (previous === undefined) delete process.env["ADCODE_CLI_DATA_DIR"];
  else process.env["ADCODE_CLI_DATA_DIR"] = previous;
  removeDir(dataDir);
});

const CREATIVE: Creative = {
  creativeId: "creative-test-1",
  advertiser: "Test Sponsor",
  headline: "Ship the thing you meant to ship",
  body: "A real sponsored card, rendered at the bottom of a terminal screen.",
  clickUrl: "https://sponsor.example/landing",
  logoLight: "https://sponsor.example/logo-light.png",
  logoDark: "https://sponsor.example/logo-dark.png",
  ttlMs: 60_000,
};

function key(name: string, options: Partial<Key> = {}): Key {
  return { name, sequence: "", string: name, ctrl: false, meta: false, shift: false, ...options };
}

function fakeContext(options: { adsEnabled?: boolean; noAds?: boolean } = {}): AppContext {
  return {
    flags: { noAds: options.noAds ?? false, json: false },
    config: {
      theme: "midnight",
      motion: false,
      unicode: true,
      model: null,
      ads: { enabled: options.adsEnabled ?? true, preset: "standard" },
    },
    account: {
      tokens: { getToken: async () => null, invalidate: () => undefined },
    } as unknown as Account,
    stdout: { write: () => true } as unknown as NodeJS.WriteStream,
    workspaceSignals: () => ({ languageIds: ["typescript"], filenames: ["index.ts"] }),
    adThemeKind: () => "dark",
  } as unknown as AppContext;
}

describe("the sponsored card never takes the keyboard", () => {
  it("renders inside the terminal width and lets ordinary keys through", async () => {
    const ads = new TerminalAds(fakeContext());
    const ui = createUI({ theme: "midnight", color: false, unicode: true, width: 40, height: 30 });

    expect(ads.lines(ui)).toEqual([]);
    expect(ads.reserve).toBe(0);

    ads.runtime.renderer.present(CREATIVE, "dark");
    expect(ads.active).toBe(true);
    expect(ads.reserve).toBe(8);

    const lines = ads.lines(ui);
    expect(lines.length).toBeGreaterThan(4);
    expect(lines.join("\n")).toContain("Test Sponsor");
    expect(lines.join("\n")).toContain("Ship the thing you meant to ship");
    expect(lines.join("\n")).toContain("ctrl+o");
    expect(lines.join("\n")).toContain("ctrl+x");
    for (const line of lines) expect(ui.visibleWidth(line)).toBeLessThanOrEqual(40);

    // Typing, escape and enter belong to the screen underneath. Only the two advertised
    // control chords are consumed.
    expect(ads.handleKey(key("a"))).toBe(false);
    expect(ads.handleKey(key("escape"))).toBe(false);
    expect(ads.handleKey(key("return"))).toBe(false);
    expect(ads.active).toBe(true);

    expect(ads.handleKey(key("x", { ctrl: true }))).toBe(true);
    expect(ads.active).toBe(false);
    expect(ads.lines(ui)).toEqual([]);
    await ads.shutdown();
  });

  it("keeps the card narrow enough for a split terminal", async () => {
    const ads = new TerminalAds(fakeContext());
    const ui = createUI({ theme: "paper", color: false, unicode: true, width: 30, height: 24 });
    ads.runtime.renderer.present(CREATIVE, "light");

    for (const line of ads.lines(ui)) expect(ui.visibleWidth(line)).toBeLessThanOrEqual(30);
    expect(ads.handleKey(key("x", { ctrl: true }))).toBe(true);
    await ads.shutdown();
  });

  it("shows nothing at all when ads are off for this run", async () => {
    const ads = new TerminalAds(fakeContext({ adsEnabled: true, noAds: true }));
    const ui = createUI({ theme: "midnight", color: false, unicode: true, width: 60, height: 30 });

    ads.runtime.renderer.present(CREATIVE, "dark");
    expect(ads.active).toBe(false);
    expect(ads.lines(ui)).toEqual([]);
    expect(ads.handleKey(key("x", { ctrl: true }))).toBe(false);
    await ads.shutdown();
  });

  it("dismisses through the same path the auto-dismiss timer uses", async () => {
    const ads = new TerminalAds(fakeContext());
    ads.runtime.renderer.present(CREATIVE, "dark");
    expect(ads.active).toBe(true);
    ads.dismiss();
    expect(ads.active).toBe(false);
    await ads.shutdown();
  });
});
