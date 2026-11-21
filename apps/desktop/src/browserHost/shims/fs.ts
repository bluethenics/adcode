/** `node:fs` in the browser host: the in-memory file system in vfs.ts, plus inert watching and streams. */
import * as vfs from "./vfs.ts";
import { promises } from "./fsPromises.ts";

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };
export {
  accessSync, appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync,
} from "./vfs.ts";
export const lstatSync = vfs.statSync;
export { promises };

/** Nothing outside this tab changes its files, so a watcher has nothing to report. */
export class FSWatcher {
  close(): void {}
  on(): this { return this; }
  once(): this { return this; }
  off(): this { return this; }
  removeAllListeners(): this { return this; }
  ref(): this { return this; }
  unref(): this { return this; }
}
export function watch(): FSWatcher { return new FSWatcher(); }
export function watchFile(): void {}
export function unwatchFile(): void {}

export function createReadStream(path: string): never {
  throw vfs.fsError("ENOSYS", "createReadStream", path);
}
export function createWriteStream(path: string): never {
  throw vfs.fsError("ENOSYS", "createWriteStream", path);
}

type Callback<T> = (error: Error | null, value?: T) => void;
const callbackForm = <A extends unknown[], T>(run: (...args: A) => T) => (...args: [...A, Callback<T>]): void => {
  const callback = args.pop() as Callback<T>;
  queueMicrotask(() => {
    try { callback(null, run(...(args as unknown as A))); } catch (error) { callback(error as Error); }
  });
};
export const readFile = callbackForm(vfs.readFileSync as (...args: unknown[]) => unknown);
export const writeFile = callbackForm(vfs.writeFileSync as (...args: unknown[]) => unknown);
export const stat = callbackForm(vfs.statSync as (...args: unknown[]) => unknown);
export const mkdir = callbackForm(vfs.mkdirSync as (...args: unknown[]) => unknown);
export const readdir = callbackForm(vfs.readdirSync as (...args: unknown[]) => unknown);

export default {
  ...vfs, constants, promises, lstatSync, watch, watchFile, unwatchFile, FSWatcher, createReadStream, createWriteStream,
  readFile, writeFile, stat, mkdir, readdir,
};
