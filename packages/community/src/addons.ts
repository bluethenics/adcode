/**
 * Add-ons: the contract between a plugin's sealed panel and the app around it.
 *
 * An add-on is a small HTML document. ADCode serves it from its own `adcode-addon:` origin
 * into a sandboxed frame with a policy that allows inline script and style and nothing else:
 * no network, no storage, no navigation, no popups. It cannot read the app's page, cannot
 * fetch, and cannot reach the files or the account. What it gets is this bridge, injected
 * before its own markup, and the data it declared - pushed in, never pulled out.
 *
 *   adcode.on("init", () => …)       once, when the app has sent the data and saved state
 *   adcode.on("data", (data) => …)   called now and whenever the declared data changes
 *   adcode.run("view.problems")      runs one of the commands the add-on declared
 *   adcode.prompt("Write tests…")    puts text in the chat's message box (never sends it)
 *   adcode.store.get(key) / .set(key, value)   up to 4 KB of the add-on's own state
 *   adcode.options                    the plugin's own settings, as the person set them;
 *   adcode.on("options", (options) => …)   called when they change them
 *
 * The app checks every message against the manifest: an undeclared command, a prompt from
 * an add-on that did not ask for prompting, or an oversized store write is dropped.
 */
import type { AddonData, AddonSlot, PluginAddon } from "./plugin.ts";

/** The shape of each piece of data an add-on can declare. */
export interface AddonDataView {
  readonly usage?: {
    /** "Free AI", a plan name, or "Your API key". */
    readonly label: string;
    /** "Pro", "Max", or null on the free allowance or your own key. */
    readonly plan: string | null;
    /** Share of the current window used, 0–100, or null when unmetered. */
    readonly percent: number | null;
    readonly remaining: number | null;
    readonly limit: number | null;
    readonly unit: "credits" | "requests";
    /** "2 h 10 min", or null. */
    readonly resetsIn: string | null;
    readonly requestsToday: number;
    readonly tokensToday: number;
    /** The 7-day window, when the allowance has one. */
    readonly weekly: { readonly percent: number; readonly remaining: number; readonly limit: number; readonly resetsIn: string | null } | null;
  };
  /** How full the open conversation is: the share of the model's context in use. */
  readonly context?: { readonly used: number; readonly limit: number; readonly percent: number; readonly compactsAt: number };
  readonly account?: { readonly signedIn: boolean; readonly plan: string | null };
  readonly git?: { readonly isRepo: boolean; readonly branch: string | null; readonly changed: number; readonly ahead: number; readonly behind: number };
  readonly editor?: { readonly file: string | null; readonly language: string | null; readonly line: number | null };
  readonly problems?: { readonly errors: number; readonly warnings: number };
  readonly project?: { readonly name: string | null };
  readonly model?: { readonly provider: string | null; readonly model: string | null };
  readonly earnings?: { readonly balance: string | null };
}

/** Sizes each slot allows, in CSS pixels. The add-on asks; the app clamps. */
export const SLOT_SIZE: Readonly<Record<AddonSlot, { readonly minHeight: number; readonly maxHeight: number; readonly minWidth: number; readonly maxWidth: number | null }>> = {
  chat: { minHeight: 24, maxHeight: 180, minWidth: 0, maxWidth: null },
  sidebar: { minHeight: 24, maxHeight: 240, minWidth: 0, maxWidth: null },
  statusbar: { minHeight: 22, maxHeight: 22, minWidth: 24, maxWidth: 260 },
};

export function clampAddonSize(slot: AddonSlot, height: unknown, width: unknown): { readonly height: number; readonly width: number | null } {
  const size = SLOT_SIZE[slot];
  const h = typeof height === "number" && Number.isFinite(height) ? height : size.minHeight;
  const w = typeof width === "number" && Number.isFinite(width) ? width : size.minWidth;
  return {
    height: Math.round(Math.min(size.maxHeight, Math.max(size.minHeight, h))),
    width: size.maxWidth === null ? null : Math.round(Math.min(size.maxWidth, Math.max(size.minWidth, w))),
  };
}

export type AddonRequest =
  | { readonly type: "ready" }
  | { readonly type: "resize"; readonly height: number; readonly width: number | null }
  | { readonly type: "run"; readonly command: string }
  | { readonly type: "prompt"; readonly text: string }
  | { readonly type: "store"; readonly value: Readonly<Record<string, unknown>> };

const MAX_STORE = 4_000;

/**
 * A message from an add-on, accepted only if its manifest allows it. Everything an add-on
 * sends passes through here; anything else is dropped without a word.
 */
export function readAddonRequest(addon: PluginAddon, message: unknown): AddonRequest | null {
  if (typeof message !== "object" || message === null) return null;
  const value = message as Record<string, unknown>;
  if (value["adcode"] !== 1) return null;
  switch (value["type"]) {
    case "ready":
      return { type: "ready" };
    case "resize": {
      const size = clampAddonSize(addon.slot, value["height"], value["width"]);
      return { type: "resize", ...size };
    }
    case "run":
      return typeof value["command"] === "string" && addon.commands.includes(value["command"]) ? { type: "run", command: value["command"] } : null;
    case "prompt":
      return addon.prompt && typeof value["text"] === "string" && value["text"].trim().length > 0 ? { type: "prompt", text: value["text"].slice(0, 4000) } : null;
    case "store": {
      const store = value["value"];
      if (typeof store !== "object" || store === null || Array.isArray(store)) return null;
      try {
        if (JSON.stringify(store).length > MAX_STORE) return null;
      } catch {
        return null;
      }
      return { type: "store", value: store as Record<string, unknown> };
    }
    default:
      return null;
  }
}

/** Only the declared pieces of the app's data, so an add-on never sees what it did not ask for. */
export function addonDataFor(addon: Pick<PluginAddon, "data">, all: AddonDataView): AddonDataView {
  const picked: Record<string, unknown> = {};
  for (const key of addon.data as readonly AddonData[]) if (all[key] !== undefined) picked[key] = all[key];
  return picked as AddonDataView;
}

/** The theme tokens handed to an add-on so it matches the app, light or dark. */
export const ADDON_THEME_TOKENS = [
  "--accent", "--text-on-accent", "--text-primary", "--text-secondary", "--text-tertiary",
  "--bg-app", "--bg-elevated", "--bg-hover", "--bg-active", "--surface-control", "--border-hairline", "--border-strong",
  "--success", "--warning", "--danger", "--font-ui", "--font-mono", "--radius-sm",
] as const;

/** The add-on's URL: one origin for all add-ons, the plugin and add-on in the path. */
export const ADDON_SCHEME = "adcode-addon";
export const addonUrl = (pluginId: string, addonId: string, version: string): string => `${ADDON_SCHEME}://addon/${pluginId}/${addonId}?v=${encodeURIComponent(version)}`;

export function parseAddonUrl(url: string): { readonly pluginId: string; readonly addonId: string } | null {
  const match = /^adcode-addon:\/\/addon\/([a-z0-9][a-z0-9-]{1,46}[a-z0-9])\/([a-z][a-z0-9-]{0,31})(?:[?#].*)?$/.exec(url);
  return match === null ? null : { pluginId: match[1]!, addonId: match[2]! };
}

/**
 * The policy an add-on document is served with. `default-src 'none'` and then only inline
 * script and style and inline images: no fetch, no WebSocket, no frames, no forms, no base.
 * The `sandbox` directive repeats the frame's own attribute, so the document is sealed even
 * if it were ever opened outside its frame.
 */
export const ADDON_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "sandbox allow-scripts",
].join("; ");

/** The script ADCode puts in front of every add-on: the whole of what it can call. */
export const ADDON_BRIDGE = `(() => {
  const listeners = { data: [], init: [], options: [] };
  let data = {}, store = {}, options = {}, ready = false;
  const send = (message) => parent.postMessage(Object.assign({ adcode: 1 }, message), "*");
  addEventListener("message", (event) => {
    if (event.source !== parent || !event.data || event.data.adcode !== 1) return;
    const message = event.data;
    if (message.theme) for (const [name, value] of Object.entries(message.theme)) document.documentElement.style.setProperty(name, value);
    if (message.type === "init") { store = message.store || {}; options = message.options || {}; document.documentElement.dataset.slot = message.slot; ready = true; }
    if (message.type === "options") {
      options = message.options || {};
      for (const listener of listeners.options) { try { listener(options); } catch (error) { console.error(error); } }
    }
    if (message.type === "init" || message.type === "data") {
      data = message.data || {};
      for (const listener of listeners.data) { try { listener(data); } catch (error) { console.error(error); } }
    }
    if (message.type === "init") for (const listener of listeners.init.splice(0)) { try { listener(data); } catch (error) { console.error(error); } }
  });
  const report = () => send({ type: "resize", height: Math.ceil(document.documentElement.getBoundingClientRect().height), width: Math.ceil(document.body ? document.body.scrollWidth : 0) });
  window.adcode = Object.freeze({
    on(type, listener) {
      if (typeof listener !== "function") return;
      if (type === "data") { listeners.data.push(listener); listener(data); }
      if (type === "init") { if (ready) listener(data); else listeners.init.push(listener); }
      if (type === "options") listeners.options.push(listener);
    },
    get data() { return data; },
    get options() { return options; },
    run(command) { send({ type: "run", command: String(command) }); },
    prompt(text) { send({ type: "prompt", text: String(text) }); },
    resize() { report(); },
    store: Object.freeze({
      get(key) { return store[key]; },
      set(key, value) { store = Object.assign({}, store, { [key]: value }); send({ type: "store", value: store }); },
    }),
  });
  addEventListener("DOMContentLoaded", () => { new ResizeObserver(report).observe(document.documentElement); send({ type: "ready" }); });
})();`;

/** Plain defaults so an add-on looks like ADCode before it writes a line of CSS. */
export const ADDON_BASE_CSS = `html, body { margin: 0; padding: 0; background: transparent; }
body { color: var(--text-primary); font: 12px/1.4 var(--font-ui, system-ui), sans-serif; overflow: hidden; }
button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--border-hairline); background: var(--surface-control); border-radius: var(--radius-sm, 6px); padding: 2px 8px; transition: background-color 120ms ease, scale 90ms ease-out; }
button:hover { background: var(--bg-hover); }
button:active { scale: .97; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
:root[data-slot="statusbar"] body { white-space: nowrap; line-height: 22px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }`;

/** The document an add-on is served as. */
export function addonDocument(addon: Pick<PluginAddon, "html">): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${ADDON_CSP.replace("; sandbox allow-scripts", "")}"><style>${ADDON_BASE_CSS}</style><script>${ADDON_BRIDGE}</script></head><body>${addon.html}</body></html>`;
}
