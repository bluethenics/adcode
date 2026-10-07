import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  groupChatSessions,
  renderChatMessageHtml,
  splitChatContent,
} from "../src/renderer/ai/chatMarkdown.ts";

describe("chatMarkdown", () => {
  it("escapes HTML before adding markup", () => {
    const html = renderChatMessageHtml(`<img src=x onerror=alert(1)> **bold**`);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders fenced code with language and copy button", () => {
    const html = renderChatMessageHtml("```powershell\ncmd /c \"npm i\"\n```");
    expect(html).toContain('class="chat-codeblock"');
    expect(html).toContain('data-language="powershell"');
    expect(html).toContain("powershell");
    expect(html).toContain('class="chat-codeblock-copy"');
    expect(html).toContain("cmd /c &quot;npm i&quot;");
  });

  it("keeps file links out of code blocks and renders them as buttons", () => {
    const html = renderChatMessageHtml(
      "See [src/a.ts](src/a.ts#L2) and ```js\n[not a link](x)\n```",
    );
    expect(html).toContain('class="chat-code-reference"');
    expect(html).toContain('data-path="src/a.ts"');
    expect(html).toContain("[not a link](x)");
  });

  it("renders numbered steps and inline code", () => {
    const html = renderChatMessageHtml("1. Or run npm through `cmd` for this command:");
    expect(html).toContain("<ol");
    expect(html).toContain('<code class="chat-inline-code">cmd</code>');
  });

  it("reads a heading, its list and a closing sentence in one block", () => {
    const html = renderChatMessageHtml("## What I'll build\n1. **index.html** - the page\n2. game.js\nThat is all.");
    expect(html).not.toContain("##");
    expect(html).toContain('<h4 class="chat-md-heading" data-level="2">What I&#39;ll build</h4>');
    expect(html).toContain('<ol class="chat-md-list"><li><strong>index.html</strong> - the page</li><li>game.js</li></ol>');
    expect(html).toContain('<p class="chat-md-para">That is all.</p>');
  });

  it("renders quotes, rules, emphasis and a list that starts later", () => {
    const html = renderChatMessageHtml("> saved *locally*\n> twice\n\n---\n\n3. third\n4. fourth\n\n2 * 3 * 4 and snake_case_name");
    expect(html).toContain('<blockquote class="chat-md-quote">saved <em>locally</em><br>twice</blockquote>');
    expect(html).toContain('<hr class="chat-md-rule">');
    expect(html).toContain('<ol class="chat-md-list" start="3">');
    expect(html).toContain("2 * 3 * 4 and snake_case_name");
    expect(html).not.toContain("&gt; saved");
  });

  it("keeps a wrapped bullet in its item and a year as prose", () => {
    const html = renderChatMessageHtml("- first item\n  continues here\n- second\n\n2026. was a good year");
    expect(html).toContain("<li>first item continues here</li><li>second</li>");
    expect(html).toContain('<p class="chat-md-para">2026. was a good year</p>');
  });

  it("splits unclosed fences as code rather than throwing", () => {
    const segments = splitChatContent("hello ```js\nconst a = 1;");
    expect(segments.some((segment) => segment.kind === "code")).toBe(true);
    expect(escapeHtml("<&>")).toBe("&lt;&amp;&gt;");
  });

  it("groups chats Today / Yesterday / week / month / older, newest first", () => {
    const noon = new Date(2026, 8, 13, 12, 0, 0).getTime();
    const day = 24 * 60 * 60 * 1000;
    const groups = groupChatSessions(
      [
        { id: "old", title: "Old", updatedAt: noon - 40 * day },
        { id: "today", title: "Today", updatedAt: noon - 60_000 },
        { id: "week", title: "Week", updatedAt: noon - 3 * day },
        { id: "yesterday", title: "Yesterday", updatedAt: noon - day - 60_000 },
      ],
      noon,
    );
    expect(groups.map((group) => group.label)).toEqual([
      "Today",
      "Yesterday",
      "Previous 7 days",
      "Older",
    ]);
    expect(groups[0]?.sessions[0]?.id).toBe("today");
  });
});
