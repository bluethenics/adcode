import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/renderer/workbench/popupShell.ts", import.meta.url),
  "utf8",
);

describe("shared pop-up shell", () => {
  it("uses native dialogs for modal surfaces", () => {
    expect(source).toContain('document.createElement("dialog")');
    expect(source).toContain("dialog.showModal()");
  });

  it("owns Escape, backdrop dismissal, and focus restoration", () => {
    expect(source).toContain('addEventListener("cancel"');
    expect(source).toContain("surface.contains(event.target as Node)");
    expect(source).toContain("restoreTarget?.focus()");
  });

  it("announces launcher disclosure", () => {
    expect(source).toContain('setAttribute("aria-expanded"');
    expect(source).toContain('setAttribute("aria-pressed"');
  });
});
