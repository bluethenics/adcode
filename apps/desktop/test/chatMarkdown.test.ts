import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  groupChatForks,
  groupChatSessions,
  renderChatMessageHtml,
  splitChatContent,
} from "../src/renderer/ai/chatMarkdown.ts";

describe("chatMarkdown", () => {
  it("bolds text that starts or ends with inline code, and never reads code as formatting", () => {
    const html = renderChatMessageHtml("1. **`fitLine` was broken** - slope used `dyy/dxy`\n2. **Fixed `fitCircle`** too\n3. Keep `**not bold**` and `a*b*c` literal");
    expect(html).toContain('<strong><code class="chat-inline-code">fitLine</code> was broken</strong>');
    expect(html).toContain('<strong>Fixed <code class="chat-inline-code">fitCircle</code></strong>');
    expect(html).toContain('<code class="chat-inline-code">**not bold**</code>');
    expect(html).toContain('<code class="chat-inline-code">a*b*c</code>');
    expect(html).not.toMatch(/\*\*<code|<\/code> was broken\*\*/);
    expect(html).not.toContain("");
  });
  it("renders the file summary as a real table between prose and a heading", () => {
    const html = renderChatMessageHtml("What was built (3 files)\n| File | Purpose |\n|---|---|\n| `index.html` | App shell |\n| `styles.css` | **Full styling** |\n| [app.js](app.js#L2) | All logic |\n## Features\n- Notes");
    expect(html).toContain('<table class="chat-md-table"><thead><tr><th scope="col"');
    expect(html).toContain('<code class="chat-inline-code">index.html</code></td>');
    expect(html).toContain('<strong>Full styling</strong>');
    expect(html).toContain('data-path="app.js"');
    expect(html.match(/<tbody><tr>|<\/tr><tr>/g)).toHaveLength(3);
    expect(html).toContain('</table></div><h4');
    expect(html).not.toContain('|---|');
  });

  it("keeps escaped and code pipes in cells and applies column alignment safely", () => {
    const html = renderChatMessageHtml('| Name | Value | Count |\n| :--- | :---: | ---: |\n| A\\|B | `left | right` | 2 |\n| <img src=x onerror=alert(1)> | only two |');
    expect(html).toContain('data-align="left">A|B</td>');
    expect(html).toContain('data-align="center"><code class="chat-inline-code">left | right</code></td>');
    expect(html).toContain('data-align="right">2</td>');
    expect(html).toContain('data-align="right"></td>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it("recognizes tables without outer pipes but keeps incomplete, malformed and fenced rows literal", () => {
    expect(renderChatMessageHtml('File | Purpose\n--- | ---\napp.js | Logic')).toContain('<table');
    expect(renderChatMessageHtml('| File | Purpose |\n|---')).not.toContain('<table');
    expect(renderChatMessageHtml('| File | Purpose |\n|---|---|---|\n|a|b|')).not.toContain('<table');
    expect(renderChatMessageHtml('```md\n| File | Purpose |\n|---|---|\n|a|b|\n```')).not.toContain('<table');
    expect(renderChatMessageHtml('Use a | b in a command.')).not.toContain('<table');
  });

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

  it("nests forks under their root in creation order and keeps orphans visible", () => {
    const sessions = [
      { id: "parent", title: "Parent", createdAt: 1, updatedAt: 10 },
      { id: "b", title: "Fork B", parentId: "parent", createdAt: 3, updatedAt: 8 },
      { id: "a", title: "Fork A", parentId: "parent", createdAt: 2, updatedAt: 9 },
      { id: "orphan", title: "Orphan", parentId: "gone", createdAt: 4, updatedAt: 7 },
    ];
    const { roots, children } = groupChatForks(sessions);
    expect(roots.map((root) => root.id)).toEqual(["parent", "orphan"]);
    expect(children.get("parent")?.map((fork) => fork.id)).toEqual(["a", "b"]);
  });

  it("buckets a family by its newest fork, not just the parent's last turn", () => {
    const sessions = [
      { id: "parent", title: "Parent", createdAt: 1, updatedAt: 5 },
      { id: "fork", title: "Fork", parentId: "parent", createdAt: 2, updatedAt: 20 },
      { id: "plain", title: "Plain", createdAt: 3, updatedAt: 10 },
    ];
    const { activity } = groupChatForks(sessions);
    expect(activity.get("parent")).toBe(20);
    expect(activity.get("plain")).toBe(10);
  });

  it("does not nest a fork under another fork", () => {
    const sessions = [
      { id: "parent", title: "Parent", createdAt: 1, updatedAt: 10 },
      { id: "fork", title: "Fork", parentId: "parent", createdAt: 2, updatedAt: 9 },
      { id: "nested", title: "Nested", parentId: "fork", createdAt: 3, updatedAt: 8 },
    ];
    const { roots, children } = groupChatForks(sessions);
    expect(roots.map((root) => root.id)).toEqual(["parent", "nested"]);
    expect(children.get("parent")?.map((fork) => fork.id)).toEqual(["fork"]);
  });
});
