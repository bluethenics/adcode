import { Screen } from "../tui/screen.ts";
import { startKeyboard, type Key } from "../tui/keyboard.ts";
import { keyHints, printLines, rightAlign } from "../tui/components.ts";
import { easeOutCubic, sleep } from "../tui/motion.ts";
import { TerminalAds } from "../tui/adsChrome.ts";
import type { AppContext } from "../context.ts";
import { balanceLabel } from "../ads/runtime.ts";

/**
 * The tour is a reel, not a settings page.
 *
 * Every slide is a still frame first: the animation only reveals lines that are already
 * part of the layout, so `--no-motion`, a pipe and a slow terminal all get the same
 * content. Live data - the selected model, ready providers, the real balance - is read
 * from this machine; nothing is invented for the screenshot.
 */

interface TourSlide {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly note: string;
  readonly command: string;
}

export const TOUR_SLIDES: readonly TourSlide[] = [
  {
    id: "welcome",
    eyebrow: "THE TERMINAL APP",
    title: "ADCode, where you already work.",
    note: "A deck, a conversation, and real sponsor cards, sharing one account with the editor.",
    command: "adcode",
  },
  {
    id: "chat",
    eyebrow: "ASK",
    title: "A conversation that streams.",
    note: "Markdown, code blocks and scrolling, with the transcript saved as you go.",
    command: "adcode chat",
  },
  {
    id: "models",
    eyebrow: "CHOOSE",
    title: "Live models, honest readiness.",
    note: "Included AI, provider keys, or a model already running on this machine.",
    command: "adcode models",
  },
  {
    id: "earn",
    eyebrow: "EARN",
    title: "Real sponsors. Real balance.",
    note: "The same account, server and receipts as the desktop app. Cards never take the keyboard.",
    command: "adcode earn",
  },
  {
    id: "start",
    eyebrow: "START",
    title: "Pick a command and go.",
    note: "The deck is the map; every command is also a direct route.",
    command: "adcode help",
  },
];

export interface TourOptions {
  readonly start?: string;
}

function findSlide(id: string): number {
  return TOUR_SLIDES.findIndex((slide) => slide.id === id);
}

function bodyLines(ctx: AppContext, slide: TourSlide, width: number, balance: string | null, pending: number): string[] {
  const ui = ctx.ui;
  const room = Math.max(12, width - 4);
  const lines: string[] = [];
  const paragraph = (text: string, tone = "muted"): void => {
    for (const line of ui.wrap(text, room)) lines.push(`  ${ui.paint(line, tone)}`);
  };
  const blank = (): void => {
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
  };
  const keyValue = (label: string, value: string, tone = "ink"): void => {
    lines.push(`  ${ui.paint(label.padEnd(10), "faint")}${ui.paint(value, tone)}`);
  };

  switch (slide.id) {
    case "welcome": {
      if (ui.width >= 64) {
        for (const logo of ui.glyphs.logo) lines.push(`  ${ui.gradient(logo, { phase: 0.22, bold: true })}`);
        lines.push("");
      }
      paragraph("A terminal app for talking to live models, choosing what answers, and seeing the sponsor account that pays for the free tier.");
      blank();
      keyValue("MODEL", `${ctx.selection.providerName} ${ui.glyphs.dot} ${ctx.selection.modelName}`, ctx.selection.ready ? "ink" : "warning");
      keyValue("READY", ctx.selection.ready ? "yes" : ctx.selection.reason ?? "no", ctx.selection.ready ? "money" : "warning");
      keyValue("SPONSORS", ctx.config.ads.enabled && !ctx.flags.noAds ? `on ${ui.glyphs.dot} ${ctx.config.ads.preset}` : "off", ctx.config.ads.enabled && !ctx.flags.noAds ? "money" : "faint");
      blank();
      paragraph("Press enter, or use the arrow keys, to move through the tour.", "faint");
      break;
    }
    case "chat": {
      paragraph("Ask in plain language. The reply arrives as it is written, not after a spinner disappears.", "muted");
      blank();
      lines.push(`  ${ui.paint("YOU", "faint", { bold: true })}`);
      paragraph("Add a health endpoint and a test that proves it works.", "ink");
      blank();
      lines.push(`  ${ui.gradient(ui.glyphs.mark)} ${ui.paint("ADCODE", "ink", { bold: true })}  ${ui.paint(ctx.selection.modelName, "faint")}`);
      paragraph("I would add the route beside the existing handlers, then test the status code and the body.", "muted");
      lines.push(`  ${ui.paint(ui.glyphs.vertical, "borderSoft")} ${ui.paint("```ts", "faint")}`);
      lines.push(`  ${ui.paint(ui.glyphs.vertical, "borderSoft")} ${ui.paint("app.get(\"/health\", () => ({ ok: true }));", "info")}`);
      lines.push(`  ${ui.paint(ui.glyphs.vertical, "borderSoft")} ${ui.paint("```", "faint")}`);
      blank();
      paragraph("The transcript saves itself. adcode chat --continue resumes it; /new starts fresh without deleting the old one.", "faint");
      break;
    }
    case "models": {
      paragraph("The catalogue is the truth about this machine, not a list of possibilities.", "muted");
      blank();
      const ready = ctx.catalogue.providers.filter((provider) => provider.ready && provider.models.length > 0);
      if (ready.length === 0) {
        lines.push(`  ${ui.paint("No provider is ready yet.", "warning")}`);
        blank();
        paragraph("Run adcode models, or open ADCode Desktop once so the terminal can reuse its account.", "faint");
      } else {
        for (const provider of ready.slice(0, 4)) {
          const current = provider.id === ctx.selection.providerId;
          const marker = current ? ui.paint(ui.glyphs.solidCircle, "money") : ui.paint(ui.glyphs.circle, "faint");
          const count = `${provider.models.length} ${provider.models.length === 1 ? "model" : "models"}`;
          lines.push(`  ${marker} ${ui.paint(provider.name, current ? "ink" : "muted", { bold: current })}  ${ui.paint(count, "faint")}${current ? `  ${ui.paint("current", "money")}` : ""}`);
        }
        blank();
        const source = ctx.catalogue.source === "live" ? "live catalogue" : ctx.catalogue.source === "cached" ? "cached catalogue" : "bundled catalogue";
        paragraph(`Source: ${source}. Tab inside chat opens the same picker; enter saves the choice.`, "faint");
      }
      break;
    }
    case "earn": {
      if (balance === null) {
        lines.push(`  ${ui.paint("The sponsor server did not answer this time.", "warning")}`);
        blank();
        paragraph("The next card simply waits. Chat, models and sessions are unaffected.", "faint");
      } else {
        lines.push(`  ${ui.paint("AVAILABLE", "faint")}`);
        lines.push(`  ${ui.paint(balance, "money", { bold: true })}`);
        blank();
        paragraph("This is the balance on the account shared with the editor, read from the live sponsor server.", "muted");
      }
      blank();
      keyValue("CADENCE", ctx.config.ads.preset);
      keyValue("RECEIPTS", pending === 0 ? "none waiting" : `${pending} waiting to settle`, pending === 0 ? "faint" : "warning");
      blank();
      paragraph("A real sponsored card appears at the bottom of the screen. ctrl+o opens it, ctrl+x dismisses it, and typing continues underneath.", "faint");
      break;
    }
    case "start":
    default: {
      paragraph("Everything below works from the shell, and the deck runs the same commands.", "muted");
      blank();
      const rows: ReadonlyArray<readonly [string, string]> = [
        ["adcode chat", "full conversation"],
        ["adcode models", "choose what answers"],
        ["adcode sessions", "resume saved work"],
        ["adcode earn", "the real balance"],
        ["adcode doctor", "find what is missing"],
        ["adcode help", "the whole reference"],
      ];
      for (const [command, description] of rows) {
        lines.push(`  ${ui.paint(command.padEnd(18), "accent")}${ui.paint(description, "muted")}`);
      }
      blank();
      paragraph("Developer commands are unchanged: adcode open, dev, site, build, check, test and the rest still run their npm scripts.", "faint");
      break;
    }
  }

  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return lines;
}

function frame(
  ctx: AppContext,
  index: number,
  reveal: number,
  phase: number,
  balance: string | null,
  pending: number,
  ads: readonly string[],
  width: number,
  height: number,
): string[] {
  const ui = ctx.makeUI({ width, height });
  const slide = TOUR_SLIDES[index] ?? TOUR_SLIDES[0]!;
  const progress = (index + Math.max(0, Math.min(1, reveal))) / TOUR_SLIDES.length;
  const compact = width < 62;
  const short = height < 22;
  const header = rightAlign(
    `  ${ui.gradient(ui.glyphs.mark, { phase })}  ${ui.paint("ADCODE", "ink", { bold: true })}  ${ui.paint("TOUR", "faint")}`,
    ui.paint(`${index + 1} / ${TOUR_SLIDES.length}`, "faint"),
    width,
  );
  const bar = `  ${ui.gradientBar(Math.max(8, width - 6), progress, { phase })}`;
  const lines: string[] = [header, bar, ""];
  if (!short) {
    lines.push(`  ${ui.paint(slide.eyebrow, "faint", { bold: true })}`);
    lines.push("");
  }
  const titleWidth = Math.max(8, width - 4);
  for (const line of ui.wrap(slide.title, titleWidth)) lines.push(`  ${ui.paint(line, "ink", { bold: true })}`);
  lines.push("");
  const body = bodyLines(ctx, slide, width, balance, pending);
  const showing = Math.ceil(body.length * (ctx.motion.enabled ? Math.max(0, Math.min(1, reveal)) : 1));
  lines.push(...body.slice(0, showing));
  if (!short) {
    lines.push("");
    for (const line of ui.wrap(slide.note, titleWidth)) lines.push(`  ${ui.paint(line, "faint")}`);
  }

  const footer = keyHints(ui, [
    ["← →", "slides"],
    ["enter", compact ? "next" : "next slide"],
    ["esc", "leave"],
  ]);
  const adLines = ads.length > 0 ? ["", ...ads] : [];
  const fixed = 4 + footer.length;
  const room = Math.max(4, height - fixed - adLines.length - 2);
  const bodyOnly = lines.slice(3, Math.max(3, 3 + room));
  const tail: string[] = [];
  if (adLines.length > 0) tail.push(...adLines);
  tail.push("", `  ${ui.truncate(footer, Math.max(4, width - 2))}`);
  return [header, bar, "", ...bodyOnly.slice(0, room), ...tail].slice(0, height);
}

function staticTour(ctx: AppContext, start: number): number {
  const ui = ctx.ui;
  const width = Math.max(20, Math.min(ui.width - 4, 108));
  printLines(
    [
      "",
      `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("ADCODE TOUR", "ink", { bold: true })}  ${ui.paint(
        `${TOUR_SLIDES.length} slides ${ui.glyphs.dot} still frames`,
        "faint",
      )}`,
      `  ${ui.paint("The same tour with the motion removed. Every slide is complete on its own.", "muted")}`,
      "",
    ],
    ctx.stdout,
  );

  for (const [index, slide] of TOUR_SLIDES.entries()) {
    if (index < start) continue;
    printLines(
      [
        `  ${ui.paint(String(index + 1).padStart(2, "0"), "faint")}  ${ui.paint(slide.eyebrow, "faint", { bold: true })}`,
        `  ${ui.paint(ui.glyphs.horizontal.repeat(Math.max(4, width - 4)), "borderSoft")}`,
        "",
        ...ui.wrap(slide.title, width).map((line) => `  ${ui.paint(line, "ink", { bold: true })}`),
        "",
        ...bodyLines(ctx, slide, width, null, 0),
        "",
        `  ${ui.paint(slide.note, "faint")}`,
        "",
        `  ${ui.paint("next", "faint")}  ${ui.paint(slide.command, "accent")}`,
        "",
      ],
      ctx.stdout,
    );
  }
  printLines(
    [
      `  ${ui.paint("Motion is optional. adcode tour --no-motion is this page; without the flag it is a reel.", "faint")}`,
      "",
    ],
    ctx.stdout,
  );
  return 0;
}

function payload(ctx: AppContext, start: number): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    command: "tour",
    version: ctx.version,
    interactive: ctx.isTTY,
    start: TOUR_SLIDES[start]?.id ?? null,
    slides: TOUR_SLIDES.map((slide, index) => ({
      index,
      id: slide.id,
      eyebrow: slide.eyebrow,
      title: slide.title,
      note: slide.note,
      command: slide.command,
    })),
    model: {
      provider: ctx.selection.providerId,
      id: ctx.selection.modelId,
      ready: ctx.selection.ready,
    },
    catalogue: {
      source: ctx.catalogue.source,
      readyProviders: ctx.catalogue.providers.filter((provider) => provider.ready).length,
    },
    ads: {
      enabled: ctx.config.ads.enabled && !ctx.flags.noAds,
      preset: ctx.config.ads.preset,
    },
  };
}

async function reel(ctx: AppContext, start: number): Promise<number> {
  const screen = new Screen({ out: ctx.stdout });
  const ads = new TerminalAds(ctx);
  let index = start;
  let reveal = ctx.motion.enabled ? 0 : 1;
  let phase = 0.24;
  let finished = false;
  let balance: string | null = null;
  let pending = 0;
  let stopKeyboard = (): void => undefined;
  let ambient: NodeJS.Timeout | null = null;
  let resolveDone: (value: number) => void = () => undefined;
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });

  function render(): void {
    if (finished) return;
    ctx.resize();
    const width = ctx.ui.width;
    const height = ctx.ui.height;
    const adLines = height >= 20 ? ads.lines(ctx.ui) : [];
    screen.render(frame(ctx, index, reveal, phase, balance, pending, adLines, width, height));
    if (adLines.length > 0) ads.painted();
  }

  function close(code: number): void {
    if (finished) return;
    finished = true;
    if (ambient !== null) clearInterval(ambient);
    ambient = null;
    try {
      stopKeyboard();
    } catch {
      // The terminal is already gone.
    }
    ads.detach(() => undefined);
    screen.exit();
    resolveDone(code);
  }

  function go(delta: number): void {
    index = (index + delta + TOUR_SLIDES.length) % TOUR_SLIDES.length;
    reveal = ctx.motion.enabled ? 0 : 1;
    phase = (phase + 0.04) % 1;
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
    if (key.ctrl && key.name === "d") {
      close(0);
      return;
    }
    if (key.ctrl && key.name === "c") {
      close(130);
      return;
    }
    if (key.name === "escape" || (key.name === "q" && key.string === "q")) {
      close(0);
      return;
    }
    if (key.ctrl && key.name === "l") {
      screen.redraw();
      render();
      return;
    }
    if (key.name === "left" || key.name === "up" || key.name === "pageup" || key.name === "backspace") {
      go(-1);
      return;
    }
    if (key.name === "right" || key.name === "down" || key.name === "pagedown" || key.name === "tab" || key.name === "space" || key.name === "return" || key.name === "enter") {
      go(1);
      return;
    }
    if (/^[1-9]$/.test(key.string)) {
      const target = Number(key.string) - 1;
      if (target >= 0 && target < TOUR_SLIDES.length) {
        index = target;
        reveal = ctx.motion.enabled ? 0 : 1;
        render();
      }
      return;
    }
    if (reveal < 1) {
      reveal = 1;
      render();
    }
  }

  screen.enter();
  stopKeyboard = startKeyboard({
    stdin: ctx.stdin,
    stdout: ctx.stdout,
    onKey,
    onFocus: (focused) => ads.setFocused(focused),
    onEnd: () => close(0),
    onResize: () => {
      screen.redraw();
      render();
    },
  });
  ads.attach(() => render());
  void ads.start().then(async () => {
    const result = await ads.runtime.refreshBalance();
    if (result.ok) {
      balance = balanceLabel(result.value);
    }
    pending = ads.pending;
    render();
  });

  try {
    render();
    if (ctx.motion.enabled) {
      const started = Date.now();
      while (!finished) {
        const progress = Math.min(1, (Date.now() - started) / 420);
        reveal = easeOutCubic(progress);
        render();
        if (progress >= 1) break;
        await sleep(24);
      }
      reveal = 1;
      ambient = setInterval(() => {
        if (finished) return;
        phase = (phase + 0.01) % 1;
        render();
      }, 110);
      ambient.unref?.();
    }
    return await done;
  } finally {
    if (!finished) close(0);
    stopKeyboard();
    if (ambient !== null) clearInterval(ambient);
    await ads.shutdown();
  }
}

export async function runTour(ctx: AppContext, args: readonly string[] = []): Promise<number> {
  const requested = args[0]?.trim().toLowerCase() ?? "";
  const startIndex = requested.length === 0 ? 0 : findSlide(requested);
  if (startIndex < 0) {
    const lines = [
      `  ${ctx.ui.paint("There is no tour slide called", "ink")} ${ctx.ui.paint(`"${requested}"`, "warning")}.`,
      `  ${ctx.ui.paint(`Slides: ${TOUR_SLIDES.map((slide) => slide.id).join(", ")}.`, "faint")}`,
    ];
    if (ctx.flags.json) {
      ctx.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), command: "tour", error: { message: `There is no "${requested}" slide.` }, slides: TOUR_SLIDES.map((slide) => slide.id) }, null, 2)}\n`);
    } else {
      ctx.stderr.write(`${lines.join("\n")}\n`);
    }
    return 2;
  }

  if (ctx.flags.json) {
    ctx.stdout.write(`${JSON.stringify(payload(ctx, startIndex), null, 2)}\n`);
    return 0;
  }

  if (!ctx.isTTY || ctx.flags.snapshot) {
    return staticTour(ctx, startIndex);
  }

  return reel(ctx, startIndex);
}
