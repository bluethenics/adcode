/**
 * What a reply may draw beyond text, and a conversation as a file. The first is a safety
 * boundary: model output becomes markup here, so each rule is tested with the input that
 * would break it.
 */
import { describe, expect, it } from "vitest";
import { renderChatMessageHtml } from "../src/renderer/ai/chatMarkdown.ts";
import { isSafeChatLink, renderChatButtons, renderChatMockup } from "../src/renderer/ai/chatRich.ts";
import { exportConversationText, exportFileName } from "../src/renderer/ai/chatExport.ts";

describe("links in a reply", () => {
  it("allows the web and this machine, and nothing else", () => {
    expect(isSafeChatLink("https://example.com/a?b=1&c=2")).toBe(true);
    expect(isSafeChatLink("http://localhost:5173/")).toBe(true);
    expect(isSafeChatLink("http://example.com/")).toBe(false);
    expect(isSafeChatLink("javascript:alert(1)")).toBe(false);
    expect(isSafeChatLink("file:///C:/secret.txt")).toBe(false);
    expect(isSafeChatLink('https://example.com/"onclick="x')).toBe(false);
  });

  it("turns a markdown link into a button carrying its address, never an anchor", () => {
    const html = renderChatMessageHtml("Read [the docs](https://example.com/docs?a=1&b=2) first.");
    expect(html).toContain('<button type="button" class="chat-link" data-chat-link="https://example.com/docs?a=1&amp;b=2"');
    expect(html).not.toContain("<a ");
  });

  it("leaves an unsafe link as the text that was written", () => {
    const html = renderChatMessageHtml("[click](http://evil.example/)");
    expect(html).not.toContain("data-chat-link");
    expect(html).toContain("[click]");
  });

  it("still shows a markdown image as an image, not a link", () => {
    const html = renderChatMessageHtml("![logo](https://example.com/logo.png)");
    expect(html).toContain("chat-result-image");
    expect(html).not.toContain("chat-link");
  });
});

describe("a buttons block", () => {
  it("draws one button per safe line, in either form", () => {
    const html = renderChatButtons("Open dashboard | https://app.example.com\n[Docs](https://example.com/docs)\nBad | javascript:alert(1)\njust words");
    expect(html.match(/chat-action-button/g)).toHaveLength(2);
    expect(html).toContain(">Open dashboard</button>");
    expect(html).toContain('data-chat-link="https://example.com/docs"');
    expect(html).not.toContain("javascript");
  });

  it("escapes a label and falls back to a code block when no line qualifies", () => {
    expect(renderChatButtons("<img src=x onerror=1> | https://example.com")).toContain("&lt;img src=x onerror=1&gt;");
    expect(renderChatButtons("nothing here")).toBe("");
    expect(renderChatMessageHtml("```buttons\nnothing here\n```")).toContain("chat-codeblock");
  });
});

describe("a mockup block", () => {
  it("is drawn in a frame with every permission off, its markup held in an attribute", () => {
    const html = renderChatMessageHtml('```mockup\n<button onclick="alert(1)">Buy</button><script>fetch("/x")</script>\n```');
    expect(html).toContain('<iframe class="chat-mockup-frame" sandbox=""');
    // Nothing of the model's HTML is live in this document: it exists only escaped inside srcdoc and the source view.
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('<button onclick');
    expect(html).toContain("&lt;script&gt;");
  });

  it("refuses an empty or enormous mockup", () => {
    expect(renderChatMockup("   ", "")).toBe("");
    expect(renderChatMockup("x".repeat(60_001), "")).toBe("");
  });
});

describe("exporting a conversation", () => {
  const when = new Date("2026-11-10T09:30:00Z");
  const messages = [["user", "Add a contact form"], ["assistant", "Done. It is in **contact.html**."]] as const;

  it("names the file after the conversation, safely", () => {
    expect(exportFileName("Fix: the <login> page / flow?", "markdown", when)).toBe("fix-the-login-page-flow-2026-11-10.md");
    expect(exportFileName("???", "json", when)).toBe("conversation-2026-11-10.json");
  });

  it("writes Markdown a person can read", () => {
    const { text } = exportConversationText("Contact form", messages, "markdown", when);
    expect(text).toBe("# Contact form\n\n_Exported from ADCode on 2026-11-10_\n\n## You\n\nAdd a contact form\n\n## ADCode\n\nDone. It is in **contact.html**.\n");
  });

  it("writes JSON the importer reads back", () => {
    const { text } = exportConversationText("Contact form", messages, "json", when);
    expect(JSON.parse(text)).toEqual({ format: "adcode-conversation", version: 1, title: "Contact form", exportedAt: "2026-11-10T09:30:00.000Z", messages: [{ role: "user", text: "Add a contact form" }, { role: "assistant", text: "Done. It is in **contact.html**." }] });
  });
});
