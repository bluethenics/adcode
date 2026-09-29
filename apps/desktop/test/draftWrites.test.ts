import { describe, expect, it } from "vitest";
import { draftWritesSettled, trackDraftWrite } from "../src/main/draftWrites.ts";

/*
 * "Restart now" for an update quits the app. A recovery draft still on its way to disk at
 * that moment is the only copy of that text, so the restart waits on these.
 */
describe("draft writes", () => {
  it("settles only after every tracked write has finished", async () => {
    let finish!: () => void;
    let written = false;
    trackDraftWrite(
      new Promise<void>((resolve) => {
        finish = resolve;
      }).then(() => {
        written = true;
      }),
    );

    const settled = draftWritesSettled().then(() => written);
    finish();
    expect(await settled).toBe(true);
  });

  it("does not let a failed write reject the wait", async () => {
    trackDraftWrite(Promise.reject(new Error("disk full")));
    await expect(draftWritesSettled()).resolves.toBeUndefined();
  });

  it("resolves at once when nothing is in flight", async () => {
    await expect(draftWritesSettled()).resolves.toBeUndefined();
  });
});
