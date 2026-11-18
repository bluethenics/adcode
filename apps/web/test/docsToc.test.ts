import { describe, expect, it } from "vitest";
import { outlineDoc } from "../src/lib/docsToc";
import { renderMarkdown } from "../src/lib/markdown";

describe("doc outline", () => {
  it("gives every section heading an id and lists it for the rail", () => {
    const { html, outline } = outlineDoc(
      renderMarkdown("## When you would want it\n\nText.\n\n### A detail\n\nMore.\n\n## Shortcut\n\n`Ctrl+K`"),
    );

    expect(outline).toEqual([
      { id: "doc-when-you-would-want-it", text: "When you would want it", level: 2 },
      { id: "doc-a-detail", text: "A detail", level: 3 },
      { id: "doc-shortcut", text: "Shortcut", level: 2 },
    ]);
    expect(html).toContain('<h2 id="doc-when-you-would-want-it">When you would want it</h2>');
    expect(html).toContain('<h3 id="doc-a-detail">');
  });

  it("keeps an author's own anchor and never repeats an id", () => {
    const { html, outline } = outlineDoc(
      renderMarkdown("## Setup {#setup}\n\n## Usage\n\n## Usage\n\n## Tips & tricks"),
    );

    expect(outline.map((item) => item.id)).toEqual(["setup", "doc-usage", "doc-usage-2", "doc-tips-tricks"]);
    expect(outline[3]?.text).toBe("Tips & tricks");
    expect(html.match(/id="setup"/g)).toHaveLength(1);
  });

  it("leaves pages without headings untouched", () => {
    const body = renderMarkdown("Just a paragraph.");
    expect(outlineDoc(body)).toEqual({ html: body, outline: [] });
  });
});
