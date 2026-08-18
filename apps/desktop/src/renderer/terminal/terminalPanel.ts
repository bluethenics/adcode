/**
 * The terminal panel: many terminals, one panel.
 *
 * Each terminal owns its own container and stays mounted while hidden, because xterm
 * rebuilds its whole viewport when reattached - and a terminal that loses its scrollback
 * every time you switch away from it is not a terminal you can work in.
 *
 * Splits are real side-by-side terminals within one tab, matching what VS Code calls a
 * split terminal; the tab strip lists tabs, not panes.
 */
import { createTerminalHost, type TerminalHost } from "./terminalHost.ts";
import { uniqueTerminalTitle } from "./terminalTitles.ts";
import { ICON, createIcon } from "../workbench/icons.ts";

interface Pane {
  readonly id: number;
  readonly element: HTMLElement;
  readonly host: TerminalHost;
}

interface Tab {
  readonly id: number;
  readonly element: HTMLElement;
  title: string;
  panes: Pane[];
  activePane: number;
}

export interface TerminalPanel {
  /** Open a new terminal, creating the panel if it is closed. */
  create(options?: { profileId?: string }): Promise<void>;
  /** The active tab's title, which is the shell it is running. */
  activeTitle(): string | null;
  /** Add a pane beside the active terminal. */
  split(): Promise<void>;
  close(): void;
  killActive(): void;
  killAll(): void;
  next(): void;
  previous(): void;
  clear(): void;
  /** Type a command into the active terminal and press return. */
  send(text: string): void;
  toggle(): Promise<void>;
  isOpen(): boolean;
  fit(): void;
  focus(): void;
  applyTheme(theme: "light" | "dark"): void;
  count(): number;
}

export interface TerminalPanelDeps {
  readonly panel: HTMLElement;
  readonly tabStrip: HTMLElement;
  readonly surface: HTMLElement;
  readonly profileId: () => string;
  /** The shell's display name, which becomes the tab's title. */
  readonly profileLabel: (profileId: string) => string;
  readonly cwd: () => string | null;
  readonly theme: () => "light" | "dark";
  readonly notify: (message: string) => void;
  /** Called whenever the panel opens or closes, so the editor can re-layout. */
  readonly onLayoutChange: () => void;
  /**
   * Called when the visible terminal changes.
   *
   * The tab strip hides itself at one terminal, so with named shells the panel header is
   * the only thing left that says whether that one terminal is cmd or Git Bash.
   */
  readonly onActiveTitle: (title: string | null) => void;
}

export function createTerminalPanel(deps: TerminalPanelDeps): TerminalPanel {
  const tabs: Tab[] = [];
  let activeTab: number | null = null;
  let nextId = 1;

  const findTab = (id: number): Tab | undefined => tabs.find((tab) => tab.id === id);

  function renderTabs(): void {
    deps.tabStrip.replaceChildren();

    // One terminal needs no tab strip; the panel title already says what it is.
    deps.tabStrip.hidden = tabs.length < 2;

    for (const tab of tabs) {
      const button = document.createElement("button");
      button.className = "terminal-tab";
      button.type = "button";
      button.ariaSelected = String(tab.id === activeTab);
      button.title = tab.title;

      const label = document.createElement("span");
      label.textContent = tab.panes.length > 1 ? `${tab.title} (${tab.panes.length})` : tab.title;

      const close = document.createElement("button");
      close.className = "terminal-tab-close";
      close.type = "button";
      close.append(createIcon(ICON.close));
      close.ariaLabel = `Close ${tab.title}`;
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        kill(tab.id);
      });

      button.append(label, close);
      button.addEventListener("click", () => activate(tab.id));
      deps.tabStrip.append(button);
    }
  }

  function activate(id: number): void {
    activeTab = id;

    for (const tab of tabs) tab.element.hidden = tab.id !== id;

    renderTabs();
    fitActive();
    deps.onActiveTitle(findTab(id)?.title ?? null);
    findTab(id)?.panes[findTab(id)?.activePane ?? 0]?.host.focus();
  }

  function fitActive(): void {
    const tab = activeTab === null ? undefined : findTab(activeTab);
    for (const pane of tab?.panes ?? []) pane.host.fit();
  }

  /** Start one pty and mount it into a pane element. */
  async function spawnPane(into: HTMLElement, profileId: string | undefined): Promise<Pane> {
    const element = document.createElement("div");
    element.className = "terminal-pane";
    into.append(element);

    const cwd = deps.cwd();
    const host = await createTerminalHost(element, {
      ...(profileId === undefined || profileId === "" ? {} : { profileId }),
      ...(cwd === null ? {} : { cwd }),
      theme: deps.theme(),
    });

    return { id: nextId++, element, host };
  }

  async function create(options?: { profileId?: string }): Promise<void> {
    const wasClosed = deps.panel.hidden;
    deps.panel.hidden = false;

    const element = document.createElement("div");
    element.className = "terminal-tab-body";
    deps.surface.append(element);

    const profileId = options?.profileId ?? deps.profileId();

    let pane: Pane;
    try {
      pane = await spawnPane(element, profileId);
    } catch (error) {
      element.remove();
      if (wasClosed && tabs.length === 0) deps.panel.hidden = true;
      deps.notify(error instanceof Error ? error.message : "could not start terminal");
      return;
    }

    const tab: Tab = {
      id: pane.id,
      element,
      title: uniqueTerminalTitle(
        deps.profileLabel(profileId),
        tabs.map((existing) => existing.title),
      ),
      panes: [pane],
      activePane: 0,
    };

    tabs.push(tab);
    activate(tab.id);
    deps.onLayoutChange();
  }

  async function split(): Promise<void> {
    const tab = activeTab === null ? undefined : findTab(activeTab);
    if (tab === undefined) {
      await create();
      return;
    }

    // Four panes in one tab is already unreadable at panel height; past that, a new tab
    // is what the user actually wants.
    if (tab.panes.length >= 4) {
      deps.notify("That terminal is already split four ways.");
      return;
    }

    try {
      const pane = await spawnPane(tab.element, deps.profileId());
      tab.panes.push(pane);
      tab.activePane = tab.panes.length - 1;
    } catch (error) {
      deps.notify(error instanceof Error ? error.message : "could not split terminal");
      return;
    }

    tab.element.dataset["panes"] = String(tab.panes.length);
    renderTabs();
    fitActive();
    tab.panes[tab.activePane]?.host.focus();
  }

  function kill(id: number): void {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;

    const [tab] = tabs.splice(index, 1);
    if (tab === undefined) return;

    for (const pane of tab.panes) pane.host.dispose();
    tab.element.remove();

    if (tabs.length === 0) {
      activeTab = null;
      deps.panel.hidden = true;
      deps.onLayoutChange();
      deps.onActiveTitle(null);
      renderTabs();
      return;
    }

    activate((tabs[index] ?? tabs[index - 1])!.id);
  }

  return {
    create,
    split,

    activeTitle: () => (activeTab === null ? null : (findTab(activeTab)?.title ?? null)),

    close() {
      deps.panel.hidden = true;
      deps.onLayoutChange();
    },

    killActive() {
      if (activeTab !== null) kill(activeTab);
    },

    killAll() {
      for (const tab of [...tabs]) kill(tab.id);
    },

    next() {
      if (activeTab === null || tabs.length < 2) return;
      const at = tabs.findIndex((tab) => tab.id === activeTab);
      activate(tabs[(at + 1) % tabs.length]!.id);
    },

    previous() {
      if (activeTab === null || tabs.length < 2) return;
      const at = tabs.findIndex((tab) => tab.id === activeTab);
      activate(tabs[(at - 1 + tabs.length) % tabs.length]!.id);
    },

    clear() {
      const tab = activeTab === null ? undefined : findTab(activeTab);
      tab?.panes[tab.activePane]?.host.clear();
    },

    send(text) {
      const tab = activeTab === null ? undefined : findTab(activeTab);
      tab?.panes[tab.activePane]?.host.send(text);
    },

    async toggle() {
      if (!deps.panel.hidden) {
        deps.panel.hidden = true;
        deps.onLayoutChange();
        return;
      }

      // Opening an empty panel would show a blank rectangle; the first open starts a
      // terminal, later ones just bring the panel back.
      if (tabs.length === 0) {
        await create();
        return;
      }

      deps.panel.hidden = false;
      deps.onLayoutChange();
      fitActive();
      this.focus();
    },

    isOpen: () => !deps.panel.hidden,
    fit: fitActive,

    focus() {
      const tab = activeTab === null ? undefined : findTab(activeTab);
      tab?.panes[tab.activePane]?.host.focus();
    },

    applyTheme(theme) {
      for (const tab of tabs) for (const pane of tab.panes) pane.host.applyTheme(theme);
    },

    count: () => tabs.length,
  };
}
