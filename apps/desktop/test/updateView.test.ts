import { describe, expect, it } from "vitest";
import { readyNoticeDue, restartBlocked, updateView } from "../src/renderer/updates/updateView.ts";

describe("updateView", () => {
  it("hides for every quiet state", () => {
    for (const state of ["idle", "checking", "current", "failed", "unsupported"] as const) {
      expect(updateView({ state })).toEqual({ label: null, title: "", canRestart: false });
    }
  });

  it("shows download progress, rounded and clamped", () => {
    expect(updateView({ state: "downloading", percent: 41.6 }).label).toBe("Updating 42%");
    expect(updateView({ state: "downloading", percent: 104 }).label).toBe("Updating 100%");
    expect(updateView({ state: "downloading", percent: -3 }).label).toBe("Updating 0%");
    expect(updateView({ state: "downloading", percent: 5 }).canRestart).toBe(false);
  });

  /* The first progress event carries a version and no percentage. */
  it("never prints NaN% or a missing percentage", () => {
    expect(updateView({ state: "downloading", percent: Number.NaN }).label).toBe("Updating…");
    expect(updateView({ state: "downloading", version: "2.1.2" }).label).toBe("Updating…");
  });

  it("offers the restart once ready, naming the version", () => {
    const view = updateView({ state: "ready", version: "2.1.2", restartable: true });
    expect(view).toMatchObject({ label: "Restart to update", canRestart: true });
    expect(view.title).toContain("2.1.2");
  });
});

describe("updateView while restarting, or where restart is not offered", () => {
  /* The first click has been taken: a second one would install twice. */
  it("stops offering the restart once one has been asked for", () => {
    expect(updateView({ state: "ready", version: "2.1.2", restartable: true }, { restarting: true }))
      .toMatchObject({ label: "Restarting…", canRestart: false });
  });

  it("says the update is ready, without a restart, where restart is not offered", () => {
    const view = updateView({ state: "ready", version: "2.1.2", restartable: false });
    expect(view).toMatchObject({ label: "Update ready", canRestart: false });
    expect(view.title).toContain("when you close ADCode");
  });
});

describe("restartBlocked", () => {
  /* With crash recovery off there is no draft to offer back: the restart would lose the text. */
  it("asks to save first when unsaved files have no recovery draft", () => {
    expect(restartBlocked(2)).toMatch(/save/i);
  });

  it("lets the restart go when nothing would be lost", () => {
    expect(restartBlocked(0)).toBeNull();
  });
});

describe("readyNoticeDue", () => {
  const ready = { state: "ready", version: "2.1.2" } as const;
  const quiet = { focused: true, typingRecently: false };

  it("names the ready version in a quiet, focused moment", () => {
    expect(readyNoticeDue(ready, new Set(), quiet)).toBe("2.1.2");
  });

  it("waits while the window is in the background or someone is typing", () => {
    expect(readyNoticeDue(ready, new Set(), { focused: false, typingRecently: false })).toBeNull();
    expect(readyNoticeDue(ready, new Set(), { focused: true, typingRecently: true })).toBeNull();
  });

  it("never announces a version twice, or anything that is not ready", () => {
    expect(readyNoticeDue(ready, new Set(["2.1.2"]), quiet)).toBeNull();
    expect(readyNoticeDue({ state: "downloading", percent: 90 }, new Set(), quiet)).toBeNull();
  });
});
