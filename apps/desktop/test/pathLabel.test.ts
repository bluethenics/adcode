/**
 * Shortening a path without throwing away the part that identifies it.
 *
 * Both places this is used - the status bar corner and the recent folders in the File
 * menu - exist to answer "which checkout is this?", and the answer is always at the end
 * of the path. CSS can only ellipsise the other end, which is how the menu first shipped:
 * two different `src` folders both rendered as `E:\adcode-sourcecode\p…`, which is the
 * exact ambiguity the second line was added to remove.
 */
import { describe, expect, it } from "vitest";
import { sameWorkspacePath, shortenPath } from "../src/renderer/workbench/pathLabel.ts";

describe("shortenPath", () => {
  it("leaves a path that already fits", () => {
    expect(shortenPath("E:/work/site", 44)).toBe("E:/work/site");
  });

  it("keeps whole segments from the end, as many as the budget allows", () => {
    expect(shortenPath("E:/a/very/long/way/down/to/packages/collab/src", 24)).toBe(
      "…/to/packages/collab/src",
    );
    // One character less, and the segment that no longer fits goes whole.
    expect(shortenPath("E:/a/very/long/way/down/to/packages/collab/src", 23)).toBe(
      "…/packages/collab/src",
    );
  });

  it("never returns more than it was asked for", () => {
    const path = "E:/one/two/three/four/five/six/seven/eight/nine/ten";

    for (const max of [8, 12, 20, 30, 44]) {
      expect(shortenPath(path, max).length, `max ${max}`).toBeLessThanOrEqual(max);
    }
  });

  it("understands both separators, since Windows writes one and everything else the other", () => {
    expect(shortenPath("E:\\a\\very\\long\\way\\down\\to\\packages\\collab", 22)).toBe(
      "…\\to\\packages\\collab",
    );
  });

  /* One segment longer than the whole budget still has to say something. */
  it("cuts mid-word when a single segment will not fit", () => {
    const cut = shortenPath("E:/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 12);

    expect(cut).toHaveLength(12);
    expect(cut.startsWith("…")).toBe(true);
    expect(cut.endsWith("aaa")).toBe(true);
  });

  it("keeps the last segment even when it only just fits", () => {
    expect(shortenPath("E:/work/site/packages/git", 12)).toBe("…/git");
  });
});

describe("sameWorkspacePath", () => {
  it("matches Windows roots across separator, case, and trailing-slash differences", () => {
    expect(sameWorkspacePath("E:\\Work\\Project", "e:/work/project/")).toBe(true);
  });

  it("keeps distinct POSIX paths distinct", () => {
    expect(sameWorkspacePath("/work/Project", "/work/project")).toBe(false);
    expect(sameWorkspacePath("/work/project", "/work/project-two")).toBe(false);
  });
});
