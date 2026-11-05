/**
 * Plugin add-ons, mounted: sealed frames in the chat, the sidebar and the status bar.
 *
 * Each add-on is an `<iframe sandbox="allow-scripts">` pointed at the `adcode-addon:` scheme,
 * so its document has an opaque origin, a policy with no network, and no way into this page.
 * This module is the only thing that talks to it: it hands over the theme, the data the
 * add-on declared and its saved state, and accepts back only what `readAddonRequest` allows -
 * a declared command, a prompt for the message box, a size, a small state write.
 */
import {
  ADDON_THEME_TOKENS, addonDataFor, addonUrl, readAddonRequest,
  type AddonData, type AddonDataView, type AddonSlot, type PluginAddon,
} from "@adcode/community";
import type { InstalledPluginView } from "../../shared/community.ts";

export interface AddonHostDeps {
  /** Where each slot's add-ons go, or null when this window has no such place right now. */
  readonly slot: (slot: AddonSlot) => HTMLElement | null;
  /** The app's data, for the keys some mounted add-on declared. */
  readonly data: (keys: ReadonlySet<AddonData>) => Promise<AddonDataView>;
  readonly run: (command: string, pluginId: string) => void;
  readonly prompt: (text: string, pluginId: string) => void;
  readonly hasCommand: (command: string) => boolean;
}

interface Mounted {
  readonly key: string;
  readonly pluginId: string;
  readonly addon: PluginAddon;
  options: string;
  readonly frame: HTMLIFrameElement;
  ready: boolean;
  lastData: string;
}

const storeKey = (pluginId: string, addonId: string): string => `adcode.addon.${pluginId}.${addonId}`;

function readStore(pluginId: string, addonId: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(storeKey(pluginId, addonId)) ?? "{}") as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function theme(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const tokens = Object.fromEntries(ADDON_THEME_TOKENS.map((token) => [token, style.getPropertyValue(token).trim()]).filter(([, value]) => value !== ""));
  // The frame inherits the app's color-scheme; a document inside it that disagrees gets an opaque backdrop.
  const scheme = document.documentElement.dataset["theme"] === "light" ? "light" : "dark";
  return { ...tokens, "color-scheme": scheme };
}

export interface AddonHost {
  apply(installed: readonly InstalledPluginView[]): void;
  /** Push fresh data now, for an event the host was told about (a save, a usage change). */
  refresh(): void;
  mounted(): number;
}

export function createAddonHost(deps: AddonHostDeps): AddonHost {
  const mounted = new Map<string, Mounted>();
  let wanted: { pluginId: string; version: string; addon: PluginAddon; options: Readonly<Record<string, unknown>> }[] = [];
  const optionsFor = (pluginId: string): Readonly<Record<string, unknown>> => wanted.find((one) => one.pluginId === pluginId)?.options ?? {};

  function send(entry: Mounted, message: Record<string, unknown>): void {
    entry.frame.contentWindow?.postMessage({ adcode: 1, ...message }, "*");
  }

  function mount(): void {
    for (const { pluginId, version, addon, options } of wanted) {
      const key = `${pluginId}/${addon.id}/${version}`;
      const existing = mounted.get(key);
      const host = deps.slot(addon.slot);
      if (existing !== undefined) {
        // The person changed the plugin's settings: tell the add-on, without reloading it.
        const text = JSON.stringify(options);
        if (existing.ready && text !== existing.options) send(existing, { type: "options", options });
        existing.options = text;
        // The sidebar is rebuilt when the window switches mode; follow it there.
        if (host !== null && existing.frame.parentElement !== host) { host.append(existing.frame); existing.ready = false; }
        continue;
      }
      if (host === null) continue;
      const frame = document.createElement("iframe");
      frame.className = "addon-frame";
      frame.dataset["slot"] = addon.slot;
      frame.dataset["plugin"] = pluginId;
      frame.title = addon.title;
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.setAttribute("allow", "");
      frame.setAttribute("loading", "eager");
      frame.src = addonUrl(pluginId, addon.id, version);
      host.append(frame);
      mounted.set(key, { key, pluginId, addon, frame, ready: false, lastData: "", options: JSON.stringify(options) });
    }
  }

  function unmountStale(): void {
    const keep = new Set(wanted.map(({ pluginId, version, addon }) => `${pluginId}/${addon.id}/${version}`));
    for (const [key, entry] of mounted) {
      if (keep.has(key)) continue;
      entry.frame.remove();
      mounted.delete(key);
    }
  }

  let refreshing = false;
  async function pushData(force = false): Promise<void> {
    if (refreshing || mounted.size === 0) return;
    refreshing = true;
    try {
      const keys = new Set<AddonData>();
      for (const entry of mounted.values()) if (entry.ready) for (const key of entry.addon.data) keys.add(key);
      if (keys.size === 0) return;
      const all = await deps.data(keys);
      for (const entry of mounted.values()) {
        if (!entry.ready || entry.addon.data.length === 0) continue;
        const data = addonDataFor(entry.addon, all);
        const text = JSON.stringify(data);
        if (!force && text === entry.lastData) continue;
        entry.lastData = text;
        send(entry, { type: "data", data });
      }
    } finally {
      refreshing = false;
    }
  }

  window.addEventListener("message", (event) => {
    const entry = [...mounted.values()].find((one) => one.frame.contentWindow === event.source);
    if (entry === undefined) return;
    const request = readAddonRequest(entry.addon, event.data);
    if (request === null) return;
    switch (request.type) {
      case "ready":
        entry.ready = true;
        void deps.data(new Set(entry.addon.data)).then((all) => {
          const data = addonDataFor(entry.addon, all);
          entry.lastData = JSON.stringify(data);
          send(entry, { type: "init", slot: entry.addon.slot, theme: theme(), data, store: readStore(entry.pluginId, entry.addon.id), options: optionsFor(entry.pluginId) });
          entry.frame.dataset["ready"] = "true";
        });
        break;
      case "resize":
        entry.frame.style.height = `${request.height}px`;
        if (request.width !== null) entry.frame.style.width = `${request.width}px`;
        break;
      case "run":
        if (deps.hasCommand(request.command)) deps.run(request.command, entry.pluginId);
        break;
      case "prompt":
        deps.prompt(request.text, entry.pluginId);
        break;
      case "store":
        try { localStorage.setItem(storeKey(entry.pluginId, entry.addon.id), JSON.stringify(request.value)); } catch { /* Storage off: the add-on forgets on reload. */ }
        break;
    }
  });

  // Light/dark follows the app: re-send the tokens whenever the theme attribute changes.
  new MutationObserver(() => {
    const tokens = theme();
    for (const entry of mounted.values()) if (entry.ready) send(entry, { type: "theme", theme: tokens });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });

  // Data that changes without an event (the cursor line, git status) is checked every few
  // seconds, and only while an add-on that declared it is on screen.
  window.setInterval(() => {
    if (mounted.size > 0 && document.visibilityState === "visible") void pushData();
    // Also moves a frame whose place changed - the window switched between Vibe and Code.
    if (wanted.length > 0) mount();
  }, 3000);

  return {
    apply(installed) {
      wanted = installed.filter((plugin) => plugin.enabled).flatMap((plugin) => plugin.manifest.contributes.addons.map((addon) => ({ pluginId: plugin.manifest.id, version: plugin.manifest.version, addon, options: plugin.options })));
      unmountStale();
      mount();
    },
    refresh() { void pushData(); },
    mounted: () => mounted.size,
  };
}
