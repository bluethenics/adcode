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

const pending = new Map<string, { readonly contentsId: number; readonly settle: (answer: boolean) => void }>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  ipcMain.on(CHANNELS.dialogConfirmAnswer, (event, id: unknown, answer: unknown) => {
    const entry = typeof id === "string" ? pending.get(id) : undefined;
    // Only the window that was asked may answer its question.
    if (entry === undefined || entry.contentsId !== event.sender.id) return;
    entry.settle(answer === true);
  });
}

export function confirmInWindow(
  target: BrowserWindow | null,
  request: ThemedConfirmRequest,
  signal?: AbortSignal,
): Promise<boolean> {
  listen();
  const candidate = target !== null && !target.isDestroyed()
    ? target
    : BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null;
  if (candidate === null || candidate.isDestroyed() || signal?.aborted === true) return Promise.resolve(false);
  const window = candidate;
  const contents = window.webContents;
  const id = randomUUID();

  return new Promise<boolean>((resolve) => {
    const settle = (answer: boolean): void => {
      if (!pending.delete(id)) return;
      contents.removeListener("destroyed", gone);
      signal?.removeEventListener("abort", abort);
      resolve(answer);
    };
    const gone = (): void => settle(false);
    const abort = (): void => {
      if (!contents.isDestroyed()) contents.send(CHANNELS.dialogConfirmCancel, id);
      settle(false);
    };
    pending.set(id, { contentsId: contents.id, settle });
    contents.once("destroyed", gone);
    signal?.addEventListener("abort", abort, { once: true });
    if (window.isMinimized()) window.restore();
    window.focus();
    contents.send(CHANNELS.dialogConfirmRequest, id, request);
  });
}
