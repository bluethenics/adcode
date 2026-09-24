import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { summarizeUnsavedDrafts, workspaceHasUnsavedDraft } from "../src/main/aiWorkspaceDrafts.ts";

describe("AI workspace unsaved-buffer guard", () => {
  const root = resolve("project");

  it("blocks when any recoverable draft belongs to the open workspace", () => {
    expect(
      workspaceHasUnsavedDraft(root, [
        { path: resolve(root, "src", "file.ts"), text: "unsaved contents are irrelevant" },
      ]),
    ).toBe(true);
  });

  it("ignores drafts from another project and prefix-shaped sibling folders", () => {
    expect(workspaceHasUnsavedDraft(root, [{ path: resolve("other", "file.ts"), text: "x" }])).toBe(false);
    expect(
      workspaceHasUnsavedDraft(root, [{ path: resolve(`${root}-private`, "file.ts"), text: "x" }]),
    ).toBe(false);
  });

  it("names the dirty files for the blocker message, capped and sorted", () => {
    const drafts = [
      { path: resolve(root, "b.ts") },
      { path: resolve(root, "src", "a.ts") },
      { path: resolve(root, "b.ts") },
      { path: resolve("other", "z.ts") },
    ];
    expect(summarizeUnsavedDrafts(root, drafts)).toBe("b.ts, src/a.ts");
    expect(summarizeUnsavedDrafts(root, drafts, 1)).toBe("b.ts, and 1 more");
    expect(summarizeUnsavedDrafts(root, [])).toBe("");
    expect(summarizeUnsavedDrafts(root, [{ path: resolve("other", "z.ts") }])).toBe("");
  });
});
