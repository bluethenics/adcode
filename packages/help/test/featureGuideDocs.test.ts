import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { featureRecords } from "../src/index.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const GUIDE = join(ROOT, "docs", "features", "complete-feature-guide.md");

describe("the complete feature guide", () => {
  const guide = () => readFileSync(GUIDE, "utf8");

  it("has a stable inventory marker for every feature card", () => {
    const content = guide();
    const missing = featureRecords().filter(
      ({ entry }) => !content.includes(`<!-- feature:${entry.id} -->`),
    );

    expect(missing.map(({ entry }) => entry.id)).toEqual([]);
  });

  it("documents every direct command route exposed by the catalogue", () => {
    const content = guide();
    const missing = featureRecords().flatMap((record) =>
      record.actions
        .filter((action) => action.kind === "command")
        .filter((action) => !content.includes(`command:${action.command}`))
        .map((action) => `${record.entry.id}:${action.command}`),
    );

    expect(missing).toEqual([]);
  });

  it("distinguishes universal and specialized search routes", () => {
    const content = guide();

    for (const shortcut of ["Ctrl+P", "Ctrl+Shift+P", "Ctrl+T", "Ctrl+Shift+F"]) {
      expect(content).toContain(shortcut);
    }
    expect(content).toContain("Universal Search");
    expect(content).toContain("Quick Open");
    expect(content).toContain("Command Palette");
    expect(content).toContain("Symbol Search");
    expect(content).toContain("Content Search");
  });

  it("links the AI safety and workspace guides", () => {
    const content = guide();

    expect(content).toContain("./ai-workspaces.md");
    expect(content).toContain("../architecture/ai-workspace-security.md");
  });
});
