/**
 * Claude-style rich message rendering for the Assistant transcript.
 *
 * Pure TypeScript: no Electron, no DOM, no storage - so the parsing and HTML
 * building are testable in milliseconds under `environment: node`.
 *
 * The caller sets the returned HTML via `innerHTML` on a bubble it owns, then
 * wires the buttons it finds inside (code-copy, code references). All values
 * are escaped before any markup is added, and inline rules run on the escaped
 * text so a model can never inject an element or attribute.
 */
import { parseCodeReference } from "../editor/codeReferences.ts";

export interface ChatTextSegment {
  readonly kind: "text";
  readonly text: string;
}

export interface ChatCodeSegment {
  readonly kind: "code";
  readonly language: string;
  readonly code: string;
}

export type ChatSegment = ChatTextSegment | ChatCodeSegment;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/\n/g, "&#10;");
}

/**
 * Split a message into text and fenced-code segments.
 *
 * Mirrors `codeReferenceParts` (leaves unclosed fences as code, never throws)
 * so file links inside ``` blocks stay literal sample text.
 */
export function splitChatContent(text: string): readonly ChatSegment[] {
  const segments: ChatSegment[] = [];
  const fence = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
  let cursor = 0;
  for (const match of text.matchAll(fence)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ kind: "text", text: text.slice(cursor, index) });
    segments.push({
      kind: "code",
      language: (match[1] ?? "").trim().slice(0, 32),
      code: (match[2] ?? "").replace(/\n$/, ""),
    });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  if (segments.length === 0) segments.push({ kind: "text", text: "" });
  return segments;
}

function renderReferenceButtons(escaped: string): string {
  return escaped.replace(
    /\[((?:\\.|[^\\\]])+)\]\(([^)\s]+)\)/g,
    (whole, label: string, target: string) => {
      const reference = parseCodeReference(target);
      if (!reference) return whole;
      const clean = String(label).replace(/\\([\\[\]])/g, "$1").replace(/^`(.*)`$/, "$1");
      return `<button type="button" class="chat-code-reference" data-path="${escapeAttribute(reference.path)}" data-line="${reference.line}" data-column="${reference.column}">${clean}</button>`;
    },
  );
}

function renderBold(escaped: string): string {
  return escaped.replace(/\*\*([^*][^*]*?)\*\*/g, "<strong>$1</strong>");
}

/** Inline code, bold, and file-reference buttons. Input must already be escaped. */
export function renderChatInline(escaped: string): string {
  const parts = escaped.split(/(`[^`\n]*`)/g);
  return parts
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
        return `<code class="chat-inline-code">${part.slice(1, -1)}</code>`;
      }
      return renderReferenceButtons(renderBold(part));
    })
    .join("");
}

function renderTextBlock(block: string): string {
  const lines = block.split("\n").map((line) => line.trimEnd());
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) return "";

  const numbered = nonEmpty.every((line) => /^\s*\d+[.)]\s+\S/.test(line));
  if (numbered) {
    const items = nonEmpty
      .map((line) => line.replace(/^\s*\d+[.)]\s+/, ""))
      .map((item) => `<li>${renderChatInline(escapeHtml(item))}</li>`)
      .join("");
    return `<ol class="chat-md-list">${items}</ol>`;
  }

  const bulleted = nonEmpty.every((line) => /^\s*[-*•]\s+\S/.test(line));
  if (bulleted) {
    const items = nonEmpty
      .map((line) => line.replace(/^\s*[-*•]\s+/, ""))
      .map((item) => `<li>${renderChatInline(escapeHtml(item))}</li>`)
      .join("");
    return `<ul class="chat-md-list">${items}</ul>`;
  }

  if (nonEmpty.length === 1 && /^#{1,3}\s+\S/.test(nonEmpty[0] as string)) {
    const heading = (nonEmpty[0] as string).replace(/^#{1,3}\s+/, "");
    return `<p class="chat-md-heading">${renderChatInline(escapeHtml(heading))}</p>`;
  }

  const inline = renderChatInline(escapeHtml(block.trim()));
  return `<p class="chat-md-para">${inline.replace(/\n/g, "<br>")}</p>`;
}

function renderCodeSegment(segment: ChatCodeSegment): string {
  const language = segment.language.length > 0 ? segment.language : "code";
  return (
    `<div class="chat-codeblock" data-language="${escapeAttribute(language)}">` +
    `<div class="chat-codeblock-header"><span class="chat-codeblock-lang">${escapeHtml(language)}</span>` +
    `<button type="button" class="chat-codeblock-copy">Copy</button></div>` +
    `<pre class="chat-codeblock-body"><code>${escapeHtml(segment.code)}</code></pre></div>`
  );
}

/** Full message to safe HTML: code blocks, lists, bold, inline code, file links. */
export function renderChatMessageHtml(text: string): string {
  const out: string[] = [];
  for (const segment of splitChatContent(text)) {
    if (segment.kind === "code") {
      out.push(renderCodeSegment(segment));
      continue;
    }
    for (const block of segment.text.split(/\n{2,}/)) {
      const html = renderTextBlock(block);
      if (html.length > 0) out.push(html);
    }
  }
  return out.join("") || `<p class="chat-md-para"></p>`;
}

export interface ChatSessionGroup {
  readonly label: string;
  readonly sessions: readonly {
    readonly id: string;
    readonly title: string;
    readonly updatedAt: number;
  }[];
}

/**
 * Claude-style "Chats and tasks" grouping: Today, Yesterday, Previous 7 days,
 * Previous 30 days, Older. Pure date math on `updatedAt`, newest first.
 */
export function groupChatSessions(
  sessions: readonly { readonly id: string; readonly title: string; readonly updatedAt: number }[],
  now: number = Date.now(),
): readonly ChatSessionGroup[] {
  const startOfDay = (at: number): number => {
    const date = new Date(at);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const today = startOfDay(now);
  const day = 24 * 60 * 60 * 1000;
  const buckets: { label: string; sessions: { id: string; title: string; updatedAt: number }[] }[] = [
    { label: "Today", sessions: [] },
    { label: "Yesterday", sessions: [] },
    { label: "Previous 7 days", sessions: [] },
    { label: "Previous 30 days", sessions: [] },
    { label: "Older", sessions: [] },
  ];
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const session of sorted) {
    const age = today - startOfDay(session.updatedAt);
    const days = Math.round(age / day);
    const entry = { id: session.id, title: session.title, updatedAt: session.updatedAt };
    if (days <= 0) buckets[0]?.sessions.push(entry);
    else if (days === 1) buckets[1]?.sessions.push(entry);
    else if (days <= 7) buckets[2]?.sessions.push(entry);
    else if (days <= 30) buckets[3]?.sessions.push(entry);
    else buckets[4]?.sessions.push(entry);
  }
  return buckets.filter((bucket) => bucket.sessions.length > 0);
}
