/**
 * Node's file system, inside a browser tab's worker (2026-11-21).
 *
 * The web version runs the desktop's own main-process code in a Web Worker instead of on a
 * computer of its own. That code reads and writes files with `node:fs`; here those files live
 * in memory and are written through to IndexedDB, so settings, chats and opened projects come
 * back after a reload. Only what `src/main` actually calls is implemented: the sync and promise
 * forms of reading, writing, listing, stat, mkdir, rm and rename, with Node's error codes, so
 * the callers' existing `ENOENT` handling keeps working.
 *
 * Paths are POSIX and absolute; a relative path resolves against `/home/adcode`.
 */
type Kind = "file" | "dir";
interface Entry { kind: Kind; data: Uint8Array; mtimeMs: number; birthtimeMs: number; mode: number }

const entries = new Map<string, Entry>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const CWD = "/home/adcode";

const now = (): number => Date.now();
entries.set("/", { kind: "dir", data: new Uint8Array(), mtimeMs: now(), birthtimeMs: now(), mode: 0o40755 });

/* ── Paths ─────────────────────────────────────────────────────────────── */

export function normalizePath(input: string | URL | Uint8Array): string {
  let raw = typeof input === "string" ? input : input instanceof URL ? decodeURIComponent(input.pathname) : decoder.decode(input);
  raw = raw.replace(/\\/g, "/");
  if (!raw.startsWith("/")) raw = `${CWD}/${raw}`;
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

const parentOf = (path: string): string => {
  const at = path.lastIndexOf("/");
  return at <= 0 ? "/" : path.slice(0, at);
};
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/* ── Errors, in Node's shape ───────────────────────────────────────────── */

const MESSAGES: Record<string, string> = {
  ENOENT: "no such file or directory",
  EEXIST: "file already exists",
  ENOTDIR: "not a directory",
  EISDIR: "illegal operation on a directory",
  ENOTEMPTY: "directory not empty",
  EINVAL: "invalid argument",
  ENOSYS: "function not implemented",
};

export function fsError(code: string, syscall: string, path: string): Error {
  const error = new Error(`${code}: ${MESSAGES[code] ?? "error"}, ${syscall} '${path}'`) as Error & { code: string; syscall: string; path: string; errno: number };
  error.code = code;
  error.syscall = syscall;
  error.path = path;
  error.errno = -1;
  return error;
}

/* ── Persistence: IndexedDB, written behind ────────────────────────────── */

const DB_NAME = "adcode-files";
const STORE = "entries";
let db: IDBDatabase | null = null;
const dirty = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

/** Read everything saved before; called once, before any main-process module loads. */
export async function loadFileSystem(): Promise<void> {
  db = await openDb();
  if (db === null) return;
  const saved = await new Promise<[string, Entry][]>((resolve) => {
    const out: [string, Entry][] = [];
    const cursor = db!.transaction(STORE, "readonly").objectStore(STORE).openCursor();
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (at === null) return resolve(out);
      out.push([String(at.key), at.value as Entry]);
      at.continue();
    };
    cursor.onerror = () => resolve(out);
  });
  for (const [path, entry] of saved) entries.set(path, entry);
}

function touch(path: string): void {
  dirty.add(path);
  if (flushTimer === null) flushTimer = setTimeout(() => void flushFileSystem(), 400);
}

/** Write every change since the last flush. Also called when the tab is going away. */
export async function flushFileSystem(): Promise<void> {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  if (db === null || dirty.size === 0) { dirty.clear(); return; }
  const paths = [...dirty];
  dirty.clear();
  await new Promise<void>((resolve) => {
    const tx = db!.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const path of paths) {
      const entry = entries.get(path);
      if (entry === undefined) store.delete(path);
      else store.put(entry, path);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

/* ── The core operations, synchronous ──────────────────────────────────── */

function get(path: string): Entry | undefined {
  return entries.get(path);
}

function requireDir(path: string, syscall: string): void {
  const parent = get(path);
  if (parent === undefined) throw fsError("ENOENT", syscall, path);
  if (parent.kind !== "dir") throw fsError("ENOTDIR", syscall, path);
}

function put(path: string, entry: Entry): void {
  entries.set(path, entry);
  touch(path);
  const parent = get(parentOf(path));
  if (parent !== undefined && path !== "/") { parent.mtimeMs = now(); touch(parentOf(path)); }
}

function children(path: string): string[] {
  const prefix = path === "/" ? "/" : `${path}/`;
  const out: string[] = [];
  for (const key of entries.keys()) {
    if (key !== path && key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) out.push(key.slice(prefix.length));
  }
  return out.sort();
}

export type Data = string | Uint8Array | ArrayBuffer | ArrayBufferView;
const toBytes = (data: Data, encoding?: string | null): Uint8Array => {
  if (typeof data === "string") {
    if (encoding === "base64") return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    return encoder.encode(data);
  }
  if (data instanceof Uint8Array) return new Uint8Array(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
};

type EncodingOption = string | null | undefined | { encoding?: string | null; flag?: string; recursive?: boolean; withFileTypes?: boolean; force?: boolean; mode?: number };
const encodingOf = (options: EncodingOption): string | null => (typeof options === "string" ? options : options?.encoding ?? null);

export function readFileSync(path: string | URL, options?: EncodingOption): string | Uint8Array {
  const at = normalizePath(path);
  const entry = get(at);
  if (entry === undefined) throw fsError("ENOENT", "open", at);
  if (entry.kind === "dir") throw fsError("EISDIR", "read", at);
  const encoding = encodingOf(options);
  if (encoding === null) return wrapBytes(entry.data);
  return encoding === "base64" ? btoa(String.fromCharCode(...entry.data)) : decoder.decode(entry.data);
}

/** Buffer is installed globally by globals.ts; bytes come back as one when it is there. */
function wrapBytes(data: Uint8Array): Uint8Array {
  const BufferClass = (globalThis as { Buffer?: { from(data: Uint8Array): Uint8Array } }).Buffer;
  return BufferClass === undefined ? new Uint8Array(data) : BufferClass.from(data);
}

export function writeFileSync(path: string | URL, data: Data, options?: EncodingOption): void {
  const at = normalizePath(path);
  requireDir(parentOf(at), "open");
  const existing = get(at);
  if (existing?.kind === "dir") throw fsError("EISDIR", "open", at);
  const bytes = toBytes(data, encodingOf(options));
  const flag = typeof options === "object" && options !== null ? options.flag : undefined;
  if (flag?.startsWith("a") && existing !== undefined) return appendFileSync(at, bytes);
  if (flag === "wx" && existing !== undefined) throw fsError("EEXIST", "open", at);
  put(at, { kind: "file", data: bytes, mtimeMs: now(), birthtimeMs: existing?.birthtimeMs ?? now(), mode: 0o100644 });
}

export function appendFileSync(path: string | URL, data: Data, options?: EncodingOption): void {
  const at = normalizePath(path);
  const existing = get(at);
  if (existing === undefined) return writeFileSync(at, data, options);
  if (existing.kind === "dir") throw fsError("EISDIR", "open", at);
  const extra = toBytes(data, encodingOf(options));
  const joined = new Uint8Array(existing.data.length + extra.length);
  joined.set(existing.data);
  joined.set(extra, existing.data.length);
  put(at, { ...existing, data: joined, mtimeMs: now() });
}

export function mkdirSync(path: string | URL, options?: EncodingOption | number): string | undefined {
  const at = normalizePath(path);
  const recursive = typeof options === "object" && options !== null && options.recursive === true;
  const existing = get(at);
  if (existing !== undefined) {
    if (recursive && existing.kind === "dir") return undefined;
    throw fsError("EEXIST", "mkdir", at);
  }
  if (!recursive) {
    requireDir(parentOf(at), "mkdir");
    put(at, { kind: "dir", data: new Uint8Array(), mtimeMs: now(), birthtimeMs: now(), mode: 0o40755 });
    return undefined;
  }
  let first: string | undefined;
  const parts = at.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    const entry = get(current);
    if (entry === undefined) {
      first ??= current;
      put(current, { kind: "dir", data: new Uint8Array(), mtimeMs: now(), birthtimeMs: now(), mode: 0o40755 });
    } else if (entry.kind !== "dir") throw fsError("ENOTDIR", "mkdir", current);
  }
  return first;
}

export function mkdtempSync(prefix: string): string {
  for (;;) {
    const candidate = normalizePath(`${prefix}${Math.random().toString(36).slice(2, 8)}`);
    if (get(candidate) === undefined) {
      mkdirSync(candidate, { recursive: true });
      return candidate;
    }
  }
}

export interface Dirent { name: string; parentPath: string; path: string; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }

export function readdirSync(path: string | URL, options?: EncodingOption): string[] | Dirent[] {
  const at = normalizePath(path);
  const entry = get(at);
  if (entry === undefined) throw fsError("ENOENT", "scandir", at);
  if (entry.kind !== "dir") throw fsError("ENOTDIR", "scandir", at);
  const names = children(at);
  if (typeof options === "object" && options !== null && options.withFileTypes === true) {
    return names.map((name) => {
      const kind = get(`${at === "/" ? "" : at}/${name}`)?.kind;
      return { name, parentPath: at, path: at, isFile: () => kind === "file", isDirectory: () => kind === "dir", isSymbolicLink: () => false };
    });
  }
  return names;
}

export interface Stats {
  size: number; mode: number; mtimeMs: number; ctimeMs: number; birthtimeMs: number; atimeMs: number;
  mtime: Date; ctime: Date; birthtime: Date; atime: Date; dev: number; ino: number; uid: number; gid: number; nlink: number;
  isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean;
}

function statsOf(entry: Entry): Stats {
  return {
    size: entry.data.length, mode: entry.mode, mtimeMs: entry.mtimeMs, ctimeMs: entry.mtimeMs, birthtimeMs: entry.birthtimeMs, atimeMs: entry.mtimeMs,
    mtime: new Date(entry.mtimeMs), ctime: new Date(entry.mtimeMs), birthtime: new Date(entry.birthtimeMs), atime: new Date(entry.mtimeMs),
    dev: 1, ino: 0, uid: 1000, gid: 1000, nlink: 1,
    isFile: () => entry.kind === "file", isDirectory: () => entry.kind === "dir", isSymbolicLink: () => false,
  };
}

export function statSync(path: string | URL, options?: { throwIfNoEntry?: boolean }): Stats | undefined {
  const at = normalizePath(path);
  const entry = get(at);
  if (entry === undefined) {
    if (options?.throwIfNoEntry === false) return undefined;
    throw fsError("ENOENT", "stat", at);
  }
  return statsOf(entry);
}

export function existsSync(path: string | URL): boolean {
  try { return get(normalizePath(path)) !== undefined; } catch { return false; }
}

export function rmSync(path: string | URL, options?: { recursive?: boolean; force?: boolean }): void {
  const at = normalizePath(path);
  const entry = get(at);
  if (entry === undefined) {
    if (options?.force === true) return;
    throw fsError("ENOENT", "rm", at);
  }
  if (entry.kind === "dir") {
    if (options?.recursive !== true && children(at).length > 0) throw fsError("ENOTEMPTY", "rm", at);
    const prefix = `${at}/`;
    for (const key of [...entries.keys()]) if (key.startsWith(prefix)) { entries.delete(key); touch(key); }
  }
  if (at === "/") return;
  entries.delete(at);
  touch(at);
}

export function rmdirSync(path: string | URL, options?: { recursive?: boolean }): void {
  const at = normalizePath(path);
  const entry = get(at);
  if (entry === undefined) throw fsError("ENOENT", "rmdir", at);
  if (entry.kind !== "dir") throw fsError("ENOTDIR", "rmdir", at);
  rmSync(at, { recursive: options?.recursive === true });
}

export function unlinkSync(path: string | URL): void {
  const at = normalizePath(path);
  const entry = get(at);
  if (entry === undefined) throw fsError("ENOENT", "unlink", at);
  if (entry.kind === "dir") throw fsError("EISDIR", "unlink", at);
  entries.delete(at);
  touch(at);
}

export function renameSync(from: string | URL, to: string | URL): void {
  const source = normalizePath(from);
  const target = normalizePath(to);
  const entry = get(source);
  if (entry === undefined) throw fsError("ENOENT", "rename", source);
  requireDir(parentOf(target), "rename");
  if (source === target) return;
  if (entry.kind === "dir") {
    const prefix = `${source}/`;
    for (const [key, value] of [...entries]) {
      if (!key.startsWith(prefix)) continue;
      entries.delete(key);
      touch(key);
      put(target + key.slice(source.length), value);
    }
  }
  rmSync(target, { recursive: true, force: true });
  entries.delete(source);
  touch(source);
  put(target, entry);
}

export function copyFileSync(from: string | URL, to: string | URL): void {
  const source = normalizePath(from);
  const entry = get(source);
  if (entry === undefined) throw fsError("ENOENT", "copyfile", source);
  if (entry.kind === "dir") throw fsError("EISDIR", "copyfile", source);
  writeFileSync(to, entry.data);
}

export function accessSync(path: string | URL): void {
  const at = normalizePath(path);
  if (get(at) === undefined) throw fsError("ENOENT", "access", at);
}

export function realpathSync(path: string | URL): string {
  accessSync(path);
  return normalizePath(path);
}

/** Every file under `root`, for tools that walk a project (search, upload to GitHub). */
export function listFiles(root: string): string[] {
  const prefix = `${normalizePath(root)}/`;
  return [...entries].filter(([key, value]) => value.kind === "file" && key.startsWith(prefix)).map(([key]) => key);
}

export { nameOf as basenameOf, parentOf as dirnameOf };
