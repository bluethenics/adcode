import { describe, expect, it } from "vitest";
import {
  ASK_ON_LAUNCHES,
  decidePinPrompt,
  formatFavorites,
  parseFavorites,
  pinPromptContent,
  withFavorite,
} from "../src/main/pinPromptPolicy.ts";

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
