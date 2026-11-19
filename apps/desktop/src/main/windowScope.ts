/**
 * Every IPC call runs as the window that sent it.
 *
 * Imported by `index.ts` before any module registers a handler. It wraps `ipcMain.handle` and
 * `ipcMain.on` so each listener runs inside `runInGroup` for the sender's window group
 * (workspace.ts). That is what lets two projects be open in two windows at once: the sixty-odd
 * places that read `currentWorkspace()` were written for one project, and they now read the
 * project of whichever window is asking - through every await, timer and callback the handler
 * starts - without each of them being rewritten.
 *
 * A listener removed later by reference would miss its wrapper, so the wrapped function is
 * remembered per original and `removeListener`/`off` are mapped back to it.
 */
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { groupOfWindow, runInGroup } from "./workspace.ts";

type Listener = (event: IpcMainEvent, ...args: unknown[]) => void;
type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const wrapped = new WeakMap<Listener, Listener>();

const senderGroup = (event: { readonly sender?: { readonly id: number } | null }): string | null =>
  event.sender === undefined || event.sender === null ? null : groupOfWindow(event.sender.id);

const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel: string, listener: Handler): void => {
  originalHandle(channel, (event, ...args) => {
    const group = senderGroup(event);
    return group === null ? listener(event, ...args) : runInGroup(group, () => listener(event, ...args));
  });
};

const scoped = (listener: Listener): Listener => {
  let wrapper = wrapped.get(listener);
  if (wrapper === undefined) {
    wrapper = (event, ...args) => {
      const group = senderGroup(event);
      if (group === null) listener(event, ...args);
      else runInGroup(group, () => listener(event, ...args));
    };
    wrapped.set(listener, wrapper);
  }
  return wrapper;
};

const originalOn = ipcMain.on.bind(ipcMain);
const originalOnce = ipcMain.once.bind(ipcMain);
const originalRemove = ipcMain.removeListener.bind(ipcMain);
ipcMain.on = ((channel: string, listener: Listener) => originalOn(channel, scoped(listener))) as typeof ipcMain.on;
ipcMain.once = ((channel: string, listener: Listener) => originalOnce(channel, scoped(listener))) as typeof ipcMain.once;
ipcMain.removeListener = ((channel: string, listener: Listener) => originalRemove(channel, wrapped.get(listener) ?? listener)) as typeof ipcMain.removeListener;
ipcMain.off = ipcMain.removeListener;
