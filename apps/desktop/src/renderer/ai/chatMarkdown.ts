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

/**
 * `*word*` as emphasis. Underscores are left alone on purpose: `snake_case_names` are
 * everywhere in a coding chat, and turning half of one italic is worse than never
 * italicising `_this_`. The asterisks must hug the words, so `2 * 3 * 4` stays maths.
 */
function renderItalic(html: string): string {
  return html.replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, "$1<em>$2</em>");
}

/**
 * Images the assistant itself produced, rendered as a rounded result card.
 *
 * Markdown `![alt](src)` is the only image syntax honoured — raw `<img>` HTML
 * stays escaped, so a model can never inject an element or attribute. Sources
 * are allow-listed (remote https, loopback http, image data URLs); anything
 * else falls back to plain text.
 */
export function isSafeMarkdownImageSrc(src: string): boolean {
  const value = src.trim();
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value)) return true;
  if (/^https:\/\//i.test(value)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i.test(value)) return true;
  return false;
}

function renderResultFigure(alt: string, src: string): string {
  const safeAlt = escapeHtml(alt.slice(0, 160));
  const safeSrc = escapeAttribute(src);
  const label = safeAlt.length > 0 ? safeAlt : "Generated preview";
  return (
    `<figure class="chat-result">` +
    `<div class="chat-result-media"><img class="chat-result-image" src="${safeSrc}" alt="${safeAlt}" loading="lazy"></div>` +
    `<figcaption class="chat-result-caption">${label}</figcaption></figure>`
  );
}

/** Split a raw text block on markdown images; text chunks stay inline HTML. */
function renderInlineWithImages(raw: string): string {
  const pattern = /!\[([^\]\n]*)\]\(([^)\s]+)\)/g;
  pattern.lastIndex = 0;
  if (!pattern.test(raw)) {
    return `<p class="chat-md-para">${renderChatInline(escapeHtml(raw.trim())).replace(/\n/g, "<br>")}</p>`;
  }
  pattern.lastIndex = 0;
  const out: string[] = [];
  let cursor = 0;
  for (const match of raw.matchAll(pattern)) {
    const index = match.index ?? 0;
    const before = raw.slice(cursor, index).trim();
    if (before.length > 0) {
      out.push(`<p class="chat-md-para">${renderChatInline(escapeHtml(before)).replace(/\n/g, "<br>")}</p>`);
    }
    const alt = match[1] ?? "";
    const src = match[2] ?? "";
    if (isSafeMarkdownImageSrc(src)) out.push(renderResultFigure(alt, src));
    else out.push(`<p class="chat-md-para">${renderChatInline(escapeHtml(match[0] ?? ""))}</p>`);
    cursor = index + (match[0] ?? "").length;
  }
  const after = raw.slice(cursor).trim();
  if (after.length > 0) {
    out.push(`<p class="chat-md-para">${renderChatInline(escapeHtml(after)).replace(/\n/g, "<br>")}</p>`);
  }
  return out.join("");
}

/** Inline code, bold, and file-reference buttons. Input must already be escaped. */
export function renderChatInline(escaped: string): string {
  const parts = escaped.split(/(`[^`\n]*`)/g);
  return parts
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
        return `<code class="chat-inline-code">${part.slice(1, -1)}</code>`;
      }
      return renderReferenceButtons(renderItalic(renderBold(part)));
    })
    .join("");
}

type LineKind = "ol" | "ul" | "quote" | "heading" | "rule" | "text";

// Three digits at most, so a sentence that opens with a year ("2026. was...") stays prose.
const ORDERED = /^\s*(\d{1,3})[.)]\s+(?=\S)/;
const BULLET = /^\s*[-*•+]\s+(?=\S)/;
const QUOTE = /^\s*>\s?/;
const HEADING = /^\s*(#{1,6})\s+(?=\S)/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

function lineKind(line: string): LineKind {
  if (RULE.test(line)) return "rule";
  if (HEADING.test(line)) return "heading";
  if (QUOTE.test(line)) return "quote";
  if (ORDERED.test(line)) return "ol";
  if (BULLET.test(line)) return "ul";
  return "text";
}

/**
 * One paragraph-separated block, read line by line, the way a model actually writes:
 * a heading straight above its list, a sentence that introduces the bullets under it,
 * a quote in the middle of an explanation. The old renderer only recognised a block that
 * was *all* list or *all* heading, so "## What I'll build" followed by "1. ..." printed
 * the hashes, and "> note" printed the angle bracket.
 *
 * A line that is not a new item continues the item above it (a wrapped bullet); runs of
 * plain lines stay one paragraph with their line breaks.
 */
function renderTextBlock(block: string): string {
  const lines = block.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return "";
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;
    const kind = lineKind(line);
    if (kind === "rule") {
      out.push(`<hr class="chat-md-rule">`);
      index += 1;
      continue;
    }
    if (kind === "heading") {
      const level = Math.min(3, (HEADING.exec(line)?.[1] ?? "##").length);
      const text = line.replace(HEADING, "");
      out.push(`<h${level + 2} class="chat-md-heading" data-level="${level}">${renderChatInline(escapeHtml(text))}</h${level + 2}>`);
      index += 1;
      continue;
    }
    if (kind === "quote") {
      const quoted: string[] = [];
      while (index < lines.length && lineKind(lines[index] as string) === "quote") {
        quoted.push((lines[index] as string).replace(QUOTE, ""));
        index += 1;
      }
      out.push(`<blockquote class="chat-md-quote">${renderChatInline(escapeHtml(quoted.join("\n"))).replace(/\n/g, "<br>")}</blockquote>`);
      continue;
    }
    if (kind === "ol" || kind === "ul") {
      const marker = kind === "ol" ? ORDERED : BULLET;
      const items: string[] = [];
      const start = kind === "ol" ? Number(ORDERED.exec(line)?.[1] ?? "1") : 1;
      while (index < lines.length) {
        const current = lines[index] as string;
        const currentKind = lineKind(current);
        if (currentKind === kind) items.push(current.replace(marker, ""));
        else if (currentKind === "text" && items.length > 0 && /^\s+/.test(current)) items[items.length - 1] += ` ${current.trim()}`;
        else break;
        index += 1;
      }
      const tag = kind;
      const startAttribute = tag === "ol" && start !== 1 ? ` start="${String(start)}"` : "";
      const body = items.map((item) => `<li>${renderChatInline(escapeHtml(item))}</li>`).join("");
      out.push(`<${tag} class="chat-md-list"${startAttribute}>${body}</${tag}>`);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lineKind(lines[index] as string) === "text") {
      paragraph.push(lines[index] as string);
      index += 1;
    }
    out.push(renderInlineWithImages(paragraph.join("\n")));
  }
  return out.join("");
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
