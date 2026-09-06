import { describe, expect, it } from "vitest";
import { canSelfUpdate, runningFromWindowsStore } from "../src/main/updatePolicy.ts";

const environment = (overrides: Partial<Parameters<typeof canSelfUpdate>[0]> = {}) => ({
  packaged: true,
  disabled: false,
  windowsStore: false,
  ...overrides,
});

describe("canSelfUpdate", () => {
  it("updates a normal packaged build", () => {
    expect(canSelfUpdate(environment())).toBe(true);
  });

  it("never updates a dev run, which has no feed", () => {
    expect(canSelfUpdate(environment({ packaged: false }))).toBe(false);
  });

  it("honours the opt-out for anyone repackaging ADCode", () => {
    expect(canSelfUpdate(environment({ disabled: true }))).toBe(false);
  });

  /*
   * The reason this file exists.
   *
   * A Microsoft Store build is updated by the Store, and its install directory is
   * read-only and virtualised. Left to run, electron-updater would download every release
   * and fail to apply any of them - an endless loop on the user's bandwidth. The app has
   * to stand down, and be seen to.
   */
  it("stands down inside the Microsoft Store container", () => {
    expect(canSelfUpdate(environment({ windowsStore: true }))).toBe(false);
  });

  it("stands down for the Store even when everything else says go", () => {
    expect(canSelfUpdate({ packaged: true, disabled: false, windowsStore: true })).toBe(false);
  });
});

describe("runningFromWindowsStore", () => {
  /* Electron sets this only inside an AppX container; Node has no such property. */
  it("is true only for an explicit true", () => {
    expect(runningFromWindowsStore({ windowsStore: true } as unknown as NodeJS.Process)).toBe(true);
  });

  it("is false when absent, which is every non-Store build", () => {
    expect(runningFromWindowsStore({} as unknown as NodeJS.Process)).toBe(false);
    expect(runningFromWindowsStore({ windowsStore: undefined } as unknown as NodeJS.Process)).toBe(
      false,
    );
  });

  /* A truthy string must not be mistaken for the flag; only the boolean counts. */
  it("does not accept a truthy impostor", () => {
    expect(runningFromWindowsStore({ windowsStore: "yes" } as unknown as NodeJS.Process)).toBe(false);
  });
});
