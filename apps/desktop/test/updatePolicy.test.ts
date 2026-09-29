import { describe, expect, it } from "vitest";
import { blockMapFitsInstaller, canSelfUpdate, runningFromWindowsStore } from "../src/main/updatePolicy.ts";

const environment = (overrides: Partial<Parameters<typeof canSelfUpdate>[0]> = {}) => ({
  packaged: true,
  disabled: false,
  windowsStore: false,
  portable: false,
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
    expect(canSelfUpdate({ packaged: true, disabled: false, windowsStore: true, portable: false })).toBe(false);
  });

  /* A portable build has no install to update: electron-updater would install a second copy. */
  it("stands down in the portable build", () => {
    expect(canSelfUpdate(environment({ portable: true }))).toBe(false);
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

describe("blockMapFitsInstaller", () => {
  const map = (...sizes: number[][]) => ({
    version: "2",
    files: sizes.map((blocks) => ({ name: "file", offset: 0, sizes: blocks })),
  });

  it("accepts a blockmap whose blocks add up to the installer", () => {
    expect(blockMapFitsInstaller(map([100, 200, 50]), 350)).toBe(true);
  });

  /*
   * The bug this exists for: a manual install rewrote installer.exe but left the blockmap of
   * the version the updater downloaded before it. These two sizes are real - the 2.1.0 and
   * 2.0.0 installers - and the differential download built from the pair failed its checksum.
   */
  it("rejects a blockmap for a different installer", () => {
    expect(blockMapFitsInstaller(map([115_664_780]), 115_582_018)).toBe(false);
  });

  it("rejects anything that is not a blockmap", () => {
    const impostors: unknown[] = [
      null,
      undefined,
      42,
      "blockmap",
      {},
      { files: [] },
      { files: [{}] },
      { files: [{ sizes: [1, "2"] }] },
      { files: [{ sizes: [-1, 2] }] },
      { files: [{ sizes: [1.5] }] },
    ];
    for (const impostor of impostors) expect(blockMapFitsInstaller(impostor, 1)).toBe(false);
  });

  it("rejects an empty or impossible installer size", () => {
    expect(blockMapFitsInstaller(map([0]), 0)).toBe(false);
    expect(blockMapFitsInstaller(map([10]), Number.NaN)).toBe(false);
  });
});
