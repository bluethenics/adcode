import type { UI } from "../tui/ui.ts";
import { visibleWidth, wrapPlain } from "../tui/ansi.ts";
import { commandPalette, keyHints, promptBlock, rightAlign, centerLine } from "../tui/components.ts";
import type { ChatSession } from "../ai/sessions.ts";
import type { CliModel, ModelSelection } from "../ai/catalogue.ts";
import { formatDuration, plural } from "../util/format.ts";
import { slashMatches } from "./commands.ts";
import { renderMarkdown } from "./markdown.ts";
import { brandLines } from "../tui/brand.ts";

/**
 * The conversation, dressed like the front door.
 *
 * Empty chat is a landing page: the wordmark, one sentence, the prompt. Once there is a
 * transcript the wordmark shrinks to a slim header and the bottom half becomes the fixed
 * furniture - composer, status, hints - the way a terminal tool should behave.
 */

export interface ChatNotice {
  readonly tone: "info" | "success" | "warning" | "danger";
  readonly title?: string;
  readonly message: string;
  readonly hint?: string;
  readonly expires?: number;
}

export interface PickerModel {
  readonly model: CliModel;
  readonly providerReady: boolean;
  readonly providerNote: string | null;
  readonly current: boolean;
}

export interface ChatState {
  session: ChatSession;
  model: ModelSelection;
  input: string[];
  cursor: number;
  history: string[];
  historyIndex: number | null;
  historyDraft: string;
  mode: "chat" | "picker" | "help";
  streaming: boolean;
  thinking: boolean;
  stopping: boolean;
  streamStartedAt: number;
  streamText: string;
  streamModelName: string;
  streamThought: string;
  streamThinkingStartedAt: number;
  streamThinkingMs: number;
  tokens: number;
  thinkingChars: number;
  scroll: number;
  scrollMaximum: number;
  notice: ChatNotice | null;
  phase: number;
  caretOn: boolean;
  pickerModels: PickerModel[];
  pickerIndex: number;
  pickerVisual: number;
  pickerFilter: string[];
  helpScroll: number;
  helpMaximum: number;
  saved: boolean;
  turnStartedAt: number;
  slashOpen: boolean;
  slashIndex: number;
  effort: string;
  cwd: string;
}

export interface ChatFrameOptions {
  readonly ui: UI;
  readonly state: ChatState;
  readonly ads: readonly string[];
  readonly width: number;
  readonly height: number;
}

const TONE: Readonly<Record<ChatNotice["tone"], string>> = {
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
};

function clock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function promptWidth(width: number): number {
  return Math.min(76, Math.max(20, width - 6));
}

function present(value: number): string {
  return String(Math.max(0, Math.floor(value)));
}

function headerLines(ui: UI, state: ChatState, width: number): string[] {
  const left = `  ${ui.gradient(ui.glyphs.mark, { phase: state.phase })}  ${ui.paint("ADCODE", "ink", { bold: true })}  ${ui.paint("CHAT", "faint")}`;
  const right = state.saved ? `${ui.paint("saved", "money")}  ${ui.paint(state.session.title, "faint")}` : ui.paint(state.session.title, "faint");
  const lines = [width < 58 ? left : rightAlign(left, right, width)];
  if (width >= 56) {
    lines.push(`  ${ui.paint(ui.glyphs.horizontal.repeat(Math.max(2, width - 4)), "borderSoft")}`);
  }
  return lines;
}

function messageHeader(ui: UI, state: ChatState, role: "user" | "assistant", at: number, width: number): string {
  if (role === "user") {
    return `  ${ui.paint("you", "muted", { bold: true })}  ${ui.paint(clock(at), "faint")}`;
  }
  const prefix = `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("ADCODE", "ink", { bold: true })}`;
  if (width < 32) return prefix;
  const model = state.streaming && state.streamModelName.length > 0
    ? state.streamModelName
    : state.session.model ?? state.model.modelName;
  const clockText = width >= 44 ? `  ${ui.paint(clock(at), "faint")}` : "";
  const room = Math.max(6, width - visibleWidth(prefix) - visibleWidth(clockText) - 2);
  return `${prefix}  ${ui.paint(ui.truncate(model, room), "faint")}${clockText}`;
}

function thoughtLines(ui: UI, text: string, milliseconds: number, width: number, active: boolean): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  const wrapped = wrapPlain(trimmed, Math.max(8, width - 8));
  const shown = wrapped.slice(0, 7);
  const duration = !active && milliseconds > 0 ? `  ${ui.paint(formatDuration(milliseconds), "faint")}` : "";
  const header = `  ${ui.paint(ui.glyphs.play, "accent")} ${ui.paint(active ? "thinking" : "thought", "muted", { bold: true })}${duration}`;
  const lines = [header];
  for (const line of shown) lines.push(`  ${ui.paint(ui.glyphs.vertical, "border")} ${ui.paint(line, "faint")}`);
  if (wrapped.length > shown.length) {
    lines.push(`  ${ui.paint(ui.glyphs.vertical, "border")} ${ui.paint(`${ui.glyphs.ellipsis} ${wrapped.length - shown.length} more lines`, "faint")}`);
  }
  return lines;
}

function spinnerLine(ui: UI, label: string): string {
  const frames = ui.glyphs.spinner;
  const glyph = frames[Math.floor(Date.now() / 90) % Math.max(1, frames.length)] ?? "-";
  return `  ${ui.paint(glyph, "money")} ${ui.paint(label, "faint")}`;
}

function markdownBlock(ui: UI, text: string, width: number, role: "user" | "assistant", streaming: boolean, caretOn: boolean): string[] {
  if (text.length === 0) return [];
  const body = renderMarkdown(text, { ui, width: Math.max(8, width - 7) });
  const lines = body.length === 0 ? [""] : body;
  const prefix = role === "user" ? `  ${ui.paint(ui.glyphs.vertical, "borderSoft")}   ` : "    ";
  return lines.map((line, index) => {
    const last = index === lines.length - 1;
    const caret = last && streaming && caretOn ? ui.paint(ui.glyphs.caret, "money") : "";
    return `${prefix}${line}${caret}`;
  });
}

function messageBody(ui: UI, text: string, role: "user" | "assistant", width: number): string[] {
  return markdownBlock(ui, text, width, role, false, false);
}

function assistantBlock(
  ui: UI,
  state: ChatState,
  text: string,
  width: number,
  options: { streaming: boolean; thinking: boolean; thought: string; thinkingMs: number },
): string[] {
  const lines: string[] = [];
  if (options.thought.trim().length > 0) {
    lines.push(...thoughtLines(ui, options.thought, options.thinkingMs, width, options.streaming && options.thinking));
  }
  if (text.length === 0) {
    if (options.streaming && options.thought.trim().length === 0) lines.push(spinnerLine(ui, "thinking"));
    return lines;
  }
  lines.push(...markdownBlock(ui, text, width, "assistant", options.streaming, state.caretOn));
  return lines;
}

function welcomeMark(ui: UI, width: number, height: number): string[] {
  return brandLines(ui, width, height);
}

function welcomeBody(ui: UI, state: ChatState, width: number, height: number, maxPaletteRows: number): string[] {
  const lines = welcomeMark(ui, width, height);
  if (height >= 18) {
    lines.push("");
    lines.push(centerLine(ui.paint("What are we building?", "muted"), width));
  }
  lines.push("");
  if (state.slashOpen) {
    const blockWidth = promptWidth(width);
    const matches = slashMatches(state.input.join(""));
    lines.push(...commandPalette(ui, {
      items: matches.map((entry) => ({ command: entry.command, blurb: entry.blurb })),
      index: state.slashIndex,
      width: blockWidth,
      maxRows: maxPaletteRows,
      emptyText: "No command matches.",
    }).map((line) => centerLine(line, width)));
    lines.push("");
  }
  const blockWidth = promptWidth(width);
  const window = inputWindow(state, Math.max(4, blockWidth - 6), ui.glyphs.ellipsis);
  lines.push(...composerBlock(ui, state, blockWidth, window).map((line) => centerLine(line, width)));
  lines.push("");
  const model = width < 60
    ? state.model.modelName
    : `${state.model.providerName} ${ui.glyphs.dot} ${state.model.modelName}`;
  const effort = state.effort === "auto" ? "" : ui.paint(`${state.effort} effort`, "faint");
  const status = rightAlign(ui.paint(model, "muted"), effort, blockWidth);
  lines.push(centerLine(status, width));
  return lines;
}

export function transcriptLines(ui: UI, state: ChatState, width: number): string[] {
  const lines: string[] = [];
  for (const [index, message] of state.session.messages.entries()) {
    if (index > 0) lines.push("");
    lines.push(messageHeader(ui, state, message.role, message.at, width));
    if (message.role === "assistant" && message.thinking !== undefined) {
      lines.push(...thoughtLines(ui, message.thinking, message.thinkingMs ?? 0, width, false));
    }
    lines.push(...messageBody(ui, message.text, message.role, width));
  }
  if (state.streaming) {
    if (state.session.messages.length > 0) lines.push("");
    lines.push(messageHeader(ui, state, "assistant", state.streamStartedAt, width));
    lines.push(...assistantBlock(ui, state, state.streamText, width, {
      streaming: true,
      thinking: state.thinking,
      thought: state.streamThought,
      thinkingMs: state.streamThinkingMs,
    }));
  }
  return lines;
}

function noticeLines(ui: UI, notice: ChatNotice, width: number): string[] {
  const tone = TONE[notice.tone];
  const icon = notice.tone === "danger" ? ui.glyphs.cross : notice.tone === "warning" ? ui.glyphs.warning : notice.tone === "success" ? ui.glyphs.check : ui.glyphs.spark;
  const title = notice.title === undefined ? "" : `${ui.paint(icon, tone, { bold: true })} ${ui.paint(notice.title, tone, { bold: true })}  `;
  const bodyWidth = Math.max(8, width - visibleWidth(title) - 6);
  const wrapped = wrapPlain(notice.message, bodyWidth);
  const lines = wrapped.map((line, index) => `  ${index === 0 ? title : " ".repeat(visibleWidth(title))}${ui.paint(line, "ink")}`);
  if (notice.hint !== undefined) {
    const hintWidth = Math.max(8, width - 8);
    const hintLines = notice.message.includes("\n")
      ? notice.hint.split("\n")
      : wrapPlain(notice.hint, hintWidth);
    for (const line of hintLines) {
      lines.push(`    ${ui.paint(line, "faint")}`);
    }
  }
  return lines;
}

function inputWindow(state: ChatState, room: number, ellipsis: string): { before: string; after: string } {
  const characters = state.input;
  let start = 0;
  if (characters.length > room) start = Math.max(0, Math.min(state.cursor, characters.length) - Math.floor(room * 0.7));
  const visible = characters.slice(start, start + room);
  let local = Math.max(0, Math.min(visible.length, state.cursor - start));
  if (state.cursor < start) local = 0;
  if (state.cursor > start + room) local = room;
  const beforeText = visible.slice(0, local).join("");
  const afterText = visible.slice(local).join("");
  const lead = start > 0 ? ellipsis : "";
  const trail = start + room < characters.length ? ellipsis : "";
  return { before: `${lead}${beforeText}`, after: `${afterText}${trail}` };
}

function composerBlock(ui: UI, state: ChatState, width: number, window: { before: string; after: string }): string[] {
  const empty = state.input.length === 0;
  const placeholder = state.slashOpen
    ? "Type a command"
    : state.mode === "picker"
      ? "Type to filter models"
      : state.streaming
        ? "ctrl+c stops this reply"
        : "Ask a question, paste code, or type /";
  return promptBlock(ui, {
    width,
    placeholder,
    ...(empty ? {} : { before: window.before, after: window.after }),
    caretOn: state.caretOn && !state.streaming,
  });
}

function composerLines(ui: UI, state: ChatState, width: number): string[] {
  const blockWidth = promptWidth(width);
  return composerBlock(ui, state, blockWidth, inputWindow(state, Math.max(4, blockWidth - 6), ui.glyphs.ellipsis));
}

function workStatus(state: ChatState): { text: string; tone: string } {
  if (state.stopping) return { text: "stopping", tone: "warning" };
  if (state.streaming) {
    if (state.thinking && state.thinkingChars > 0) {
      return { text: `reasoning · ${present(state.thinkingChars)} chars`, tone: "money" };
    }
    if (state.thinking) return { text: "thinking", tone: "money" };
    return { text: `streaming · ${present(state.tokens)} chars`, tone: "money" };
  }
  const count = state.session.messages.length;
  return { text: `${count} ${plural(count, "message")}`, tone: "faint" };
}

function statusBar(ui: UI, state: ChatState, width: number): string {
  const model = width < 56
    ? state.model.modelName
    : `${state.model.providerName} ${ui.glyphs.dot} ${state.model.modelName}`;
  // Below thirty columns there is only room for one truth. Say what is answering.
  if (width < 30) return `  ${ui.paint(ui.truncate(model, Math.max(4, width - 2)), "muted")}`;
  const parts = [ui.paint(model, "muted")];
  if (width >= 76 && state.effort !== "auto") parts.push(ui.paint(state.effort, "faint"));
  if (width >= 100) parts.push(ui.paint(ui.truncateMiddle(state.cwd, 28), "faint"));
  const status = workStatus(state);
  return rightAlign(`  ${parts.join(`  ${ui.paint(ui.glyphs.dot, "borderSoft")}  `)}`, ui.paint(status.text, status.tone), width);
}

function footerHints(ui: UI, state: ChatState, width: number): string {
  const hints = state.slashOpen
    ? width >= 44
      ? keyHints(ui, [["↑↓", "select"], ["enter", "run"], ["esc", "close"]])
      : width >= 24
        ? keyHints(ui, [["enter", "run"], ["esc", "close"]])
        : keyHints(ui, [["esc", "close"]])
    : state.streaming
      ? width >= 56
        ? keyHints(ui, [["esc", "stop"], ["↑↓", "scroll"], ["/", "commands"]])
        : keyHints(ui, [["esc", "stop"]])
      : width >= 86
        ? keyHints(ui, [["enter", "send"], ["tab", "models"], ["/", "commands"], ["ctrl+c", "quit"]])
        : width >= 58
          ? keyHints(ui, [["enter", "send"], ["tab", "models"], ["/", "commands"]])
          : width >= 27
            ? keyHints(ui, [["enter", "send"], ["/", "commands"]])
            : keyHints(ui, [["enter", "send"]]);
  return rightAlign("", hints, width);
}

function pickerRows(ui: UI, state: ChatState, width: number, maxRows: number): string[] {
  const query = state.pickerFilter.join("").toLowerCase();
  const matches = state.pickerModels
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      if (query.length === 0) return true;
      return `${entry.model.providerName} ${entry.model.name} ${entry.model.id}`.toLowerCase().includes(query);
    });
  if (matches.length === 0) return [`  ${ui.paint("No models match that filter.", "faint")}`];

  const activePosition = Math.max(0, matches.findIndex(({ index }) => index === state.pickerIndex));
  const start = Math.max(0, Math.min(activePosition - Math.floor(maxRows / 2), Math.max(0, matches.length - maxRows)));
  const visible = matches.slice(start, start + maxRows);
  const lines: string[] = [];
  let provider = "";
  for (const [offset, { entry, index }] of visible.entries()) {
    if (entry.model.providerName !== provider) {
      provider = entry.model.providerName;
      if (offset > 0) lines.push("");
      lines.push(`  ${ui.paint(provider.toUpperCase(), "faint", { bold: true })}`);
    }
    const selected = index === state.pickerIndex;
    const dot = entry.providerReady ? ui.glyphs.solidCircle : ui.glyphs.circle;
    const current = entry.current ? "  current" : "";
    const id = width >= 64 ? `  ${entry.model.id}` : "";
    const plain = ` ${selected ? ui.glyphs.selected : " "} ${dot} ${entry.model.name}${current}${id}`;
    if (selected) {
      lines.push(`  ${ui.solidRow(plain, Math.max(8, width - 2), { fg: "selectedText", bg: "selected", bold: true })}`);
    } else {
      const detail = `${ui.paint(entry.model.name, "muted")}${current.length > 0 ? ui.paint(current, "money") : ""}${id.length > 0 ? ui.paint(id, "faint") : ""}`;
      lines.push(`   ${ui.paint(ui.glyphs.circle, "faint")} ${detail}`);
    }
  }
  if (matches.length > maxRows) {
    lines.push(`  ${ui.paint(`${activePosition + 1} of ${matches.length}`, "faint")}`);
  }
  return lines;
}

function pickerFrame(ui: UI, state: ChatState, width: number, height: number): string[] {
  const header = [
    `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("MODELS", "ink", { bold: true })}  ${ui.paint("choose what answers next", "faint")}`,
    "",
  ];
  const selected = state.pickerModels[state.pickerIndex];
  const detail: string[] = [];
  if (selected !== undefined) {
    const source = selected.providerReady ? "ready" : selected.providerNote ?? "not ready";
    detail.push(`  ${ui.paint(selected.model.providerName, "muted")}  ${ui.paint(ui.glyphs.dot, "borderSoft")}  ${ui.paint(source, selected.providerReady ? "money" : "warning")}`);
    if (selected.model.contextWindow > 0) {
      const context = `${Math.round(selected.model.contextWindow / 1000)}k context`;
      detail.push(`  ${ui.paint(`${context}  ${ui.glyphs.dot}  ${selected.model.costNote}`, "faint")}`);
    }
    detail.push("");
  }
  const composer = composerLines(ui, state, width);
  const footer = [rightAlign("", keyHints(ui, [["↑↓", "choose"], ["enter", "use"], ["esc", "back"]]), width)];
  const room = Math.max(4, height - header.length - detail.length - composer.length - footer.length - 1);
  const rows = pickerRows(ui, state, width, room);
  return [...header, ...rows, ...detail, ...composer, ...footer].slice(0, height);
}

const HELP_LINES = [
  "# Chat commands",
  "",
  "- `/model [id]` - open the model picker, or switch directly",
  "- `/new` - start a fresh conversation; the current one stays saved",
  "- `/sessions` - show where the conversation is saved",
  "- `/earn` - your real balance and the ad frequency caps",
  "- `/status` - account, model and ad state",
  "- `/theme` - switch the palette",
  "- `/help` - this list",
  "- `/quit` - save and leave",
  "",
  "## Keys",
  "",
  "- `ctrl+p` - open the command palette",
  "- `tab` - model picker",
  "- `ctrl+n` - new conversation",
  "- `ctrl+c` - stop a reply; press again to leave",
  "- `up` / `down` - scroll the transcript",
  "- `pageup` / `pagedown` - scroll a page",
  "- `ctrl+l` - redraw the screen",
  "",
  "Ads are real sponsored cards. They never take the keyboard: `ctrl+o` opens the",
  "sponsor, `ctrl+x` dismisses the card, and typing continues underneath.",
];

function helpFrame(ui: UI, state: ChatState, width: number, height: number): string[] {
  const header = [
    `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("CHAT HELP", "ink", { bold: true })}`,
    "",
  ];
  const all = renderMarkdown(HELP_LINES.join("\n"), { ui, width: Math.max(8, width - 4) });
  const footer = [rightAlign("", keyHints(ui, [["↑↓", "scroll"], ["esc", "back"]]), width)];
  const room = Math.max(5, height - header.length - footer.length - 1);
  const maximum = Math.max(0, all.length - room);
  state.helpMaximum = maximum;
  const start = Math.max(0, Math.min(state.helpScroll, maximum));
  const visible = all.slice(start, start + room).map((line) => `  ${line}`);
  return [...header, ...visible, ...footer].slice(0, height);
}

function padCenter(lines: readonly string[], height: number): string[] {
  const room = Math.max(lines.length, height);
  const top = Math.max(0, Math.floor((room - lines.length) / 2));
  const bottom = Math.max(0, room - lines.length - top);
  return [
    ...Array.from({ length: top }, () => ""),
    ...lines,
    ...Array.from({ length: bottom }, () => ""),
  ];
}

function welcomeFrame(ui: UI, state: ChatState, width: number, height: number, ads: readonly string[]): string[] {
  const tail = ads.length > 0 ? ["", ...ads] : [];
  const available = Math.max(4, height - tail.length - 1);
  const body = welcomeBody(ui, state, width, height, Math.max(1, Math.min(8, available - 9)));
  const notice = state.notice === null ? [] : ["", ...noticeLines(ui, state.notice, width)];
  return [...padCenter([...body, ...notice], available).slice(0, available), ...tail, footerHints(ui, state, width)].slice(0, height);
}

export function buildChatFrame(options: ChatFrameOptions): string[] {
  const { ui, state, ads, width, height } = options;
  const finish = (lines: string[]): string[] => lines.slice(0, height).map((line) => ui.truncate(line, width));
  if (state.mode === "picker") return finish(pickerFrame(ui, state, width, height));
  if (state.mode === "help") return finish(helpFrame(ui, state, width, height));
  if (state.session.messages.length === 0 && !state.streaming) {
    return finish(welcomeFrame(ui, state, width, height, ads));
  }

  const header = headerLines(ui, state, width);
  const composer = composerLines(ui, state, width);
  const status = [statusBar(ui, state, width)];
  const footer = [footerHints(ui, state, width)];
  const notice = state.notice === null ? [] : noticeLines(ui, state.notice, width);
  const palette = state.slashOpen
    ? commandPalette(ui, {
        items: slashMatches(state.input.join("")).map((entry) => ({ command: entry.command, blurb: entry.blurb })),
        index: state.slashIndex,
        width: promptWidth(width),
        maxRows: Math.max(1, Math.min(8, height - 16)),
        emptyText: "No command matches.",
      })
    : [];
  const adTail = ads.length > 0 ? ["", ...ads] : [];
  const fixed = header.length + composer.length + status.length + footer.length
    + notice.length + (notice.length > 0 ? 1 : 0)
    + palette.length + (palette.length > 0 ? 1 : 0) + adTail.length;
  const room = Math.max(3, height - fixed);
  const all = transcriptLines(ui, state, width);
  const maximum = Math.max(0, all.length - room);
  state.scrollMaximum = maximum;
  state.scroll = Math.max(0, Math.min(state.scroll, maximum));
  const end = all.length - state.scroll;
  const start = Math.max(0, end - room);
  const visible = all.slice(start, end);
  while (visible.length < room && fixed + visible.length < height) visible.push("");
  const lines = [
    ...header,
    ...visible.slice(0, room),
    ...(notice.length > 0 ? ["", ...notice] : []),
    ...(palette.length > 0 ? ["", ...palette] : []),
    ...composer,
    ...status,
    ...adTail,
    ...footer,
  ];
  return finish(lines);
}

export function transcriptSnapshot(ui: UI, state: ChatState, width: number): string[] {
  if (state.session.messages.length === 0) {
    return welcomeBody(ui, state, width, 24, 6);
  }
  const lines: string[] = [];
  for (const message of state.session.messages) {
    lines.push(messageHeader(ui, state, message.role, message.at, width));
    if (message.role === "assistant" && message.thinking !== undefined) {
      lines.push(...thoughtLines(ui, message.thinking, message.thinkingMs ?? 0, width, false));
    }
    lines.push(...messageBody(ui, message.text, message.role, width));
    lines.push("");
  }
  return lines;
}
