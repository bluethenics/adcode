import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/renderer/panels/sourceControl.ts", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/renderer/styles/panels.css", import.meta.url),
  "utf8",
);

describe("Source Control workspace", () => {
  it("separates changes, commit, and history into stable regions", () => {
    expect(source).toContain('changesRegion.className = "scm-changes-region"');
    expect(source).toContain('commitRegion.className = "scm-commit-region"');
    expect(source).toContain('historyRegion.className = "scm-history-region"');
    expect(source).toContain("element.append(changesRegion, commitRegion, historyRegion)");
  });

  it("provides an accessible visible close affordance", () => {
    expect(source).toContain('close.className = "icon-button scm-close"');
    expect(source).toContain('close.setAttribute("aria-label", "Close Source Control")');
    expect(source).toContain("close.addEventListener(\"click\", deps.onRequestClose)");
    expect(source).toContain("changesRegion.inert = changesHidden");
    expect(source).toContain("historyRegion.inert = historyHidden");
    expect(source).toContain('if (outcome.ok) message.value = "";');
    expect(styles).toMatch(/\.scm-drawer-actions\s*\{[\s\S]*padding-inline-end: 48px;/);
  });
});
