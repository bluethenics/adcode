import { describe, expect, it } from "vitest";
import { pairedTagAt } from "@adcode/structure";

/** The span of a name, as `line:startColumn-endColumn`, for readable assertions. */
const at = (text: string, line: number, column: number): string | null => {
  const found = pairedTagAt(text, line, column);
  if (found === null) return null;
  return `${found.name} ${String(found.partner.line)}:${String(found.partner.startColumn)}-${String(found.partner.endColumn)}`;
};

describe("pairedTagAt", () => {
  it("finds the closing tag from the opening one", () => {
    // <div>hello</div> - the cursor is on the `d` of the opening tag.
    expect(at("<div>hello</div>", 1, 2)).toBe("div 1:13-16");
  });

  it("finds the opening tag from the closing one", () => {
    expect(at("<div>hello</div>", 1, 13)).toBe("div 1:2-5");
  });

  it("works across lines", () => {
    const text = ["<section>", "  <p>text</p>", "</section>"].join("\n");
    expect(at(text, 1, 2)).toBe("section 3:3-10");
  });

  it("pairs the outer tag with the outer tag when they nest", () => {
    const text = "<div><div>inner</div></div>";
    // Cursor in the first (outer) opening tag; the partner is the *last* closing tag.
    expect(at(text, 1, 2)).toBe("div 1:24-27");
  });

  it("pairs the inner tag with the inner tag", () => {
    const text = "<div><div>inner</div></div>";
    expect(at(text, 1, 7)).toBe("div 1:18-21");
  });

  it("matches the cursor at either end of the name", () => {
    // Column 2 is before the `d`; column 5 is just after the `v`. Both are "in the name" -
    // a rename triggered from the end of the word is the common case.
    expect(at("<div>x</div>", 1, 2)).not.toBeNull();
    expect(at("<div>x</div>", 1, 5)).not.toBeNull();
  });

  it("ignores a cursor outside the name", () => {
    // Column 1 is the `<` itself, column 6 is past the `>`.
    expect(at("<div>x</div>", 1, 1)).toBeNull();
    expect(at("<div>x</div>", 1, 6)).toBeNull();
  });

  it("has no partner for a self-closing tag", () => {
    expect(at("<br />", 1, 2)).toBeNull();
  });

  it("has no partner for a void element", () => {
    expect(at('<img src="a.png">', 1, 2)).toBeNull();
  });

  it("is not fooled by a greater-than inside an attribute", () => {
    const text = '<div title="a > b">x</div>';
    expect(at(text, 1, 2)).toBe("div 1:23-26");
  });

  it("ignores tags inside comments", () => {
    // The commented `</div>` must not be taken as the partner.
    const text = "<div><!-- </div> --></div>";
    expect(at(text, 1, 2)).toBe("div 1:23-26");
  });

  it("ignores a doctype", () => {
    const text = "<!doctype html>\n<html></html>";
    expect(at(text, 2, 2)).toBe("html 2:9-13");
  });

  it("returns null when the tag was never closed", () => {
    expect(at("<div>hello", 1, 2)).toBeNull();
  });

  it("returns null when the closing tag has no opener", () => {
    expect(at("hello</div>", 1, 8)).toBeNull();
  });

  it("handles attributes spread over several lines", () => {
    const text = ['<button', '  class="x"', '  disabled>', "  hi", "</button>"].join("\n");
    expect(at(text, 1, 2)).toBe("button 5:3-9");
  });

  it("keeps hyphenated custom element names whole", () => {
    expect(at("<my-widget>x</my-widget>", 1, 2)).toBe("my-widget 1:15-24");
  });

  /*
   * Mis-nested markup still pairs by name.
   *
   * `<div><span></div></span>` is invalid, but the `<span>` and the `</span>` are
   * unambiguously each other's partner - only tags of the same name are counted, so the
   * stray `</div>` between them changes nothing. Renaming one and not the other would
   * leave the file more broken than it already is, which is the outcome worth avoiding.
   */
  it("pairs by name even when the markup is mis-nested", () => {
    expect(at("<div><span></div></span>", 1, 7)).toBe("span 1:20-24");
  });
});
