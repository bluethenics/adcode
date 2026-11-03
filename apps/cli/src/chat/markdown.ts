import type { UI } from "../tui/ui.ts";
import { stripAnsi, visibleWidth, wrapPlain } from "../tui/ansi.ts";

/**
 * A small Markdown reader for the transcript.
 *
 * Models answer in Markdown, and a terminal that prints the asterisks looks broken. This
 * understands the subset that chat actually produces - headings, lists, quotes, rules,
 * fenced code, inline code, emphasis and links - and deliberately ignores the rest, which
 * is the right failure mode: an unknown construct stays readable as plain text.
 */

export interface MarkdownOptions {
  readonly width: number;
  readonly ui: UI;
}

const FENCE = /^\s*(```|~~~)\s*([\w.+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;

function plainInline(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1$2")
    .replace(/~~([^~]+)~~/g, "$1");
}

/** Style the inline spans of one already-wrapped line. */
function inline(ui: UI, value: string): string {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*|_[^_]+_)/g;
  let output = "";
  let index = 0;
  for (const match of value.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > index) output += value.slice(index, start);
    if (token.startsWith("**") || token.startsWith("__")) {
      output += ui.paint(token.slice(2, -2), "ink", { bold: true });
    } else if (token.startsWith("`")) {
      output += ui.paint(token.slice(1, -1), "info");
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const label = link?.[1] ?? token;
      const url = link?.[2] ?? "";
      output += ui.paint(label, "accent", { underline: true });
      if (url.length > 0 && url !== label) output += ui.paint(` (${url})`, "faint");
    } else {
      output += ui.paint(token.slice(1, -1), "ink", { italic: true });
    }
    index = start + token.length;
  }
  if (index < value.length) output += value.slice(index);
  return output;
}

function wrapInline(ui: UI, text: string, width: number): string[] {
  const visible = plainInline(text).trimEnd();
  if (visible.length === 0) return [""];
  // Wrap the visible text, then style each line. Emphasis that crosses a line break keeps
  // its words and loses only its weight, which is the least surprising outcome in a pipe.
  return wrapPlain(visible, Math.max(4, width)).map((line) => inline(ui, line));
}

function codeBlock(ui: UI, language: string, lines: readonly string[], width: number): string[] {
  // The language is the whole label. A run glyph here reads as "press enter", which a
  // fence is not.
  const title = language.length > 0 ? language : "code";
  const boxWidth = Math.max(20, Math.min(width, Math.max(28, ...lines.map((line) => visibleWidth(line) + 4))));
  return ui.box({
    title,
    titleTone: "faint",
    borderTone: "borderSoft",
    padding: 1,
    width: boxWidth,
    lines: lines.length === 0 ? [""] : lines.map((line) => ui.paint(line, "ink")),
  });
}

export function renderMarkdown(text: string, options: MarkdownOptions): string[] {
  const { ui } = options;
  const width = Math.max(8, Math.floor(options.width));
  const source = String(text).replace(/\r\n/g, "\n");
  const output: string[] = [];

  let fence: string | null = null;
  let language = "";
  let code: string[] = [];

  const flushCode = (): void => {
    output.push(...codeBlock(ui, language, code, width));
    code = [];
    language = "";
  };

  for (const rawLine of source.split("\n")) {
    if (fence !== null) {
      if (rawLine.trim().startsWith(fence)) {
        flushCode();
        fence = null;
        continue;
      }
      code.push(rawLine.replace(/\t/g, "  "));
      continue;
    }

    const fenceMatch = FENCE.exec(rawLine);
    if (fenceMatch !== null) {
      fence = fenceMatch[1] ?? "```";
      language = fenceMatch[2] ?? "";
      continue;
    }

    if (rawLine.trim().length === 0) {
      if (output.length > 0 && output.at(-1) !== "") output.push("");
      continue;
    }

    if (RULE.test(rawLine)) {
      output.push(ui.paint(ui.glyphs.horizontal.repeat(Math.max(4, Math.min(width, 40))), "borderSoft"));
      continue;
    }

    const heading = HEADING.exec(rawLine);
    if (heading !== null) {
      const level = heading[1]?.length ?? 1;
      const label = plainInline(heading[2] ?? "");
      output.push(
        ui.paint(level <= 2 ? label.toUpperCase() : label, level <= 2 ? "ink" : "muted", { bold: true }),
      );
      if (level === 1) output.push(ui.paint(ui.glyphs.horizontal.repeat(Math.min(width, Math.max(4, visibleWidth(label)))), "borderSoft"));
      continue;
    }

    const bullet = BULLET.exec(rawLine);
    if (bullet !== null) {
      const indent = Math.min(4, (bullet[1] ?? "").length);
      const prefix = `${" ".repeat(indent)}${ui.paint(ui.glyphs.bullet, "accent")} `;
      const lines = wrapInline(ui, bullet[2] ?? "", width - visibleWidth(prefix));
      lines.forEach((line, index) => output.push(`${index === 0 ? prefix : " ".repeat(visibleWidth(prefix))}${line}`));
      continue;
    }

    const numbered = NUMBERED.exec(rawLine);
    if (numbered !== null) {
      const indent = Math.min(4, (numbered[1] ?? "").length);
      const number = `${ui.paint(`${numbered[2]}.`, "faint")} `;
      const prefix = `${" ".repeat(indent)}${number}`;
      const lines = wrapInline(ui, numbered[3] ?? "", width - visibleWidth(prefix));
      lines.forEach((line, index) => output.push(`${index === 0 ? prefix : " ".repeat(visibleWidth(prefix))}${line}`));
      continue;
    }

    const quote = QUOTE.exec(rawLine);
    if (quote !== null) {
      const rule = ui.paint(ui.glyphs.vertical, "border");
      for (const line of wrapInline(ui, quote[1] ?? "", width - 3)) {
        output.push(`${rule}  ${ui.paint(stripAnsi(line), "muted")}`);
      }
      continue;
    }

    // A pipe table is common enough to be worth keeping, but not worth a layout engine.
    if (rawLine.trim().startsWith("|") && rawLine.trim().endsWith("|")) {
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(rawLine)) continue;
      const cells = rawLine.trim().slice(1, -1).split("|").map((cell) => cell.trim());
      output.push(`  ${cells.map((cell) => ui.paint(cell, "muted")).join(ui.paint(" · ", "borderSoft"))}`);
      continue;
    }

    for (const line of wrapInline(ui, rawLine, width)) output.push(line);
  }

  if (fence !== null) flushCode();
  while (output.at(-1) === "") output.pop();
  return output;
}
