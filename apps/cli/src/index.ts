#!/usr/bin/env node
import process from "node:process";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createContext, parseFlags, type AppContext } from "./context.ts";
import { runDeck } from "./commands/deck.ts";
import { runChat, findRequestedModel } from "./commands/chat.ts";
import { runModels } from "./commands/models.ts";
import { runSessions } from "./commands/sessions.ts";
import { runEarn } from "./commands/earn.ts";
import { runStatus } from "./commands/status.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runTheme } from "./commands/theme.ts";
import { runTour } from "./commands/tour.ts";
import { runHelp, HELP_COMMANDS } from "./commands/help.ts";
import { errorPanel, printLines } from "./tui/components.ts";
import { createUI } from "./tui/ui.ts";
import { holdScreen, restoreScreen } from "./tui/screen.ts";
import { didYouMean } from "./util/suggest.ts";
import { runCompletion } from "./commands/completion.ts";

const APP_COMMANDS = new Set([
  "app",
  "open",
  "deck",
  "chat",
  "models",
  "sessions",
  "earn",
  "status",
  "doctor",
  "theme",
  "tour",
  "help",
  "version",
  "completion",
]);

function errorJson(command: string, message: string): string {
  return `${JSON.stringify({ generatedAt: new Date().toISOString(), command, error: { message } }, null, 2)}\n`;
}

function unknownCommand(ctx: AppContext, name: string): number {
  const names = [...APP_COMMANDS, ...HELP_COMMANDS.filter((entry) => entry.group === "developer").map((entry) => entry.name)];
  const near = didYouMean(name, names, (entry) => `adcode ${entry}`);
  const message = `adcode: there is no "${name}" command.`;
  if (ctx.flags.json) {
    ctx.stdout.write(errorJson(name, message));
    return 2;
  }
  printLines(
    [
      "",
      ...errorPanel(ctx.ui, {
        title: "No such command",
        message,
        hint: near !== null
          ? `${near} Or run adcode help for every command.`
          : /\s/.test(name)
            ? `To ask a question, use adcode chat "${name}".`
            : 'Run adcode help for the list, or adcode chat "..." to ask a question.',
      }),
      "",
    ],
    ctx.stderr,
  );
  return 2;
}

async function dispatch(ctx: AppContext, command: string | null, args: readonly string[]): Promise<number> {
  if (command === null || command === "deck") {
    if (ctx.flags.continueSession || ctx.flags.session !== null) return runChat(ctx, []);
    const release = ctx.isTTY ? holdScreen(ctx.stdout) : () => undefined;
    try {
      while (true) {
        const result = await runDeck(ctx);
        if (result.command === null) return 0;
        const seed = result.seed;
        if (seed !== undefined && seed.length > 0) return await runChat(ctx, [], { initialPrompt: seed });
        if (!["models", "theme", "tour", "chat", "sessions"].includes(result.command)) release();
        const code = await dispatch(ctx, result.command, []);
        if (code !== 0 || !["models", "theme", "tour"].includes(result.command) || !ctx.isTTY) return code;
      }
    } finally { release(); }
  }

  switch (command) {
    case "app":
    case "open":
      return new Promise<number>((resolve) => {
        const child = spawn(process.execPath, [join(ctx.root, "scripts/adcode.mjs"), "app", ctx.cwd], { stdio: "inherit", shell: false });
        child.once("error", (error) => {
          ctx.stderr.write(`Could not open ADCode: ${error.message}\n`);
          resolve(1);
        });
        child.once("exit", (code) => resolve(code ?? 1));
      });
    case "chat":
      return runChat(ctx, args);
    case "models":
      return runModels(ctx, args);
    case "sessions":
      return runSessions(ctx, args);
    case "earn":
      return runEarn(ctx);
    case "status":
      return runStatus(ctx);
    case "doctor":
      return runDoctor(ctx);
    case "theme":
      return runTheme(ctx, args);
    case "tour":
      return runTour(ctx, args);
    case "help":
      return runHelp(ctx, args);
    case "completion":
      return runCompletion(ctx, args);
    case "version":
      if (ctx.flags.json) {
        ctx.stdout.write(`${JSON.stringify({ name: "adcode", version: ctx.version, root: ctx.root }, null, 2)}\n`);
      } else {
        ctx.stdout.write(`${ctx.version}\n`);
      }
      return 0;
    default:
      return unknownCommand(ctx, command);
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseFlags(argv);
  const command = parsed.command;
  const ctx = await createContext({ flags: parsed.flags });

  // The deck, chat and the status screens should start on a model that can actually
  // answer. The initial catalogue is deliberately offline; one cheap refresh fills in
  // Included AI and Ollama without fetching models.dev unless the person asked for it.
  const home = command === null || command === "deck";
  const known = command === null || APP_COMMANDS.has(command);
  const offline = command === "help" || command === "version" || command === "completion";
  if (known && !offline && !home && !ctx.flags.snapshot) {
    const live = parsed.flags.live || parsed.flags.refresh;
    if (ctx.catalogue.tagflow === null || !ctx.selection.ready || live) {
      try {
        await ctx.refreshCatalogue({ live });
      } catch {
        // A live catalogue is an improvement, not a prerequisite for the CLI.
      }
    }
  }

  if (home && (ctx.flags.model !== null || ctx.flags.provider !== null)) {
    const requested = findRequestedModel(ctx);
    if (requested.error !== undefined) {
      const error = new Error(`${requested.error.message} ${requested.error.hint}`);
      error.name = "CliUsageError";
      throw error;
    }
  }

  return dispatch(ctx, command, parsed.rest);
}

const wantsInteractive = !process.argv.includes("--json") && !process.argv.includes("--snapshot");
if (process.stdout.isTTY === true && wantsInteractive) {
  process.once("exit", () => {
    try {
      restoreScreen(process.stdout);
    } catch {
      // A closed terminal has nothing left to restore.
    }
  });
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (process.argv.includes("--json")) {
    process.stdout.write(errorJson("adcode", message));
  } else {
    const ui = createUI({
      theme: "midnight",
      color: process.stderr.isTTY === true,
      unicode: true,
      width: process.stderr.columns ?? 80,
      height: process.stderr.rows ?? 30,
    });
    const usageError = error instanceof Error && error.name === "CliUsageError";
    const panel = usageError
      ? { title: "Not quite", message, hint: "adcode help lists every command and flag; adcode help <command> shows one in full." }
      : { title: "ADCODE STOPPED", message, hint: "If this keeps happening, adcode doctor checks the machine, account and network." };
    process.stderr.write(`\n${errorPanel(ui, panel).join("\n")}\n\n`);
  }
  process.exitCode = error instanceof Error && error.name === "CliUsageError" ? 2 : 1;
}

// A terminal session has finished all persistence and restored its input modes here.
// Flush the final frame, then leave even if a background refresh or Windows console
// worker is still pending. Piped output retains Node's normal stream-draining exit.
if (process.stdin.isTTY === true && process.stdout.isTTY === true) {
  process.stdout.write("", () => process.exit(process.exitCode ?? 0));
}
