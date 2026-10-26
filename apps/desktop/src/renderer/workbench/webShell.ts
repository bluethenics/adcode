import { reconcileTabs, tabMotionAllowed, updateTabStrip } from "./tabMotion.ts";
/**
 * The web version's frame around Vibe: an icon rail on the far left and chat tabs along the top.
 *
 * Freebuff showed the shape a browser AI workspace should have - a slim rail for the places you
 * go, a sidebar for what you are working on, and a tab per open chat - and this is that shape in
 * ADCode's own theme. It lives in the renderer, behind `isWebSurface()`, so the desktop app is
 * unchanged until the same frame is ready for it.
 *
 * Nothing here owns state. The rail calls the Vibe sidebar's own actions; the tabs mirror the
 * conversation list the chat widget already draws (`.chat-history-row`, with its session id and
 * its working/finished mark) and open a chat by pressing that row, so a tab can never disagree
 * with the list.
 */
import { createIcon, type IconSource } from "./icons.ts";
import { brandMark } from "./brandMark.ts";

import { WEB_ICON } from "./webIcons.ts";

export interface RailItem {
  readonly id: string;
  readonly label: string;
  readonly shortLabel?: string;
  readonly icon: IconSource;
  readonly run: () => void;
}

/**
 * A rail panel that is a control the app already owns, moved into the rail rather than rebuilt.
 *
 * The live session is the reason: its button carries state the app writes onto it - the accent
 * fill while hosting, its label, the expanded state of its panel - and a copy in the rail would
 * be a second thing to keep in step with the first. Moved, it is the same button, and every
 * state it already had comes with it.
 */
export interface MovedPanel {
  readonly id: string;
  readonly control: HTMLElement;
}

export interface WebRail {
  readonly element: HTMLElement;
  /** Mark which place is showing; `null` for none. */
  setCurrent(id: string | null): void;
  /** A toggle's state, for panels that open over the page (Changes, Preview). */
  setPressed(id: string, pressed: boolean): void;
  /** A small count on an item: changes waiting, unread notifications. */
  setBadge(id: string, text: string): void;
}

/** One rail button: an icon, its name as a tooltip that appears beside it, and a badge slot. */
function railButton(item: RailItem): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "web-rail-item";
  button.dataset["rail"] = item.id;
  button.dataset["tip"] = item.label;
  button.setAttribute("aria-label", item.label);
  button.append(createIcon(item.icon));
  const label = document.createElement("span");
  label.className = "web-rail-label";
  label.textContent = item.shortLabel ?? item.label;
  label.setAttribute("aria-hidden", "true");
  button.append(label);
  const badge = document.createElement("span");
  badge.className = "web-rail-badge";
  badge.hidden = true;
  button.append(badge);
  button.addEventListener("click", item.run);
  return button;
}

export function createWebRail(options: {
  readonly home: () => void;
  readonly places: readonly RailItem[];
  readonly panels: readonly (RailItem | MovedPanel)[];
  /** Controls that already exist elsewhere and move here: notifications, settings, account. */
  readonly footer: readonly HTMLElement[];
}): WebRail {
  const element = document.createElement("nav");
  element.className = "web-rail";
  element.setAttribute("aria-label", "ADCode");

  const home = document.createElement("button");
  home.type = "button";
  home.className = "web-rail-home";
  home.dataset["tip"] = "Home";
  home.setAttribute("aria-label", "Home - the chat");
  home.append(brandMark({ size: 28, plate: true, accent: true }));
  home.addEventListener("click", options.home);

  const places = document.createElement("div");
  places.className = "web-rail-group";
  const buttons = new Map<string, HTMLElement>();
  for (const item of options.places) {
    const button = railButton(item);
    buttons.set(item.id, button);
    places.append(button);
  }
  const panels = document.createElement("div");
  panels.className = "web-rail-group";
  for (const item of options.panels) {
    // A control the app already built (the live session): moved into the rail, not copied, so
    // its own state styling and its own handlers are the ones on screen.
    if ("control" in item) {
      const control = item.control;
      control.classList.add("web-rail-item");
      // The same marker a built button carries, so compact mode treats it as a rail item and
      // the tests can find it by place rather than by which module made it.
      control.dataset["rail"] = item.id;
      if (!control.dataset["tip"]) {
        const label = control.getAttribute("aria-label") ?? control.title;
        if (label) control.dataset["tip"] = label;
      }
      buttons.set(item.id, control);
      panels.append(control);
      continue;
    }
    const button = railButton(item);
    button.setAttribute("aria-pressed", "false");
    buttons.set(item.id, button);
    panels.append(button);
  }
  const footer = document.createElement("div");
  footer.className = "web-rail-group web-rail-footer";
  for (const control of options.footer) {
    control.classList.add("web-rail-item");
    const label = control.getAttribute("aria-label") ?? control.title;
    if (label) control.dataset["tip"] = label;
    footer.append(control);
  }

  element.append(home, places, panels, footer);
  return {
    element,
    setCurrent(id): void {
      for (const [key, button] of buttons) {
        if (!places.contains(button)) continue;
        if (key === id) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
    },
    setPressed(id, pressed): void {
      buttons.get(id)?.setAttribute("aria-pressed", String(pressed));
    },
    setBadge(id, text): void {
      const badge = buttons.get(id)?.querySelector<HTMLElement>(".web-rail-badge");
      if (badge === undefined || badge === null) return;
      badge.textContent = text;
      badge.hidden = text === "";
      const button = buttons.get(id)!;
      const label = button.dataset["tip"] ?? id;
      button.setAttribute("aria-label", text ? `${label}, ${text}` : label);
    },
  };
}

/* ── Chat tabs ─────────────────────────────────────────────────────────── */

const TABS_KEY = "adcode.web.tabs";
const MAX_TABS = 8;

interface TabRecord { readonly id: string; title: string }

/** The tabs this browser tab has open, oldest first. Per tab, like the browser's own. */
function loadTabs(): TabRecord[] {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(TABS_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((tab): tab is TabRecord => typeof tab?.id === "string" && typeof tab?.title === "string").slice(-MAX_TABS) : [];
  } catch { return []; }
}
function saveTabs(tabs: readonly TabRecord[]): void {
  try { sessionStorage.setItem(TABS_KEY, JSON.stringify(tabs)); } catch { /* Tabs simply do not survive a reload. */ }
}

export interface ChatTabs { readonly element: HTMLElement }

export function createChatTabs(options: {
  /** Where the chat widget draws its conversation list. */
  readonly historyHost: HTMLElement;
  readonly newChat: () => void;
  readonly leading: readonly HTMLElement[];
  readonly trailing: readonly HTMLElement[];
}): ChatTabs {
  const element = document.createElement("div");
  element.className = "web-tabs";
  const strip = document.createElement("div");
  strip.className = "web-tabs-strip";
  strip.setAttribute("role", "tablist");
  strip.setAttribute("aria-label", "Open chats");
  // A mouse wheel has no horizontal delta. Keep overflowing chats reachable just as
  // editor tabs are, without taking horizontal trackpad gestures or browser zoom.
  strip.addEventListener("wheel", (event) => {
    if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    const limit = strip.scrollWidth - strip.clientWidth;
    if (limit <= 0) return;
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? strip.clientWidth
      : event.deltaMode === WheelEvent.DOM_DELTA_LINE ? Number.parseFloat(getComputedStyle(strip).lineHeight) || 16 : 1;
    const next = Math.max(0, Math.min(limit, strip.scrollLeft + event.deltaY * unit));
    if (Math.abs(next - strip.scrollLeft) < 1) return;
    event.preventDefault();
    strip.scrollLeft = next;
  }, { passive: false });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "web-tabs-add";
  add.dataset["tip"] = "New chat";
  add.setAttribute("aria-label", "New chat in a new tab");
  add.append(createIcon(WEB_ICON.newChat));
  add.addEventListener("click", options.newChat);
  const lead = document.createElement("div");
  lead.className = "web-tabs-side";
  lead.append(...options.leading);
  const trail = document.createElement("div");
  trail.className = "web-tabs-side web-tabs-trailing";
  trail.append(...options.trailing);
  element.append(lead, strip, add, trail);

  let tabs = loadTabs();
  const row = (id: string): HTMLElement | null => options.historyHost.querySelector<HTMLElement>(`.chat-history-row[data-session-id="${CSS.escape(id)}"]`);
  const activeId = (): string | null => options.historyHost.querySelector<HTMLElement>('.chat-history-row[data-active="true"]')?.dataset["sessionId"] ?? null;
  const open = (id: string): void => { row(id)?.querySelector<HTMLButtonElement>(".chat-history-open")?.click(); };

  function close(id: string): void {
    const at = tabs.findIndex((tab) => tab.id === id);
    if (at < 0) return;
    const wasActive = activeId() === id;
    tabs.splice(at, 1);
    saveTabs(tabs);
    if (!wasActive) { render(); return; }
    const neighbour = tabs[at] ?? tabs[at - 1];
    if (neighbour !== undefined && row(neighbour.id) !== null) open(neighbour.id);
    else options.newChat();
    render();
  }

  const tabNodes = new Map<string | null, HTMLElement>();
  function tab(record: TabRecord | null, active: boolean): HTMLElement {
    const existing = tabNodes.get(record?.id ?? null);
    if (existing) {
      existing.dataset["active"] = String(active);
      const button = existing.querySelector<HTMLButtonElement>(".web-tab-open")!;
      button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1;
      const title = record?.title ?? "New chat"; button.title = title;
      existing.querySelector(".web-tab-title")!.textContent = title;
      existing.querySelector<HTMLElement>(".web-tab-status")!.dataset["status"] = record === null ? "idle" : row(record.id)?.querySelector<HTMLElement>(".chat-history-status")?.dataset["status"] ?? "idle";
      existing.querySelector(".web-tab-close")?.setAttribute("aria-label", `Close ${title}`);
      return existing;
    }
    const item = document.createElement("div");
    item.className = "web-tab";
    item.dataset["active"] = String(active);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "web-tab-open";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    const status = document.createElement("span");
    status.className = "web-tab-status";
    status.dataset["status"] = record === null ? "idle" : row(record.id)?.querySelector<HTMLElement>(".chat-history-status")?.dataset["status"] ?? "idle";
    const title = document.createElement("span");
    title.className = "web-tab-title";
    title.textContent = record?.title ?? "New chat";
    button.title = title.textContent;
    button.append(status, title);
    if (record !== null) button.addEventListener("click", () => { if (activeId() !== record.id) open(record.id); });
    item.append(button);
    if (record !== null) {
      const shut = document.createElement("button");
      shut.type = "button";
      shut.className = "web-tab-close";
      shut.setAttribute("aria-label", `Close ${record.title}`);
      shut.append(createIcon(WEB_ICON.close));
      shut.addEventListener("click", (event) => { event.stopPropagation(); close(record.id); });
      item.append(shut);
      // Middle click closes, as a browser tab does.
      item.addEventListener("auxclick", (event) => { if (event.button === 1) { event.preventDefault(); close(record.id); } });
    }
    tabNodes.set(record?.id ?? null, item);
    return item;
  }

  let painted = "";
  let paintedOnce = false;
  function render(): void {
    const active = activeId();
    // The active chat is always a tab; titles follow renames in the list.
    if (active !== null && !tabs.some((one) => one.id === active)) {
      tabs.push({ id: active, title: "" });
      while (tabs.length > MAX_TABS) {
        const oldest = tabs.findIndex((one) => one.id !== active);
        tabs.splice(oldest < 0 ? 0 : oldest, 1);
      }
    }
    for (const record of tabs) {
      const title = row(record.id)?.querySelector(".chat-history-open")?.textContent?.trim();
      if (title) record.title = title;
      if (!record.title) record.title = "Chat";
    }
    saveTabs(tabs);
    // Re-drawn only when something a person can see changed, so focus and hover hold still.
    const signature = JSON.stringify([active, tabs.map((one) => [one.id, one.title, row(one.id)?.querySelector<HTMLElement>(".chat-history-status")?.dataset["status"]])]);
    if (signature === painted) return;
    painted = signature;
    const focusedIndex = [...strip.querySelectorAll(".web-tab-open")].indexOf(document.activeElement as Element);
    let items: HTMLElement[] = [];
    const focused = document.activeElement;
    updateTabStrip(strip, () => {
      items = tabs.map((record) => tab(record, record.id === active));
      if (active === null) items.push(tab(null, true));
      reconcileTabs(strip, items);
    }, paintedOnce && tabMotionAllowed());
    paintedOnce = true;
    for (const [id, node] of tabNodes) if (!items.includes(node)) tabNodes.delete(id);
    if (focusedIndex >= 0 && !focused?.isConnected) strip.querySelectorAll<HTMLElement>(".web-tab-open")[Math.min(focusedIndex, items.length - 1)]?.focus();
    strip.querySelector('.web-tab[data-active="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  strip.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const all = [...strip.querySelectorAll<HTMLElement>(".web-tab-open")];
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? all.length - 1 : (at + (event.key === "ArrowRight" ? 1 : all.length - 1)) % all.length;
    all[next]?.focus();
  });

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  }).observe(options.historyHost, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-active", "data-status"], characterData: true });
  render();
  return { element };
}
