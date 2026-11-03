import { Screen } from "../tui/screen.ts";
import { startKeyboard, type Key } from "../tui/keyboard.ts";
import { errorPanel, printLines, successPanel } from "../tui/components.ts";
import { easeOutCubic, sleep } from "../tui/motion.ts";
import { renderMarkdown } from "../chat/markdown.ts";
import type { AppContext } from "../context.ts";
import {
  deleteSession,
  exportSession,
  isSessionId,
  listSessions,
  readSession,
  renameSession,
  type ChatSession,
} from "../ai/sessions.ts";
import { plural, relativeTime, shortDate } from "../util/format.ts";
import { cliPaths } from "../util/paths.ts";
import { runChat } from "./chat.ts";

function payload(ctx: AppContext): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    command: "sessions",
    directory: cliPaths.sessions(),
    sessions: listSessions().map((session) => ({
      id: session.id,
      title: session.title,
      messages: session.messages.length,
      createdAt: new Date(session.createdAt).toISOString(),
      updatedAt: new Date(session.updatedAt).toISOString(),
      provider: session.provider,
      model: session.model,
    })),
  };
}

function sessionLines(ctx: AppContext, session: ChatSession, width: number): string[] {
  const ui = ctx.ui;
  const meta = `${session.messages.length} ${plural(session.messages.length, "message")} ${ui.glyphs.dot} ${relativeTime(session.updatedAt)}`;
  const model = session.model === null ? "" : ` ${ui.glyphs.dot} ${session.model}`;
  if (width >= 66) {
    const left = `  ${ui.paint(session.title, "ink", { bold: true })}`;
    const right = ui.paint(`${meta}${model}`, "faint");
    const gap = Math.max(2, width - ui.visibleWidth(left) - ui.visibleWidth(right) - 2);
    return [`${left}${" ".repeat(gap)}${right}`, `    ${ui.paint(session.id, "faint")}  ${ui.paint(shortDate(session.updatedAt), "borderSoft")}`];
  }
  return [
    `  ${ui.paint(session.title, "ink", { bold: true })}`,
    `    ${ui.paint(meta, "faint")}`,
    `    ${ui.paint(session.id, "borderSoft")}`,
  ];
}

function listOutput(ctx: AppContext, width: number): string[] {
  const ui = ctx.ui;
  const sessions = listSessions();
  const lines: string[] = [
    "",
    `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("SESSIONS", "ink", { bold: true })}  ${ui.paint(
      `${sessions.length} saved ${ui.glyphs.dot} ${cliPaths.sessions()}`,
      "faint",
    )}`,
    "",
  ];
  if (sessions.length === 0) {
    lines.push(`  ${ui.paint("No saved conversations yet.", "muted")}`);
    lines.push(`  ${ui.paint("Run adcode chat in a terminal; every conversation is saved as you go.", "faint")}`);
    lines.push("");
    return lines;
  }
  for (const [index, session] of sessions.entries()) {
    lines.push(...sessionLines(ctx, session, width));
    if (index < sessions.length - 1) lines.push("");
  }
  lines.push("");
  lines.push(`  ${ui.paint("open", "faint")}  ${ui.paint("adcode chat --session <id>", "accent")}  ${ui.paint(ui.glyphs.dot, "borderSoft")}  ${ui.paint("browse", "faint")}  ${ui.paint("adcode sessions", "accent")}`);
  lines.push("");
  return lines;
}

function resolveId(ctx: AppContext, raw: string | undefined): ChatSession | number {
  if (raw === undefined || raw.length === 0) {
    ctx.stderr.write(
      `${errorPanel(ctx.ui, {
        title: "A session id is needed",
        message: "This action needs the id of a saved conversation.",
        hint: "Run adcode sessions to see the ids, then copy one.",
      }).join("\n")}\n`,
    );
    return 2;
  }
  if (!isSessionId(raw)) {
    ctx.stderr.write(
      `${errorPanel(ctx.ui, {
        title: "That is not a session id",
        message: `"${raw}" cannot be a saved session id.`,
        hint: "Run adcode sessions; ids start with s-.",
      }).join("\n")}\n`,
    );
    return 2;
  }
  const session = readSession(raw);
  if (session === null) {
    ctx.stderr.write(
      `${errorPanel(ctx.ui, {
        title: "That session is gone",
        message: `No saved session named "${raw}".`,
        hint: "Run adcode sessions to see what is still on disk.",
      }).join("\n")}\n`,
    );
    return 2;
  }
  return session;
}

function showTranscript(ctx: AppContext, session: ChatSession): number {
  if (ctx.flags.json) {
    ctx.stdout.write(`${JSON.stringify({
      generatedAt: new Date().toISOString(),
      command: "sessions",
      action: "show",
      session: {
        id: session.id,
        title: session.title,
        createdAt: new Date(session.createdAt).toISOString(),
        updatedAt: new Date(session.updatedAt).toISOString(),
        provider: session.provider,
        model: session.model,
        messages: session.messages.map((message) => ({ role: message.role, text: message.text, at: message.at })),
      },
    }, null, 2)}\n`);
    return 0;
  }
  const ui = ctx.ui;
  const width = Math.max(20, Math.min(ui.width - 4, 104));
  const lines = [
    "",
    `  ${ui.gradient(ui.glyphs.mark)}  ${ui.paint("ADCODE SESSION", "ink", { bold: true })}  ${ui.paint(session.id, "faint")}`,
    `  ${ui.paint(session.title, "muted")}  ${ui.paint(ui.glyphs.dot, "borderSoft")}  ${ui.paint(`${session.messages.length} ${plural(session.messages.length, "message")}`, "faint")}`,
    "",
  ];
  for (const message of session.messages) {
    lines.push(`  ${message.role === "user" ? ui.paint("YOU", "faint", { bold: true }) : `${ui.gradient(ui.glyphs.mark)} ${ui.paint("ADCODE", "ink", { bold: true })}`}  ${ui.paint(relativeTime(message.at), "borderSoft")}`);
    const body = renderMarkdown(message.text, { ui, width: Math.max(8, width - 4) });
    for (const line of body.length === 0 ? [""] : body) lines.push(`    ${line}`);
    lines.push("");
  }
  printLines(lines, ctx.stdout);
  return 0;
}

async function picker(ctx: AppContext): Promise<number> {
  const ui = ctx.ui;
  const sessions = listSessions();
  const state = {
    index: 0,
    confirmDelete: false,
    notice: null as { tone: string; message: string } | null,
    phase: 0.3,
    reveal: ctx.motion.enabled ? 0 : 1,
  };
  const screen = new Screen({ out: ctx.stdout });
  let finished = false;
  let ambient: NodeJS.Timeout | null = null;
  let stopKeyboard = (): void => undefined;
  let resolveDone: (value: number) => void = () => undefined;
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });

  function render(): void {
    if (finished) return;
    ctx.resize();
    const width = ctx.ui.width;
    const height = ctx.ui.height;
    const header = [
      `  ${ui.gradient(ui.glyphs.mark, { phase: state.phase })}  ${ui.paint("SESSIONS", "ink", { bold: true })}  ${ui.paint(
        `${sessions.length} saved ${ui.glyphs.dot} ${cliPaths.sessions()}`,
        "faint",
      )}`,
      `  ${ui.paint(ui.glyphs.horizontal.repeat(Math.max(2, width - 4)), "borderSoft")}`,
      "",
    ];
    const footer: string[] = [];
    if (state.notice !== null) {
      footer.push(`  ${ui.paint(state.notice.message, state.notice.tone)}`);
    }
    footer.push("");
    footer.push(`  ${ui.paint("enter resume   n new chat   d delete   esc quit   ↑↓ choose", "faint")}`);
    if (state.confirmDelete) {
      const session = sessions[state.index];
      footer.push(
        `  ${ui.paint("Delete", "danger", { bold: true })} ${ui.paint(session?.title ?? "this session", "ink")}? ${ui.paint("Press d again to confirm, any other key to keep it.", "faint")}`,
      );
    }
    const room = Math.max(3, height - header.length - footer.length - 1);
    const lines: string[] = [];
    if (sessions.length === 0) {
      lines.push(`  ${ui.paint("No saved conversations yet.", "muted")}`);
      lines.push(`  ${ui.paint("Press n to start one.", "faint")}`);
    } else {
      const start = Math.max(0, Math.min(state.index - Math.floor(room / 3), Math.max(0, sessions.length - room)));
      for (const [offset, session] of sessions.slice(start, start + room).entries()) {
        const actual = start + offset;
        const selected = actual === state.index;
        const selectedMarker = selected ? ui.paint(ui.glyphs.selected, "accent", { bold: true }) : " ";
        const title = ui.paint(session.title, selected ? "ink" : "muted", { bold: selected });
        const meta = `${session.messages.length} ${plural(session.messages.length, "message")}  ${ui.glyphs.dot}  ${relativeTime(session.updatedAt)}`;
        if (width >= 62) {
          const left = `  ${selectedMarker} ${title}`;
          const right = ui.paint(meta, "faint");
          const gap = Math.max(2, width - ui.visibleWidth(left) - ui.visibleWidth(right) - 2);
          const row = `${left}${" ".repeat(gap)}${right}`;
          lines.push(selected ? ui.style(ui.fit(row, width, "left"), { bg: "selected" }) : row);
        } else {
          const row = `  ${selectedMarker} ${title}`;
          lines.push(selected ? ui.style(ui.fit(row, width, "left"), { bg: "selected" }) : row);
          lines.push(`      ${ui.paint(meta, "faint")}`);
        }
        if (selected) lines.push(`      ${ui.paint(session.id, "borderSoft")}${session.model === null ? "" : `  ${ui.paint(session.model, "faint")}`}`);
      }
    }
    screen.render([...header, ...lines, ...footer].slice(0, height));
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
    resolveDone(next);
  }

  function consume(): ChatSession | null {
    const session = sessions[state.index];
    return session ?? null;
  }

  function onKey(key: Key): void {
    if (finished) return;
    if (state.confirmDelete) {
      state.confirmDelete = false;
      if (key.name === "d") {
        const session = consume();
        if (session !== null && deleteSession(session.id)) {
          sessions.splice(state.index, 1);
          state.index = Math.max(0, Math.min(state.index, sessions.length - 1));
          state.notice = { tone: "success", message: `Deleted "${session.title}".` };
        } else {
          state.notice = { tone: "danger", message: "That session could not be deleted." };
        }
      }
      render();
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
    if (key.ctrl && key.name === "l") {
      screen.redraw();
      render();
      return;
    }
    const character = key.string.length > 0 ? key.string : key.sequence;
    if (key.name === "escape" || character === "q") {
      close(0);
      return;
    }
    if (sessions.length === 0) {
      if (character === "n") {
        close(0);
        void runChat(ctx, []).then(resolveDone);
      }
      return;
    }
    if (key.name === "up" || character === "k") {
      state.index = (state.index - 1 + sessions.length) % sessions.length;
      state.notice = null;
      render();
      return;
    }
    if (key.name === "down" || character === "j") {
      state.index = (state.index + 1) % sessions.length;
      state.notice = null;
      render();
      return;
    }
    if (key.name === "home") {
      state.index = 0;
      render();
      return;
    }
    if (key.name === "end") {
      state.index = sessions.length - 1;
      render();
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      const session = consume();
      if (session === null) return;
      close(0);
      void runChat(ctx, [], { sessionId: session.id }).then(resolveDone);
      return;
    }
    if (character === "n") {
      close(0);
      void runChat(ctx, []).then(resolveDone);
      return;
    }
    if (character === "d") {
      state.confirmDelete = true;
      state.notice = null;
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
        render();
      }, 120);
      ambient.unref?.();
    }
    return await done;
  } finally {
    if (!finished) close(0);
    stopKeyboard();
    if (ambient !== null) clearInterval(ambient);
  }
}

export async function runSessions(ctx: AppContext, args: readonly string[]): Promise<number> {
  const action = args[0] ?? null;
  if (action !== null && !["list", "open", "show", "delete", "rename", "export"].includes(action)) {
    ctx.stderr.write(
      `${errorPanel(ctx.ui, {
        title: "Not this time",
        message: `"${action}" is not a sessions action.`,
        hint: "Use adcode sessions, open, show, delete, rename, or export.",
      }).join("\n")}\n`,
    );
    return 2;
  }

  if (action === null || action === "list") {
    if (ctx.flags.json) {
      ctx.stdout.write(`${JSON.stringify(payload(ctx), null, 2)}\n`);
      return 0;
    }
    if (action === null && ctx.isTTY && !ctx.flags.snapshot && listSessions().length > 0) {
      return picker(ctx);
    }
    printLines(listOutput(ctx, Math.max(20, Math.min(ctx.ui.width, 110))), ctx.stdout);
    return 0;
  }

  const session = resolveId(ctx, args[1]);
  if (typeof session === "number") return session;

  if (action === "open") {
    return runChat(ctx, [], { sessionId: session.id });
  }
  if (action === "show") {
    return showTranscript(ctx, session);
  }
  if (action === "delete") {
    const deleted = deleteSession(session.id);
    if (ctx.flags.json) {
      ctx.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), command: "sessions", action: "delete", id: session.id, deleted }, null, 2)}\n`);
      return deleted ? 0 : 1;
    }
    if (!deleted) {
      ctx.stderr.write(`${errorPanel(ctx.ui, { title: "Could not delete", message: session.title, hint: "Check the sessions folder permissions." }).join("\n")}\n`);
      return 1;
    }
    printLines([...successPanel(ctx.ui, { title: "Session deleted", message: session.title, details: "The conversation file is gone. Nothing else was touched." }), ""], ctx.stdout);
    return 0;
  }
  if (action === "rename") {
    const title = args.slice(2).join(" ").trim();
    if (title.length === 0) {
      ctx.stderr.write(`${errorPanel(ctx.ui, { title: "A title is needed", message: "sessions rename needs the new title after the id.", hint: `Try adcode sessions rename ${session.id} "API design notes"` }).join("\n")}\n`);
      return 2;
    }
    const renamed = renameSession(session.id, title);
    if (renamed === null) {
      ctx.stderr.write(`${errorPanel(ctx.ui, { title: "Could not rename", message: session.title, hint: "Check the sessions folder permissions." }).join("\n")}\n`);
      return 1;
    }
    if (ctx.flags.json) {
      ctx.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), command: "sessions", action: "rename", session: { id: renamed.id, title: renamed.title } }, null, 2)}\n`);
      return 0;
    }
    printLines([...successPanel(ctx.ui, { title: "Session renamed", message: renamed.title, details: renamed.id }), ""], ctx.stdout);
    return 0;
  }

  const content = exportSession(session.id);
  if (content === null) {
    ctx.stderr.write(`${errorPanel(ctx.ui, { title: "Could not export", message: session.title, hint: "The session file disappeared while reading it." }).join("\n")}\n`);
    return 1;
  }
  if (ctx.flags.json) {
    ctx.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), command: "sessions", action: "export", id: session.id, title: session.title, format: "markdown", content }, null, 2)}\n`);
    return 0;
  }
  printLines([content, ""], ctx.stdout);
  return 0;
}
