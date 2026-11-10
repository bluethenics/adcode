import type { AgentBrowserView } from "../../shared/api.ts";
import { setWorkspaceBrowserOpener } from "../workbench/workspacePanels.ts";
import { createFloatingPanel } from "../workbench/floatingPanel.ts";
import { reconcileTabs, tabMotionAllowed, updateTabStrip } from "../workbench/tabMotion.ts";
import { ICON, createIcon } from "../workbench/icons.ts";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCw, type IconNode } from "lucide";

import { createLiveBrowserPane, liveBrowserSupported } from "./liveBrowserPane.ts";

/**
 * The Browser panel. On the desktop it is a real browser (`liveBrowserPane.ts`); the web
 * version has no `<webview>`, so it keeps the snapshot view of the assistant's own page below.
 */
export function createAgentBrowserPane(): { open: (url?: string) => void; panel: ReturnType<typeof createFloatingPanel> } {
  return liveBrowserSupported() ? createLiveBrowserPane() : createSnapshotBrowserPane();
}

/** The same Chromium session agents drive, rendered safely as snapshots instead of privileged web content. */
function createSnapshotBrowserPane() {
  const content = document.createElement("div"); content.className = "agent-browser";
  const tabs = document.createElement("div"); tabs.className = "agent-browser-tabs"; tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Browser tabs");
  const toolbar = document.createElement("form"); toolbar.className = "agent-browser-toolbar";
  const address = document.createElement("input"); address.type = "text"; address.placeholder = "Search or enter a URL"; address.setAttribute("aria-label", "Search or enter a URL"); address.autocomplete = "off"; address.spellcheck = false;
  const stage = document.createElement("div"); stage.className = "agent-browser-stage";
  const image = document.createElement("img"); image.className = "agent-browser-image"; image.alt = "Current browser page"; image.hidden = true; image.tabIndex = 0; image.setAttribute("aria-label", "Browser page. Click to interact; use the text field below to type.");
  const empty = document.createElement("div"); empty.className = "agent-browser-empty";
  empty.append(createIcon("M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM1.5 8h13M8 1.5c-4 4-4 9 0 13M8 1.5c4 4 4 9 0 13"));
  const heading = document.createElement("h2"); heading.textContent = "Open a page";
  const hint = document.createElement("p"); hint.textContent = "Preview your app, read docs, or follow your agent on the web.";
  empty.append(heading, hint);
  const status = document.createElement("p"); status.className = "agent-browser-status"; status.setAttribute("role", "status");
  const details = document.createElement("details"); details.className = "agent-browser-report";
  const summary = document.createElement("summary"); summary.textContent = "Page text and browser findings";
  const report = document.createElement("pre"); details.append(summary, report);
  const inputBar = document.createElement("form"); inputBar.className = "agent-browser-input";
  const typing = document.createElement("input"); typing.placeholder = "Type into the selected page field"; typing.setAttribute("aria-label", "Text to type into the browser page");
  const sendText = document.createElement("button"); sendText.type = "submit"; sendText.textContent = "Type";
  inputBar.append(typing, sendText);
  stage.append(empty, image);
  content.append(tabs, toolbar, stage, status, inputBar, details);
  const panel = createFloatingPanel({ id: "browser", title: "Browser", content, defaultSize: { width: 960, height: 740 }, anchor: "bottom-right", className: "agent-browser-panel" });
  type Tab = { id: number; url: string; history: string[]; index: number; view: AgentBrowserView | null };
  let serial = 0;
  let list: Tab[] = [];
  let active: Tab;
  let busy = false;
  let following = true;
  let ownRequest = false;
  let request = 0;
  const button = (label: string, symbol: string | IconNode, run: (event: MouseEvent) => void) => {
    const b = document.createElement("button"); b.type = "button"; if (typeof symbol === "string") b.textContent = symbol; else b.append(createIcon(symbol)); b.title = label; b.setAttribute("aria-label", label); b.addEventListener("click", run); return b;
  };
  const back = button("Back", ArrowLeft, () => history(-1));
  const forward = button("Forward", ArrowRight, () => history(1));
  const reload = button("Reload page", RotateCw, () => { if (active.url) void navigate(active.url, false); });
  const follow = button("Follow agent browser", "Follow agent", () => { following = !following; follow.setAttribute("aria-pressed", String(following)); if (following) void window.adcode.browser.read().then(v => { if (v) receive(v); }); });
  follow.className = "agent-browser-follow"; follow.setAttribute("aria-pressed", "true");
  toolbar.append(back, forward, reload, address, follow);
  const recent = document.createElement("div"); recent.className = "agent-browser-recents"; empty.append(recent);
  const visited: string[] = [];
  const remember = (url: string) => {
    if (!url || visited.includes(url)) return;
    visited.unshift(url); visited.splice(6); recent.replaceChildren();
    for (const href of visited) recent.append(button(`Open ${href}`, href, () => void navigate(href)));
  };
  const tabNodes = new Map<Tab, { wrap: HTMLElement; select: HTMLButtonElement; label: HTMLElement; close: HTMLButtonElement }>();
  const add = button("New browser tab", "", event => { if (!busy) addTab(tabMotionAllowed(event)); });
  add.className = "workspace-tab-add"; add.append(createIcon(ICON.plus));
  function closeTab(tab: Tab, motion: boolean) {
    if (busy) return;
    const index = list.indexOf(tab);
    const focusWasInside = tabNodes.get(tab)?.wrap.contains(document.activeElement);
    list = list.filter(t => t !== tab);
    if (!list.length) { addTab(motion); return; }
    const changed = active === tab;
    if (changed) active = list[Math.min(index, list.length - 1)]!;
    paint(motion);
    if (focusWasInside) tabNodes.get(active)?.select.focus();
    if (changed && active.url) void navigate(active.url, false);
  }
  function renderTabs(motion = false) {
    updateTabStrip(tabs, () => {
      for (const tab of tabNodes.keys()) if (!list.includes(tab)) tabNodes.delete(tab);
      const nodes: HTMLElement[] = [];
      for (const tab of list) {
        let node = tabNodes.get(tab);
        if (!node) {
          const wrap = document.createElement("div"); wrap.className = "agent-browser-tab";
          const label = document.createElement("span"); label.className = "workspace-tab-label";
          const select = button("New tab", "", () => {
            if (busy || active === tab) return;
            active = tab; following = false; follow.setAttribute("aria-pressed", "false"); paint();
            if (tab.url) void navigate(tab.url, false);
          });
          select.append(createIcon("M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM1.5 8h13M8 1.5c-4 4-4 9 0 13M8 1.5c4 4 4 9 0 13"), label);
          select.setAttribute("role", "tab"); select.id = `agent-browser-tab-${tab.id}`;
          select.setAttribute("aria-controls", "agent-browser-page");
          const close = button("Close tab", "", event => closeTab(tab, tabMotionAllowed(event)));
          close.className = "workspace-tab-close"; close.append(createIcon(ICON.close));
          wrap.append(select, close); node = { wrap, select, label, close }; tabNodes.set(tab, node);
        }
        node.wrap.dataset["active"] = String(tab === active);
        node.label.textContent = tab.url ? new URL(tab.url).hostname : "New tab";
        node.select.title = tab.url || "New tab"; node.select.setAttribute("aria-label", node.select.title);
        node.select.setAttribute("aria-selected", String(tab === active)); node.select.tabIndex = tab === active ? 0 : -1;
        node.select.disabled = busy; node.close.disabled = busy;
        node.close.title = `Close ${node.label.textContent}`;
        nodes.push(node.wrap);
      }
      add.disabled = busy; nodes.push(add); reconcileTabs(tabs, nodes);
    }, motion);
    stage.setAttribute("aria-labelledby", `agent-browser-tab-${active.id}`);
  }
  stage.id = "agent-browser-page"; stage.setAttribute("role", "tabpanel");
  tabs.addEventListener("keydown", event => {
    const buttons = [...tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    if (event.key === "Delete") { event.preventDefault(); closeTab(list[index]!, false); return; }
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : event.key === "ArrowRight" ? (index + 1) % buttons.length : event.key === "ArrowLeft" ? (index + buttons.length - 1) % buttons.length : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
  });
  function addTab(motion = false) {
    active = { id: ++serial, url: "", history: [], index: -1, view: null }; list.push(active);
    status.textContent = ""; paint(motion); tabNodes.get(active)?.wrap.scrollIntoView({ block: "nearest", inline: "nearest" }); address.focus();
  }
  function paint(motion = false) {
    address.value = active.url; image.hidden = !active.view?.image; empty.hidden = Boolean(active.view?.image);
    if (active.view?.image) image.src = active.view.image; else image.removeAttribute("src");
    report.textContent = active.view?.report ?? ""; details.hidden = !active.view; inputBar.hidden = !active.view;
    back.disabled = busy || active.index < 1; forward.disabled = busy || active.index >= active.history.length - 1; reload.disabled = busy || !active.url;
    renderTabs(motion);
  }
  function receive(view: AgentBrowserView) {
    if (!following || ownRequest) return;
    active.url = view.url; active.view = view; remember(view.url); status.textContent = view.error ? view.report : "Agent browser updated"; paint();
  }
  async function perform(input: Record<string, unknown>, addHistory = false) {
    if (busy) return;
    busy = true; ownRequest = true; const mine = ++request; const tab = active;
    content.dataset["busy"] = "true"; status.textContent = "Opening page…"; paint();
    try {
      const view = await window.adcode.browser.view({ width: active.view?.width ?? 1280, height: active.view?.height ?? 800, screenshot: true, ...(!input["url"] && active.view ? { expectedUpdatedAt: active.view.updatedAt } : {}), ...input });
      if (mine !== request) return;
      tab.url = view.url; tab.view = view;
      if (addHistory && tab.history[tab.index] !== view.url) { tab.history.splice(tab.index + 1); tab.history.push(view.url); tab.index = tab.history.length - 1; }
      remember(view.url); status.textContent = view.error ? "The page reported an issue. See browser findings." : "Ready · shared with your agents";
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Couldn't open this page. Try again."; }
    finally { busy = false; ownRequest = false; delete content.dataset["busy"]; paint(); }
  }
  async function navigate(value: string, addHistory = true) {
    const trimmed = value.trim(); if (!trimmed) return;
    let url: string;
    try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : trimmed.includes(".") || trimmed.startsWith("localhost:") ? `${trimmed.startsWith("localhost:") || trimmed.startsWith("127.0.0.1:") ? "http" : "https"}://${trimmed}` : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`).href; }
    catch { status.textContent = "Enter a valid web address."; return; }
    await perform({ url }, addHistory);
  }
  function history(delta: number) { const next = active.index + delta; if (busy || next < 0 || next >= active.history.length) return; active.index = next; void navigate(active.history[next]!, false); }
  toolbar.addEventListener("submit", event => { event.preventDefault(); void navigate(address.value); });
  image.addEventListener("click", event => {
    if (busy || !active.view) return;
    const bounds = image.getBoundingClientRect();
    const x = Math.round((event.clientX - bounds.left) / bounds.width * active.view.width);
    const y = Math.round((event.clientY - bounds.top) / bounds.width * active.view.width);
    void perform({ actions: [{ type: "eval", expression: `(() => { const e = document.elementFromPoint(${x}, ${y}); e?.focus(); e?.click(); return true; })()` }] }, true);
  });
  image.addEventListener("keydown", event => { if (["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Backspace"].includes(event.key)) { event.preventDefault(); void perform({ actions: [{ type: "press", key: event.key }] }, true); } });
  inputBar.addEventListener("submit", event => { event.preventDefault(); if (!typing.value) return; const value = typing.value; typing.value = ""; void perform({ actions: [{ type: "type", value }] }); });
  const down = button("Scroll page down", ArrowDown, () => void perform({ actions: [{ type: "eval", expression: "window.scrollBy(0, 600)" }] }));
  const up = button("Scroll page up", ArrowUp, () => void perform({ actions: [{ type: "eval", expression: "window.scrollBy(0, -600)" }] }));
  inputBar.append(up, down);
  addTab();
  window.adcode.browser.onChanged(receive);
  const open = () => { panel.open(); void window.adcode.browser.read().then(view => { if (view) receive(view); }).catch(error => { status.textContent = String(error); }); address.focus(); };
  setWorkspaceBrowserOpener(open);
  return { open, panel };
}
