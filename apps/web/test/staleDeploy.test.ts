import { describe, expect, it, vi } from "vitest";
import { STALE_DEPLOY_KEY, STALE_DEPLOY_QUIET_MS, STALE_DEPLOY_SCRIPT } from "../src/lib/staleDeploy";

/** Runs the inline script against a fake window and returns its listeners and effects. */
function page(storage: Map<string, string> | null = new Map(), now = 1_000_000) {
  const listeners = new Map<string, (event: unknown) => void>();
  const reload = vi.fn();
  const sessionStorage = storage === null
    ? { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }
    : { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) };
  const run = new Function("addEventListener", "sessionStorage", "location", "Date", STALE_DEPLOY_SCRIPT);
  run((type: string, listener: (event: unknown) => void) => listeners.set(type, listener), sessionStorage, { reload }, { now: () => now });
  const fail = (tagName: string, fields: Record<string, string>) => listeners.get("error")!({ target: { tagName, ...fields } });
  const reject = (reason: unknown) => listeners.get("unhandledrejection")!({ reason });
  return { reload, fail, reject, storage };
}

describe("a tab left open across a deploy", () => {
  it("reloads once when a chunk from its old build is gone", () => {
    const tab = page();
    tab.fail("SCRIPT", { src: "https://adcode.bluethenics.com/_next/static/chunks/267961k4l678e.js" });
    expect(tab.reload).toHaveBeenCalledTimes(1);
    expect(tab.storage?.get(STALE_DEPLOY_KEY)).toBe("1000000");
    tab.fail("SCRIPT", { src: "https://adcode.bluethenics.com/_next/static/chunks/02-qmp32pbcqr.js" });
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads for a missing build stylesheet and for a chunk the router could not import", () => {
    const css = page();
    css.fail("LINK", { rel: "stylesheet", href: "/_next/static/chunks/0wnbscesxao2-.css" });
    expect(css.reload).toHaveBeenCalledTimes(1);
    const lazy = page();
    lazy.reject(Object.assign(new Error("Loading chunk 123 failed."), { name: "ChunkLoadError" }));
    expect(lazy.reload).toHaveBeenCalledTimes(1);
  });

  it("leaves everything else alone", () => {
    const tab = page();
    tab.fail("SCRIPT", { src: "https://www.googletagmanager.com/gtag/js" });
    tab.fail("IMG", { src: "/_next/static/media/logo.png" });
    tab.fail("LINK", { rel: "preload", href: "/_next/static/chunks/a.css" });
    tab.reject(new Error("Network request failed"));
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it("reloads at most once in ten minutes, and never without session storage", () => {
    const recent = page(new Map([[STALE_DEPLOY_KEY, String(1_000_000 - STALE_DEPLOY_QUIET_MS + 1)]]));
    recent.fail("SCRIPT", { src: "/_next/static/chunks/x.js" });
    expect(recent.reload).not.toHaveBeenCalled();
    const later = page(new Map([[STALE_DEPLOY_KEY, String(1_000_000 - STALE_DEPLOY_QUIET_MS - 1)]]));
    later.fail("SCRIPT", { src: "/_next/static/chunks/x.js" });
    expect(later.reload).toHaveBeenCalledTimes(1);
    const blocked = page(null);
    blocked.fail("SCRIPT", { src: "/_next/static/chunks/x.js" });
    expect(blocked.reload).not.toHaveBeenCalled();
  });
});
