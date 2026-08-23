import { describe, expect, it } from "vitest";
import { closingTagFor, completeClosingTag, supportsTagClosing } from "@adcode/structure";

describe("closingTagFor", () => {
  it("closes a tag the moment its `>` is typed", () => {
    expect(closingTagFor("<h1>", "html")).toBe("</h1>");
    expect(closingTagFor("  <section>", "html")).toBe("</section>");
  });

  it("keeps the attributes out of the closing tag", () => {
    expect(closingTagFor('<div class="card" id="top">', "html")).toBe("</div>");
  });

  it("does not close a void element", () => {
    for (const tag of ["<br>", "<img src='a.png'>", "<input>", "<hr>", "<meta charset='utf-8'>"]) {
      expect(closingTagFor(tag, "html")).toBeNull();
    }
  });

  it("does not close a tag that closed itself", () => {
    expect(closingTagFor("<Widget />", "typescript")).toBeNull();
  });

  it("does not close a closing tag", () => {
    expect(closingTagFor("</div>", "html")).toBeNull();
  });

  it("leaves comments, doctypes and processing instructions alone", () => {
    expect(closingTagFor("<!-- a comment -->", "html")).toBeNull();
    expect(closingTagFor("<!doctype html>", "html")).toBeNull();
    expect(closingTagFor("<?php echo 1; ?>", "php")).toBeNull();
  });

  it("does not fire on a `>` inside an unfinished attribute", () => {
    expect(closingTagFor('<a title="a > b', "html")).toBeNull();
    expect(closingTagFor("<a title='x >", "html")).toBeNull();
  });

  it("fires once the attribute is finished", () => {
    expect(closingTagFor('<a title="a > b">', "html")).toBe("</a>");
  });

  it("closes a JSX component in a TypeScript file", () => {
    expect(closingTagFor("  <Panel>", "typescript")).toBe("</Panel>");
    expect(closingTagFor("<Foo.Bar>", "javascript")).toBe("</Foo.Bar>");
  });

  it("does not mistake a TypeScript generic for a tag", () => {
    expect(closingTagFor("const map: Map<string, number>", "typescript")).toBeNull();
    expect(closingTagFor("function id<T>", "typescript")).toBeNull();
  });

  it("stays out of languages that have no tags", () => {
    expect(closingTagFor("<h1>", "python")).toBeNull();
    expect(closingTagFor("if (a > b)", "c")).toBeNull();
  });

  it("only fires on the character that was just typed", () => {
    expect(closingTagFor("<div", "html")).toBeNull();
  });
});

describe("completeClosingTag", () => {
  it("completes `</` with the innermost open element", () => {
    expect(completeClosingTag("<div><span></", "html")).toBe("span>");
  });

  it("skips elements that are already closed", () => {
    expect(completeClosingTag("<div><span></span></", "html")).toBe("div>");
  });

  it("skips void and self-closed elements", () => {
    expect(completeClosingTag("<div><br><img src='a'></", "html")).toBe("div>");
    expect(completeClosingTag("<div><Widget /></", "typescript")).toBe("div>");
  });

  it("returns null when nothing is open", () => {
    expect(completeClosingTag("</", "html")).toBeNull();
    expect(completeClosingTag("<div></div></", "html")).toBeNull();
  });

  it("is not confused by a `>` inside an attribute value", () => {
    expect(completeClosingTag('<div title="a > b"></', "html")).toBe("div>");
  });
});

describe("supportsTagClosing", () => {
  it("covers markup and the JSX dialects", () => {
    for (const language of ["html", "xml", "typescript", "javascript", "php", "handlebars"]) {
      expect(supportsTagClosing(language)).toBe(true);
    }
  });

  it("leaves the rest alone", () => {
    for (const language of ["python", "c", "cpp", "css", "json", "rust"]) {
      expect(supportsTagClosing(language)).toBe(false);
    }
  });
});
