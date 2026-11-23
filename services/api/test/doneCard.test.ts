import { describe, expect, it } from "vitest";
import { ADCODE_ICON_SVG, DONE_CARD_CSS, doneCardDocument, doneCardHtml, maskEmail } from "../src/doneCard.ts";

describe("the shared success card", () => {
  it("masks an email to its first letter and domain", () => {
    expect(maskEmail("bluebird.dev@gmail.com")).toBe("b***@gmail.com");
    expect(maskEmail("a@b.co")).toBe("a***@b.co");
    expect(maskEmail("no-at-sign")).toBe("");
    expect(maskEmail("@gmail.com")).toBe("");
    expect(maskEmail(null)).toBe("");
  });

  it("escapes every value it prints", () => {
    const html = doneCardHtml({
      title: "<b>Hi</b>",
      rows: [{ label: "A&B", value: "\"quoted\"" }],
      notes: ["<script>x</script>"],
      action: { kind: "link", label: "Go", href: "/x?a=1&b=\"2\"" },
    });
    expect(html).toContain("&lt;b&gt;Hi&lt;/b&gt;");
    expect(html).toContain("A&amp;B");
    expect(html).toContain("&quot;quoted&quot;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="/x?a=1&amp;b=&quot;2&quot;"');
    expect(html).not.toContain("<script>");
  });

  it("posts a form for actions that change something, so a mail scanner's GET cannot", () => {
    const html = doneCardHtml({ title: "Confirm", action: { kind: "post", label: "Confirm", action: "/v1/x", fields: { token: "t\"1" } } });
    expect(html).toContain('<form method="post" action="/v1/x">');
    expect(html).toContain('name="token" value="t&quot;1"');
    expect(html).toContain('<button type="submit" class="done-button">Confirm</button>');
  });

  it("leaves out the table and the buttons when there is nothing to put in them", () => {
    const html = doneCardHtml({ title: "Done" });
    expect(html).not.toContain("done-rows");
    expect(html).not.toContain("done-actions");
    expect(html).toContain(ADCODE_ICON_SVG);
  });

  it("is a complete document that follows the system theme and never uses an em-dash", () => {
    const page = doneCardDocument({ title: "You're signed in", rows: [{ label: "Account", value: "b***@gmail.com" }] }, { favicon: true });
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page).toContain("<title>You&#39;re signed in - ADCode</title>");
    expect(page).toContain('rel="icon"');
    expect(DONE_CARD_CSS).toContain("prefers-color-scheme:dark");
    expect(DONE_CARD_CSS).toContain('[data-theme="dark"]');
    expect(page).not.toMatch(/[–—]/);
  });
});
