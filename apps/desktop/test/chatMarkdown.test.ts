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
