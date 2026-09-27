/**
 * The debug log: what went wrong, kept so a user can send it with Help > Report a Problem.
 *
 * Imported first by `index.ts`, on purpose. It wraps `ipcMain.handle` so that every
 * handler's failure is recorded - "Error occurred in handler for 'ai-workspace:apply'"
 * used to exist only in a terminal nobody had open - and it must be in place before any
 * module registers a handler.
 *
 * Kept in memory (the last few hundred events) and appended to `userData/logs/debug.log`,
 * rotated at a megabyte. Every line is redacted as it is recorded (see debugLogFormat.ts);
 * the log never holds file contents, prompts, keys, or paths.
 */
import { appendFile, mkdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir, arch, release } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import { CHANNELS } from "../shared/api.ts";
import { clip, formatEntry, formatReport, formatSummary, redact, type DebugEntry, type DebugEnvironment, type DebugLevel } from "./debugLogFormat.ts";

const MEMORY_LIMIT = 400;
const FILE_LIMIT_BYTES = 1_000_000;
const entries: DebugEntry[] = [];
let writes: Promise<void> = Promise.resolve();

/** Filled in by the modules that know: the workspace root and the AI selection. */
let projectRoot: () => string | null = () => null;
let aiSelection: () => { provider: string; model: string; effort: string; fileTools: boolean } = () => ({
  provider: "unknown", model: "unknown", effort: "auto", fileTools: true,
});

export function describeDebugContext(deps: {
  readonly projectRoot?: () => string | null;
  readonly aiSelection?: () => { provider: string; model: string; effort: string; fileTools: boolean };
}): void {
  if (deps.projectRoot) projectRoot = deps.projectRoot;
  if (deps.aiSelection) aiSelection = deps.aiSelection;
}

const logDirectory = (): string => join(app.getPath("userData"), "logs");
const logFile = (): string => join(logDirectory(), "debug.log");

function privatePaths(): Array<readonly [string, string]> {
  const paths: Array<readonly [string, string]> = [];
  const root = projectRoot();
  if (root !== null) paths.push([root, "<project>"]);
  try { paths.push([app.getPath("userData"), "<app-data>"]); } catch { /* Before ready. */ }
  paths.push([homedir(), "~"]);
  return paths;
}

/** Record one event. Never throws: a failure to log must not become a second failure. */
export function recordDebug(level: DebugLevel, source: string, message: string): void {
  try {
    const entry: DebugEntry = {
      at: Date.now(),
      level,
      source: clip(source, 80),
      message: clip(redact(message, privatePaths())),
    };
    entries.push(entry);
    if (entries.length > MEMORY_LIMIT) entries.splice(0, entries.length - MEMORY_LIMIT);
    writes = writes.then(() => persist(entry)).catch(() => undefined);
  } catch {
    // Logging is best effort by definition.
  }
}

async function persist(entry: DebugEntry): Promise<void> {
  if (!app.isReady()) return;
  await mkdir(logDirectory(), { recursive: true });
  const size = await stat(logFile()).then((info) => info.size, () => 0);
  if (size > FILE_LIMIT_BYTES) await rename(logFile(), join(logDirectory(), "debug.1.log")).catch(() => undefined);
  await appendFile(logFile(), `${formatEntry(entry)}\n`, "utf8");
}

function environment(): DebugEnvironment {
  const ai = aiSelection();
  return {
    appVersion: app.getVersion(),
    electron: process.versions["electron"] ?? "",
    chrome: process.versions["chrome"] ?? "",
    node: process.versions["node"] ?? "",
    os: `${process.platform} ${release()} ${arch()}`,
    locale: app.getLocale(),
    provider: ai.provider,
    model: redact(ai.model, privatePaths()),
    effort: ai.effort,
    fileTools: ai.fileTools,
    projectOpen: projectRoot() !== null,
    windows: BrowserWindow.getAllWindows().map((window) => (window.webContents.getURL().endsWith("#/ide") ? "ide" : "vibe")),
  };
}

export function debugReport(): string {
  return formatReport(environment(), entries);
}

/*
 * Every IPC handler, wrapped: a handler that throws is recorded under its channel name
 * and then rethrown unchanged, so callers see exactly what they saw before.
 */
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void => {
  originalHandle(channel, async (event, ...args: unknown[]) => {
    try {
      return await listener(event, ...args);
    } catch (error) {
      recordDebug("error", `ipc:${channel}`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  });
};

process.on("uncaughtException", (error) => {
  recordDebug("error", "main", `Uncaught: ${error.stack ?? error.message}`);
});
process.on("unhandledRejection", (reason) => {
  recordDebug("error", "main", `Unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});

export function registerDebugLogIpc(): void {
  recordDebug("info", "app", `Started ADCode ${app.getVersion()}`);
  app.on("render-process-gone", (_event, _contents, details) => recordDebug("error", "renderer", `Window process gone: ${details.reason} (exit ${details.exitCode})`));
  app.on("child-process-gone", (_event, details) => recordDebug("warn", "process", `${details.type} process gone: ${details.reason}`));

  // Renderer reports, rate limited: a render loop that throws every frame must not flood
  // the log or the disk.
  let windowStart = 0;
  let windowCount = 0;
  ipcMain.on(CHANNELS.debugRecord, (_event, level: unknown, source: unknown, message: unknown) => {
    const now = Date.now();
    if (now - windowStart > 60_000) { windowStart = now; windowCount = 0; }
    if (++windowCount > 30) return;
    const safeLevel: DebugLevel = level === "warn" || level === "info" ? level : "error";
    recordDebug(safeLevel, `renderer${typeof source === "string" && source.length > 0 ? `:${clip(source, 40)}` : ""}`, typeof message === "string" ? message : String(message));
  });
  ipcMain.handle(CHANNELS.debugReport, () => debugReport());
  ipcMain.handle(CHANNELS.debugSummary, (_event, maxChars: unknown) =>
    formatSummary(environment(), entries, typeof maxChars === "number" && maxChars > 200 ? Math.min(maxChars, 4000) : 1500));
  ipcMain.handle(CHANNELS.debugCopy, () => { clipboard.writeText(debugReport()); return true; });
  ipcMain.handle(CHANNELS.debugSave, async (event): Promise<string | null> => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const stampName = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const options = {
      title: "Save debug log",
      defaultPath: join(app.getPath("desktop"), `adcode-debug-${stampName}.txt`),
      filters: [{ name: "Text", extensions: ["txt"] }],
    };
    const picked = owner === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(owner, options);
    if (picked.canceled || picked.filePath === undefined) return null;
    await writeFile(picked.filePath, debugReport(), "utf8");
    return picked.filePath;
  });
}
