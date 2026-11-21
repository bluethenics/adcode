/** `node:path` for the browser host: POSIX paths, which is all the in-memory file system has. */
import { basename, dirname, extname, isAbsolute, join, normalize, parse, format, relative, resolve as resolveFrom, toNamespacedPath } from "pathe";
import { CWD } from "./vfs.ts";

export const sep = "/";
export const delimiter = ":";
export const resolve = (...parts: string[]): string => resolveFrom(CWD, ...parts);
export { basename, dirname, extname, isAbsolute, join, normalize, parse, format, relative, toNamespacedPath };

const api = { sep, delimiter, resolve, basename, dirname, extname, isAbsolute, join, normalize, parse, format, relative, toNamespacedPath };
export const posix = api;
export const win32 = api;
export default { ...api, posix, win32 };
