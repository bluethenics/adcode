import { describe, expect, it } from "vitest";
import {
  ASK_ON_LAUNCHES,
  decidePinPrompt,
  formatFavorites,
  parseFavorites,
  pinEligibility,
  pinPromptContent,
  withFavorite,
  type PinEnvironment,
} from "../src/main/pinPromptPolicy.ts";

const installed: PinEnvironment = {
  platform: "win32",
  packaged: true,
  portable: false,
  shortcutInstalled: true,
  dockEditable: false,
  forced: false,
};

const fresh = { launches: 1, settled: false, shownAt: [] as readonly number[] };

describe("decidePinPrompt", () => {
  it("asks on the first launch", () => {
    expect(decidePinPrompt(fresh)).toEqual({ show: true });
  });

  it("says nothing on the second launch", () => {
    const decision = decidePinPrompt({ ...fresh, launches: 2, shownAt: [1] });
    expect(decision).toEqual({ show: false, reason: "resting" });
  });

  it("asks once more on the third launch", () => {
    expect(decidePinPrompt({ ...fresh, launches: 3, shownAt: [1] })).toEqual({ show: true });
  });

  it("never asks again from the fourth launch onwards", () => {
    for (const launches of [4, 5, 40]) {
      expect(decidePinPrompt({ ...fresh, launches, shownAt: [1, 3] })).toEqual({
        show: false,
        reason: "exhausted",
      });
    }
  });

  it("stays quiet once the question is settled, even on an asking launch", () => {
    for (const launches of ASK_ON_LAUNCHES) {
      expect(decidePinPrompt({ launches, settled: true, shownAt: [] })).toEqual({
        show: false,
        reason: "settled",
      });
    }
  });

  it("asks only once within a single launch", () => {
    expect(decidePinPrompt({ ...fresh, shownAt: [1] })).toEqual({
      show: false,
      reason: "already-asked",
    });
  });

  it("treats a launch counter that never advanced as a first launch", () => {
    // A disk that cannot be written leaves the counter at 1 forever. The card is drawn
    // once and then recorded in memory, so `shownAt` is what stops the repeat.
    expect(decidePinPrompt({ ...fresh, launches: 1, shownAt: [] })).toEqual({ show: true });
    expect(decidePinPrompt({ ...fresh, launches: 1, shownAt: [1] })).toEqual({
      show: false,
      reason: "already-asked",
    });
  });
});

describe("pinPromptContent", () => {
  it("talks about the taskbar on Windows, and offers no button that pins", () => {
    const content = pinPromptContent("win32");
    expect(content?.title).toMatch(/taskbar/i);
    // Windows removed the pin verb for applications: the card can only point at the menu.
    expect(content?.pinLabel).toBeNull();
    expect(content?.steps.join(" ")).toMatch(/Pin to taskbar/);
  });

  it("talks about the Dock on macOS, and offers no button that pins", () => {
    const content = pinPromptContent("darwin");
    expect(content?.title).toMatch(/Dock/);
    expect(content?.pinLabel).toBeNull();
    expect(content?.steps.join(" ")).toMatch(/Keep in Dock/);
  });

  it("offers a button that really pins on Linux, and steps for when it cannot", () => {
    const content = pinPromptContent("linux");
    expect(content?.pinLabel).not.toBeNull();
    expect(content?.steps.length).toBeGreaterThan(0);
  });

  it("says nothing at all on a platform with no dock to speak of", () => {
    expect(pinPromptContent("freebsd" as NodeJS.Platform)).toBeNull();
  });

  it("never writes the same instruction for two different platforms", () => {
    const win = pinPromptContent("win32");
    const mac = pinPromptContent("darwin");
    expect(win?.steps).not.toEqual(mac?.steps);
  });
});

/*
 * The check that was missing, and that a real Windows install found for us: asking is only
 * honest where the answer is available. Windows hides "Pin to taskbar" entirely unless the
 * running app's AppUserModelID resolves to a Start Menu shortcut carrying the same ID, so
 * a development run and a portable build - neither of which installs one - are asked to
 * pin something the shell will not offer.
 */
describe("pinEligibility", () => {
  it("asks on an installed Windows build", () => {
    expect(pinEligibility(installed)).toEqual({ eligible: true });
  });

  it("never asks in development, on any platform", () => {
    for (const platform of ["win32", "darwin", "linux"] as NodeJS.Platform[]) {
      expect(pinEligibility({ ...installed, platform, packaged: false })).toEqual({
        eligible: false,
        reason: "unpackaged",
      });
    }
  });

  it("never asks from a portable build, which installs no shortcut to pin", () => {
    expect(pinEligibility({ ...installed, portable: true })).toEqual({
      eligible: false,
      reason: "portable",
    });
  });

  it("never asks on Windows without the Start Menu shortcut", () => {
    // Without it the AppUserModelID resolves to nothing and the shell drops the entry.
    expect(pinEligibility({ ...installed, shortcutInstalled: false })).toEqual({
      eligible: false,
      reason: "no-shortcut",
    });
  });

  it("asks on a packaged macOS build, which needs no shortcut", () => {
    expect(
      pinEligibility({ ...installed, platform: "darwin", shortcutInstalled: false }),
    ).toEqual({ eligible: true });
  });

  it("asks on Linux only where the dock can actually be edited", () => {
    const linux = { ...installed, platform: "linux" as NodeJS.Platform, shortcutInstalled: false };
    expect(pinEligibility({ ...linux, dockEditable: true })).toEqual({ eligible: true });
    expect(pinEligibility({ ...linux, dockEditable: false })).toEqual({
      eligible: false,
      reason: "no-dock",
    });
  });

  it("says nothing on a platform with no dock to speak of", () => {
    expect(pinEligibility({ ...installed, platform: "freebsd" as NodeJS.Platform })).toEqual({
      eligible: false,
      reason: "unsupported",
    });
  });

  it("can be forced, which is the only way the smoke run sees the card", () => {
    // `scripts/smoke.mjs` drives the unpackaged app, where every check above says no.
    expect(pinEligibility({ ...installed, packaged: false, forced: true })).toEqual({
      eligible: true,
    });
  });

  it("is not forced past a platform that has nothing to pin to", () => {
    expect(
      pinEligibility({ ...installed, platform: "freebsd" as NodeJS.Platform, forced: true }),
    ).toEqual({ eligible: false, reason: "unsupported" });
  });
});

describe("GNOME favourites", () => {
  it("reads the list gsettings prints", () => {
    const raw = "['firefox.desktop', 'org.gnome.Nautilus.desktop']\n";
    expect(parseFavorites(raw)).toEqual(["firefox.desktop", "org.gnome.Nautilus.desktop"]);
  });

  it("reads an empty list", () => {
    // gsettings prints a typed empty array rather than `[]`.
    expect(parseFavorites("@as []\n")).toEqual([]);
    expect(parseFavorites("[]")).toEqual([]);
  });

  it("reads a list that is not there at all", () => {
    expect(parseFavorites("")).toEqual([]);
  });

  it("writes a list gsettings accepts", () => {
    expect(formatFavorites(["firefox.desktop", "adcode.desktop"])).toBe(
      "['firefox.desktop', 'adcode.desktop']",
    );
  });

  it("writes an empty list in the form gsettings understands", () => {
    expect(formatFavorites([])).toBe("@as []");
  });

  it("survives a round trip", () => {
    const entries = ["a.desktop", "b.desktop"];
    expect(parseFavorites(formatFavorites(entries))).toEqual(entries);
  });

  it("escapes a quote rather than closing the list early", () => {
    const formatted = formatFavorites(["it's.desktop"]);
    expect(formatted).toBe("['it\\'s.desktop']");
  });

  it("appends the entry at the end, where a newly pinned app belongs", () => {
    expect(withFavorite(["firefox.desktop"], "adcode.desktop")).toEqual([
      "firefox.desktop",
      "adcode.desktop",
    ]);
  });

  it("does nothing when the app is already pinned", () => {
    const entries = ["adcode.desktop", "firefox.desktop"];
    expect(withFavorite(entries, "adcode.desktop")).toEqual(entries);
  });

  it("pins into an empty dock", () => {
    expect(withFavorite([], "adcode.desktop")).toEqual(["adcode.desktop"]);
  });
});
