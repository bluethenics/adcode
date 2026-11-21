/**
 * `process` and `Buffer`, installed on the worker's global scope before any main-process module
 * loads (worker.ts imports this first). Main-process code reads `process.env` and
 * `process.platform` at import time.
 */
import { Buffer } from "./buffer.ts";
import { EventEmitter } from "./events.ts";

const HOME = "/home/adcode";

class BrowserProcess extends EventEmitter {
  readonly env: Record<string, string | undefined> = {
    HOME,
    ADCODE_HOME: HOME,
    ADCODE_USER_DATA_DIR: `${HOME}/.adcode`,
    ADCODE_PROJECTS_HOME: `${HOME}/projects`,
    // The browser host's safeStorage (seal.ts) has no secret to keep; see the note there.
    ADCODE_SEAL_KEY: "browser",
    ADCODE_BROWSER_HOST: "1",
    // The API through the page's own origin: the cloud Worker (and Vite, in development) forwards
    // /v1 to it, where a call straight to adcode.bluethenics.com would be refused by CORS.
    ...(typeof location === "undefined" ? {} : { ADCODE_AD_SERVER: location.origin }),
    LANG: (typeof navigator === "undefined" ? "en-US" : navigator.language).replace("-", "_"),
  };
  readonly platform = "linux";
  readonly arch = "x64";
  readonly pid = 1;
  readonly ppid = 0;
  readonly title = "adcode-browser-host";
  readonly argv = ["adcode-browser-host"];
  readonly execPath = "";
  readonly resourcesPath = "/app";
  readonly version = "v24.0.0";
  readonly versions: Record<string, string> = { node: "24.0.0" };
  readonly release = { name: "node" };
  exitCode: number | undefined = undefined;
  readonly stdout = { write: (text: string): boolean => { console.log(String(text).replace(/\n$/, "")); return true; }, isTTY: false };
  readonly stderr = { write: (text: string): boolean => { console.warn(String(text).replace(/\n$/, "")); return true; }, isTTY: false };
  private readonly started = performance.now();
  cwd(): string { return HOME; }
  chdir(): void {}
  nextTick(callback: (...args: unknown[]) => void, ...args: unknown[]): void { queueMicrotask(() => callback(...args)); }
  kill(): boolean { return false; }
  exit(code = 0): void { console.warn(`[browser host] process.exit(${code}) ignored`); }
  uptime(): number { return (performance.now() - this.started) / 1000; }
  memoryUsage() { return { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }; }
  cpuUsage() { return { user: 0, system: 0 }; }
  emitWarning(warning: unknown): void { console.warn(warning); }
  getuid(): number { return 1000; }
  hrtime = Object.assign((previous?: [number, number]): [number, number] => {
    const now = performance.now();
    const seconds = Math.floor(now / 1000);
    const nanos = Math.floor((now % 1000) * 1e6);
    if (previous === undefined) return [seconds, nanos];
    return [seconds - previous[0], nanos - previous[1]];
  }, { bigint: (): bigint => BigInt(Math.floor(performance.now() * 1e6)) });
}

const scope = globalThis as unknown as { process?: unknown; Buffer?: unknown; global?: unknown; setImmediate?: unknown; clearImmediate?: unknown };
scope.process = new BrowserProcess();
scope.Buffer = Buffer;
scope.global = globalThis;
scope.setImmediate ??= (callback: (...args: unknown[]) => void, ...args: unknown[]) => setTimeout(callback, 0, ...args);
scope.clearImmediate ??= (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle);

/*
 * Node's timers have `unref()` and `ref()`; main-process code calls them to say "this timer must
 * not keep the program alive". A worker's timers are numbers, so give the number those methods.
 */
for (const name of ["setTimeout", "setInterval"] as const) {
  const original = globalThis[name].bind(globalThis) as (...args: unknown[]) => number;
  (globalThis as Record<string, unknown>)[name] = (...args: unknown[]) => {
    const id = original(...args);
    return Object.assign(Object(id) as object, { unref() { return this; }, ref() { return this; }, hasRef: () => false, refresh() { return this; }, [Symbol.toPrimitive]: () => id });
  };
}
for (const name of ["clearTimeout", "clearInterval"] as const) {
  const original = globalThis[name].bind(globalThis) as (id: unknown) => void;
  (globalThis as Record<string, unknown>)[name] = (id: unknown) => original(id === null || id === undefined ? id : Number(id));
}
