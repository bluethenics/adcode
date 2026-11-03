import { Screen } from "../tui/screen.ts";
import { startKeyboard, type Key } from "../tui/keyboard.ts";
import { errorPanel, printLines } from "../tui/components.ts";
import { Spinner } from "../tui/motion.ts";
import { TerminalAds } from "../tui/adsChrome.ts";
import { renderMarkdown } from "../chat/markdown.ts";
import { buildChatFrame, transcriptSnapshot, type ChatNotice, type ChatState, type PickerModel } from "../chat/view.ts";
import { describeChatError, streamChat, type ChatTurn } from "../ai/chat.ts";
import { recommendedFor, findModel, type CliModel } from "../ai/catalogue.ts";
import { slashMatches, slashHint } from "../chat/commands.ts";
import { formatMicros as formatAdMicros } from "../../../../packages/ads/src/index.ts";
import {
  createSession,
  isSessionId,
  latestSession,
  listSessions,
  readSession,
  saveSession,
  withMessage,
  type ChatMessageRecord,
  type ChatSession,
} from "../ai/sessions.ts";
import type { AppContext } from "../context.ts";
import { balanceLabel } from "../ads/runtime.ts";
import { cliPaths } from "../util/paths.ts";
import { formatDuration, formatMicros, plural, relativeTime } from "../util/format.ts";
import { isThemeName, themeNames } from "../tui/theme.ts";
import type { Effort } from "../../../../packages/ai/src/types.ts";

export interface ChatOptions {
  readonly sessionId?: string;
  readonly initialPrompt?: string;
}

interface ResolvedSession {
  readonly session: ChatSession | null;
  readonly resumed: boolean;
  readonly error?: { readonly message: string; readonly hint: string };
}

function writeJson(out: NodeJS.WriteStream, value: unknown): void {
  out.write(`${JSON.stringify(value, null, 2)}\n`);
}

function modelPayload(ctx: AppContext): Record<string, unknown> {
  return {
    provider: ctx.selection.providerId,
    providerName: ctx.selection.providerName,
    id: ctx.selection.modelId,
    name: ctx.selection.modelName,
    ready: ctx.selection.ready,
    reason: ctx.selection.reason,
    included: ctx.selection.included,
    catalogue: ctx.catalogue.source,
  };
}

function resolveSession(ctx: AppContext, options: ChatOptions): ResolvedSession {
  const requested = options.sessionId ?? ctx.flags.session;
  if (ctx.flags.continueSession && requested !== null && requested !== undefined) {
    return {
      session: null,
      resumed: false,
      error: {
        message: "--continue and --session point at two different conversations.",
        hint: "Use one, or run `adcode sessions` to find the id you want.",
      },
    };
  }
  if (requested !== undefined && requested !== null) {
    if (!isSessionId(requested)) {
      return {
        session: null,
        resumed: false,
        error: {
          message: `"${requested}" is not a session id.`,
          hint: "Run `adcode sessions` to see the saved ids.",
        },
      };
    }
    const session = readSession(requested);
    if (session === null) {
      return {
        session: null,
        resumed: false,
        error: {
          message: `No saved session named "${requested}".`,
          hint: "Run `adcode sessions`, or start fresh with `adcode chat`.",
        },
      };
    }
    return { session, resumed: true };
  }
  if (ctx.flags.continueSession) {
    const session = latestSession();
    return { session, resumed: session !== null };
  }
  return { session: null, resumed: false };
}

export function findRequestedModel(ctx: AppContext): { error?: { message: string; hint: string } } {
  const providerId = ctx.flags.provider;
  const modelId = ctx.flags.model;
  if (providerId === null && modelId === null) return {};

  const provider = providerId === null
    ? undefined
    : ctx.catalogue.providers.find((one) => one.id === providerId || one.name.toLowerCase() === providerId.toLowerCase());
  if (providerId !== null && provider === undefined) {
    return {
      error: {
        message: `"${providerId}" is not a provider in the catalogue.`,
        hint: "Run `adcode models` to see the providers that are ready.",
      },
    };
  }

  const pools = provider === undefined ? ctx.catalogue.providers : [provider];
  const found = modelId === null
    ? undefined
    : pools
        .flatMap((one) => one.models.map((model) => ({ provider: one, model })))
        .find((entry) => entry.model.id === modelId || entry.model.name.toLowerCase() === modelId.toLowerCase());

  if (modelId !== null && found === undefined) {
    const hint = provider === undefined
      ? "Run `adcode models --all` to see every model id."
      : `Run \`adcode models\` and look under ${provider.name}.`;
    return { error: { message: `"${modelId}" is not in the catalogue.`, hint } };
  }

  if (found !== undefined) {
    ctx.chooseModel(found.provider.id, found.model.id, false);
    return {};
  }
  if (provider !== undefined) {
    const recommended = recommendedFor(ctx.catalogue, provider.id) ?? provider.models[0]?.id;
    if (recommended !== null && recommended !== undefined) ctx.chooseModel(provider.id, recommended, false);
    return {};
  }
  return {};
}

function restoreModel(ctx: AppContext, session: ChatSession | null): void {
  if (session === null || ctx.flags.provider !== null || ctx.flags.model !== null) return;
  if (session.provider === null || session.model === null) return;
  const provider = ctx.catalogue.providers.find((one) => one.id === session.provider);
  if (provider === undefined || !provider.models.some((one) => one.id === session.model)) return;
  ctx.chooseModel(provider.id, session.model, false);
}

function defaultState(ctx: AppContext, session: ChatSession, mode: ChatState["mode"]): ChatState {
  return {
    session,
    model: ctx.selection,
    input: [],
    cursor: 0,
    history: session.messages.filter((message) => message.role === "user").map((message) => message.text),
    historyIndex: null,
    historyDraft: "",
    mode,
    streaming: false,
    thinking: false,
    stopping: false,
    streamStartedAt: 0,
    streamText: "",
    streamModelName: "",
    streamThought: "",
    streamThinkingStartedAt: 0,
    streamThinkingMs: 0,
    tokens: 0,
    thinkingChars: 0,
    scroll: 0,
    scrollMaximum: 0,
    notice: null,
    phase: 0.2,
    caretOn: true,
    pickerModels: [],
    pickerIndex: 0,
    pickerVisual: 0,
    pickerFilter: [],
    helpScroll: 0,
    helpMaximum: 0,
    saved: false,
    turnStartedAt: 0,
    slashOpen: false,
    slashIndex: 0,
    effort: effortFor(ctx),
    cwd: ctx.cwd,
  };
}

function pickerList(ctx: AppContext): PickerModel[] {
  const entries: PickerModel[] = [];
  for (const provider of ctx.catalogue.providers) {
    if (!provider.ready && ctx.flags.all !== true && provider.id !== ctx.selection.providerId) continue;
    for (const model of provider.models) {
      entries.push({
        model,
        providerReady: provider.ready,
        providerNote: provider.note,
        current: provider.id === ctx.selection.providerId && model.id === ctx.selection.modelId,
      });
    }
  }
  return entries;
}

function pickerIndexOf(entries: readonly PickerModel[], providerId: string, modelId: string): number {
  const index = entries.findIndex((entry) => entry.model.providerId === providerId && entry.model.id === modelId);
  return index < 0 ? 0 : index;
}

function filterIndices(state: ChatState): number[] {
  const query = state.pickerFilter.join("").toLowerCase();
  const indices: number[] = [];
  for (const [index, entry] of state.pickerModels.entries()) {
    if (query.length === 0 || `${entry.model.providerName} ${entry.model.name} ${entry.model.id}`.toLowerCase().includes(query)) {
      indices.push(index);
    }
  }
  return indices;
}

function findAnyModel(ctx: AppContext, query: string): { providerId: string; model: CliModel } | null {
  const trimmed = query.trim();
  if (trimmed.length === 0) return null;
  const slash = trimmed.indexOf("/");
  const providerFilter = slash > 0 ? trimmed.slice(0, slash).toLowerCase() : null;
  const modelQuery = slash > 0 ? trimmed.slice(slash + 1).toLowerCase() : trimmed.toLowerCase();
  for (const provider of ctx.catalogue.providers) {
    if (providerFilter !== null && provider.id.toLowerCase() !== providerFilter && provider.name.toLowerCase() !== providerFilter) continue;
    const model = provider.models.find(
      (one) => one.id.toLowerCase() === modelQuery || one.name.toLowerCase() === modelQuery,
    );
    if (model !== undefined) return { providerId: provider.id, model };
  }
  return null;
}

function errorLines(ctx: AppContext, title: string, message: string, hint?: string, details?: string): string[] {
  return errorPanel(ctx.ui, {
    title,
    message,
    ...(hint === undefined ? {} : { hint }),
    ...(details === undefined ? {} : { details }),
    width: Math.min(ctx.ui.width - 4, 92),
  });
}

function oneShotError(ctx: AppContext, prompt: string, error: string, hint: string | null): number {
  if (ctx.flags.json) {
    writeJson(ctx.stdout, {
      generatedAt: new Date().toISOString(),
      command: "chat",
      mode: "one-shot",
      prompt,
      model: modelPayload(ctx),
      error: { message: error, hint },
    });
    return 1;
  }
  ctx.stderr.write(`${errorLines(ctx, "Chat stopped", error, hint ?? undefined).join("\n")}\n`);
  return 1;
}

class LiveWriter {
  readonly ui: AppContext["ui"];
  readonly out: NodeJS.WriteStream;
  readonly width: number;
  buffer = "";
  started = false;
  fence = false;
  prefix: string;

  constructor(ui: AppContext["ui"], out: NodeJS.WriteStream, width: number) {
    this.ui = ui;
    this.out = out;
    this.width = Math.max(20, width);
    this.prefix = `  ${ui.paint(ui.glyphs.vertical, "borderSoft")} `;
  }

  #emit(raw: string): void {
    const line = raw.replace(/\t/g, "  ");
    const marker = /^\s*```/.test(line);
    if (marker) {
      this.fence = !this.fence;
      return;
    }
    if (line.trim().length === 0) {
      this.out.write(`${this.prefix}\n`);
      return;
    }
    if (this.fence) {
      for (const part of this.ui.wrap(line, Math.max(8, this.width - 4))) {
        this.out.write(`${this.prefix}${this.ui.paint(part, "muted")}\n`);
      }
      return;
    }
    const rendered = renderMarkdown(line, { ui: this.ui, width: Math.max(8, this.width - 4) });
    if (rendered.length === 0) rendered.push("");
    for (const part of rendered) this.out.write(`${this.prefix}${part}\n`);
  }

  #take(): boolean {
    const newline = this.buffer.indexOf("\n");
    if (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.#emit(line);
      return true;
    }
    const visible = this.ui.visibleWidth(this.buffer);
    if (visible < Math.max(20, this.width - 6)) return false;
    let cut = Math.max(1, Math.floor(this.buffer.length * 0.75));
    for (let index = Math.min(this.buffer.length - 1, cut); index > 0; index -= 1) {
      if (/\s/.test(this.buffer[index] ?? "")) {
        cut = index;
        break;
      }
    }
    const line = this.buffer.slice(0, cut);
    this.buffer = this.buffer.slice(cut).replace(/^[ \t]+/, "");
    this.#emit(line);
    return true;
  }

  push(delta: string): void {
    this.buffer += delta;
    while (this.#take()) {
      // One completed line at a time.
    }
  }

  finish(): void {
    if (this.buffer.trim().length > 0) this.#emit(this.buffer);
    this.buffer = "";
  }
}

async function oneShot(ctx: AppContext, prompt: string, session: ChatSession, resumed: boolean): Promise<number> {
  if (!ctx.selection.ready || ctx.flags.provider !== null || ctx.flags.model !== null) {
    if (!ctx.selection.ready) {
      const hint = ctx.selection.reason ?? "Run `adcode models` to choose a model that is ready.";
      return oneShotError(ctx, prompt, `${ctx.selection.providerName} is not ready.`, hint);
    }
  }

  const startedAt = Date.now();
  const turns: ChatTurn[] = [
    ...session.messages.map((message): ChatTurn => ({ role: message.role, text: message.text })),
    { role: "user", text: prompt },
  ];
  session = withMessage(session, { role: "user", text: prompt, at: startedAt });

  if (!ctx.flags.json) {
    const ui = ctx.ui;
    printLines(
      [
        "",
        `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("ADCODE CHAT", "ink", { bold: true })}  ${ui.paint(
          `${ctx.selection.modelName} ${ui.glyphs.dot} ${ctx.selection.providerName}`,
          "muted",
        )}`,
        `  ${ui.paint(
          resumed ? `resumed ${ui.glyphs.dot} ${session.title}` : "one answer, then back to your terminal",
          "faint",
        )}`,
        "",
        `  ${ui.paint("YOU", "faint", { bold: true })}`,
        ...ui.wrap(prompt, Math.max(20, Math.min(ui.width - 6, 100))).map((line) => `  ${ui.paint(line, "ink")}`),
        "",
        `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("ADCODE", "ink", { bold: true })}  ${ui.paint(ctx.selection.modelName, "faint")}`,
      ],
      ctx.stdout,
    );
  }

  let spinner: Spinner | null = null;
  let writer: LiveWriter | null = null;
  if (!ctx.flags.json) {
    writer = new LiveWriter(ctx.ui, ctx.stdout, Math.min(ctx.ui.width - 4, 104));
    if (ctx.motion.enabled) spinner = new Spinner(ctx.ui, ctx.motion, { out: ctx.stdout }).start("thinking");
  }

  const controller = new AbortController();
  let built;
  try {
    built = await ctx.buildSelection();
  } catch (error) {
    spinner?.stop();
    return oneShotError(
      ctx,
      prompt,
      describeChatError(error, ctx.selection),
      "Run `adcode models` to choose another model, or set the provider key.",
    );
  }

  try {
    const result = await streamChat({
      built,
      turns,
      signal: controller.signal,
      cwd: ctx.cwd,
      effort: effortFor(ctx),
      handlers: {
        onText: (delta) => {
          if (spinner !== null) {
            spinner.stop();
            spinner = null;
          }
          writer?.push(delta);
        },
        onThinking: () => {
          spinner?.update("thinking");
        },
      },
    });
    spinner?.stop();
    spinner = null;
    writer?.finish();

    if (result.text.trim().length === 0) {
      return oneShotError(ctx, prompt, "The model returned an empty reply.", "Try again, or switch models with `adcode models`.");
    }

    const assistant: ChatMessageRecord = {
      role: "assistant",
      text: result.text,
      at: Date.now(),
      provider: built.selection.providerId,
      model: built.selection.modelId,
    };
    session = withMessage(session, assistant);
    let saved = false;
    try {
      session = saveSession(session);
      saved = true;
    } catch (error) {
      if (!ctx.flags.json) {
        ctx.stderr.write(
          `${errorLines(
            ctx,
            "Could not save the conversation",
            error instanceof Error ? error.message : String(error),
            "The answer above is complete; only the transcript was lost.",
          ).join("\n")}\n`,
        );
      }
    }

    const durationMs = Date.now() - startedAt;
    if (ctx.flags.json) {
      writeJson(ctx.stdout, {
        generatedAt: new Date().toISOString(),
        command: "chat",
        mode: "one-shot",
        prompt,
        reply: result.text,
        model: modelPayload(ctx),
        provider: built.selection.providerId,
        usage: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          stopReason: result.stopReason,
        },
        durationMs,
        session: {
          id: session.id,
          title: session.title,
          saved,
          messages: session.messages.map((message) => ({
            role: message.role,
            text: message.text,
            at: message.at,
          })),
        },
      });
      return result.refused ? 1 : 0;
    }

    const notice = result.cutOff
      ? `  ${ctx.ui.paint("The reply hit the output limit; ask for the rest.", "warning")}`
      : result.refused
        ? `  ${ctx.ui.paint("The provider declined that request.", "warning")}`
        : null;
    const summary = [
      "",
      ...(notice === null ? [] : [notice]),
      `  ${ctx.ui.paint(
        `${saved ? "saved" : "not saved"}  ${ctx.ui.glyphs.dot}  ${formatDuration(durationMs)}`,
        "faint",
      )}  ${ctx.ui.paint(ctx.ui.glyphs.dot, "borderSoft")}  ${ctx.ui.paint(
        saved ? "adcode chat --continue resumes this one" : "adcode chat starts fresh",
        "muted",
      )}`,
      "",
    ];
    printLines(summary, ctx.stdout);
    return result.refused ? 1 : 0;
  } catch (error) {
    spinner?.stop();
    writer?.finish();
    return oneShotError(
      ctx,
      prompt,
      describeChatError(error, ctx.selection),
      "Try again, or run `adcode models` to pick a different model.",
    );
  }
}

function effortFor(ctx: AppContext): Effort | "auto" {
  const requested = ctx.flags.effort;
  if (requested === "low" || requested === "medium" || requested === "high" || requested === "max") return requested;
  return ctx.desktop.settings.effort;
}

function staticChat(ctx: AppContext, session: ChatSession | null, resumed: boolean): number {
  const ui = ctx.ui;
  const model = modelPayload(ctx);
  if (ctx.flags.json) {
    writeJson(ctx.stdout, {
      generatedAt: new Date().toISOString(),
      command: "chat",
      mode: resumed ? "transcript" : "welcome",
      interactive: ctx.isTTY,
      model,
      session: session === null
        ? null
        : {
            id: session.id,
            title: session.title,
            updatedAt: session.updatedAt,
            resumed,
            messages: session.messages.map((message) => ({ role: message.role, text: message.text, at: message.at })),
          },
      sessions: listSessions().length,
      hint: resumed
        ? `Resume with adcode chat --session ${session?.id ?? ""}, or add a prompt to continue it.`
        : 'Run adcode chat "..." for one answer, or adcode chat in a terminal for the full conversation.',
    });
    return 0;
  }

  if (session !== null && resumed) {
    const state = defaultState(ctx, session, "chat");
    printLines(
      [
        "",
        `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("ADCODE CHAT", "ink", { bold: true })}  ${ui.paint(
          `${session.messages.length} ${plural(session.messages.length, "message")} ${ui.glyphs.dot} ${relativeTime(session.updatedAt)}`,
          "faint",
        )}`,
        `  ${ui.paint(session.title, "muted")}`,
        "",
      ],
      ctx.stdout,
    );
    printLines(transcriptSnapshot(ui, state, Math.min(ui.width - 4, 104)), ctx.stdout);
    printLines(
      [
        "",
        `  ${ui.paint(`Resume in a terminal: adcode chat --session ${session.id}`, "faint")}`,
        "",
      ],
      ctx.stdout,
    );
    return 0;
  }

  printLines(
    [
      "",
      `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("ADCODE CHAT", "ink", { bold: true })}`,
      "",
      ...ui.wrap(
        `Talk to ${ctx.selection.modelName} through ${ctx.selection.providerName}. In a terminal this opens a full conversation; here it prints a snapshot.`,
        Math.max(20, Math.min(ui.width - 6, 100)),
      ).map((line) => `  ${ui.paint(line, "muted")}`),
      "",
      `  ${ui.paint("MODEL", "faint")}  ${ui.paint(`${ctx.selection.modelName} ${ui.glyphs.dot} ${ctx.selection.providerName}`, "ink")}`,
      `  ${ui.paint("READY", "faint")}  ${ctx.selection.ready ? ui.paint("yes", "money") : ui.paint(ctx.selection.reason ?? "no", "warning")}`,
      "",
      `  ${ui.paint("adcode chat \"explain this repo\"", "accent")}`,
      `  ${ui.paint("adcode chat --continue", "accent")}`,
      "",
    ],
    ctx.stdout,
  );
  return 0;
}

function noticeForResume(session: ChatSession): ChatNotice {
  return {
    tone: "info",
    title: "Session resumed",
    message: session.title,
    hint: `${session.messages.length} ${plural(session.messages.length, "message")} ${uiDot()} ${relativeTime(session.updatedAt)}`,
    expires: Date.now() + 4_500,
  };
}

function uiDot(): string {
  return "·";
}

async function interactive(ctx: AppContext, session: ChatSession, resumed: boolean, initialPrompt?: string): Promise<number> {
  const state = defaultState(ctx, session, ctx.selection.ready ? "chat" : "picker");
  state.pickerModels = pickerList(ctx);
  state.pickerIndex = pickerIndexOf(state.pickerModels, ctx.selection.providerId, ctx.selection.modelId);
  state.pickerVisual = state.pickerIndex;
  if (resumed) state.notice = noticeForResume(session);
  else if (!ctx.selection.ready) {
    state.notice = {
      tone: "warning",
      title: "Model needs setup",
      message: `${ctx.selection.providerName} is not ready.`,
      hint: ctx.selection.reason ?? "Pick another model with the list, or run adcode models.",
    };
  }

  const screen = new Screen({ out: ctx.stdout });
  const ads = new TerminalAds(ctx);
  let finished = false;
  let stopKeyboard = (): void => undefined;
  let ambient: NodeJS.Timeout | null = null;
  let controller: AbortController | null = null;
  let resolveDone: (code: number) => void = () => undefined;
  let exitCode = 0;
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });

  function render(): void {
    if (finished) return;
    ctx.resize();
    const width = ctx.ui.width;
    const height = ctx.ui.height;
    const adLines = height >= 16 ? ads.lines(ctx.ui) : [];
    screen.render(buildChatFrame({ ui: ctx.ui, state, ads: adLines, width, height }));
    if (adLines.length > 0) ads.painted();
  }

  function persist(): boolean {
    if (!state.session.messages.some((message) => message.role === "user")) return false;
    try {
      state.session = saveSession(state.session);
      state.saved = true;
      return true;
    } catch (error) {
      state.notice = {
        tone: "danger",
        title: "Could not save the conversation",
        message: error instanceof Error ? error.message : String(error),
        hint: `The chat still works. Check that ${cliPaths.sessions()} is writable.`,
      };
      return false;
    }
  }

  function farewell(): string {
    return state.session.messages.some((message) => message.role === "user")
      ? "conversation saved · adcode chat --continue"
      : "until next time.";
  }

  function close(code: number, message?: string): void {
    if (finished) return;
    finished = true;
    try {
      controller?.abort();
    } catch {
      // The request may already be complete.
    }
    persist();
    if (ambient !== null) clearInterval(ambient);
    ambient = null;
    try {
      stopKeyboard();
    } catch {
      // Terminal already gone.
    }
    ads.detach(() => undefined);
    screen.exit(true);
    if (message !== undefined && message.length > 0) {
      ctx.stdout.write(`\n  ${ctx.ui.gradient(ctx.ui.glyphs.mark)}  ${ctx.ui.paint(message, "muted")}\n\n`);
    }
    exitCode = code;
    resolveDone(code);
  }

  function setInput(text: string, cursor = text.length): void {
    state.input = [...text];
    state.cursor = Math.max(0, Math.min(cursor, state.input.length));
    state.historyIndex = null;
  }

  function insert(text: string): void {
    const characters = [...text.replace(/[\r\n\t]+/g, " ")];
    if (characters.length === 0) return;
    state.input.splice(state.cursor, 0, ...characters);
    state.cursor += characters.length;
    state.scroll = 0;
    if (state.notice !== null && state.notice.expires !== undefined && Date.now() > state.notice.expires) state.notice = null;
    render();
  }

  function moveCursor(delta: number): void {
    state.cursor = Math.max(0, Math.min(state.input.length, state.cursor + delta));
    render();
  }

  function deleteBack(): void {
    if (state.cursor <= 0) return;
    state.input.splice(state.cursor - 1, 1);
    state.cursor -= 1;
    render();
  }

  function deleteForward(): void {
    if (state.cursor >= state.input.length) return;
    state.input.splice(state.cursor, 1);
    render();
  }

  function deleteWord(): void {
    let index = state.cursor;
    while (index > 0 && /\s/.test(state.input[index - 1] ?? "")) index -= 1;
    while (index > 0 && !/\s/.test(state.input[index - 1] ?? "")) index -= 1;
    if (index === state.cursor) return;
    state.input.splice(index, state.cursor - index);
    state.cursor = index;
    render();
  }

  function historyStep(delta: number): void {
    if (state.history.length === 0) return;
    if (delta < 0) {
      if (state.historyIndex === null) {
        state.historyDraft = state.input.join("");
        state.historyIndex = state.history.length - 1;
      } else {
        state.historyIndex = Math.max(0, state.historyIndex - 1);
      }
      setInput(state.history[state.historyIndex] ?? "");
      render();
      return;
    }
    if (state.historyIndex === null) return;
    if (state.historyIndex >= state.history.length - 1) {
      const draft = state.historyDraft;
      state.historyIndex = null;
      setInput(draft);
      render();
      return;
    }
    state.historyIndex += 1;
    setInput(state.history[state.historyIndex] ?? "");
    render();
  }

  function scrollBy(delta: number): void {
    state.scroll = Math.max(0, Math.min(state.scrollMaximum, state.scroll + delta));
    render();
  }

  function refreshPicker(): void {
    state.pickerModels = pickerList(ctx);
    state.pickerIndex = pickerIndexOf(state.pickerModels, ctx.selection.providerId, ctx.selection.modelId);
    state.pickerVisual = state.pickerIndex;
    state.pickerFilter = [];
  }

  function openPicker(): void {
    if (state.streaming) {
      state.notice = {
        tone: "warning",
        title: "One reply at a time",
        message: "Stop the current reply before switching models.",
        hint: "Press ctrl+c to stop.",
        expires: Date.now() + 3_500,
      };
      render();
      return;
    }
    refreshPicker();
    state.mode = "picker";
    state.notice = null;
    render();
  }

  function applyModel(index: number): void {
    const entry = state.pickerModels[index];
    if (entry === undefined) return;
    if (!entry.providerReady) {
      state.notice = {
        tone: "warning",
        title: "That model is not ready",
        message: entry.providerNote ?? `${entry.model.providerName} needs setup.`,
        hint: "Run adcode models for the exact environment variable or setting.",
      };
      render();
      return;
    }
    ctx.chooseModel(entry.model.providerId, entry.model.id);
    state.model = ctx.selection;
    state.session = { ...state.session, provider: ctx.selection.providerId, model: ctx.selection.modelId };
    state.mode = "chat";
    state.notice = {
      tone: "success",
      title: "Model set",
      message: `${ctx.selection.modelName} will answer next.`,
      hint: ctx.selection.providerName,
      expires: Date.now() + 3_800,
    };
    if (state.session.messages.length > 0) persist();
    render();
  }

  function newSession(): void {
    const had = state.session.messages.some((message) => message.role === "user");
    const saved = had ? persist() : false;
    state.session = createSession(ctx.selection.providerId, ctx.selection.modelId);
    state.history = [];
    state.historyIndex = null;
    state.historyDraft = "";
    state.input = [];
    state.cursor = 0;
    state.streamText = "";
    state.streamThought = "";
    state.streamThinkingStartedAt = 0;
    state.streamThinkingMs = 0;
    state.slashOpen = false;
    state.slashIndex = 0;
    state.streaming = false;
    state.scroll = 0;
    state.saved = false;
    state.notice = {
      tone: "success",
      title: "New conversation",
      message: saved ? "The previous conversation is saved." : "A fresh conversation.",
      expires: Date.now() + 3_500,
    };
    render();
  }

  async function streamReply(): Promise<void> {
    const signal = new AbortController();
    controller = signal;
    state.streaming = true;
    state.thinking = true;
    state.stopping = false;
    state.streamText = "";
    state.streamModelName = ctx.selection.modelName;
    state.streamStartedAt = Date.now();
    state.tokens = 0;
    state.thinkingChars = 0;
    state.streamThought = "";
    state.streamThinkingStartedAt = 0;
    state.streamThinkingMs = 0;
    state.slashOpen = false;
    state.scroll = 0;
    render();

    const turns: ChatTurn[] = state.session.messages.map((message): ChatTurn => ({ role: message.role, text: message.text }));
    try {
      const built = await ctx.buildSelection();
      const result = await streamChat({
        built,
        turns,
        signal: signal.signal,
        cwd: ctx.cwd,
        effort: effortFor(ctx),
        handlers: {
          onText: (delta) => {
            if (state.streamThinkingStartedAt > 0 && state.streamThinkingMs === 0) {
              state.streamThinkingMs = Math.max(1, Date.now() - state.streamThinkingStartedAt);
            }
            state.thinking = false;
            state.streamText += delta;
            state.tokens += delta.length;
          },
          onThinking: (delta) => {
            state.thinking = true;
            state.thinkingChars += delta.length;
            state.streamThought += delta;
            if (state.streamThinkingStartedAt === 0) state.streamThinkingStartedAt = Date.now();
          },
          onStatus: (text) => {
            state.notice = { tone: "info", message: text, expires: Date.now() + 2_500 };
          },
        },
      });
      if (finished) return;
      const text = result.text;
      state.streaming = false;
      state.thinking = false;
      state.stopping = false;
      controller = null;

      if (text.trim().length > 0) {
        const thinking = state.streamThought.trim();
        const thinkingMs = state.streamThinkingMs > 0
          ? state.streamThinkingMs
          : state.streamThinkingStartedAt > 0
            ? Math.max(1, Date.now() - state.streamThinkingStartedAt)
            : 0;
        state.session = withMessage(state.session, {
          role: "assistant",
          text,
          at: Date.now(),
          provider: built.selection.providerId,
          model: built.selection.modelId,
          ...(thinking.length > 0 ? { thinking: state.streamThought } : {}),
          ...(thinking.length > 0 && thinkingMs > 0 ? { thinkingMs } : {}),
        });
        persist();
        if (result.cutOff) {
          state.notice = {
            tone: "warning",
            title: "Output limit",
            message: "The reply reached the model's output ceiling.",
            hint: "Ask it to continue.",
          };
        } else if (result.refused) {
          state.notice = { tone: "warning", title: "Declined", message: "The provider declined that request." };
        }
      } else {
        state.notice = {
          tone: "danger",
          title: "No answer",
          message: "The model returned an empty reply.",
          hint: "Try again, or switch models with tab.",
        };
      }
      state.streamText = "";
      render();
    } catch (error) {
      if (finished) return;
      const aborted = signal.signal.aborted || (error instanceof Error && /abort/i.test(error.name + error.message));
      state.streaming = false;
      state.thinking = false;
      state.stopping = false;
      controller = null;
      if (state.streamText.trim().length > 0) {
        const thinking = state.streamThought.trim();
        const thinkingMs = state.streamThinkingMs > 0
          ? state.streamThinkingMs
          : state.streamThinkingStartedAt > 0
            ? Math.max(1, Date.now() - state.streamThinkingStartedAt)
            : 0;
        state.session = withMessage(state.session, {
          role: "assistant",
          text: state.streamText,
          at: Date.now(),
          provider: ctx.selection.providerId,
          model: ctx.selection.modelId,
          ...(thinking.length > 0 ? { thinking: state.streamThought } : {}),
          ...(thinking.length > 0 && thinkingMs > 0 ? { thinkingMs } : {}),
        });
        persist();
        state.notice = aborted
          ? { tone: "warning", title: "Stopped", message: "The partial reply is saved." }
          : {
              tone: "danger",
              title: "Chat stopped",
              message: describeChatError(error, ctx.selection),
              hint: "The partial reply is saved. Try again, or switch models with tab.",
            };
      } else {
        state.notice = aborted
          ? { tone: "warning", title: "Stopped", message: "No reply arrived." }
          : {
              tone: "danger",
              title: "Chat stopped",
              message: describeChatError(error, ctx.selection),
              hint: "Try again, or switch models with tab.",
            };
      }
      state.streamText = "";
      render();
    }
  }

  function stopStream(): boolean {
    if (!state.streaming || controller === null) return false;
    state.stopping = true;
    state.thinking = false;
    try {
      controller.abort();
    } catch {
      // Already done.
    }
    render();
    return true;
  }

  function send(): void {
    if (state.streaming) return;
    const text = state.input.join("").trim();
    if (text.length === 0) return;
    state.slashOpen = false;
    state.slashIndex = 0;
    if (text.startsWith("/")) {
      setInput("");
      handleSlash(text);
      return;
    }
    if (!ctx.selection.ready) {
      state.notice = {
        tone: "warning",
        title: "Model needs setup",
        message: `${ctx.selection.providerName} is not ready.`,
        hint: ctx.selection.reason ?? "Press tab to choose a model, or run adcode models.",
      };
      openPicker();
      return;
    }

    setInput("");
    state.history.push(text);
    if (state.history.length > 80) state.history.shift();
    state.historyIndex = null;
    state.historyDraft = "";
    state.notice = null;
    state.scroll = 0;
    state.turnStartedAt = Date.now();
    state.session = withMessage(state.session, { role: "user", text, at: Date.now() });
    persist();
    void streamReply();
  }

  async function handleEarn(): Promise<void> {
    state.notice = { tone: "info", message: "Reading the live balance…" };
    render();
    try {
      const result = await ads.runtime.refreshBalance();
      if (!result.ok) {
        state.notice = {
          tone: "warning",
          title: "Ad server unavailable",
          message: result.error.detail,
          hint: "Your chat is unaffected. Try adcode doctor.",
        };
      } else {
        const config = await ads.runtime.config();
        const caps = ads.runtime.effectiveCaps();
        state.notice = {
          tone: "success",
          title: "Earnings",
          message: `${balanceLabel(result.value)} available ${ctx.ui.glyphs.dot} ${formatAdMicros(result.value.lifetimeMicros)} lifetime`,
          hint: `${ctx.config.ads.preset} cadence ${ctx.ui.glyphs.dot} ${Math.round(caps.minIntervalMs / 60_000)} min gap ${ctx.ui.glyphs.dot} ${caps.dailyCap}/day${config.ok && config.value.killSwitch ? " · server paused ads" : ""}`,
          expires: Date.now() + 9_000,
        };
      }
    } catch (error) {
      state.notice = {
        tone: "warning",
        title: "Ad server unavailable",
        message: error instanceof Error ? error.message : String(error),
        hint: "Chat is unaffected.",
      };
    }
    render();
  }

  function statusMessage(): string {
    const uid = ctx.account.uid();
    return [
      `Account     ${ctx.account.source}${uid === null ? "" : ` · ${uid.slice(0, 8)}…`}`,
      `Model       ${ctx.selection.providerName} · ${ctx.selection.modelName}`,
      `Catalogue   ${ctx.catalogue.source} · ${ctx.catalogue.providers.filter((one) => one.ready).length} ready providers`,
      `Ads         ${ctx.config.ads.enabled && !ctx.flags.noAds ? `on · ${ctx.config.ads.preset}` : "off"}`,
      `Sessions    ${cliPaths.sessions()}`,
    ].join("\n");
  }

  function handleSlash(text: string): void {
    const [raw = "", ...rest] = text.trim().split(/\s+/);
    const command = raw.toLowerCase();
    const argument = rest.join(" ").trim();

    if (state.streaming && command !== "/help" && command !== "/status" && command !== "/quit" && command !== "/exit") {
      state.notice = {
        tone: "warning",
        title: "One reply at a time",
        message: "Stop the current reply first.",
        hint: "Press ctrl+c to stop, then run the command again.",
        expires: Date.now() + 3_200,
      };
      render();
      return;
    }

    if (command === "/help") {
      state.mode = "help";
      state.helpScroll = 0;
      render();
      return;
    }
    if (command === "/model" || command === "/models") {
      if (argument.length === 0) {
        openPicker();
        return;
      }
      const found = findAnyModel(ctx, argument);
      if (found === null) {
        state.notice = {
          tone: "danger",
          title: "Unknown model",
          message: `"${argument}" is not in the catalogue.`,
          hint: "Press tab to browse the ready models.",
          expires: Date.now() + 4_000,
        };
        render();
        return;
      }
      const provider = ctx.catalogue.providers.find((one) => one.id === found.providerId);
      if (provider === undefined || !provider.ready) {
        state.notice = {
          tone: "warning",
          title: "That model is not ready",
          message: provider?.note ?? `${found.providerId} needs setup.`,
          hint: "Run adcode models for the exact key or setting.",
        };
        render();
        return;
      }
      ctx.chooseModel(found.providerId, found.model.id);
      state.model = ctx.selection;
      state.session = { ...state.session, provider: ctx.selection.providerId, model: ctx.selection.modelId };
      state.notice = { tone: "success", title: "Model set", message: ctx.selection.modelName, expires: Date.now() + 3_500 };
      if (state.session.messages.length > 0) persist();
      render();
      return;
    }
    if (command === "/new" || command === "/clear") {
      newSession();
      return;
    }
    if (command === "/sessions") {
      state.notice = {
        tone: "info",
        title: "This conversation",
        message: state.session.title,
        hint: `${state.saved ? "saved" : "not saved yet"} · ${state.session.id} · adcode sessions`,
      };
      render();
      return;
    }
    if (command === "/status") {
      state.notice = {
        tone: "info",
        title: "Status",
        message: statusMessage(),
      };
      render();
      return;
    }
    if (command === "/earn") {
      void handleEarn();
      return;
    }
    if (command === "/theme") {
      if (argument.length === 0) {
        state.notice = {
          tone: "info",
          title: "Themes",
          message: themeNames().join(" · "),
          hint: "/theme paper",
        };
      } else if (!isThemeName(argument)) {
        state.notice = { tone: "warning", title: "Unknown theme", message: argument, hint: themeNames().join(" · ") };
      } else {
        ctx.setTheme(argument);
        ads.setTheme(ctx.adThemeKind());
        screen.redraw();
        state.notice = { tone: "success", title: "Theme set", message: argument, expires: Date.now() + 3_000 };
      }
      render();
      return;
    }
    if (command === "/quit" || command === "/exit") {
      close(
        0,
        state.session.messages.some((message) => message.role === "user")
          ? "conversation saved · adcode chat --continue"
          : "until next time.",
      );
      return;
    }

    state.notice = {
      tone: "warning",
      title: "Unknown command",
      message: `"${raw}" is not a chat command.`,
      hint: slashHint(),
      expires: Date.now() + 4_000,
    };
    render();
  }

  function openSlash(): void {
    state.mode = "chat";
    state.slashOpen = true;
    state.slashIndex = 0;
    setInput("/");
    render();
  }

  function closeSlash(clear = true): void {
    state.slashOpen = false;
    state.slashIndex = 0;
    if (clear) setInput("");
    render();
  }

  function slashMove(delta: number): void {
    const list = slashMatches(state.input.join(""));
    if (list.length === 0) return;
    state.slashIndex = (state.slashIndex + delta + list.length) % list.length;
    render();
  }

  function runSlashSelection(): void {
    const list = slashMatches(state.input.join(""));
    if (list.length === 0) {
      state.slashOpen = false;
      const raw = state.input.join("").trim();
      if (raw.length > 0) send();
      else render();
      return;
    }
    const selected = list[Math.max(0, Math.min(list.length - 1, state.slashIndex))];
    if (selected === undefined) return;
    state.slashOpen = false;
    state.slashIndex = 0;
    setInput(selected.command);
    send();
  }

  function pickerMove(delta: number): void {
    const indices = filterIndices(state);
    if (indices.length === 0) return;
    const current = Math.max(0, indices.indexOf(state.pickerIndex));
    const next = indices[(current + delta + indices.length) % indices.length];
    if (next === undefined) return;
    state.pickerIndex = next;
    if (Math.abs(next - state.pickerVisual) > 2) state.pickerVisual = next;
    render();
  }

  function onKey(key: Key): void {
    if (finished) return;
    if (ads.handleKey(key)) {
      render();
      return;
    }
    if (key.name === "focus") {
      ads.setFocused(true);
      return;
    }
    if (key.name === "blur") {
      ads.setFocused(false);
      return;
    }
    if (key.ctrl && key.name === "c") {
      if (stopStream()) return;
      close(130, farewell());
      return;
    }
    if (key.ctrl && key.name === "d" && state.input.length === 0) {
      close(0, farewell());
      return;
    }
    if (key.ctrl && key.name === "l") {
      screen.redraw();
      render();
      return;
    }
    if (key.ctrl && key.name === "p" && state.mode === "chat") {
      if (state.slashOpen) closeSlash();
      else openSlash();
      return;
    }

    const character = key.string.length > 0 ? key.string : key.sequence;
    const enter = key.name === "return" || key.name === "enter";

    if (state.mode === "picker") {
      if (key.name === "escape" || (character === "q" && state.pickerFilter.length === 0)) {
        state.mode = "chat";
        render();
        return;
      }
      if (key.name === "up") {
        pickerMove(-1);
        return;
      }
      if (key.name === "down") {
        pickerMove(1);
        return;
      }
      if (key.name === "pageup") {
        pickerMove(-8);
        return;
      }
      if (key.name === "pagedown") {
        pickerMove(8);
        return;
      }
      if (key.name === "home") {
        const indices = filterIndices(state);
        state.pickerIndex = indices[0] ?? 0;
        render();
        return;
      }
      if (key.name === "end") {
        const indices = filterIndices(state);
        state.pickerIndex = indices.at(-1) ?? 0;
        render();
        return;
      }
      if (enter) {
        applyModel(state.pickerIndex);
        return;
      }
      if (key.ctrl && key.name === "u") {
        state.pickerFilter = [];
        state.pickerIndex = filterIndices(state)[0] ?? 0;
        render();
        return;
      }
      if (key.name === "backspace") {
        if (state.pickerFilter.length > 0) {
          state.pickerFilter.splice(state.pickerFilter.length - 1, 1);
          state.pickerIndex = filterIndices(state)[0] ?? 0;
          render();
        }
        return;
      }
      if (!key.ctrl && !key.meta && character.length > 0 && character >= " ") {
        state.pickerFilter.push(character);
        state.pickerIndex = filterIndices(state)[0] ?? 0;
        render();
      }
      return;
    }

    if (state.mode === "help") {
      if (key.name === "escape" || character === "q" || character === "?") {
        state.mode = "chat";
        render();
        return;
      }
      if (key.name === "up") {
        state.helpScroll = Math.max(0, state.helpScroll - 1);
        render();
        return;
      }
      if (key.name === "down") {
        state.helpScroll = Math.min(state.helpMaximum, state.helpScroll + 1);
        render();
        return;
      }
      if (key.name === "pageup") {
        state.helpScroll = Math.max(0, state.helpScroll - 8);
        render();
        return;
      }
      if (key.name === "pagedown") {
        state.helpScroll = Math.min(state.helpMaximum, state.helpScroll + 8);
        render();
      }
      return;
    }

    if (state.slashOpen) {
      if (key.name === "escape") {
        closeSlash();
        return;
      }
      if (key.name === "up") {
        slashMove(-1);
        return;
      }
      if (key.name === "down") {
        slashMove(1);
        return;
      }
      if (key.name === "pageup") {
        slashMove(-5);
        return;
      }
      if (key.name === "pagedown") {
        slashMove(5);
        return;
      }
      if (key.name === "home") {
        state.slashIndex = 0;
        render();
        return;
      }
      if (key.name === "end") {
        state.slashIndex = Math.max(0, slashMatches(state.input.join("")).length - 1);
        render();
        return;
      }
      if (enter) {
        runSlashSelection();
        return;
      }
      if (key.ctrl && key.name === "u") {
        setInput("/");
        state.slashIndex = 0;
        render();
        return;
      }
      if (key.name === "backspace") {
        if (state.input.length <= 1) {
          closeSlash();
          return;
        }
        deleteBack();
        state.slashIndex = 0;
        return;
      }
      if (key.name === "paste" && key.string.length > 0) {
        insert(key.string.replace(/[\r\n\t]+/g, " "));
        state.slashIndex = 0;
        return;
      }
      if (!key.ctrl && !key.meta && character.length > 0 && character >= " ") {
        if (character === " ") {
          state.slashOpen = false;
          insert(" ");
          return;
        }
        insert(character);
        state.slashIndex = 0;
      }
      return;
    }

    if (key.name === "tab") {
      openPicker();
      return;
    }
    if (key.name === "escape") {
      if (state.streaming) {
        stopStream();
        return;
      }
      if (state.notice !== null) {
        state.notice = null;
        render();
        return;
      }
      if (state.input.length > 0) {
        setInput("");
        render();
      }
      return;
    }
    if (key.name === "up") {
      scrollBy(key.meta ? 0 : 2);
      if (key.meta) historyStep(-1);
      return;
    }
    if (key.name === "down") {
      scrollBy(key.meta ? 0 : -2);
      if (key.meta) historyStep(1);
      return;
    }
    if (key.name === "pageup") {
      scrollBy(Math.max(4, ctx.ui.height - 12));
      return;
    }
    if (key.name === "pagedown") {
      scrollBy(-Math.max(4, ctx.ui.height - 12));
      return;
    }
    if (key.name === "home") {
      if (key.ctrl) {
        state.scroll = state.scrollMaximum;
        render();
      } else {
        state.cursor = 0;
        render();
      }
      return;
    }
    if (key.name === "end") {
      if (key.ctrl) {
        state.scroll = 0;
        render();
      } else {
        state.cursor = state.input.length;
        render();
      }
      return;
    }
    if (key.name === "left") {
      moveCursor(-1);
      return;
    }
    if (key.name === "right") {
      moveCursor(1);
      return;
    }
    if (key.name === "backspace") {
      deleteBack();
      return;
    }
    if (key.name === "delete") {
      deleteForward();
      return;
    }
    if (key.ctrl) {
      if (key.name === "a") {
        state.cursor = 0;
        render();
        return;
      }
      if (key.name === "e") {
        state.cursor = state.input.length;
        render();
        return;
      }
      if (key.name === "u") {
        state.input.splice(0, state.cursor);
        state.cursor = 0;
        render();
        return;
      }
      if (key.name === "k") {
        state.input.splice(state.cursor);
        render();
        return;
      }
      if (key.name === "w") {
        deleteWord();
        return;
      }
      if (key.name === "n") {
        newSession();
        return;
      }
      return;
    }
    if (enter) {
      send();
      return;
    }
    if (!key.meta && character.length > 0 && character >= " ") {
      if (character === "/" && state.input.length === 0) {
        openSlash();
        return;
      }
      insert(character);
    }
  }

  screen.enter();
  stopKeyboard = startKeyboard({
    stdin: ctx.stdin,
    stdout: ctx.stdout,
    onKey,
    onFocus: (focused) => ads.setFocused(focused),
    onEnd: () => close(0, farewell()),
    onResize: () => {
      screen.redraw();
      render();
    },
  });
  ads.attach(() => render());
  void ads.start();

  const onSignal = (): void => close(130);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    render();
    if (initialPrompt !== undefined && initialPrompt.length > 0) {
      setInput(initialPrompt);
      send();
      render();
    }
    ambient = setInterval(() => {
      if (finished) return;
      state.phase = (state.phase + 0.01) % 1;
      state.caretOn = ctx.motion.enabled ? Date.now() % 1120 < 560 : true;
      if (state.notice?.expires !== undefined && Date.now() > state.notice.expires) state.notice = null;
      render();
    }, 80);
    ambient.unref?.();
    return await done;
  } finally {
    if (!finished) close(exitCode);
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    stopKeyboard();
    if (ambient !== null) clearInterval(ambient);
    await ads.shutdown();
  }
}

export async function runChat(ctx: AppContext, args: readonly string[], options: ChatOptions = {}): Promise<number> {
  const prompt = args.join(" ").trim();
  const selected = resolveSession(ctx, options);
  if (selected.error !== undefined) {
    if (ctx.flags.json) {
      writeJson(ctx.stdout, {
        generatedAt: new Date().toISOString(),
        command: "chat",
        error: selected.error,
      });
      return 2;
    }
    ctx.stderr.write(`${errorLines(ctx, "Not this time", selected.error.message, selected.error.hint).join("\n")}\n`);
    return 2;
  }

  const requested = findRequestedModel(ctx);
  if (requested.error !== undefined) {
    if (ctx.flags.json) {
      writeJson(ctx.stdout, {
        generatedAt: new Date().toISOString(),
        command: "chat",
        error: requested.error,
      });
      return 2;
    }
    ctx.stderr.write(`${errorLines(ctx, "Not this time", requested.error.message, requested.error.hint).join("\n")}\n`);
    return 2;
  }

  if (!ctx.selection.ready || ctx.flags.refresh) {
    await ctx.refreshCatalogue({ live: ctx.flags.refresh });
  }
  restoreModel(ctx, selected.session);

  let session = selected.session;
  if (session === null) {
    session = createSession(ctx.selection.providerId, ctx.selection.modelId);
  } else if (ctx.flags.session === null && options.sessionId === undefined) {
    // `--continue` resumes the latest conversation, including its model.
  } else if (ctx.flags.model !== null || ctx.flags.provider !== null) {
    session = { ...session, provider: ctx.selection.providerId, model: ctx.selection.modelId };
  }

  if (prompt.length > 0) {
    return await oneShot(ctx, prompt, session, selected.resumed);
  }
  if (!ctx.isTTY || ctx.flags.json || ctx.flags.snapshot) {
    return staticChat(ctx, session, selected.resumed);
  }
  return await interactive(ctx, session, selected.resumed, options.initialPrompt);
}
