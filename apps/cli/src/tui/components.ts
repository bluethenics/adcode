import { visibleWidth, wrapPlain } from "./ansi.ts";
import type { UI } from "./ui.ts";

export interface CommandHeaderOptions {
  readonly title?: string;
  readonly subtitle?: string;
  readonly note?: string;
}

export function commandHeader(ui: UI, options: CommandHeaderOptions = {}): string[] {
  const label = String(options.title ?? "");
  const prefix = `  ${ui.gradient(ui.glyphs.mark)}  `;
  const labelWidth = Math.max(1, ui.width - visibleWidth(prefix));
  const lines = ["", `${prefix}${ui.paint(ui.truncate(label, labelWidth), "ink", { bold: true })}`];
  const textWidth = Math.max(8, ui.width - 5);
  if (options.subtitle !== undefined) {
    for (const line of wrapPlain(options.subtitle, textWidth)) {
      lines.push(`     ${ui.paint(line, "muted")}`);
    }
  }
  if (options.note !== undefined) {
    for (const line of wrapPlain(options.note, textWidth)) {
      lines.push(`     ${ui.paint(line, "faint")}`);
    }
  }
  lines.push("");
  return lines;
}

export interface CommandHint {
  readonly label: string;
  readonly command: string;
  readonly tone?: string;
}

export function commandHints(ui: UI, hints: readonly CommandHint[], width = ui.width): string[] {
  const lines: string[] = [];
  for (const hint of hints) {
    const label = String(hint.label);
    const command = String(hint.command);
    const tone = hint.tone ?? "accent";
    const prefix = `  ${ui.paint(label.padEnd(8), "faint")}`;
    if (visibleWidth(prefix) + visibleWidth(command) <= width) {
      lines.push(`${prefix}${ui.paint(command, tone)}`);
      continue;
    }
    lines.push(`  ${ui.paint(label, "faint")}`);
    for (const piece of wrapPlain(command, Math.max(4, width - 2))) {
      lines.push(`  ${ui.paint(ui.truncate(piece, Math.max(1, width - 2)), tone)}`);
    }
  }
  return lines;
}

export function sectionHeader(ui: UI, index: string, title: string, width = ui.width - 4, note?: string): string[] {
  // An unnumbered section starts at the margin rather than behind an empty number column.
  const number = index.length === 0 ? "" : /^\d+$/.test(index) ? index.padStart(2, "0") : index.padEnd(2);
  const base = number.length === 0 ? 2 : 2 + number.length + 2;
  const headingText = title.toUpperCase();
  const headingRoom = Math.max(1, width - base);
  const heading = ui.truncate(headingText, headingRoom);
  const used = base + visibleWidth(heading);
  const ruleWidth = width - used - 2;
  const withRule = ruleWidth >= 4;
  const left = number.length === 0
    ? `  ${ui.paint(heading, "ink", { bold: true })}`
    : `  ${ui.paint(number, "faint")}  ${ui.paint(heading, "ink", { bold: true })}`;
  const line = withRule ? `${left}  ${ui.paint(ui.glyphs.horizontal.repeat(ruleWidth), "borderSoft")}` : ui.truncate(left, width);
  const noteLines = note === undefined ? [] : wrapPlain(note, Math.max(4, width - 5)).map((part) => `     ${ui.paint(part, "faint")}`);
  return note === undefined ? [line, ""] : [line, ...noteLines, ""];
}

export interface ErrorPanelOptions {
  readonly title?: string;
  readonly message: string;
  readonly hint?: string;
  readonly details?: string;
  readonly width?: number;
}

export function errorPanel(ui: UI, options: ErrorPanelOptions): string[] {
  const panelWidth = options.width ?? Math.min(ui.width - 4, 96);
  const textWidth = panelWidth - 4;
  const lines: string[] = [];
  for (const line of wrapPlain(options.message, textWidth)) lines.push(ui.paint(line, "ink"));
  if (options.hint !== undefined) {
    lines.push("");
    const hintLines = wrapPlain(options.hint, Math.max(10, textWidth - 6));
    hintLines.forEach((line, index) => {
      const prefix = index === 0 ? `${ui.paint("Try", "muted")}   ` : "      ";
      lines.push(`${prefix}${ui.paint(line, "accent")}`);
    });
  }
  if (options.details !== undefined) {
    lines.push("");
    for (const line of wrapPlain(options.details, textWidth)) lines.push(ui.paint(line, "faint"));
  }
  return ui.box({
    title: `${ui.glyphs.cross} ${(options.title ?? "Something went wrong").toUpperCase()}`,
    titleTone: "danger",
    borderTone: "border",
    lines,
    width: panelWidth,
  });
}

export interface SuccessPanelOptions {
  readonly title?: string;
  readonly message?: string;
  readonly next?: string;
  readonly details?: string;
  readonly width?: number;
}

export function successPanel(ui: UI, options: SuccessPanelOptions): string[] {
  const panelWidth = options.width ?? Math.min(ui.width - 4, 96);
  const textWidth = panelWidth - 4;
  const lines: string[] = [];
  if (options.message !== undefined) {
    for (const line of wrapPlain(options.message, textWidth)) lines.push(ui.paint(line, "ink"));
  }
  if (options.next !== undefined) {
    if (lines.length > 0) lines.push("");
    lines.push(`${ui.paint("Next", "muted")}   ${ui.paint(options.next, "accent")}`);
  }
  if (options.details !== undefined) {
    if (lines.length > 0) lines.push("");
    for (const line of wrapPlain(options.details, textWidth)) lines.push(ui.paint(line, "faint"));
  }
  return ui.box({
    title: `${ui.glyphs.check} ${(options.title ?? "Done").toUpperCase()}`,
    titleTone: "success",
    borderTone: "border",
    lines,
    width: panelWidth,
  });
}

export function hintLine(ui: UI, label: string, value: string, options: { width?: number; labelTone?: string; valueTone?: string } = {}): string {
  return (
    `  ${ui.paint(String(label).padEnd(options.width ?? 8), options.labelTone ?? "faint")}` +
    `${ui.paint(value, options.valueTone ?? "muted")}`
  );
}

export function keyHints(ui: UI, pairs: ReadonlyArray<readonly [string, string]>): string {
  return pairs
    .map(([key, label]) => `${ui.paint(key, "ink", { bold: true })} ${ui.paint(label, "faint")}`)
    .join(` ${ui.paint(ui.glyphs.dot, "borderSoft")}   `);
}

export interface PaletteItem {
  readonly command: string;
  readonly blurb: string;
}

export interface CommandPaletteOptions {
  readonly items: readonly PaletteItem[];
  readonly index: number;
  readonly width: number;
  readonly maxRows?: number;
  readonly emptyText?: string;
}

/**
 * The list every command surface shares. The selected row is a single filled band, the
 * way a palette should read: one thing, clearly chosen, with the rest quiet behind it.
 */
export function commandPalette(ui: UI, options: CommandPaletteOptions): string[] {
  const width = Math.max(12, options.width);
  const rowWidth = width;
  const items = options.items;
  if (items.length === 0) {
    return [`  ${ui.truncate(ui.paint(options.emptyText ?? "No commands match.", "faint"), width - 2)}`];
  }
  const maxRows = Math.max(1, Math.floor(options.maxRows ?? 8));
  const rows = Math.min(maxRows, items.length);
  const active = Math.max(0, Math.min(items.length - 1, Math.floor(options.index)));
  const start = Math.max(0, Math.min(active - Math.floor(rows / 2), Math.max(0, items.length - rows)));
  const visible = items.slice(start, start + rows);
  const commandWidth = Math.min(14, Math.max(8, ...items.map((item) => visibleWidth(item.command))));
  const showBlurb = rowWidth >= commandWidth + 12;
  const lines: string[] = [];
  for (const [offset, item] of visible.entries()) {
    const absolute = start + offset;
    const selected = absolute === active;
    const command = item.command.padEnd(commandWidth);
    const blurb = showBlurb ? item.blurb : "";
    const plain = blurb.length > 0 ? `  ${command}  ${blurb}` : `  ${command}`;
    if (selected) {
      lines.push(ui.solidRow(plain, rowWidth, { fg: "selectedText", bg: "selected" }));
    } else {
      const room = Math.max(4, rowWidth - commandWidth - 2);
      lines.push(
        `  ${ui.paint(command, "ink")}${blurb.length === 0 ? "" : `  ${ui.paint(ui.truncate(blurb, room), "faint")}`}`,
      );
    }
  }
  return lines.map((line) => ui.truncate(ui.fit(line, width, "left"), width));
}

export interface PromptBlockOptions {
  readonly width: number;
  readonly placeholder: string;
  readonly before?: string;
  readonly after?: string;
  readonly caretOn?: boolean;
  readonly compact?: boolean;
}

function trimStart(value: string, amount: number): string {
  return [...value].slice(Math.max(0, amount)).join("");
}

/**
 * The input surface. It is deliberately one filled band with a single blue rail, not a
 * rounded box: the prompt is the loudest thing on the screen, and everything else gets out
 * of its way.
 */
export function promptBlock(ui: UI, options: PromptBlockOptions): string[] {
  const width = Math.max(12, Math.floor(options.width));
  const inner = Math.max(4, width - 3);
  const before = options.before ?? "";
  const after = options.after ?? "";
  const empty = before.length === 0 && after.length === 0;
  const caretText = options.caretOn === false ? " " : ui.glyphs.caret;
  const placeholder = empty ? ui.truncate(options.placeholder, inner - 2) : "";

  let beforeText = empty ? placeholder : before;
  let afterText = empty ? "" : after;
  const room = Math.max(0, inner - 2);
  while (visibleWidth(beforeText) + visibleWidth(afterText) > room && afterText.length > 0) {
    afterText = [...afterText].slice(0, -1).join("");
  }
  while (visibleWidth(beforeText) + visibleWidth(afterText) > room && beforeText.length > 0) {
    beforeText = trimStart(beforeText, 1);
  }

  const background = "panelSoft";
  const textTone = empty ? "faint" : "ink";
  const leading = ui.style(" ", { bg: background });
  const beforeStyled = ui.style(beforeText, { fg: textTone, bg: background });
  const caretStyled = ui.style(caretText, { fg: "accent", bg: background });
  const afterStyled = ui.style(afterText, { fg: "ink", bg: background });
  const used = 1 + visibleWidth(beforeText) + visibleWidth(caretText) + visibleWidth(afterText);
  const padding = ui.style(" ".repeat(Math.max(0, inner - used)), { bg: background });
  const rail = ui.paint(ui.glyphs.mark, "accent");
  const body = `  ${rail}${leading}${beforeStyled}${caretStyled}${afterStyled}${padding}`;
  if (options.compact === true) return [ui.truncate(body, width)];
  const blank = `  ${rail}${ui.solidRow("", inner, { bg: background })}`;
  return [blank, ui.truncate(body, width), blank];
}

export function centerLine(value: string, width: number): string {
  const gap = Math.max(0, width - visibleWidth(value));
  return `${" ".repeat(Math.floor(gap / 2))}${value}`;
}

export function topPad(lines: readonly string[], height: number): string[] {
  const padding = Math.max(0, Math.floor((height - lines.length) / 2));
  return [...Array.from({ length: padding }, () => ""), ...lines];
}

export function rightAlign(left: string, right: string, width: number): string {
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  return `${left}${" ".repeat(gap)}${right}`;
}

export function printLines(lines: readonly string[], out: NodeJS.WriteStream = process.stdout): void {
  out.write(`${lines.join("\n")}\n`);
}

export function bullets(ui: UI, items: readonly string[], options: { tone?: string; indent?: string; width?: number } = {}): string[] {
  const lines: string[] = [];
  const indent = options.indent ?? "  ";
  for (const item of items) {
    const wrapped = wrapPlain(String(item), Math.max(10, (options.width ?? ui.width - 8) - 4));
    wrapped.forEach((line, index) => {
      lines.push(`${indent}${index === 0 ? ui.paint(ui.glyphs.check, options.tone ?? "success") : " "} ${ui.paint(line, "muted")}`);
    });
  }
  return lines;
}

export function quote(ui: UI, value: string, width = ui.width - 8): string[] {
  const lines = wrapPlain(String(value), Math.max(16, width - 4));
  return lines.map((line, index) => {
    const prefix = index === 0 ? `${ui.paint(ui.glyphs.quote ?? "\"", "faint")} ` : "  ";
    return `  ${prefix}${ui.paint(line, "ink")}`;
  });
}

export function divider(ui: UI, label?: string): string {
  return ui.rule(Math.max(8, ui.width - 4), label === undefined ? {} : { label });
}

export function badge(ui: UI, text: string, tone: "success" | "warning" | "danger" | "muted" = "muted"): string {
  return ui.chip(text, { tone, background: "panelSoft" });
}
