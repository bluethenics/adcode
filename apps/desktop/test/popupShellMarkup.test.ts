import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPopupShellBackdrop } from "../src/renderer/workbench/popupShell.ts";

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
    expect(source).toContain("event.composedPath().includes(surface)");
    expect(source).toContain("restoreTarget?.focus()");
  });

  it("keeps an inner click after its target synchronously detaches", () => {
    const surface = {} as HTMLElement;
    const detachedRow = {} as Node;
    const event = {
      composedPath: () => [detachedRow, surface],
    } as Event;

    expect(isPopupShellBackdrop(event, surface)).toBe(false);
  });

  it("still recognizes a true backdrop click", () => {
    const surface = {} as HTMLElement;
    const backdrop = {} as Node;
    const event = {
      composedPath: () => [backdrop],
    } as Event;

    expect(isPopupShellBackdrop(event, surface)).toBe(true);
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

  it("distinguishes pointer, keyboard, and reduced-motion disclosure", () => {
    expect(source).toContain('dialog.dataset["input"]');
    expect(source).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
    expect(source).toContain('document.documentElement.dataset["reducedMotion"] === "true"');
    expect(source).toContain("duration: 220");
    expect(source).toContain("duration: 100");
    expect(source).toContain("surface.getAnimations().forEach");
  });

  it("labels the dialog from its visible title and honours task focus", () => {
    expect(source).toContain('titleElement.id = `popup-shell-title-');
    expect(source).toContain('dialog.setAttribute("aria-labelledby"');
    expect(source).toContain("openOptions.initialFocus ?? options.initialFocus?.() ?? surface");
  });

  it("keeps high contrast surfaces opaque and explicitly bordered", () => {
    expect(styles).toContain("@media (prefers-contrast: more)");
    expect(styles).toContain("border: 2px solid CanvasText");
    expect(styles).toContain("background: Canvas");
    expect(styles).toContain("color: CanvasText");
  });
});
