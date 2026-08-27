import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { workspaceHasUnsavedDraft } from "../src/main/aiWorkspaceDrafts.ts";

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
});
