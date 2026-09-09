import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INSPECT_SCRIPT,
  injectAdcodeScripts,
  injectReloadScript,
} from "../src/main/liveServer.ts";
import {
  describeBox,
  highlightHtml,
  isInspectHit,
  isInspectedBox,
  shortLabel,
} from "../src/renderer/preview/elementInspector.ts";

const box = {
  tag: "div",
  id: "hero",
  classes: ["card", "large"],
  selector: "body > div#hero",
  width: 390,
  height: 120,
  padding: { top: "8px", right: "8px", bottom: "8px", left: "8px" },
  margin: { top: "0px", right: "auto", bottom: "16px", left: "auto" },
  border: { top: "1px", right: "1px", bottom: "1px", left: "1px" },
  display: "block",
  position: "static",
  html: '<div id="hero" class="card">Hi</div>',
};

describe("preview element inspector", () => {
  it("injected page script bridges over postMessage without touching the DOM directly", () => {
    expect(INSPECT_SCRIPT).toContain("adcode-inspect");
    expect(INSPECT_SCRIPT).toContain("adcode-preview");
    expect(INSPECT_SCRIPT).toContain("contextmenu");
    expect(INSPECT_SCRIPT).toContain("getComputedStyle");
  });

  it("injects both reload and inspect scripts before the closing body tag", () => {
    const result = injectAdcodeScripts("<html><body><h1>Hi</h1></body></html>");
    expect(result).toContain("EventSource");
    expect(result).toContain("adcode-inspect");
    expect(result.indexOf("adcode-inspect")).toBeLessThan(result.indexOf("</body>"));
  });

  it("keeps the old entry point injecting both, so existing callers get inspect free", () => {
    expect(injectReloadScript("<body></body>")).toContain("adcode-inspect");
  });

  it("summarises a box the way list rows show it", () => {
    expect(describeBox(box)).toBe("div#hero.card.large · 390 × 120");
  });

  it("recognises a well-formed box and rejects junk", () => {
    expect(isInspectedBox(box)).toBe(true);
    expect(isInspectedBox({ tag: "div" })).toBe(false);
    expect(isInspectedBox(null)).toBe(false);
  });

  it("highlights markup without letting it execute", () => {
    const out = highlightHtml('<div class="a">x</div>');
    expect(out).not.toContain("<div");
    expect(out).toContain("inspect-tag");
    expect(out).toContain("&lt;div");
  });

  it("keeps resizing to one obvious route: quick sizes, labelled steppers, titled edges", () => {
    const toolbar = readFileSync(
      join(import.meta.dirname, "../src/renderer/preview/deviceToolbar.ts"),
      "utf8",
    );
    // One-click Phone / Tablet / Desktop.
    expect(toolbar).toContain("device-quick");
    // Labelled W / H groups with − / + steppers, not bare boxes.
    expect(toolbar).toContain("device-dim");
    expect(toolbar).toContain("device-step");
    // The combined box stays for paste and the smoke check.
    expect(toolbar).toContain("device-size");
    // Drag handles carry a tooltip, so hovering one says what it does.
    expect(toolbar).toContain("HANDLE_TITLES");
    expect(toolbar).toContain("Drag to resize");
    // A visible hint says what to do.
    expect(toolbar).toContain("device-hint");

    const css = readFileSync(
      join(import.meta.dirname, "../src/renderer/styles/workbench.css"),
      "utf8",
    );
    // Handles are faintly visible at rest, not invisible until hovered.
    expect(css).toMatch(/\.device-handle::after \{[^}]*opacity: 0\.55/s);
  });

  it("sends the ancestor chain so a mis-clicked span can walk up to its card", () => {
    expect(INSPECT_SCRIPT).toContain("chainOf");
    expect(INSPECT_SCRIPT).toContain("inspect-flash");
  });

  it("recognises the { current, chain } envelope and still draws a bare box", () => {
    expect(isInspectHit({ current: box, chain: [box] })).toBe(true);
    expect(isInspectHit({ current: box, chain: [] })).toBe(true);
    expect(isInspectHit({ current: box, chain: [{ tag: "div" }] })).toBe(false);
    expect(isInspectHit(box)).toBe(false);
    expect(shortLabel(box)).toBe("div#hero.card.large");
  });

  it("renders an ancestor breadcrumb the panel can walk", () => {
    const inspector = readFileSync(
      join(import.meta.dirname, "../src/renderer/preview/elementInspector.ts"),
      "utf8",
    );
    expect(inspector).toContain("inspect-crumbs");
    expect(inspector).toContain("inspect-flash");
    expect(inspector).toContain("Walk up to the one you meant");
  });

  it("wires an inspect command and button into the preview", () => {
    const main = readFileSync(
      join(import.meta.dirname, "../src/renderer/main.ts"),
      "utf8",
    );
    expect(main).toContain('"preview.inspect"');
    const pane = readFileSync(
      join(import.meta.dirname, "../src/renderer/preview/previewPane.ts"),
      "utf8",
    );
    expect(pane).toContain("toggleInspect");
    expect(pane).toContain("createElementInspector");
  });
});
