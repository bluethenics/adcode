/**
 * The assistant's commands: one run to completion, or one left running in the background.
 *
 * `run_command` used to be `execFile` with a fixed 30-second timeout. That ruled out the two
 * commands a web project needs most - an install (minutes) and a dev server (never exits) -
 * and a timed-out `cmd.exe` took only itself down, leaving the `node` it had started holding
 * the port. So:
 *
 * - **Foreground** runs take a timeout the model chooses (two minutes by default, ten at most),
 *   report the real exit code, and kill the whole process tree when they stop - on timeout
 *   and on the user's Stop alike.
 * - **Background** runs return at once with an id. Their output collects in a bounded buffer
 *   the model reads with `command_output`, which can wait for the next line; `stop_command`
 *   ends them. A dev server's address is spotted in what it prints and handed back, so the
 *   next step can be `view_page` on it.
 *
 * Commands get no stdin - an interactive prompt sees end-of-input and gives up instead of
 * waiting forever - and foreground ones run with `CI=1`, which turns test runners' watch mode
 * and most "are you sure?" prompts off. Plain Node, no Electron, so it is testable.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { parseServerUrl, stripAnsi } from "./devCommand.ts";

/** What a foreground run ended with. */
export interface CommandOutcome {
  readonly exitCode: number | null;
  readonly output: string;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
}

export interface BackgroundCommandView {
  readonly id: string;
  readonly command: string;
  readonly running: boolean;
  readonly exitCode: number | null;
  /** A local address the command printed, such as Vite's "Local: http://localhost:5173/". */
  readonly url: string | null;
  readonly startedAt: number;
}

export interface CommandReading extends BackgroundCommandView {
  /** Output since the previous reading. */
  readonly output: string;
}

/** Kept per command; older output is dropped first. */
const BUFFER_CHARS = 400_000;
/** The most a single answer carries back to the model. */
export const MAX_COMMAND_OUTPUT_CHARS = 24_000;
const MAX_BACKGROUND = 6;
const ID = /^cmd-\d{1,6}$/;

export const DEFAULT_TIMEOUT_SECONDS = 120;
export const MAX_TIMEOUT_SECONDS = 600;

/**
 * Long output with its beginning and its end.
 *
 * The first lines say what ran; the last say how it ended - a test summary, the error that
 * stopped a build. The middle is what a model can most afford to lose.
 */
export function clipOutput(text: string, max = MAX_COMMAND_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.25);
  const tail = max - head;
  return `${text.slice(0, head)}\n[... ${(text.length - max).toLocaleString("en-US")} characters cut from the middle ...]\n${text.slice(-tail)}`;
}

/**
 * Whether a command line starts something that never exits on its own: a dev server, a
 * static server, a watcher.
 *
 * Models run `npm run dev` in the foreground all the time, and in the foreground it can only
 * end by timing out - minutes of a stalled turn, then a killed server. Recognised here, it is
 * started in the background instead and the model is told so. A build (`vite build`,
 * `next build`) is not a server, and neither is anything that merely mentions one.
 */
export function looksLikeServer(command: string): boolean {
  // Each step of `cd app && PORT=3000 npm run dev` on its own, by what it starts with.
  return command.toLowerCase().split(/&&|\|\||[;|]/).some((part) => {
    const line = part.trim().replace(/^(?:set\s+)?(?:\w+=\S*\s+)+/, "");
    const watching = /(^|\s)--watch(\s|=|$)/.test(line);
    if (/(^|\s)(build|test|lint|typecheck)(\s|$)|^tsc(\s|$)/.test(line) && !watching && !/(^|\s)(dev|serve)(\s|$)/.test(line)) return false;
    return watching ||
      /^(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview|watch)(\s|$)/.test(line) ||
      /^(npx\s+|pnpm\s+exec\s+|bunx\s+)?(vite|astro\s+dev|next\s+dev|nuxt\s+dev|remix\s+dev|ng\s+serve|vue-cli-service\s+serve|webpack\s+serve|webpack-dev-server|http-server|live-server|serve|nodemon)(\s|$)/.test(line) ||
      /^(python3?|py)\s+-m\s+http\.server(\s|$)|^php\s+-s\s|^flask\s+run(\s|$)|^(python3?\s+)?manage\.py\s+runserver(\s|$)|^uvicorn\s/.test(line);
  });
}

/** A timeout from a tool argument, in milliseconds: the default when absent, null when invalid. */
export function timeoutFrom(value: unknown): number | null {
  if (value === undefined || value === null) return DEFAULT_TIMEOUT_SECONDS * 1000;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_TIMEOUT_SECONDS) return null;
  return Math.round(seconds) * 1000;
}

/**
 * The shell and its arguments.
 *
 * On Windows this is exactly what Node does for `shell: true`: `cmd /d /s /c "<line>"`, passed
 * verbatim. Left to Node's own quoting, a line with quotes in it - `"C:\Program Files\x.exe"
 * -e "..."` - reached cmd with every quote backslash-escaped, which cmd does not understand,
 * so any command naming a path with a space in it failed.
 */
function shellFor(command: string): { file: string; args: string[]; verbatim: boolean } {
  return process.platform === "win32"
    ? { file: `${process.env["SystemRoot"] ?? "C:\\Windows"}\\System32\\cmd.exe`, args: ["/d", "/s", "/c", `"${command}"`], verbatim: true }
    : { file: "/bin/sh", args: ["-c", command], verbatim: false };
}

/**
 * End a process and everything it started.
 *
 * On Windows the shell is `cmd.exe` and the work is its grandchild, so killing the shell
 * alone is the bug this replaces; `taskkill /T` takes the tree. Elsewhere the command leads
 * its own process group, which one negative-pid signal reaches.
 */
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => child.kill());
    } catch {
      child.kill();
    }
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
    setTimeout(() => {
      try { process.kill(-pid, "SIGKILL"); } catch { /* Already gone. */ }
    }, 2_000).unref();
  } catch {
    child.kill("SIGKILL");
  }
}

function start(command: string, cwd: string, background: boolean): ChildProcess {
  const { file, args, verbatim } = shellFor(command);
  return spawn(file, args, {
    cwd,
    windowsHide: true,
    windowsVerbatimArguments: verbatim,
    // Its own process group, so killTree reaches what it starts (POSIX only; Windows uses taskkill).
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      // A dev server must not open the user's browser behind the app.
      BROWSER: "none",
      // Foreground: test runners run once instead of watching, prompts take their defaults.
      ...(background ? {} : { CI: "1" }),
    },
  });
}

export interface CommandRunner {
  runForeground(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandOutcome>;
  /** Start a background command, or say why not. */
  startBackground(command: string, cwd: string): BackgroundCommandView | string;
  /** New output from a background command, waiting up to `waitMs` for some. Null for an unknown id. */
  read(id: string, waitMs: number, signal?: AbortSignal): Promise<CommandReading | null>;
  stop(id: string): Promise<CommandReading | null>;
  list(): BackgroundCommandView[];
  /** Stop everything: the folder closed, the conversation was reset, the app is quitting. */
  stopAll(): void;
}

interface Background {
  readonly id: string;
  readonly command: string;
  readonly child: ChildProcess;
  readonly startedAt: number;
  buffer: string;
  /** Characters ever written; `buffer` holds the last `buffer.length` of them. */
  total: number;
  /** Characters the model has already been shown. */
  cursor: number;
  exitCode: number | null;
  running: boolean;
  url: string | null;
  readonly waiters: Set<() => void>;
}

export function createCommandRunner(): CommandRunner {
  const background = new Map<string, Background>();
  let nextId = 1;

  const view = (run: Background): BackgroundCommandView => ({
    id: run.id,
    command: run.command,
    running: run.running,
    exitCode: run.exitCode,
    url: run.url,
    startedAt: run.startedAt,
  });

  function wake(run: Background): void {
    for (const waiter of run.waiters) waiter();
    run.waiters.clear();
  }

  function unread(run: Background): string {
    const first = run.total - run.buffer.length;
    const dropped = Math.max(0, first - run.cursor);
    const from = Math.max(run.cursor, first) - first;
    run.cursor = run.total;
    const text = run.buffer.slice(from);
    return dropped > 0 ? `[${dropped.toLocaleString("en-US")} earlier characters were dropped]\n${text}` : text;
  }

  return {
    runForeground(command, cwd, timeoutMs, signal) {
      return new Promise((resolve) => {
        let output = "";
        let timedOut = false;
        let cancelled = false;
        let child: ChildProcess;
        try {
          child = start(command, cwd, false);
        } catch (error) {
          resolve({ exitCode: null, output: error instanceof Error ? error.message : "Could not start the command.", timedOut, cancelled });
          return;
        }
        const collect = (chunk: Buffer): void => {
          // A runaway command must not fill the main process's memory; keep the newest megabyte.
          output = `${output}${chunk.toString("utf8")}`;
          if (output.length > 1_000_000) output = output.slice(-1_000_000);
        };
        child.stdout?.on("data", collect);
        child.stderr?.on("data", collect);
        const timer = setTimeout(() => {
          timedOut = true;
          killTree(child);
        }, timeoutMs);
        const abort = (): void => {
          cancelled = true;
          killTree(child);
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted === true) abort();
        child.on("error", (error) => {
          output = `${output}${error.message}\n`;
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          resolve({ exitCode: code, output: stripAnsi(output).trim(), timedOut, cancelled });
        });
      });
    },

    startBackground(command, cwd) {
      const live = [...background.values()].filter((run) => run.running);
      if (live.length >= MAX_BACKGROUND) {
        return `${live.length} background commands are already running (${live.map((run) => run.id).join(", ")}). Stop one with stop_command first.`;
      }
      let child: ChildProcess;
      try {
        child = start(command, cwd, true);
      } catch (error) {
        return error instanceof Error ? error.message : "Could not start the command.";
      }
      const run: Background = {
        id: `cmd-${nextId++}`,
        command,
        child,
        startedAt: Date.now(),
        buffer: "",
        total: 0,
        cursor: 0,
        exitCode: null,
        running: true,
        url: null,
        waiters: new Set(),
      };
      const collect = (chunk: Buffer): void => {
        const text = stripAnsi(chunk.toString("utf8"));
        run.buffer = `${run.buffer}${text}`;
        run.total += text.length;
        if (run.buffer.length > BUFFER_CHARS) run.buffer = run.buffer.slice(-BUFFER_CHARS);
        run.url ??= parseServerUrl(run.buffer.slice(-4_000));
        wake(run);
      };
      child.stdout?.on("data", collect);
      child.stderr?.on("data", collect);
      child.on("error", (error) => collect(Buffer.from(`${error.message}\n`)));
      child.on("close", (code) => {
        run.running = false;
        run.exitCode = code;
        wake(run);
      });
      background.set(run.id, run);
      // Finished runs are kept for reading, but not forever.
      const finished = [...background.values()].filter((item) => !item.running);
      for (const old of finished.slice(0, Math.max(0, finished.length - 10))) background.delete(old.id);
      return view(run);
    },

    async read(id, waitMs, signal) {
      if (!ID.test(id)) return null;
      const run = background.get(id);
      if (run === undefined) return null;
      if (waitMs > 0 && run.running && run.cursor === run.total && signal?.aborted !== true) {
        await new Promise<void>((resolve) => {
          const done = (): void => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", done);
            run.waiters.delete(done);
            resolve();
          };
          const timer = setTimeout(done, waitMs);
          run.waiters.add(done);
          signal?.addEventListener("abort", done, { once: true });
        });
        // A burst usually arrives over a few chunks; let the rest of it land.
        if (run.running) await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return { ...view(run), output: unread(run) };
    },

    async stop(id) {
      if (!ID.test(id)) return null;
      const run = background.get(id);
      if (run === undefined) return null;
      if (run.running) {
        killTree(run.child);
        // Waiters wake on output too; only the exit counts here.
        const until = Date.now() + 5_000;
        while (run.running && Date.now() < until) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, until - Date.now());
            run.waiters.add(() => {
              clearTimeout(timer);
              resolve();
            });
          });
        }
      }
      return { ...view(run), output: unread(run) };
    },

    list() {
      return [...background.values()].map(view);
    },

    stopAll() {
      for (const run of background.values()) if (run.running) killTree(run.child);
    },
  };
}
