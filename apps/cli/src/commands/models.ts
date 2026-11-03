import { Screen } from "../tui/screen.ts";
import { startKeyboard, type Key } from "../tui/keyboard.ts";
import { errorPanel, printLines, successPanel } from "../tui/components.ts";
import { easeOutCubic, sleep } from "../tui/motion.ts";
import type { AppContext } from "../context.ts";
import type { CliModel, CliProvider } from "../ai/catalogue.ts";
import { visibleWidth } from "../tui/ansi.ts";

interface Entry {
  readonly provider: CliProvider;
  readonly model: CliModel;
}

function entries(ctx: AppContext): Entry[] {
  const providerFilter = ctx.flags.provider?.toLowerCase() ?? null;
  const list: Entry[] = [];
  for (const provider of ctx.catalogue.providers) {
    if (providerFilter !== null && provider.id.toLowerCase() !== providerFilter && provider.name.toLowerCase() !== providerFilter) continue;
    if (!provider.ready && !ctx.flags.all && provider.id !== ctx.selection.providerId) continue;
    for (const model of provider.models) list.push({ provider, model });
  }
  return list;
}

function payload(ctx: AppContext): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    command: "models",
    source: ctx.catalogue.source,
    refreshedAt: ctx.catalogue.refreshedAt === null ? null : new Date(ctx.catalogue.refreshedAt).toISOString(),
    liveError: ctx.catalogue.liveError,
    current: {
      provider: ctx.selection.providerId,
      model: ctx.selection.modelId,
      ready: ctx.selection.ready,
      reason: ctx.selection.reason,
    },
    providers: ctx.catalogue.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      ready: provider.ready,
      keySource: provider.keySource,
      included: provider.included,
      custom: provider.custom,
      note: provider.note,
      baseUrl: provider.baseUrl,
      env: provider.env,
      doc: provider.doc,
      models: provider.models.map((model) => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxOutput: model.maxOutput,
        reasoning: model.reasoning,
        cost: model.costNote,
        note: model.note,
        current: provider.id === ctx.selection.providerId && model.id === ctx.selection.modelId,
      })),
    })),
    ollama: ctx.catalogue.ollama,
    tagflow: ctx.catalogue.tagflow === null
      ? null
      : {
          available: ctx.catalogue.tagflow.available,
          defaultModel: ctx.catalogue.tagflow.defaultModel,
          requiresVerifiedAccount: ctx.catalogue.tagflow.requiresVerifiedAccount,
          models: ctx.catalogue.tagflow.models.length,
        },
    hint: "adcode models use <provider/model> to switch",
  };
}

function providerStatus(provider: CliProvider): string {
  if (provider.ready) return provider.keySource === "included" ? "included" : provider.keySource === "local" ? "local" : "ready";
  return provider.keySource === "unavailable" ? "unavailable" : "needs setup";
}

function modelRow(ctx: AppContext, entry: Entry, width: number, current: boolean): string[] {
  const { provider, model } = entry;
  const marker = current ? ctx.ui.paint(ctx.ui.glyphs.solidCircle, "money") : provider.ready ? ctx.ui.paint(ctx.ui.glyphs.circle, "faint") : ctx.ui.paint(ctx.ui.glyphs.circle, "borderSoft");
  const name = ctx.ui.paint(model.name, current ? "ink" : "muted", { bold: current });
  const id = ctx.ui.paint(model.id, "faint");
  const context = model.contextWindow > 0 ? `${Math.round(model.contextWindow / 1000)}k` : "";
  const right = `${provider.ready ? "" : `${ctx.ui.paint("not ready", "warning")}  `}${ctx.ui.paint(context, "faint")}`;
  if (width >= 72) {
    const left = `    ${marker} ${name}`;
    const gap = Math.max(2, width - visibleWidth(left) - visibleWidth(id) - visibleWidth(right) - 4);
    return [`${left}${" ".repeat(gap)}${id}  ${right}`];
  }
  return [
    `    ${marker} ${name}`,
    `      ${id}${context.length > 0 ? `  ${ctx.ui.paint(context, "faint")}` : ""}`,
  ];
}

function listLines(ctx: AppContext, width: number): string[] {
  const ui = ctx.ui;
  const lines: string[] = [
    "",
    `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("MODELS", "ink", { bold: true })}  ${ui.paint(
      `${ctx.selection.modelName} ${ui.glyphs.dot} ${ctx.selection.providerName}`,
      "faint",
    )}`,
    "",
  ];
  const source = ctx.catalogue.source === "live"
    ? "live catalogue"
    : ctx.catalogue.source === "cached"
      ? `cached catalogue${ctx.catalogue.refreshedAt === null ? "" : ` ${ui.glyphs.dot} ${new Date(ctx.catalogue.refreshedAt).toLocaleDateString()}`}`
      : "bundled catalogue";
  lines.push(`  ${ui.paint(source, "faint")}  ${ui.paint(ui.glyphs.dot, "borderSoft")}  ${ui.paint(
    `${ctx.catalogue.providers.filter((provider) => provider.ready).length} providers ready`,
    "faint",
  )}`);
  if (ctx.catalogue.liveError !== null && ctx.catalogue.source !== "live") {
    for (const line of ui.wrap(ctx.catalogue.liveError, Math.max(12, width - 4))) lines.push(`  ${ui.paint(line, "warning")}`);
  }
  lines.push("");

  const providerFilter = ctx.flags.provider?.toLowerCase() ?? null;
  for (const provider of ctx.catalogue.providers) {
    if (providerFilter !== null && provider.id.toLowerCase() !== providerFilter && provider.name.toLowerCase() !== providerFilter) continue;
    if (!provider.ready && !ctx.flags.all && provider.id !== ctx.selection.providerId) continue;
    const status = providerStatus(provider);
    const statusTone = provider.ready ? "money" : "warning";
    const count = `${provider.models.length} ${provider.models.length === 1 ? "model" : "models"}`;
    lines.push(`  ${ui.paint(provider.name, "ink", { bold: true })}  ${ui.paint(ui.glyphs.dot, "borderSoft")}  ${ui.paint(status, statusTone)}  ${ui.paint(count, "faint")}`);
    if (provider.note !== null) {
      for (const line of ui.wrap(provider.note, Math.max(12, width - 6))) lines.push(`    ${ui.paint(line, "faint")}`);
    }
    const current = provider.id === ctx.selection.providerId;
    const models = provider.ready || ctx.flags.all || current ? provider.models : [];
    for (const model of models) {
      lines.push(...modelRow(ctx, { provider, model }, width, current && model.id === ctx.selection.modelId));
    }
    lines.push("");
  }

  lines.push(`  ${ui.paint("switch", "faint")}  ${ui.paint("adcode models use <id>", "accent")}  ${ui.paint(ui.glyphs.dot, "borderSoft")}  ${ui.paint("browse", "faint")}  ${ui.paint("adcode models", "accent")}`);
  lines.push("");
  return lines;
}

function apply(ctx: AppContext, entry: Entry): number {
  if (!entry.provider.ready) {
    const lines = errorPanel(ctx.ui, {
      title: "That model is not ready",
      message: entry.provider.note ?? `${entry.provider.name} still needs setup.`,
      hint: entry.provider.env.length > 0
        ? `Set ${entry.provider.env[0]} and run adcode models again.`
        : "Run adcode doctor to see what is missing.",
    });
    ctx.stderr.write(`${lines.join("\n")}\n`);
    return 1;
  }
  ctx.chooseModel(entry.provider.id, entry.model.id);
  const lines = successPanel(ctx.ui, {
    title: "Model saved",
    message: `${entry.model.name} is now the deck's model.`,
    next: "adcode chat",
    details: `${entry.provider.name} ${ctx.ui.glyphs.dot} ${entry.model.id} ${ctx.ui.glyphs.dot} ${entry.model.costNote}`,
  });
  printLines([...lines, ""], ctx.stdout);
  return 0;
}

function resolveEntry(ctx: AppContext, query: string): Entry | null {
  const slash = query.indexOf("/");
  const providerQuery = slash > 0 ? query.slice(0, slash).toLowerCase() : null;
  const modelQuery = slash > 0 ? query.slice(slash + 1).toLowerCase() : query.toLowerCase();
  for (const provider of ctx.catalogue.providers) {
    if (providerQuery !== null && provider.id.toLowerCase() !== providerQuery && provider.name.toLowerCase() !== providerQuery) continue;
    const model = provider.models.find((one) => one.id.toLowerCase() === modelQuery || one.name.toLowerCase() === modelQuery);
    if (model !== undefined) return { provider, model };
  }
  return null;
}

async function picker(ctx: AppContext): Promise<number> {
  const ui = ctx.ui;
  const all = entries(ctx);
  const start = Math.max(0, all.findIndex((entry) => entry.provider.id === ctx.selection.providerId && entry.model.id === ctx.selection.modelId));
  const state = {
    index: start,
    visual: start,
    filter: [] as string[],
    phase: 0.3,
    reveal: ctx.motion.enabled ? 0 : 1,
    dirty: true,
  };
  const screen = new Screen({ out: ctx.stdout });
  let finished = false;
  let ambient: NodeJS.Timeout | null = null;
  let stopKeyboard = (): void => undefined;
  let code = 0;
  let resolveDone: (value: number) => void = () => undefined;
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });

  function matches(): number[] {
    const query = state.filter.join("").toLowerCase();
    const list: number[] = [];
    for (const [index, entry] of all.entries()) {
      if (query.length === 0 || `${entry.provider.name} ${entry.provider.id} ${entry.model.name} ${entry.model.id}`.toLowerCase().includes(query)) {
        list.push(index);
      }
    }
    return list;
  }

  function visibleRows(width: number, height: number): string[] {
    const indices = matches();
    if (indices.length === 0) {
      return [`  ${ui.paint("No models match that filter.", "faint")}`];
    }
    const activePosition = Math.max(0, indices.indexOf(state.index));
    const room = Math.max(4, height - 12);
    const startIndex = Math.max(0, Math.min(activePosition - Math.floor(room / 2), Math.max(0, indices.length - room)));
    const lines: string[] = [];
    let provider = "";
    for (const index of indices.slice(startIndex, startIndex + room)) {
      const entry = all[index];
      if (entry === undefined) continue;
      if (entry.provider.id !== provider) {
        provider = entry.provider.id;
        if (lines.length > 0) lines.push("");
        const status = entry.provider.ready ? ui.paint("ready", "money") : ui.paint(providerStatus(entry.provider), "warning");
        lines.push(`  ${ui.paint(entry.provider.name.toUpperCase(), "faint", { bold: true })}  ${status}`);
      }
      const selected = index === state.index;
      const current = entry.provider.id === ctx.selection.providerId && entry.model.id === ctx.selection.modelId;
      const mark = selected ? ui.paint(ui.glyphs.selected, "accent", { bold: true }) : " ";
      const dot = entry.provider.ready ? ui.paint(ui.glyphs.solidCircle, "money") : ui.paint(ui.glyphs.circle, "faint");
      const name = ui.paint(entry.model.name, selected ? "ink" : "muted", { bold: selected });
      const tail = `${current ? ui.paint("  current", "money") : ""}${width >= 70 ? ui.paint(`  ${entry.model.id}`, "faint") : ""}`;
      const row = `  ${mark} ${dot} ${name}${tail}`;
      lines.push(selected ? ui.style(ui.fit(row, width, "left"), { bg: "selected" }) : row);
    }
    if (indices.length > room) {
      lines.push(`  ${ui.paint(`${activePosition + 1} of ${indices.length}`, "faint")}`);
    }
    return lines;
  }

  function render(): void {
    if (finished) return;
    ctx.resize();
    const width = ctx.ui.width;
    const height = ctx.ui.height;
    const selected = all[state.index];
    const detail: string[] = [];
    if (selected !== undefined) {
      detail.push("");
      const status = selected.provider.ready ? "ready" : selected.provider.note ?? "not ready";
      detail.push(`  ${ui.paint(selected.provider.name, "muted")}  ${ui.paint(ui.glyphs.dot, "borderSoft")}  ${ui.paint(status, selected.provider.ready ? "money" : "warning")}`);
      const meta = [
        `${Math.round(selected.model.contextWindow / 1000)}k context`,
        selected.model.costNote,
        selected.model.reasoning ? "reasoning" : null,
      ].filter((part): part is string => part !== null && part.length > 0);
      for (const line of ui.wrap(meta.join(` ${ui.glyphs.dot} `), Math.max(12, width - 4))) detail.push(`  ${ui.paint(line, "faint")}`);
    }
    const filterText = state.filter.length === 0
      ? `${ui.paint("›", "faint")} ${ui.paint("type to filter providers and models", "faint")}`
      : `${ui.paint("›", "accent")} ${ui.paint(state.filter.join(""), "ink")}${ui.paint(ui.glyphs.caret, "money")}`;
    const filterWidth = Math.max(10, width - 6);
    const footer = [
      "",
      `  ${ui.paint(ui.glyphs.topLeft + ui.glyphs.horizontal.repeat(filterWidth) + ui.glyphs.topRight, "borderSoft")}`,
      `  ${ui.paint(ui.glyphs.vertical, "borderSoft")} ${ui.fit(filterText, filterWidth - 2)} ${ui.paint(ui.glyphs.vertical, "borderSoft")}`,
      `  ${ui.paint(ui.glyphs.bottomLeft + ui.glyphs.horizontal.repeat(filterWidth) + ui.glyphs.bottomRight, "borderSoft")}`,
      `  ${ui.paint("↑↓ choose   enter use   esc back   ctrl+l redraw", "faint")}`,
    ];
    const header = [
      `  ${ui.gradient(ui.glyphs.mark, { phase: state.phase })}  ${ui.paint("MODELS", "ink", { bold: true })}  ${ui.paint(
        `${ctx.catalogue.providers.filter((provider) => provider.ready).length} providers ready  ${ui.glyphs.dot}  ${ctx.catalogue.source}`,
        "faint",
      )}`,
      "",
    ];
    const room = Math.max(4, height - header.length - detail.length - footer.length - 1);
    const rows = visibleRows(width - 2, room + 12).slice(0, room);
    screen.render([...header, ...rows, ...detail, ...footer].slice(0, height));
  }

  function close(next: number): void {
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
    code = next;
    resolveDone(next);
  }

  function move(delta: number): void {
    const indices = matches();
    if (indices.length === 0) return;
    const current = Math.max(0, indices.indexOf(state.index));
    const next = indices[(current + delta + indices.length) % indices.length];
    if (next === undefined) return;
    state.index = next;
    if (Math.abs(next - state.visual) > 2) state.visual = next;
    render();
  }

  function onKey(key: Key): void {
    if (finished) return;
    if (key.ctrl && key.name === "d") {
      close(0);
      return;
    }
    if (key.ctrl && key.name === "c") {
      close(130);
      return;
    }
    if (key.ctrl && key.name === "l") {
      screen.redraw();
      render();
      return;
    }
    const character = key.string.length > 0 ? key.string : key.sequence;
    if (key.name === "escape" || (character === "q" && state.filter.length === 0)) {
      close(0);
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
      move(-10);
      return;
    }
    if (key.name === "pagedown") {
      move(10);
      return;
    }
    if (key.name === "home") {
      state.index = matches()[0] ?? 0;
      render();
      return;
    }
    if (key.name === "end") {
      state.index = matches().at(-1) ?? 0;
      render();
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      const entry = all[state.index];
      if (entry === undefined) return;
      if (!entry.provider.ready) {
        render();
        return;
      }
      finished = true;
      if (ambient !== null) clearInterval(ambient);
      ambient = null;
      try {
        stopKeyboard();
      } catch {
        // Terminal already gone.
      }
      screen.exit();
      const applied = apply(ctx, entry);
      code = applied;
      resolveDone(applied);
      return;
    }
    if (key.ctrl && key.name === "u") {
      state.filter = [];
      state.index = matches()[0] ?? 0;
      render();
      return;
    }
    if (key.name === "backspace") {
      if (state.filter.length > 0) {
        state.filter.splice(state.filter.length - 1, 1);
        state.index = matches()[0] ?? 0;
        render();
      }
      return;
    }
    if (!key.ctrl && !key.meta && character.length > 0 && character >= " ") {
      state.filter.push(character);
      state.index = matches()[0] ?? 0;
      render();
    }
  }

  screen.enter();
  stopKeyboard = startKeyboard({
    stdin: ctx.stdin,
    stdout: ctx.stdout,
    onKey,
    onEnd: () => close(0),
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
        state.reveal = easeOutCubic(progress);
        render();
        if (progress >= 1) break;
        await sleep(24);
      }
      ambient = setInterval(() => {
        if (finished) return;
        state.phase = (state.phase + 0.012) % 1;
        const distance = state.index - state.visual;
        if (Math.abs(distance) > 0.004) state.visual += distance * 0.4;
        else state.visual = state.index;
        render();
      }, 100);
      ambient.unref?.();
    }
    return await done;
  } finally {
    if (!finished) close(0);
    stopKeyboard();
    if (ambient !== null) clearInterval(ambient);
  }
}

function usage(ctx: AppContext, action: string): number {
  const lines = errorPanel(ctx.ui, {
    title: "Not this time",
    message: `"${action}" is not a models action.`,
    hint: "Use adcode models, adcode models list, adcode models use <id>, or adcode models refresh.",
  });
  ctx.stderr.write(`${lines.join("\n")}\n`);
  return 2;
}

export async function runModels(ctx: AppContext, args: readonly string[]): Promise<number> {
  const action = args[0] ?? null;

  if (action !== null && !["list", "use", "refresh", "search"].includes(action)) {
    return usage(ctx, action);
  }
  if (action === "search" && args[1] === undefined) {
    return usage(ctx, "search");
  }

  if (action === "use" && ctx.flags.json) {
    const lines = errorPanel(ctx.ui, {
      title: "Not this time",
      message: "--json reports the catalogue; it cannot apply a model.",
      hint: "Run adcode models use <id> without --json.",
    });
    ctx.stderr.write(`${lines.join("\n")}\n`);
    return 2;
  }

  if (ctx.flags.live || ctx.flags.refresh || action === "refresh") {
    await ctx.refreshCatalogue({ live: true });
  }

  if (action === "use") {
    const query = args.slice(1).join(" ").trim();
    if (query.length === 0) {
      const lines = errorPanel(ctx.ui, {
        title: "Not this time",
        message: "models use needs a model id.",
        hint: `Try adcode models use ${ctx.selection.modelId}.`,
      });
      ctx.stderr.write(`${lines.join("\n")}\n`);
      return 2;
    }
    const entry = resolveEntry(ctx, query);
    if (entry === null) {
      const lines = errorPanel(ctx.ui, {
        title: "Unknown model",
        message: `"${query}" is not in the catalogue.`,
        hint: "Run adcode models --all to see every id.",
      });
      ctx.stderr.write(`${lines.join("\n")}\n`);
      return 2;
    }
    return apply(ctx, entry);
  }

  if (ctx.flags.json) {
    ctx.stdout.write(`${JSON.stringify(payload(ctx), null, 2)}\n`);
    return 0;
  }

  if (action === "search" || ctx.flags.provider !== null) {
    const query = action === "search" ? args.slice(1).join(" ").toLowerCase() : ctx.flags.provider?.toLowerCase() ?? "";
    const searched = entries(ctx).filter((entry) =>
      `${entry.provider.name} ${entry.provider.id} ${entry.model.name} ${entry.model.id}`.toLowerCase().includes(query),
    );
    const filtered: string[] = [
      "",
      `  ${ctx.ui.gradient(ctx.ui.glyphs.mark)}  ${ctx.ui.paint("MODELS", "ink", { bold: true })}  ${ctx.ui.paint(
        `${searched.length} matches for "${query}"`,
        "faint",
      )}`,
      "",
    ];
    for (const entry of searched.slice(0, 80)) {
      filtered.push(...modelRow(ctx, entry, ctx.ui.width, entry.provider.id === ctx.selection.providerId && entry.model.id === ctx.selection.modelId));
    }
    if (searched.length === 0) filtered.push(`  ${ctx.ui.paint("Nothing matched. Try a provider name or a model id.", "faint")}`);
    filtered.push("");
    printLines(filtered, ctx.stdout);
    return 0;
  }

  if (action === "list" || !ctx.isTTY || ctx.flags.snapshot) {
    printLines(listLines(ctx, Math.max(20, Math.min(ctx.ui.width, 110))), ctx.stdout);
    return 0;
  }
  return picker(ctx);
}
