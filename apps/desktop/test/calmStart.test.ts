import { describe, expect, it } from "vitest";
import { CALM_START_MS, FIRST_WELCOME_KEY, HELD_NOTICE_GAP_MS, calmRemaining, holdUntilCalm, inCalmStart, markFirstWelcome } from "../src/renderer/onboarding/calmStart.ts";

function memory(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

describe("a calm first half hour", () => {
  it("is quiet for somebody new, and for nobody who used ADCode before", () => {
    const storage = memory();
    // No record: somebody who was welcomed before this existed. Nothing changes for them.
    expect(inCalmStart(1_000, storage)).toBe(false);
    markFirstWelcome(1_000, storage);
    expect(calmRemaining(1_000, storage)).toBe(CALM_START_MS);
    expect(inCalmStart(1_000 + CALM_START_MS - 1, storage)).toBe(true);
    expect(inCalmStart(1_000 + CALM_START_MS, storage)).toBe(false);
  });

  it("keeps the first welcome's time, however often it is marked", () => {
    const storage = memory();
    markFirstWelcome(1_000, storage);
    markFirstWelcome(9_000_000, storage);
    expect(storage.data.get(FIRST_WELCOME_KEY)).toBe("1000");
  });

  it("holds notices until the quiet is over, then shows them one at a time", () => {
    const storage = memory();
    markFirstWelcome(0, storage);
    const scheduled: number[] = [];
    const shown: string[] = [];
    const held = holdUntilCalm(["a", "b"], (item) => shown.push(item), 60_000, storage, (run, ms) => { scheduled.push(ms); run(); });
    expect(held).toBe(true);
    expect(scheduled).toEqual([CALM_START_MS - 60_000, CALM_START_MS - 60_000 + HELD_NOTICE_GAP_MS]);
    expect(shown).toEqual(["a", "b"]);
    expect(holdUntilCalm(["c"], () => undefined, CALM_START_MS, storage)).toBe(false);
  });
});
