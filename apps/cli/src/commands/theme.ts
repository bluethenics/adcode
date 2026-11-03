import { Screen } from "../tui/screen.ts";
import { startKeyboard, type Key } from "../tui/keyboard.ts";
import { errorPanel, printLines, successPanel } from "../tui/components.ts";
import { easeOutCubic, sleep } from "../tui/motion.ts";
import type { AppContext } from "../context.ts";
import { isThemeName, resolveTheme, themeNames, type Theme } from "../tui/theme.ts";
import { createUI, type UI } from "../tui/ui.ts";

function payload(ctx: AppContext): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    command: "theme",
    current: ctx.themeName,
    themes: themeNames().map((name) => {
      const theme = resolveTheme(name);
      return {
        id: theme.id,
        label: theme.label,
        blurb: theme.blurb,
        light: theme.isLight,
        current: name === ctx.themeName,
        colors: {
          ink: theme.ink,
          muted: theme.muted,
          faint: theme.faint,
          panel: theme.panel,
          panelSoft: theme.panelSoft,
          border: theme.border,
          accent: theme.accent,
          money: theme.money,
          success: theme.success,
          warning: theme.warning,
          danger: theme.danger,
          info: theme.info,
        },
      };
    }),
    hint: "adcode theme set <name>",
  };
}

function swatches(ui: UI, theme: Theme): string {
  const colors = [theme.ink, theme.muted, theme.faint, theme.accent, theme.money, theme.warning, theme.danger, theme.info];
  return colors.map((color) => ui.style("  ", { bg: color })).join("");
}

function listOutput(ctx: AppContext, width: number): string[] {
  const ui = ctx.ui;
  const lines = [
    "",
    `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("THEMES", "ink", { bold: true })}  ${ui.paint(`current ${ctx.themeName}`, "faint")}`,
    "",
  ];
  for (const name of themeNames()) {
    const theme = resolveTheme(name);
    const current = name === ctx.themeName;
    const preview = ctx.makeUI({ theme: name, width: Math.max(20, Math.min(width - 6, 72)) });
    lines.push(`  ${current ? ui.paint(ui.glyphs.selected, "money", { bold: true }) : " "} ${ui.paint(theme.label.padEnd(10), current ? "ink" : "muted", { bold: current })} ${swatches(ui, theme)}`);
    const blurb = `${theme.blurb}${theme.isLight ? " Light terminal." : ""}`;
    for (const line of preview.wrap(blurb, Math.max(12, width - 16))) {
      lines.push(`     ${ui.paint(line, "faint")}`);
    }
    lines.push("");
  }
  lines.push(`  ${ui.paint("try one", "faint")}  ${ui.paint("adcode theme", "accent")}  ${ui.paint(ui.glyphs.dot, "borderSoft")}  ${ui.paint("set", "faint")}  ${ui.paint("adcode theme set paper", "accent")}`);
  lines.push("");
  return lines;
}

function previewLines(theme: Theme, width: number, height: number): string[] {
  const preview = resolveTheme(theme.id);
  const ui = ctxPreview(preview, width);
  const other = ctxPreview(resolveTheme(theme.isLight ? "midnight" : "paper"), width);
  const lines = [
    ui.rule(Math.max(4, width), { label: "preview", labelTone: "faint", tone: "borderSoft" }),
    "",
    `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("ADCODE", "ink", { bold: true })}  ${ui.paint("terminal", "faint")}`,
    `  ${ui.paint("An ad-supported workspace for people who ship.", "muted")}`,
    "",
    `  ${ui.paint("MODEL", "faint")}   ${ui.paint("selected model", "ink")}  ${ui.paint(ui.glyphs.dot, "borderSoft")}  ${ui.paint("ready", "money")}`,
    `  ${ui.paint("EARNED", "faint")}  ${ui.paint("live balance", "money", { bold: true })}`,
    "",
    `  ${ui.paint(">", "accent")} ${ui.paint("Ask ADCode anything", "muted")}${ui.paint(ui.glyphs.caret, "money")} ${other.paint("(contrast)", "faint")}`,
  ];
  return lines.slice(0, Math.max(6, height));
}

function ctxPreview(theme: Theme, width: number): UI {
  // A UI with one fixed theme, for the preview pane only.
  return createUI({ theme: theme.id, color: process.stdout.isTTY === true, unicode: true, width, height: 20 });
}

async function picker(ctx: AppContext): Promise<number> {
  const original = ctx.themeName;
  const names = [...themeNames()];
  let index = Math.max(0, names.indexOf(original));
  let ui = ctx.ui;
  const screen = new Screen({ out: ctx.stdout });
  let finished = false;
  let ambient: NodeJS.Timeout | null = null;
  let stopKeyboard = (): void => undefined;
  let resolveDone: (value: number) => void = () => undefined;
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });
  let phase = 0.2;
  let reveal = ctx.motion.enabled ? 0 : 1;

  function setPreview(name: string): void {
    ctx.themeName = name;
    ctx.ui = ctx.makeUI();
    ui = ctx.ui;
  }

  function restore(): void {
    ctx.themeName = original;
    ctx.ui = ctx.makeUI();
    ui = ctx.ui;
  }

  function render(): void {
    if (finished) return;
    ctx.resize();
    const width = ctx.ui.width;
    const height = ctx.ui.height;
    const current = names[index] ?? original;
    const theme = resolveTheme(current);
    const wide = width >= 78;
    const lines: string[] = [
      `  ${ui.gradient(ui.glyphs.mark, { phase })}  ${ui.paint("THEMES", "ink", { bold: true })}  ${ui.paint("choose a palette; it is remembered", "faint")}`,
      "",
    ];
    const listWidth = wide ? Math.min(48, Math.floor(width * 0.48)) : width;
    for (const [offset, name] of names.entries()) {
      const entry = resolveTheme(name);
      const selected = name === current;
      const marker = selected ? ui.paint(ui.glyphs.selected, "accent", { bold: true }) : " ";
      const label = ui.paint(entry.label.padEnd(10), selected ? "ink" : "muted", { bold: selected });
      const row = `  ${marker} ${label}${wide ? "" : ` ${swatches(ui, entry)}`}`;
      lines.push(selected ? ui.style(ui.fit(row, listWidth, "left"), { bg: "selected" }) : row);
      if (!wide) {
        for (const line of ui.wrap(entry.blurb, Math.max(12, width - 8))) lines.push(`      ${ui.paint(line, "faint")}`);
        lines.push("");
      }
      void offset;
    }
    if (wide) {
      const previewWidth = width - listWidth - 4;
      const preview = previewLines(theme, Math.max(18, previewWidth), Math.max(8, height - 8));
      const room = Math.max(0, height - lines.length - 4);
      const visible = preview.slice(0, room);
      for (const [offset, line] of visible.entries()) {
        const listLine = lines[2 + offset] ?? "";
        const gap = Math.max(2, listWidth - ui.visibleWidth(listLine) + 2);
        lines[2 + offset] = `${listLine}${" ".repeat(gap)}${line}`;
      }
    }
    lines.push("");
    lines.push(`  ${ui.paint("↑↓ preview   enter use   esc cancel   current", "faint")}  ${ui.paint(original, "muted")}`);
    screen.render(lines.slice(0, height));
  }

  function close(next: number, apply: boolean): void {
    if (finished) return;
    finished = true;
    if (ambient !== null) clearInterval(ambient);
    ambient = null;
    try {
      stopKeyboard();
    } catch {
      // Terminal already gone.
    }
    screen.exit();
    if (!apply) restore();
    resolveDone(next);
  }

  function onKey(key: Key): void {
    if (finished) return;
    if (key.ctrl && key.name === "d") {
      close(0, false);
      return;
    }
    if (key.ctrl && key.name === "c") {
      close(130, false);
      return;
    }
    if (key.name === "escape" || key.string === "q") {
      close(0, false);
      return;
    }
    if (key.name === "up" || key.name === "k") {
      index = (index - 1 + names.length) % names.length;
      setPreview(names[index] ?? original);
      render();
      return;
    }
    if (key.name === "down" || key.name === "j") {
      index = (index + 1) % names.length;
      setPreview(names[index] ?? original);
      render();
      return;
    }
    if (key.name === "home") {
      index = 0;
      setPreview(names[0] ?? original);
      render();
      return;
    }
    if (key.name === "end") {
      index = names.length - 1;
      setPreview(names[index] ?? original);
      render();
      return;
    }
    if (/^[1-9]$/.test(key.string) && Number(key.string) <= names.length) {
      index = Number(key.string) - 1;
      setPreview(names[index] ?? original);
      render();
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      const choice = names[index] ?? original;
      setPreview(choice);
      ctx.setTheme(choice);
      close(0, true);
      const lines = successPanel(ctx.ui, {
        title: "Theme saved",
        message: `${resolveTheme(choice).label} is now the terminal palette.`,
        details: resolveTheme(choice).blurb,
      });
      printLines([...lines, ""], ctx.stdout);
    }
  }

  screen.enter();
  stopKeyboard = startKeyboard({
    stdin: ctx.stdin,
    stdout: ctx.stdout,
    onKey,
    onEnd: () => close(0, false),
    onResize: () => {
      screen.redraw();
      render();
    },
  });

  try {
    render();
    if (ctx.motion.enabled) {
      const started = Date.now();
      while (!finished) {
        const progress = Math.min(1, (Date.now() - started) / 280);
        reveal = easeOutCubic(progress);
        render();
        if (progress >= 1) break;
        await sleep(24);
      }
      ambient = setInterval(() => {
        if (finished) return;
        phase = (phase + 0.012) % 1;
        render();
      }, 120);
      ambient.unref?.();
    }
    void reveal;
    return await done;
  } finally {
    if (!finished) close(0, false);
    stopKeyboard();
    if (ambient !== null) clearInterval(ambient);
  }
}

function apply(ctx: AppContext, name: string): number {
  if (!isThemeName(name)) {
    ctx.stderr.write(`${errorPanel(ctx.ui, {
      title: "Unknown theme",
      message: `"${name}" is not a theme.`,
      hint: `Use one of: ${themeNames().join(", ")}.`,
    }).join("\n")}\n`);
    return 2;
  }
  ctx.setTheme(name);
  const theme = resolveTheme(name);
  ctx.stdout.write(`${successPanel(ctx.ui, {
    title: "Theme saved",
    message: `${theme.label} is now the terminal palette.`,
    details: theme.blurb,
  }).join("\n")}\n\n`);
  return 0;
}

export async function runTheme(ctx: AppContext, args: readonly string[]): Promise<number> {
  const action = args[0] ?? null;
  if (action !== null && !["list", "set", "use", "show"].includes(action)) {
    ctx.stderr.write(`${errorPanel(ctx.ui, {
      title: "Not this time",
      message: `"${action}" is not a theme action.`,
      hint: "Use adcode theme, adcode theme list, or adcode theme set <name>.",
    }).join("\n")}\n`);
    return 2;
  }

  if (action === "set" || action === "use") {
    const name = args[1] ?? "";
    if (name.length === 0) {
      ctx.stderr.write(`${errorPanel(ctx.ui, {
        title: "A theme name is needed",
        message: "theme set needs the name of a palette.",
        hint: themeNames().join(" · "),
      }).join("\n")}\n`);
      return 2;
    }
    return apply(ctx, name);
  }

  if (ctx.flags.json) {
    if (action === "set" || action === "use") return 2;
    ctx.stdout.write(`${JSON.stringify(payload(ctx), null, 2)}\n`);
    return 0;
  }

  if (action === "show") {
    const name = args[1] ?? ctx.themeName;
    if (!isThemeName(name)) {
      ctx.stderr.write(`${errorPanel(ctx.ui, { title: "Unknown theme", message: name, hint: themeNames().join(" · ") }).join("\n")}\n`);
      return 2;
    }
    printLines(previewLines(resolveTheme(name), Math.max(20, Math.min(ctx.ui.width, 96)), 18), ctx.stdout);
    return 0;
  }

  if (action === "list" || !ctx.isTTY || ctx.flags.snapshot) {
    printLines(listOutput(ctx, Math.max(20, Math.min(ctx.ui.width, 100))), ctx.stdout);
    return 0;
  }
  return picker(ctx);
}
