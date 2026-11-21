/**
 * The smaller Node modules for the browser host, one export set each (the build config maps
 * each `node:` specifier to one of the `*.ts` files beside this one that re-export from here).
 */
import { EventEmitter } from "./events.ts";

/* ── util ──────────────────────────────────────────────────────────────── */

const CUSTOM = Symbol.for("nodejs.util.promisify.custom");
export function promisify<T extends (...args: any[]) => unknown>(original: T): (...args: unknown[]) => Promise<any> {
  const custom = (original as unknown as Record<symbol, unknown>)[CUSTOM];
  if (typeof custom === "function") return custom as (...args: unknown[]) => Promise<unknown>;
  return (...args: unknown[]) => new Promise((resolve, reject) => {
    original(...args, (error: Error | null, ...values: unknown[]) => {
      if (error) reject(error);
      else resolve(values.length > 1 ? values : values[0]);
    });
  });
}
promisify.custom = CUSTOM;
export const inspect = (value: unknown): string => {
  try { return typeof value === "string" ? value : JSON.stringify(value); } catch { return String(value); }
};
export const format = (...args: unknown[]): string => args.map((arg) => (typeof arg === "string" ? arg : inspect(arg))).join(" ");
export const types = { isPromise: (value: unknown): boolean => value instanceof Promise };
export const TextEncoder = globalThis.TextEncoder;
export const TextDecoder = globalThis.TextDecoder;
export const deprecate = <T>(fn: T): T => fn;
export const isDeepStrictEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/* ── async_hooks ───────────────────────────────────────────────────────── */

/**
 * Node keeps a store through every await. A browser cannot, and needs not: one worker serves
 * one tab, so the window a call belongs to is always that tab's. The last store set is kept.
 */
export class AsyncLocalStorage<T> {
  private store: T | undefined;
  getStore(): T | undefined { return this.store; }
  run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R {
    this.store = store;
    return callback(...args);
  }
  enterWith(store: T): void { this.store = store; }
  exit<R>(callback: (...args: unknown[]) => R, ...args: unknown[]): R { return callback(...args); }
  disable(): void { this.store = undefined; }
}

/* ── stream ────────────────────────────────────────────────────────────── */

export class Readable extends EventEmitter {
  static toWeb(): never { throw new Error("Streams are not available in the browser host"); }
  static from(): never { throw new Error("Streams are not available in the browser host"); }
  pipe<T>(target: T): T { return target; }
}
export class Writable extends EventEmitter {}
export class Transform extends EventEmitter {}
export class PassThrough extends EventEmitter {}

/* ── http ──────────────────────────────────────────────────────────────── */

/** A server nobody can reach: listening fails, so callers fall back as when a port is taken. */
export class Server extends EventEmitter {
  listen(): this {
    setTimeout(() => this.emit("error", Object.assign(new Error("Servers are not available in the browser"), { code: "EACCES" })), 0);
    return this;
  }
  close(callback?: () => void): this { callback?.(); return this; }
  address(): null { return null; }
  closeAllConnections(): void {}
  unref(): this { return this; }
  override emit(name: string | symbol, ...args: unknown[]): boolean {
    if (name === "error" && this.listenerCount("error") === 0) return false;
    return super.emit(name, ...args);
  }
}
export const createServer = (): Server => new Server();
export class IncomingMessage extends EventEmitter {}
export class ServerResponse extends EventEmitter {}
export const request = (): never => { throw new Error("Use fetch in the browser host"); };
export const get = request;
export const STATUS_CODES: Record<number, string> = {};

/* ── zlib, readline, module, url, timers/promises ─────────────────────── */

export const gunzipSync = (): never => { throw new Error("Decompression is not available in the browser host"); };
export const inflateRawSync = gunzipSync;
export const gzipSync = gunzipSync;
export const createInterface = (): never => { throw new Error("Reading lines from a process is not available in the browser host"); };
export const createRequire = () => (id: string): never => { throw new Error(`Cannot load ${id} in the browser host`); };
export const fileURLToPath = (url: string | URL): string => decodeURIComponent(new URL(String(url)).pathname);
export const pathToFileURL = (path: string): URL => new URL(`file://${path}`);
export const URL_ = globalThis.URL;
export const sleep = (ms: number, value?: unknown): Promise<unknown> => new Promise((resolve) => setTimeout(() => resolve(value), ms));
