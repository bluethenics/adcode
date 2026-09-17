import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/lib/markdown";

/**
 * The renderer behind every docs page, the admin preview, and the legal pages.
 * New block types must earn their place the same way the old ones did: exact HTML
 * for the happy path, and source text - never markup - for anything hostile.
 */
describe("fenced code boxes", () => {
  it("renders a labelled box with a copy button", () => {
    const html = renderMarkdown("```bash\nadcode open .\n```");
    expect(html).toContain('class="codebox"');
    expect(html).toContain('class="codebox-lang">bash</span>');
    expect(html).toContain('data-codebox-copy');
    expect(html).toContain("adcode open .");
  });

  it("names prompt blocks Prompt", () => {
    expect(renderMarkdown("```prompt\nDo the thing.\n```")).toContain(">Prompt</span>");
  });

  it("labels an unlanguaged block Code", () => {
    expect(renderMarkdown("```\nplain\n```")).toContain(">Code</span>");
  });

  it("escapes code instead of executing it", () => {
    const html = renderMarkdown("```html\n<script>alert(1)</script>\n```");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("still renders an unclosed fence rather than swallowing the page", () => {
    const html = renderMarkdown("```js\nconst a = 1;");
    expect(html).toContain('class="codebox"');
    expect(html).toContain("const a = 1;");
  });
});

describe("images", () => {
  it("figures a lone https image with its alt as caption", () => {
    const html = renderMarkdown("![The editor at work](https://example.com/shot.png)");
    expect(html).toContain('class="prose-media"');
    expect(html).toContain('src="https://example.com/shot.png"');
    expect(html).toContain("<figcaption>The editor at work</figcaption>");
  });

  it("accepts site-relative sources", () => {
    expect(renderMarkdown("![](/assets/post-pa-1.png)")).toContain('src="/assets/post-pa-1.png"');
  });

  it("omits the caption when there is no alt text", () => {
    const html = renderMarkdown("![](https://example.com/shot.png)");
    expect(html).toContain("<figure");
    expect(html).not.toContain("figcaption");
  });

  it("refuses data: and javascript: sources as text, never as images", () => {
    expect(renderMarkdown("![x](data:image/png;base64,AAA)")).not.toContain("<img");
    expect(renderMarkdown("![x](javascript:alert(1))")).not.toContain("<img");
  });

  it("renders an inline image inside a sentence", () => {
    const html = renderMarkdown("See the toggle ![on](https://example.com/on.png) above.");
    expect(html).toContain("<p>");
    expect(html).toContain('class="prose-img"');
  });
});

describe("video embeds", () => {
  it("embeds a bare YouTube id on the privacy host", () => {
    const html = renderMarkdown("@[youtube](dQw4w9WgXcQ)");
    expect(html).toContain('class="video-embed"');
    expect(html).toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(html).not.toContain("youtube.com/watch");
  });

  it("accepts watch, share, and shorts links", () => {
    expect(renderMarkdown("@[youtube](https://www.youtube.com/watch?v=dQw4w9WgXcQ)")).toContain(
      "/embed/dQw4w9WgXcQ",
    );
    expect(renderMarkdown("@[youtube](https://youtu.be/dQw4w9WgXcQ)")).toContain(
      "/embed/dQw4w9WgXcQ",
    );
    expect(renderMarkdown("@[youtube](https://www.youtube.com/shorts/dQw4w9WgXcQ)")).toContain(
      "/embed/dQw4w9WgXcQ",
    );
  });

  it("embeds Vimeo ids and links", () => {
    expect(renderMarkdown("@[vimeo](123456789)")).toContain(
      "https://player.vimeo.com/video/123456789",
    );
    expect(renderMarkdown("@[vimeo](https://vimeo.com/123456789)")).toContain(
      "https://player.vimeo.com/video/123456789",
    );
  });

  it("renders unknown hosts and bad ids as text, never as frames", () => {
    expect(renderMarkdown("@[youtube](https://evil.test/x)")).not.toContain("<iframe");
    expect(renderMarkdown("@[youtube](not-an-id!!)")).not.toContain("<iframe");
    expect(renderMarkdown("@[daily](12345)")).not.toContain("<iframe");
  });
});

describe("quotes and the old contract", () => {
  it("renders consecutive quote lines as one blockquote", () => {
    const html = renderMarkdown("> First.\n> Second.");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("First. Second.");
  });

  it("keeps headings, lists, links, and escaping as they were", () => {
    const html = renderMarkdown("## Title\n\n- a\n- b\n\n[Docs](/docs) and **bold**.");
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(html).toContain('<a href="/docs">Docs</a>');
    expect(html).toContain("<strong>bold</strong>");
    expect(renderMarkdown("<img src=x onerror=alert(1)>")).not.toContain("<img");
  });
});
