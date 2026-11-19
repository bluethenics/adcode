/**
 * Ask the user a yes/no question in the app's own dialog, not a native Windows box.
 *
 * Electron's `dialog.showMessageBox` paints a white system window that ignores the theme
 * and looks like an error from somewhere else - which is how "turn on automatic edits"
 * read to the people it asked. The main process still decides when to ask and acts on
 * the answer; the window that caused the question just draws it, themed like everything
 * else, and sends the answer back.
 *
 * Every way out that is not the confirm button is a no: the window closing, the request
 * being cancelled, no window to ask at all.
 */
import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";
import { CHANNELS, type ThemedConfirmRequest } from "../shared/api.ts";
import { currentSettings } from "./settings.ts";
import { fullAccessApplies } from "./fullAccess.ts";
import { recordDebug } from "./debugLog.ts";

export type ThemedChoice = "confirm" | "alternate" | "cancel";

const pending = new Map<string, { readonly contentsId: number; readonly settle: (answer: ThemedChoice) => void }>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  ipcMain.on(CHANNELS.dialogConfirmAnswer, (event, id: unknown, answer: unknown) => {
    const entry = typeof id === "string" ? pending.get(id) : undefined;
    // Only the window that was asked may answer its question.
    if (entry === undefined || entry.contentsId !== event.sender.id) return;
    entry.settle(answer === true ? "confirm" : answer === "alternate" ? "alternate" : "cancel");
  });
}

export function confirmInWindow(
  target: BrowserWindow | null,
  request: ThemedConfirmRequest,
  signal?: AbortSignal,
): Promise<boolean> {
  const { alternateLabel: _alternate, ...plain } = request;
  return chooseInWindow(target, plain, signal).then((choice) => choice === "confirm");
}

/**
 * The same question with up to three answers: `request.alternateLabel` adds a button answered
 * as "alternate". Full access answers "confirm" - it allows this call, and never writes a
 * standing rule on the person's behalf.
 */
export function chooseInWindow(
  target: BrowserWindow | null,
  request: ThemedConfirmRequest,
  signal?: AbortSignal,
): Promise<ThemedChoice> {
  // A turn already stopped gets a no, whatever the permission mode says.
  if (signal?.aborted === true) return Promise.resolve("cancel");
  // Full access answers this one for the person, but only inside a turn they switched it on
  // for. Asked from elsewhere - the bridge, app startup, another program - it still asks.
  if (fullAccessApplies(currentSettings())) {
    // A permission that leaves no trace is one nobody can audit afterwards.
    recordDebug("info", "ai:full-access", `Auto-approved: ${request.title}`);
    return Promise.resolve("confirm");
  }
  listen();
  const candidate = target !== null && !target.isDestroyed()
    ? target
    : BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null;
  // The abort check above still holds: nothing between there and here yields.
  if (candidate === null || candidate.isDestroyed()) return Promise.resolve("cancel");
  const window = candidate;
  const contents = window.webContents;
  const id = randomUUID();

  return new Promise<ThemedChoice>((resolve) => {
    const settle = (answer: ThemedChoice): void => {
      if (!pending.delete(id)) return;
      contents.removeListener("destroyed", gone);
      signal?.removeEventListener("abort", abort);
      resolve(answer);
    };
    const gone = (): void => settle("cancel");
    const abort = (): void => {
      if (!contents.isDestroyed()) contents.send(CHANNELS.dialogConfirmCancel, id);
      settle("cancel");
    };
    pending.set(id, { contentsId: contents.id, settle });
    contents.once("destroyed", gone);
    signal?.addEventListener("abort", abort, { once: true });
    if (window.isMinimized()) window.restore();
    window.focus();
    contents.send(CHANNELS.dialogConfirmRequest, id, request);
  });
}
