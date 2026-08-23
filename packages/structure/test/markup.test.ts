import { describe, expect, it } from "vitest";
import { describeElement, markupElements, markupOutline, outlineOf } from "@adcode/structure";
import type { OutlineNode } from "@adcode/structure";

const names = (nodes: readonly OutlineNode[]): string[] => nodes.map((node) => node.name);

const PAGE = [
  "<!doctype html>",
  '<html lang="en">',
  "  <body>",
  '    <div class="card hero" id="top">',
  "      <h1>Title</h1>",
  '      <img src="a.png">',
  "    </div>",
  "  </body>",
  "</html>",
].join("\n");

describe("markupOutline", () => {
  it("nests tags the way the page nests", () => {
    const outline = markupOutline(PAGE);

    expect(names(outline)).toEqual(["html"]);
    expect(names(outline[0]?.children ?? [])).toEqual(["body"]);

    const card = outline[0]?.children[0]?.children[0];
    expect(card?.name).toBe("div#top.card.hero");
    expect(names(card?.children ?? [])).toEqual(["h1", "img"]);
  });

  it("gives an element the span between its tags", () => {
    const card = markupOutline(PAGE)[0]?.children[0]?.children[0];

    expect(card?.line).toBe(4);
    expect(card?.endLine).toBe(7);
  });

  it("does not let a void element swallow the rest of the page", () => {
    const outline = markupOutline("<div><br><p>after</p></div>");
    const children = outline[0]?.children ?? [];

    // With `<br>` treated as a container, `<p>` would be its child rather than its sibling.
    expect(names(children)).toEqual(["br", "p"]);
  });

  it("ignores tags inside a comment", () => {
    const outline = markupOutline("<div>\n  <!-- <span>hidden</span> -->\n  <b>real</b>\n</div>");

    expect(names(outline[0]?.children ?? [])).toEqual(["b"]);
  });

  it("keeps drawing when a tag is never closed", () => {
    const outline = markupOutline("<div>\n  <p>open\n");

    expect(names(outline)).toEqual(["div"]);
    expect(names(outline[0]?.children ?? [])).toEqual(["p"]);
  });

  it("closes the element the close tag names, not the nearest one", () => {
    const outline = markupOutline("<div><span><b>x</div><p>after</p>");

    // The `</div>` unwinds span and b too; `<p>` is then a sibling of `<div>`.
    expect(names(outline)).toEqual(["div", "p"]);
  });

  it("is what `outlineOf` uses for html", () => {
    expect(names(outlineOf("html", PAGE))).toEqual(["html"]);
  });
});

describe("markupElements", () => {
  it("reports the tag, id and classes of every element", () => {
    const elements = markupElements(PAGE);

    expect(elements.map((element) => element.tag)).toEqual(["html", "body", "div", "h1", "img"]);

    const card = elements[2];
    expect(card?.id).toBe("top");
    expect(card?.classes).toEqual(["card", "hero"]);
    expect(card?.line).toBe(4);
  });

  it("handles single-quoted and unquoted attributes", () => {
    const [element] = markupElements("<div class='a b' id=main>");

    expect(element?.classes).toEqual(["a", "b"]);
    expect(element?.id).toBe("main");
  });
});

describe("describeElement", () => {
  it("names an element the way dev tools do", () => {
    expect(describeElement({ tag: "div", id: "hero", classes: ["card", "is-open"] })).toBe(
      "div#hero.card.is-open",
    );
    expect(describeElement({ tag: "p", id: null, classes: [] })).toBe("p");
  });
});
