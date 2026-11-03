import { Screen } from "../tui/screen.ts";
import { startKeyboard, type Key } from "../tui/keyboard.ts";
import { centerLine, commandPalette, keyHints, promptBlock, rightAlign, type PaletteItem } from "../tui/components.ts";
import { visibleWidth } from "../tui/ansi.ts";
import { TerminalAds } from "../tui/adsChrome.ts";
import type { AppContext } from "../context.ts";
import { balanceLabel } from "../ads/runtime.ts";
import { brandLines } from "../tui/brand.ts";
import { basename } from "node:path";

/**
 * The deck is the front door: a quiet canvas, one large wordmark, and the prompt.
 *
 * It is deliberately not a menu. Commands live behind `/` and ctrl+p, the same gesture
 * every other command surface in the app uses, and typing a question still goes straight
 * to chat. The palette is the only list, so there is one place to learn.
 */

export interface DeckItem {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly command: string;
}

export const DECK_ITEMS: readonly DeckItem[] = [
  { id: "chat", name: "Chat", blurb: "Talk to a live model, with streaming replies", command: "chat" },
  { id: "models", name: "Models", blurb: "Choose Included AI, a provider key, or Ollama", command: "models" },
  { id: "sessions", name: "Sessions", blurb: "Resume a conversation saved on this machine", command: "sessions" },
  { id: "earn", name: "Earn", blurb: "See the real balance and the frequency caps", command: "earn" },
  { id: "status", name: "Status", blurb: "Account, model, ads and where state lives", command: "status" },
  { id: "doctor", name: "Doctor", blurb: "Check this machine, account and network", command: "doctor" },
  { id: "tour", name: "Tour", blurb: "A minute through what the deck can do", command: "tour" },
  { id: "theme", name: "Theme", blurb: "Change the palette; it is remembered", command: "theme" },
  { id: "app", name: "Desktop app", blurb: "Open this folder in the full ADCode editor", command: "app" },
  { id: "help", name: "Help", blurb: "Every command, flag and shortcut", command: "help" },
  { id: "quit", name: "Quit", blurb: "Restore the terminal and leave", command: "quit" },
];

export interface DeckResult {
  readonly command: string | null;
  readonly seed?: string;
}

interface DeckState {
  index: number;
  input: string;
  paletteOpen: boolean;
  caretOn: boolean;
  cursor: number;
  phase: number;
}

function paletteItems(): PaletteItem[] {
  return DECK_ITEMS.map((item) => ({ command: `/${item.id}`, blurb: item.blurb }));
}

function filteredItems(state: DeckState): DeckItem[] {
  const query = state.input.trim().toLowerCase();
  if (query.length === 0) return [...DECK_ITEMS];
  return DECK_ITEMS.filter(
    (item) =>
      item.id.startsWith(query) ||
      item.name.toLowerCase().startsWith(query) ||
      item.command.startsWith(query),
  );
}

function tagline(ui: ReturnType<AppContext["makeUI"]>, width: number): string {
  const candidates = [
    "Chat with AI. Build with ADCode.",
    "Chat, models, sessions.",
    "Chat, models, earn.",
  ];
  const line = candidates.find((entry) => entry.length + 4 <= width) ?? "ADCODE";
  return centerLine(ui.paint(line, "muted"), width);
}

function commandHint(ui: ReturnType<AppContext["makeUI"]>, width: number): string {
  if (width < 34) return centerLine(ui.paint("/help", "accent"), width);
  if (width >= 64) return centerLine(`${ui.paint("tab", "accent")} ${ui.paint("models", "faint")}    ${ui.paint("/", "accent")} ${ui.paint("commands", "faint")}    ${ui.paint("adcode app", "accent")} ${ui.paint("editor", "faint")}`, width);
  return centerLine(`${ui.paint("/help", "accent")} ${ui.paint("for commands", "faint")}`, width);
}

function modelLine(
  ctx: AppContext,
  ui: ReturnType<AppContext["makeUI"]>,
  width: number,
  promptWidth: number,
  balance: string | null,
): string {
  const model = width < 60
    ? ctx.selection.modelName
    : `${ctx.selection.providerName} ${ui.glyphs.dot} ${ctx.selection.modelName}`;
  const ready = ctx.catalogue.providers.filter((one) => one.ready).length;
  const right = balance !== null
    ? ui.paint(balance, "money", { bold: true })
    : width >= 52
      ? ui.paint(`${ready} provider${ready === 1 ? "" : "s"} ready`, "faint")
      : ui.paint(`${ready} ready`, "faint");
  const indicator = ui.paint(ui.glyphs.solidCircle, ctx.selection.ready ? "success" : "warning");
  const left = `${indicator} ${ui.paint(ui.truncate(model, Math.max(4, promptWidth - visibleWidth(right) - 4)), "muted")}`;
  return centerLine(rightAlign(left, right, promptWidth), width);
}

function footerLine(
  ctx: AppContext,
  ui: ReturnType<AppContext["makeUI"]>,
  state: DeckState,
  width: number,
): string {
  const workspace = width >= 100 ? `  ${ui.glyphs.dot}  ${ui.truncate(basename(ctx.cwd) || ctx.cwd, 22)}` : "";
  const left = width >= 56 ? `  ${ui.paint(`adcode v${ctx.version}${workspace}`, "faint")}` : "";
  const hints = state.paletteOpen
    ? width >= 48
      ? keyHints(ui, [["↑↓", "select"], ["enter", "run"], ["esc", "close"]])
      : keyHints(ui, [["enter", "run"], ["esc", "close"]])
    : width >= 72
      ? keyHints(ui, [["enter", "send"], ["ctrl+p", "commands"], ["ctrl+c", "quit"]])
      : width >= 50
        ? keyHints(ui, [["enter", "send"], ["ctrl+p", "commands"]])
        : keyHints(ui, [["enter", "send"], ["/", "commands"]]);
  return rightAlign(left, hints, width);
}

function buildFrame(
  ctx: AppContext,
  state: DeckState,
  options: { ads: TerminalAds | null; balance: string | null; width: number; height: number; color: boolean },
): string[] {
  const width = Math.max(20, options.width);
  const height = Math.max(10, options.height);
  const ui = ctx.makeUI({ width, height, color: options.color });
  const promptWidth = Math.min(76, Math.max(12, width - 6));

  const body: string[] = [];
  body.push(...brandLines(ui, width, state.paletteOpen ? Math.min(height, 19) : height, state.phase));
  body.push("");
  if (height >= 14 && !state.paletteOpen) {
    body.push(tagline(ui, width));
    body.push(commandHint(ui, width));
    body.push("");
  }

  const items = filteredItems(state);
  if (state.paletteOpen) {
    const room = Math.max(1, Math.min(8, height - body.length - 12));
    body.push(...commandPalette(ui, {
      items: paletteItems().filter((item) => items.some((entry) => `/${entry.id}` === item.command)),
      index: state.index,
      width: promptWidth,
      maxRows: room,
      emptyText: "No command matches.",
    }).map((line) => centerLine(line, width)));
    body.push("");
  }

  const characters = [...state.input];
  const room = Math.max(4, promptWidth - 8);
  const start = Math.max(0, state.cursor - room + 1);
  const before = state.paletteOpen ? `/${state.input}` : characters.slice(start, state.cursor).join("");
  const after = state.paletteOpen ? "" : characters.slice(state.cursor, start + room).join("");
  const prompt = promptBlock(ui, {
    width: promptWidth,
    placeholder: state.paletteOpen ? "type a command" : "Ask ADCode anything",
    before,
    after,
    caretOn: state.caretOn,
  });
  body.push(...prompt.map((line) => centerLine(line, width)));
  body.push("");
  body.push(modelLine(ctx, ui, width, promptWidth, options.balance));

  const adLines = options.ads === null ? [] : options.ads.lines(ui);
  const tail = adLines.length > 0 ? [...adLines, ""] : [];
  const available = Math.max(3, height - tail.length - 1);
  const top = Math.max(0, Math.floor((available - body.length) / 2));
  const bottom = Math.max(0, available - body.length - top);
  const centered = [
    ...Array.from({ length: top }, () => ""),
    ...body.slice(0, available),
    ...Array.from({ length: bottom }, () => ""),
  ];
  const lines = [...centered, ...tail, footerLine(ctx, ui, state, width)];
  // Every row is clipped once, after composition, so no painted fragment can escape the
  // terminal width.
  return lines.slice(0, height).map((line) => ui.truncate(line, width));
}

export async function runDeck(ctx: AppContext): Promise<DeckResult> {
  if (ctx.flags.json) {
    ctx.stdout.write(`${JSON.stringify({
      command: "deck",
      version: ctx.version,
      theme: ctx.themeName,
      interactive: ctx.isTTY,
      account: { uid: ctx.account.uid(), source: ctx.account.source, signedIn: ctx.desktop.identityFound },
      model: {
        provider: ctx.selection.providerId,
        id: ctx.selection.modelId,
        ready: ctx.selection.ready,
        reason: ctx.selection.reason,
      },
      catalogue: {
        source: ctx.catalogue.source,
        providers: ctx.catalogue.providers.length,
        ready: ctx.catalogue.providers.filter((one) => one.ready).length,
      },
      ads: {
        enabled: ctx.config.ads.enabled,
        preset: ctx.config.ads.preset,
        // The ledger is a network read; `adcode earn` asks for it on demand. A deck JSON
        // snapshot says exactly what it knows rather than inventing a zero.
        balanceMicros: null,
      },
      commands: DECK_ITEMS.map((item) => ({ id: item.id, command: item.command, blurb: item.blurb })),
    }, null, 2)}\n`);
    return { command: null };
  }

  if (!ctx.isTTY || ctx.flags.snapshot) {
    const width = ctx.flags.width ?? (ctx.stdout.isTTY ? ctx.stdout.columns ?? 100 : 96);
    const height = ctx.flags.height ?? (ctx.stdout.isTTY ? ctx.stdout.rows ?? 32 : 32);
    const state: DeckState = { index: 0, input: "", paletteOpen: false, caretOn: true, cursor: 0, phase: 0.24 };
    const lines = buildFrame(ctx, state, {
      ads: null,
      balance: null,
      width,
      height,
      color: ctx.color && ctx.flags.snapshot,
    });
    ctx.stdout.write(`${lines.join("\n")}\n`);
    return { command: null };
  }

  const screen = new Screen({ out: ctx.stdout });
  const state: DeckState = { index: 0, input: "", paletteOpen: false, caretOn: true, cursor: 0, phase: 0.24 };
  const ads = new TerminalAds(ctx);
  let balance: string | null = null;
  let finished = false;
  let resolveDone: (result: DeckResult) => void = () => undefined;
  const done = new Promise<DeckResult>((resolve) => {
    resolveDone = resolve;
  });
  let stopKeyboard = (): void => undefined;
  let ambient: NodeJS.Timeout | null = null;
  const enteredAt = Date.now();

  function render(): void {
    if (finished) return;
    ctx.resize();
    const lines = buildFrame(ctx, state, {
      ads,
      balance,
      width: ctx.ui.width,
      height: ctx.ui.height,
      color: ctx.color,
    });
    screen.render(lines);
    ads.painted();
  }

  function close(): void {
    if (finished) return;
    finished = true;
    if (ambient !== null) clearInterval(ambient);
    ambient = null;
    stopKeyboard();
    ads.detach(() => undefined);
    screen.exit();
  }

  function finish(result: DeckResult): void {
    close();
    resolveDone(result);
  }

  function items(): DeckItem[] {
    return filteredItems(state);
  }

  function selected(): DeckItem | undefined {
    const list = items();
    if (list.length === 0) return undefined;
    return list[Math.max(0, Math.min(list.length - 1, state.index))];
  }

  function openPalette(): void {
    state.paletteOpen = true;
    state.input = "";
    state.index = 0;
    state.caretOn = true;
    render();
  }

  function closePalette(clear = true): void {
    state.paletteOpen = false;
    if (clear) state.input = "";
    render();
  }

  function runSelected(): void {
    const item = selected();
    if (item === undefined) return;
    if (item.id === "quit") {
      finish({ command: null });
      return;
    }
    finish({ command: item.command });
  }

  function move(delta: number): void {
    const length = items().length;
    if (length === 0) return;
    state.index = (state.index + delta + length) % length;
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
    if (key.ctrl && (key.name === "c" || key.name === "d")) {
      finish({ command: null });
      return;
    }
    if (key.ctrl && key.name === "l") {
      screen.redraw();
      render();
      return;
    }
    if (key.ctrl && key.name === "p") {
      if (state.paletteOpen) closePalette();
      else openPalette();
      return;
    }
    if (key.name === "tab" && !state.paletteOpen) {
      finish({ command: "models" });
      return;
    }

    if (state.paletteOpen) {
      if (key.name === "escape") {
        closePalette();
        return;
      }
      if (key.name === "up") {
        move(-1);
        return;
      }
      if (key.name === "down") {
        move(1);
        return;
      }
      if (key.name === "pageup") {
        move(-6);
        return;
      }
      if (key.name === "pagedown") {
        move(6);
        return;
      }
      if (key.name === "home") {
        state.index = 0;
        render();
        return;
      }
      if (key.name === "end") {
        state.index = Math.max(0, items().length - 1);
        render();
        return;
      }
      if (key.name === "return") {
        runSelected();
        return;
      }
      if (key.ctrl && key.name === "u") {
        state.input = "";
        state.index = 0;
        render();
        return;
      }
      if (key.name === "backspace") {
        if (state.input.length === 0) {
          closePalette();
          return;
        }
        state.input = [...state.input].slice(0, -1).join("");
        state.index = 0;
        render();
        return;
      }
      if (key.name === "paste" && key.string.length > 0) {
        state.input += key.string.replace(/\s+/g, " ").trim();
        state.index = 0;
        render();
        return;
      }
      if (!key.ctrl && !key.meta && key.string.length > 0 && key.string >= " ") {
        state.input += key.string;
        state.index = 0;
        render();
      }
      return;
    }

    if (key.name === "escape") {
      if (state.input.length > 0) {
        state.input = "";
        state.cursor = 0;
        render();
      }
      return;
    }
    if (key.name === "return") {
      if (state.input.trim().length > 0) {
        finish({ command: "chat", seed: state.input.trim() });
      } else {
        openPalette();
      }
      return;
    }
    if (key.name === "backspace") {
      if (state.cursor > 0) {
        const characters = [...state.input];
        characters.splice(--state.cursor, 1);
        state.input = characters.join("");
        render();
      }
      return;
    }
    if (["left", "right", "home", "end", "delete"].includes(key.name)) {
      const characters = [...state.input];
      if (key.name === "left") state.cursor = Math.max(0, state.cursor - 1);
      if (key.name === "right") state.cursor = Math.min(characters.length, state.cursor + 1);
      if (key.name === "home") state.cursor = 0;
      if (key.name === "end") state.cursor = characters.length;
      if (key.name === "delete") { characters.splice(state.cursor, 1); state.input = characters.join(""); }
      state.caretOn = true;
      render();
      return;
    }
    if (key.ctrl && (key.name === "u" || key.name === "w")) {
      const characters = [...state.input];
      const before = characters.slice(0, state.cursor).join("");
      const kept = key.name === "u" ? "" : before.replace(/\S+\s*$/, "");
      state.input = kept + characters.slice(state.cursor).join("");
      state.cursor = [...kept].length;
      render();
      return;
    }
    if (key.name === "paste" && key.string.length > 0) {
      const pasted = key.string.replace(/\s+/g, " ").trim();
      if (state.input.length === 0 && pasted.startsWith("/") && !pasted.includes(" ")) {
        state.paletteOpen = true;
        state.input = pasted.slice(1);
        state.index = 0;
      } else {
        const characters = [...state.input];
        characters.splice(state.cursor, 0, ...pasted);
        state.input = characters.join("");
        state.cursor += [...pasted].length;
      }
      render();
      return;
    }
    if (!key.ctrl && !key.meta && key.string.length > 0 && key.string >= " ") {
      if (key.string === "/" && state.input.length === 0) {
        openPalette();
        return;
      }
      const characters = [...state.input];
      characters.splice(state.cursor, 0, ...key.string);
      state.input = characters.join("");
      state.cursor += [...key.string].length;
      state.caretOn = true;
      render();
    }
  }

  screen.enter();
  stopKeyboard = startKeyboard({
    stdin: ctx.stdin,
    stdout: ctx.stdout,
    onKey,
    onFocus: (focused) => ads.setFocused(focused),
    onEnd: () => finish({ command: null }),
    onResize: () => {
      screen.redraw();
      render();
    },
  });
  ads.attach(() => render());
  void ads.start().then(async () => {
    if (finished || ctx.flags.noAds || !ctx.config.ads.enabled) return;
    const result = await ads.runtime.refreshBalance();
    if (result.ok) {
      balance = balanceLabel(result.value);
      render();
    }
  });

  try {
    render();
    // The first frame and keyboard are ready before the network is touched.
    if (ctx.catalogue.tagflow === null || !ctx.selection.ready || ctx.flags.refresh) {
      void ctx.refreshCatalogue({ live: ctx.flags.refresh }).then(() => render()).catch(() => undefined);
    }
    if (ctx.motion.enabled) {
      ambient = setInterval(() => {
        if (finished) return;
        const elapsed = Date.now() - enteredAt;
        state.phase = elapsed < 280 ? 0.24 + (1 - elapsed / 280) * 0.16 : 0.24;
        state.caretOn = Date.now() % 1120 < 560;
        render();
      }, 80);
      ambient.unref?.();
    }
    return await done;
  } finally {
    close();
    await ads.shutdown();
  }
}
