import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/renderer/workbench/popupShell.ts", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/renderer/styles/popupShell.css", import.meta.url),
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

  it("handles Escape locally for modeless shells", () => {
    expect(source).toContain('dialog.addEventListener("keydown"');
    expect(source).toContain('!options.modal && event.key === "Escape"');
  });

  it("clamps an anchored shell within the viewport", () => {
    expect(source).toContain("Math.min(420, window.innerWidth - 72)");
    expect(source).toContain("Math.max(12, Math.min(box.right + 10, window.innerWidth - width - 12))");
  });

  it("removes backdrop blur when transparency is reduced", () => {
    expect(styles).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(styles).toContain(".popup-shell::backdrop { backdrop-filter: none; }");
  });
});
