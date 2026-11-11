/**
 * The Browser panel as a real browser.
 *
 * Each tab is a `<webview>` in the shared-browser session (`main/liveBrowser.ts`), so a page
 * takes the mouse, the keyboard, scrolling, video and sign-ins directly - nothing is a
 * screenshot. The assistant drives the same tabs through the main process; when it does, the
 * panel comes forward and says so, and the person can carry on in the tab at any moment.
 *
 * The panel never decides what a guest may do: the main process overwrites the webview's
 * preferences and refuses any that is not in this partition. A tab is only offered to the
 * assistant after its guest exists (`dom-ready`), by id, and main checks it again.
 *
 * Layout is the panel's width, not the window's: the toolbar and the start page are container
 * queries, so it reads the same docked narrow, floating, or maximised.
 */
import type { LiveBrowserRequest } from "../../shared/api.ts";
import { ArrowLeft, ArrowRight, Globe, Lock, Plus, RotateCw, Search, X, type IconNode } from "lucide";
import { createFloatingPanel } from "../workbench/floatingPanel.ts";
import { createIcon } from "../workbench/icons.ts";
import { reconcileTabs, tabMotionAllowed, updateTabStrip } from "../workbench/tabMotion.ts";
import { setWorkspaceBrowserOpener } from "../workbench/workspacePanels.ts";
import { createAdcodeMascot } from "../mascot/adcodeMascot.ts";

/** Must match `LIVE_BROWSER_PARTITION` in the main process; anything else is refused there. */
const PARTITION = "persist:adcode-browser";
const RECENTS_KEY = "adcode.browser.recents";
const MAX_RECENTS = 8;

/** The parts of Electron's `<webview>` element this panel uses. */
interface WebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  getWebContentsId(): number;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  isLoading(): boolean;
}

interface Tab {
  readonly id: number;
  view: WebviewElement | null;
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  ready: boolean;
  error: string | null;
}

interface Recent { readonly url: string; readonly title: string }

/** Whether this build can show live pages at all. The web version cannot: it has no `<webview>`. */
export function liveBrowserSupported(): boolean {
  return "getWebContentsId" in document.createElement("webview");
}

/** What a person types in the address bar, as an address. Mirrors `addressFromInput` in main. */
export function browserAddress(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(trimmed);
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed
    : local ? `http://${trimmed}`
    : /^[^\s/]+\.[^\s]+$/.test(trimmed) ? `https://${trimmed}`
    : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return ""; }
}

function readRecents(): Recent[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((item): item is Recent => typeof item?.url === "string" && typeof item?.title === "string").slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

export function createLiveBrowserPane() {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label: string, icon: IconNode | null, run: (event: MouseEvent) => void, className = ""): HTMLButtonElement => {
    const node = el("button", className);
    node.type = "button";
    node.title = label;
    node.setAttribute("aria-label", label);
    if (icon !== null) node.append(createIcon(icon));
    node.addEventListener("click", run);
    return node;
  };

  const content = el("div", "agent-browser live-browser");
  const tabStrip = el("div", "agent-browser-tabs");
  tabStrip.setAttribute("role", "tablist");
  tabStrip.setAttribute("aria-label", "Browser tabs");

  const toolbar = el("form", "agent-browser-toolbar live-browser-toolbar");
  const back = button("Back", ArrowLeft, () => active.view?.goBack());
  const forward = button("Forward", ArrowRight, () => active.view?.goForward());
  const reload = button("Reload page", RotateCw, () => {
    if (active.view === null) return;
    if (active.loading) active.view.stop(); else active.view.reload();
  });
  const addressWrap = el("div", "live-browser-address");
  const security = el("span", "live-browser-security");
  security.setAttribute("aria-hidden", "true");
  const address = el("input", "");
  address.type = "text";
  address.placeholder = "Search or enter a URL";
  address.setAttribute("aria-label", "Search or enter a URL");
  address.autocomplete = "off";
  address.spellcheck = false;
  addressWrap.append(security, address);
  const driver = el("span", "live-browser-driver");
  driver.setAttribute("role", "status");
  driver.hidden = true;
  toolbar.append(back, forward, reload, addressWrap, driver);
  const progress = el("div", "live-browser-progress");
  progress.setAttribute("aria-hidden", "true");

  const stage = el("div", "agent-browser-stage live-browser-stage");
  stage.id = "agent-browser-page";
  stage.setAttribute("role", "tabpanel");

  /* The start page: a search box and where you have been. Ours, not a web page. */
  const start = el("div", "live-browser-start");
  // The pane lives as long as the window, so Buck is made once and never destroyed; off screen
  // he stops blinking and watching the pointer on his own.
  const mascot = createAdcodeMascot({ mood: "idle", interactive: true });
  let startShown = false;
  const startTitle = el("h2", "", "Where to?");
  const startHint = el("p", "", "Browse like you would anywhere. Your assistant can use these same tabs when you ask it to.");
  const startForm = el("form", "live-browser-start-search");
  const startIcon = createIcon(Search);
  const startInput = el("input", "");
  startInput.type = "text";
  startInput.placeholder = "Search the web or type an address";
  startInput.setAttribute("aria-label", "Search the web or type an address");
  startInput.autocomplete = "off";
  startInput.spellcheck = false;
  startForm.append(startIcon, startInput);
  const recentsList = el("div", "live-browser-recents");
  start.append(mascot.element, startTitle, startHint, startForm, recentsList);

  const failure = el("div", "live-browser-failure");
  failure.hidden = true;
  const failureTitle = el("h2", "", "This page didn't load");
  const failureText = el("p", "");
  const failureRetry = el("button", "live-browser-retry", "Try again");
  failureRetry.type = "button";
  failureRetry.addEventListener("click", () => { if (active.url) go(active.url); });
  failure.append(failureTitle, failureText, failureRetry);
  stage.append(start, failure);

  const status = el("p", "live-browser-status");
  status.setAttribute("role", "status");
  status.hidden = true;

  content.append(tabStrip, toolbar, progress, stage, status);
  const panel = createFloatingPanel({
    id: "browser", title: "Browser", content, defaultSize: { width: 1040, height: 760 }, anchor: "bottom-right", className: "agent-browser-panel",
    // Opening the pane on its start page is a hello, whichever button opened it.
    onVisibilityChange: (open) => { if (open && !start.hidden) mascot.play("greeting"); },
  });

  let serial = 0;
  let list: Tab[] = [];
  let active: Tab;
  let recents = readRecents();
  let driverTimer: ReturnType<typeof setTimeout> | null = null;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  const nodes = new Map<Tab, { wrap: HTMLElement; select: HTMLButtonElement; icon: HTMLElement; label: HTMLElement; close: HTMLButtonElement }>();
  const add = button("New tab", Plus, (event) => { addTab(null, tabMotionAllowed(event)); }, "workspace-tab-add");

  function remember(tab: Tab): void {
    if (!tab.url || tab.url === "about:blank") return;
    recents = [{ url: tab.url, title: tab.title || hostOf(tab.url) }, ...recents.filter((item) => item.url !== tab.url)].slice(0, MAX_RECENTS);
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recents)); } catch { /* Private mode: recents last for the session. */ }
  }

  function paintRecents(): void {
    recentsList.replaceChildren();
    for (const item of recents) {
      const row = el("button", "live-browser-recent");
      row.type = "button";
      row.title = item.url;
      row.append(el("strong", "", item.title.slice(0, 60)), el("span", "", hostOf(item.url)));
      row.addEventListener("click", () => go(item.url));
      recentsList.append(row);
    }
  }

  function notice(text: string): void {
    status.textContent = text;
    status.hidden = false;
    if (statusTimer !== null) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.hidden = true; }, 6000);
  }

  function showDriver(): void {
    driver.textContent = "Assistant is browsing";
    driver.hidden = false;
    content.dataset["driven"] = "true";
    mascot.setMood("working");
    if (driverTimer !== null) clearTimeout(driverTimer);
    driverTimer = setTimeout(() => { driver.hidden = true; delete content.dataset["driven"]; mascot.setMood("idle"); }, 4500);
  }

  function offer(tab: Tab): void {
    if (tab.view === null || !tab.ready) return;
    let id: number;
    try { id = tab.view.getWebContentsId(); } catch { return; }
    void window.adcode.browser.attachTab(tab.id, id, tab === active).catch(() => undefined);
  }

  function createView(tab: Tab, url: string): WebviewElement {
    const view = document.createElement("webview") as WebviewElement;
    view.className = "live-browser-view";
    view.setAttribute("partition", PARTITION);
    view.setAttribute("src", url);
    view.addEventListener("dom-ready", () => { tab.ready = true; offer(tab); sync(tab); });
    view.addEventListener("did-start-loading", () => { tab.loading = true; tab.error = null; paint(); });
    view.addEventListener("did-stop-loading", () => { tab.loading = false; sync(tab); remember(tab); });
    const navigated = (): void => { sync(tab); };
    view.addEventListener("did-navigate", navigated);
    view.addEventListener("did-navigate-in-page", navigated);
    view.addEventListener("page-title-updated", navigated);
    view.addEventListener("page-favicon-updated", (event) => {
      const icons = (event as Event & { favicons?: string[] }).favicons;
      tab.favicon = icons?.find((icon) => icon.startsWith("https://")) ?? null;
      paint();
    });
    view.addEventListener("did-fail-load", (event) => {
      const detail = event as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean; validatedURL?: string };
      // -3 is a navigation the page itself replaced; not a failure anyone needs to see.
      if (detail.isMainFrame !== true || detail.errorCode === -3) return;
      tab.loading = false;
      tab.error = `${hostOf(detail.validatedURL ?? tab.url) || "The site"} can't be reached (${detail.errorDescription ?? "no connection"}).`;
      paint();
    });
    view.addEventListener("update-target-url", (event) => {
      if (tab !== active) return;
      const target = (event as Event & { url?: string }).url ?? "";
      if (target === "") { status.hidden = true; return; }
      if (statusTimer !== null) clearTimeout(statusTimer);
      status.textContent = target;
      status.hidden = false;
    });
    stage.append(view);
    return view;
  }

  function sync(tab: Tab): void {
    if (tab.view !== null && tab.ready) {
      try {
        tab.url = tab.view.getURL();
        tab.title = tab.view.getTitle();
      } catch { /* Not attached yet. */ }
    }
    paint();
  }

  function go(value: string, tab: Tab = active): void {
    const url = browserAddress(value);
    if (url === null) { notice("Enter a web address, or words to search for."); return; }
    tab.url = url;
    tab.error = null;
    tab.loading = true;
    if (tab.view === null) tab.view = createView(tab, url);
    else if (tab.ready) void tab.view.loadURL(url).catch(() => undefined);
    else tab.view.setAttribute("src", url);
    paint();
  }

  function addTab(url: string | null, motion = false): Tab {
    const tab: Tab = { id: ++serial, view: null, url: "", title: "", favicon: null, loading: false, ready: false, error: null };
    list.push(tab);
    active = tab;
    if (url !== null && url !== "about:blank") go(url, tab);
    paint(motion);
    nodes.get(tab)?.wrap.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (url === null) startInput.focus();
    return tab;
  }

  function closeTab(tab: Tab, motion: boolean): void {
    const index = list.indexOf(tab);
    if (index < 0) return;
    list = list.filter((item) => item !== tab);
    void window.adcode.browser.detachTab(tab.id).catch(() => undefined);
    tab.view?.remove();
    if (list.length === 0) { addTab(null, motion); return; }
    if (active === tab) select(list[Math.min(index, list.length - 1)]!, motion);
    else paint(motion);
  }

  function select(tab: Tab, motion = false): void {
    active = tab;
    offer(tab);
    paint(motion);
  }

  function paintTabs(motion: boolean): void {
    updateTabStrip(tabStrip, () => {
      for (const tab of nodes.keys()) if (!list.includes(tab)) nodes.delete(tab);
      const out: HTMLElement[] = [];
      for (const tab of list) {
        let node = nodes.get(tab);
        if (node === undefined) {
          const wrap = el("div", "agent-browser-tab");
          const icon = el("span", "live-browser-tab-icon");
          const label = el("span", "workspace-tab-label");
          const pick = button("New tab", null, () => { if (active !== tab) select(tab); });
          pick.append(icon, label);
          pick.setAttribute("role", "tab");
          pick.id = `agent-browser-tab-${tab.id.toString()}`;
          pick.setAttribute("aria-controls", "agent-browser-page");
          const close = button("Close tab", X, (event) => closeTab(tab, tabMotionAllowed(event)), "workspace-tab-close");
          wrap.append(pick, close);
          node = { wrap, select: pick, icon, label, close };
          nodes.set(tab, node);
        }
        const name = tab.title || hostOf(tab.url) || "New tab";
        node.wrap.dataset["active"] = String(tab === active);
        node.wrap.dataset["loading"] = String(tab.loading);
        node.label.textContent = name;
        node.select.title = tab.url || "New tab";
        node.select.setAttribute("aria-label", name);
        node.select.setAttribute("aria-selected", String(tab === active));
        node.select.tabIndex = tab === active ? 0 : -1;
        node.close.title = `Close ${name}`;
        node.close.setAttribute("aria-label", `Close ${name}`);
        const shown = node.icon.dataset["src"] ?? "";
        const wanted = tab.loading ? "loading" : tab.favicon ?? "globe";
        if (shown !== wanted) {
          node.icon.dataset["src"] = wanted;
          if (tab.favicon !== null && !tab.loading) {
            const image = document.createElement("img");
            image.alt = "";
            image.referrerPolicy = "no-referrer";
            image.src = tab.favicon;
            image.addEventListener("error", () => { node.icon.replaceChildren(createIcon(Globe)); });
            node.icon.replaceChildren(image);
          } else {
            node.icon.replaceChildren(tab.loading ? el("span", "live-browser-spinner") : createIcon(Globe));
          }
        }
        out.push(node.wrap);
      }
      out.push(add);
      reconcileTabs(tabStrip, out);
    }, motion);
    stage.setAttribute("aria-labelledby", `agent-browser-tab-${active.id.toString()}`);
  }

  function paint(motion = false): void {
    for (const tab of list) if (tab.view !== null) tab.view.dataset["active"] = String(tab === active && tab.error === null);
    const blank = active.view === null;
    start.hidden = !blank;
    // A wave each time the start page comes back into view, then he settles to his standing mood.
    if (blank && !startShown) mascot.play("greeting");
    startShown = blank;
    failure.hidden = active.error === null;
    failureText.textContent = active.error ?? "";
    if (document.activeElement !== address) address.value = active.url === "about:blank" ? "" : active.url;
    const secure = active.url.startsWith("https://");
    security.replaceChildren(createIcon(active.url === "" ? Search : secure ? Lock : Globe));
    security.dataset["secure"] = String(secure);
    let canBack = false;
    let canForward = false;
    if (active.view !== null && active.ready) {
      try { canBack = active.view.canGoBack(); canForward = active.view.canGoForward(); } catch { /* Guest gone. */ }
    }
    back.disabled = !canBack;
    forward.disabled = !canForward;
    reload.disabled = blank;
    reload.title = active.loading ? "Stop loading" : "Reload page";
    reload.setAttribute("aria-label", reload.title);
    reload.replaceChildren(createIcon(active.loading ? X : RotateCw));
    content.dataset["loading"] = String(active.loading);
    panel.setTitle(active.title ? `Browser - ${active.title.slice(0, 60)}` : "Browser");
    if (blank) paintRecents();
    paintTabs(motion);
  }

  toolbar.addEventListener("submit", (event) => { event.preventDefault(); go(address.value); address.blur(); });
  address.addEventListener("focus", () => address.select());
  startForm.addEventListener("submit", (event) => { event.preventDefault(); const value = startInput.value; startInput.value = ""; go(value); });
  tabStrip.addEventListener("keydown", (event) => {
    const buttons = [...tabStrip.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    if (event.key === "Delete") { event.preventDefault(); closeTab(list[index]!, false); return; }
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : event.key === "ArrowRight" ? (index + 1) % buttons.length : event.key === "ArrowLeft" ? (index + buttons.length - 1) % buttons.length : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
  });
  content.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "l") { event.preventDefault(); address.focus(); }
    else if (key === "t") { event.preventDefault(); addTab(null, true); }
    else if (key === "w") { event.preventDefault(); closeTab(active, true); }
    else if (key === "r") { event.preventDefault(); active.view?.reload(); }
  });

  function handle(request: LiveBrowserRequest): void {
    switch (request.kind) {
      case "open":
        panel.open();
        showDriver();
        if (request.newTab || active.view !== null) addTab(request.url, true);
        else go(request.url);
        break;
      case "popup":
        addTab(request.url, true);
        break;
      case "select": {
        const tab = list.find((item) => item.id === request.tab);
        if (tab === undefined) break;
        panel.open();
        showDriver();
        if (tab !== active) select(tab);
        break;
      }
      case "close": {
        const tab = list.find((item) => item.id === request.tab);
        if (tab !== undefined) closeTab(tab, true);
        break;
      }
      case "notice":
        notice(request.text);
        break;
    }
  }

  addTab(null);
  window.adcode.browser.onRequest(handle);
  const open = (url?: string): void => {
    panel.open();
    if (url !== undefined) {
      if (active.view === null) go(url); else addTab(url, true);
    } else if (active.view === null) startInput.focus();
  };
  setWorkspaceBrowserOpener(() => open());
  return { open, panel };
}
