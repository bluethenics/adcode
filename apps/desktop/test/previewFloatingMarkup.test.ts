/**
 * Preview never docks: a docked column on the right was one of the sidebars this layout
 * removes. It is always a floating window that can be moved, resized from any edge and
 * maximised - and its iframe is still never reparented, which is what keeps the page alive.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/renderer/preview/previewPane.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

describe("floating preview", () => {
  it("starts floating and has no dock button", () => {
    expect(source).toContain('let placement: PreviewPlacement = "floating";');
    expect(source).not.toContain("Undock preview");
    expect(source).not.toContain("DOCKED_WIDTH");
  });

  it("resizes from every edge and maximises", () => {
    expect(source).toContain("resizeGeometry(");
    expect(source).toContain("preview-edge");
    expect(source).toContain("maximisedIn(");
    expect(source).toContain('"dblclick"');
  });

  it("offers Maximise instead of Undock as a command", () => {
    expect(main).toContain('add("preview.maximise"');
    expect(main).not.toContain('"preview.undock"');
  });
});
