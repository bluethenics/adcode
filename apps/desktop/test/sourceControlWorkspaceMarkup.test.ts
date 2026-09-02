import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/renderer/panels/sourceControl.ts", import.meta.url),
  "utf8",
);

describe("Source Control workspace", () => {
  it("separates changes, commit, and history into stable regions", () => {
    expect(source).toContain('changesRegion.className = "scm-changes-region"');
    expect(source).toContain('commitRegion.className = "scm-commit-region"');
    expect(source).toContain('historyRegion.className = "scm-history-region"');
    expect(source).toContain("element.append(changesRegion, commitRegion, historyRegion)");
  });
});
