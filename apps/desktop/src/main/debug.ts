/**
 * Running a program under the inspector.
 *
 * Spawns the file with `--inspect-brk`, waits for Node to print the WebSocket address it is
 * listening on, connects, sets the breakpoints the user placed, and lets it go. From there
 * it is a conversation: the inspector says it paused, this asks for the stack, the renderer
 * draws it.
 *
 * §9's rule for the ad module holds here as well. A debug session that will not start, a
 * socket that drops, a runtime that is not installed - none of them may throw into the
 * window. The worst permitted outcome is a `failed` state carrying a sentence the user can
 * act on.
 *
 * TypeScript is run directly. Node strips types natively now, so `node app.ts` works with
 * nothing installed - which is the whole reason this is built on the inspector rather than
 * on an adapter binary that would have to be fetched.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

/** stdin is closed - the debugged program reads nothing from this editor. */
type DebugChild = ChildProcessByStdio<null, Readable, Readable>;
import { BrowserWindow } from "electron";
import {
  debugSupportFor,
  framesFrom,
  pathToFileUrl,
  pauseReasonOf,
  evaluationFrom,
  propertiesFrom,
  scopesFrom,
  type Breakpoint,
  type DebugState,
  type Scope,
  type Variable,
} from "@adcode/debug";
import { CHANNELS } from "../shared/api.ts";
import { findExecutable } from "./executables.ts";

/** Long enough for a slow machine to boot Node, short enough to admit failure. */
const ATTACH_TIMEOUT_MS = 10_000;

interface Session {
  readonly child: DebugChild;
  readonly socket: WebSocket;
  readonly pending: Map<number, (result: unknown) => void>;
  /** Script urls by the id the inspector refers to them by. */
  readonly scripts: Map<string, string>;
  /** The frame the user is looking at, for scope and variable requests. */
  frames: unknown;
  nextId: number;
}

let session: Session | null = null;
let state: DebugState = { state: "idle" };

/** Breakpoints survive between runs, because that is what a breakpoint is for. */
const breakpoints = new Map<string, Set<number>>();

function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(CHANNELS.debugState, state);
  }
}

function setState(next: DebugState): void {
  state = next;
  broadcast();
}

export const currentDebugState = (): DebugState => state;

export function debugBreakpoints(): Breakpoint[] {
  return [...breakpoints.entries()].flatMap(([path, lines]) =>
    [...lines].map((line) => ({ path, line })),
  );
}

/**
 * Add or remove a breakpoint.
 *
 * Applied to a running session immediately, so setting one while paused works - which is
 * when people most often want to.
 */
export function toggleBreakpoint(path: string, line: number): Breakpoint[] {
  const lines = breakpoints.get(path) ?? new Set<number>();

  if (lines.has(line)) lines.delete(line);
  else lines.add(line);

  if (lines.size === 0) breakpoints.delete(path);
  else breakpoints.set(path, lines);

  if (session !== null) void applyBreakpoints(session);
  return debugBreakpoints();
}

function send(active: Session, method: string, params: unknown = {}): Promise<unknown> {
  const id = active.nextId;
  active.nextId += 1;

  return new Promise((settle) => {
    // No rejection path: every caller treats "no answer" and "no result" the same, and a
    // rejection would only be somewhere else to write a catch.
    const timer = setTimeout(() => {
      active.pending.delete(id);
      settle(null);
    }, 5000);

    active.pending.set(id, (result) => {
      clearTimeout(timer);
      settle(result);
    });

    try {
      active.socket.send(JSON.stringify({ id, method, params }));
    } catch {
      clearTimeout(timer);
      active.pending.delete(id);
      settle(null);
    }
  });
}

async function applyBreakpoints(active: Session): Promise<void> {
  // Removing every breakpoint and setting them again is the honest way to reconcile: the
  // inspector hands back its own ids, and tracking which of ours maps to which of theirs is
  // a bookkeeping problem that buys nothing at this scale.
  await send(active, "Debugger.setBreakpointsActive", { active: true });

  for (const [path, lines] of breakpoints) {
    for (const line of lines) {
      await send(active, "Debugger.setBreakpointByUrl", {
        url: pathToFileUrl(path),
        // The inspector counts from zero and the editor counts from one.
        lineNumber: line - 1,
      });
    }
  }
}

/** Ask for the stack, and remember the frames so scopes can be looked up later. */
async function readPause(active: Session, params: unknown): Promise<void> {
  active.frames = params;

  const frames = framesFrom(params, (id) => active.scripts.get(id));
  const reason = pauseReasonOf(
    typeof params === "object" && params !== null ? (params as { reason?: unknown }).reason : undefined,
  );

  setState({ state: "paused", reason, frames });
}

function handleMessage(active: Session, raw: string): void {
  let message: { id?: number; method?: string; params?: unknown; result?: unknown };
  try {
    message = JSON.parse(raw) as typeof message;
  } catch {
    return;
  }

  if (typeof message.id === "number") {
    const settle = active.pending.get(message.id);
    active.pending.delete(message.id);
    settle?.(message.result);
    return;
  }

  if (message.method === "Debugger.scriptParsed") {
    const params = message.params as { scriptId?: unknown; url?: unknown } | undefined;
    if (typeof params?.scriptId === "string" && typeof params.url === "string") {
      active.scripts.set(params.scriptId, params.url);
    }
    return;
  }

  if (message.method === "Debugger.paused") {
    void readPause(active, message.params);
    return;
  }

  if (message.method === "Debugger.resumed") {
    setState({ state: "running" });
  }
}

/**
 * The WebSocket address Node prints when it starts with `--inspect-brk`.
 *
 * Read from stderr rather than assumed, because the port is asked for as 0 - letting the
 * OS choose - so that debugging twice at once does not collide.
 */
function waitForInspector(child: DebugChild): Promise<string | null> {
  return new Promise((settle) => {
    let seen = "";
    let done = false;

    const finish = (url: string | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      settle(url);
    };

    const timer = setTimeout(() => finish(null), ATTACH_TIMEOUT_MS);

    child.stderr.on("data", (chunk: Buffer) => {
      seen += chunk.toString();
      const found = /ws:\/\/[^\s]+/.exec(seen);
      if (found !== null) finish(found[0]);
    });

    child.once("exit", () => finish(null));
    child.once("error", () => finish(null));
  });
}

export async function startDebug(path: string, languageId: string, cwd: string | null): Promise<void> {
  await stopDebug();

  const support = debugSupportFor(languageId);
  if (support === null) {
    setState({ state: "failed", message: `ADCode cannot debug ${languageId} files yet.` });
    return;
  }

  if (support.requires !== null && findExecutable(support.requires, process.platform) === null) {
    setState({
      state: "failed",
      message: `Debugging ${languageId} needs ${support.requires}. Install it with: ${support.install ?? ""}`,
    });
    return;
  }

  setState({ state: "starting" });

  let child: DebugChild;
  try {
    const systemNode = findExecutable("node", process.platform);
    child = spawn(
      systemNode ?? process.execPath,
      ["--inspect-brk=0", path],
      {
        cwd: cwd ?? undefined,
        // ELECTRON_RUN_AS_NODE makes the bundled binary behave as Node, so a machine with
        // no Node installed can still debug.
        env:
          systemNode === null
            ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
            : { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      },
    );
  } catch (error) {
    setState({
      state: "failed",
      message: error instanceof Error ? error.message : "the program could not be started",
    });
    return;
  }

  const url = await waitForInspector(child);
  if (url === null) {
    child.kill();
    setState({ state: "failed", message: "The program did not open a debug port." });
    return;
  }

  const socket = new WebSocket(url);
  const active: Session = {
    child,
    socket,
    pending: new Map(),
    scripts: new Map(),
    frames: null,
    nextId: 1,
  };
  session = active;

  socket.addEventListener("message", (event) => {
    handleMessage(active, typeof event.data === "string" ? event.data : "");
  });

  socket.addEventListener("error", () => {
    if (session === active) setState({ state: "failed", message: "Lost the debug connection." });
  });

  child.once("exit", (code) => {
    if (session !== active) return;
    session = null;
    try {
      socket.close();
    } catch {
      // Already gone.
    }
    setState({ state: "stopped", exitCode: code });
  });

  await new Promise<void>((settle) => {
    socket.addEventListener("open", () => settle(), { once: true });
    socket.addEventListener("error", () => settle(), { once: true });
  });
  await send(active, "Runtime.enable");
  await send(active, "Debugger.enable");

  await applyBreakpoints(active);

  setState({ state: "running" });

  await send(active, "Runtime.runIfWaitingForDebugger");
}

export async function stopDebug(): Promise<void> {
  const active = session;
  if (active === null) return;

  session = null;

  try {
    active.socket.close();
  } catch {
    // Already gone.
  }

  active.child.kill();
  setState({ state: "idle" });
}

async function step(method: string): Promise<void> {
  if (session === null) return;
  await send(session, method);
}

export const debugResume = (): Promise<void> => step("Debugger.resume");
export const debugStepOver = (): Promise<void> => step("Debugger.stepOver");
export const debugStepInto = (): Promise<void> => step("Debugger.stepInto");
export const debugStepOut = (): Promise<void> => step("Debugger.stepOut");
export const debugPause = (): Promise<void> => step("Debugger.pause");

/** The scopes of one frame, for the variables panel. */
export function debugScopes(frameId: string): Scope[] {
  const active = session;
  if (active === null) return [];

  const params = active.frames;
  if (typeof params !== "object" || params === null) return [];

  const frames = (params as { callFrames?: unknown }).callFrames;
  if (!Array.isArray(frames)) return [];

  const frame = frames.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { callFrameId?: unknown }).callFrameId === frameId,
  );

  return scopesFrom(frame);
}

/** What is inside an object, one level down. */
export async function debugProperties(objectId: string): Promise<Variable[]> {
  const active = session;
  if (active === null) return [];

  const result = await send(active, "Runtime.getProperties", {
    objectId,
    ownProperties: true,
    // Accessors are returned but never invoked - see `propertiesFrom`.
    generatePreview: false,
  });

  return propertiesFrom(result);
}

/**
 * Evaluate an expression in a paused frame.
 *
 * Two protocol options are deliberate. `includeCommandLineAPI` stays off: `$0`, `copy()`
 * and friends are conveniences of a browser devtools console and pretending to offer them
 * in a Node debugger would be a promise this cannot keep. `silent` stays off because a
 * thrown exception is the answer to plenty of expressions and must come back rather than
 * being swallowed.
 *
 * `returnByValue` is off too, so an object comes back as a handle with a description
 * instead of being deep-serialised - the same treatment the variables panel gives it, and
 * the reason a circular structure does not fail here.
 */
export async function debugEvaluate(
  frameId: string,
  expression: string,
): Promise<{ value: string; type: string; error: boolean }> {
  const active = session;
  if (active === null) {
    return { value: "Nothing is running.", type: "error", error: true };
  }

  try {
    const result = await send(active, "Debugger.evaluateOnCallFrame", {
      callFrameId: frameId,
      expression,
      objectGroup: "console",
      includeCommandLineAPI: false,
      silent: false,
      returnByValue: false,
      generatePreview: true,
    });
    return evaluationFrom(result);
  } catch (error) {
    // A rejected send means the session went away mid-evaluation - the program resumed and
    // ran to completion, most often. That is not an error the user caused.
    return {
      value: error instanceof Error ? error.message : "Could not evaluate that.",
      type: "error",
      error: true,
    };
  }
}
