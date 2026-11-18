/**
 * Agents, in one place: the runs board, the flow that connects agents, and the tools they use.
 *
 * These were three pages - Agents, Flow and Tools - which split one question ("what can my
 * agents do, and what are they doing?") across three rail entries. Asked for 18 November 2026:
 * combine them. One page now, with a tab per job, laid out like the agent windows people
 * already know (Cursor's agents window: what is working first, the setup a click away).
 *
 * The three views are the same components as before, mounted here; this file only switches
 * between them, remembers the last one, and carries a live hint on each tab (how many runs are
 * working, whether a flow is on, how many tools are connected).
 */
import { Bot, Workflow, Wrench } from "lucide";
import { createIcon } from "../workbench/icons.ts";

export type AgentsHubTab = "runs" | "flow" | "tools";

export interface HubView {
  readonly element: HTMLElement;
  shown(): void;
  hidden(): void;
}

export interface AgentsHub {
  readonly element: HTMLElement;
  show(tab: AgentsHubTab): void;
  current(): AgentsHubTab;
  /** A short live note on a tab, such as "2 working" or "On"; empty hides it. */
  setHint(tab: AgentsHubTab, text: string, tone?: "busy" | "on" | "quiet"): void;
  shown(): void;
  hidden(): void;
  onChange(listener: (tab: AgentsHubTab) => void): void;
}

const TABS: readonly { readonly id: AgentsHubTab; readonly label: string; readonly title: string; readonly icon: Parameters<typeof createIcon>[0] }[] = [
  { id: "runs", label: "Runs", title: "Agents working now, what needs you, and your saved agents", icon: Bot },
  { id: "flow", label: "Flow", title: "Connect agents into a team that works on your chats", icon: Workflow },
  { id: "tools", label: "Tools", title: "Built-in tools, connectors, skills and project memory", icon: Wrench },
];

const STORE_KEY = "adcode.agents.tab";

export function parseHubTab(value: string | null | undefined): AgentsHubTab {
  return TABS.some((tab) => tab.id === value) ? (value as AgentsHubTab) : "runs";
}

export function createAgentsHub(views: Readonly<Record<AgentsHubTab, HubView>>): AgentsHub {
  const element = document.createElement("div");
  element.className = "agents-hub";
  const bar = document.createElement("header");
  bar.className = "agents-hub-bar";
  const title = document.createElement("h1");
  title.className = "agents-hub-title";
  title.textContent = "Agents";
  const tabs = document.createElement("div");
  tabs.className = "agents-hub-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Agents");
  const indicator = document.createElement("span");
  indicator.className = "agents-hub-indicator";
  indicator.setAttribute("aria-hidden", "true");
  tabs.append(indicator);
  bar.append(title, tabs);
  const body = document.createElement("div");
  body.className = "agents-hub-body";
  element.append(bar, body);

  const buttons = new Map<AgentsHubTab, HTMLButtonElement>();
  const hints = new Map<AgentsHubTab, HTMLElement>();
  const panels = new Map<AgentsHubTab, HTMLElement>();
  for (const tab of TABS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "agents-hub-tab";
    button.dataset["tab"] = tab.id;
    button.id = `agents-hub-tab-${tab.id}`;
    button.title = tab.title;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", `agents-hub-panel-${tab.id}`);
    const hint = document.createElement("span");
    hint.className = "agents-hub-hint";
    hint.hidden = true;
    const label = document.createElement("span");
    label.textContent = tab.label;
    button.append(createIcon(tab.icon), label, hint);
    button.addEventListener("click", () => show(tab.id));
    button.addEventListener("keydown", (event) => {
      const index = TABS.findIndex((one) => one.id === tab.id);
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const next = TABS[(index + step + TABS.length) % TABS.length]!.id;
      show(next);
      buttons.get(next)?.focus();
    });
    buttons.set(tab.id, button);
    hints.set(tab.id, hint);
    tabs.append(button);
    const panel = document.createElement("section");
    panel.className = "agents-hub-panel";
    panel.id = `agents-hub-panel-${tab.id}`;
    panel.dataset["tab"] = tab.id;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    panel.append(views[tab.id].element);
    panels.set(tab.id, panel);
    body.append(panel);
  }

  let current: AgentsHubTab = "runs";
  try { current = parseHubTab(localStorage.getItem(STORE_KEY)); } catch { current = "runs"; }
  let visible = false;
  const listeners: ((tab: AgentsHubTab) => void)[] = [];

  /** The pill under the chosen tab glides to it. */
  function placeIndicator(): void {
    const button = buttons.get(current);
    if (button === undefined || button.offsetWidth === 0) return;
    indicator.style.width = `${String(button.offsetWidth)}px`;
    indicator.style.transform = `translateX(${String(button.offsetLeft)}px)`;
  }

  function paint(): void {
    element.dataset["tab"] = current;
    for (const [id, button] of buttons) {
      const on = id === current;
      button.setAttribute("aria-selected", String(on));
      button.tabIndex = on ? 0 : -1;
    }
    for (const [id, panel] of panels) panel.hidden = id !== current;
    requestAnimationFrame(placeIndicator);
  }

  function show(tab: AgentsHubTab): void {
    if (tab !== current) {
      if (visible) views[current].hidden();
      current = tab;
      try { localStorage.setItem(STORE_KEY, tab); } catch { /* optional */ }
      paint();
      if (visible) views[current].shown();
      for (const listener of listeners) listener(tab);
      return;
    }
    paint();
  }

  new ResizeObserver(() => placeIndicator()).observe(tabs);
  paint();

  return {
    element,
    show,
    current: () => current,
    setHint(tab, text, tone = "quiet") {
      const hint = hints.get(tab);
      if (hint === undefined) return;
      hint.hidden = text === "";
      hint.textContent = text;
      hint.dataset["tone"] = tone;
    },
    shown() { visible = true; paint(); views[current].shown(); },
    hidden() { visible = false; views[current].hidden(); },
    onChange(listener) { listeners.push(listener); },
  };
}
