/**
 * The bottom panel: five surfaces, one strip of tabs.
 *
 * Before this, the panel *was* the terminal, and everything else that produces output had
 * to find its own home - Problems went into the sidebar, the dev server's log into a drawer
 * inside the preview, the language server's stderr nowhere at all. That is three places to
 * look when something goes wrong, and the one you need is never the one you opened.
 *
 * **Every tab stays mounted while hidden.** This is the same rule `terminalPanel.ts`
 * already follows for terminals, and for the same reason: a console that loses its
 * scrollback because you glanced at Problems is not a console. Hiding is `hidden`, never
 * `remove()`, so scroll position, selection and live subscriptions all survive a switch.
 *
 * **This module owns whether the panel is open.** Nothing else may set `panel.hidden` -
 * that used to be the terminal's job and it cannot be any more, because "close the
 * terminal" and "close the panel" are now different actions.
 */

export type PanelTabId = "terminal" | "problems" | "output" | "debug" | "ports";

export interface PanelTabSpec {
  readonly id: PanelTabId;
  readonly label: string;
  /** The tab's content. Mounted once, hidden when another tab is active. */
  readonly body: HTMLElement;
  /** Header controls belonging to this tab, shown only while it is active. */
  readonly actions?: HTMLElement;
  /** Called when this tab becomes visible. Where a poller starts. */
  readonly onShow?: () => void;
  /** Called when it stops being visible, including when the whole panel closes. */
  readonly onHide?: () => void;
}

export interface BottomPanel {
  add(spec: PanelTabSpec): void;
  /** Open the panel on this tab. */
  show(id: PanelTabId): void;
  /** Open on this tab, or close if it is already the visible one. */
  toggle(id: PanelTabId): void;
  close(): void;
  isOpen(): boolean;
  /** The visible tab, or null when the panel is closed. */
  active(): PanelTabId | null;
  /**
   * The tab that would come back if the panel were reopened.
   *
   * Survives closing, so Ctrl+J returns you to what you were reading rather than always
   * to the terminal.
   */
  lastActive(): PanelTabId | null;
  /** A count beside the tab's name. Zero removes it. */
  badge(id: PanelTabId, count: number): void;
  /** Move to the next or previous tab, for the keyboard. */
  cycle(delta: 1 | -1): void;
}

export interface BottomPanelDeps {
  /** The panel element. This module is the only thing that touches its `hidden`. */
  readonly panel: HTMLElement;
  /** Where the tab buttons go. */
  readonly tabStrip: HTMLElement;
  /** The divider above the panel, hidden with it or it hangs under the editor alone. */
  readonly splitter: HTMLElement;
  /** Monaco does not observe its container, so every open and close has to say so. */
  readonly onLayoutChange: () => void;
  /** Called when the panel closes, so focus does not vanish into a hidden element. */
  readonly onClosed: () => void;
}

interface Tab {
  readonly spec: PanelTabSpec;
  readonly button: HTMLButtonElement;
  readonly badge: HTMLSpanElement;
}

export function createBottomPanel(deps: BottomPanelDeps): BottomPanel {
  const tabs: Tab[] = [];
  let activeId: PanelTabId | null = null;

  const find = (id: PanelTabId): Tab | undefined => tabs.find((tab) => tab.spec.id === id);

  const setVisible = (tab: Tab, visible: boolean): void => {
    tab.spec.body.hidden = !visible;
    if (tab.spec.actions !== undefined) tab.spec.actions.hidden = !visible;
    tab.button.ariaSelected = String(visible);
    // `tabindex` follows selection so the strip is one tab stop, not five - the arrow keys
    // move within it. That is what a `tablist` is supposed to do.
    tab.button.tabIndex = visible ? 0 : -1;
  };

  const paint = (): void => {
    for (const tab of tabs) setVisible(tab, tab.spec.id === activeId);
  };

  const open = (id: PanelTabId): void => {
    const tab = find(id);
    if (tab === undefined) return;

    const previous = activeId;
    if (previous === id && !deps.panel.hidden) return;

    if (previous !== null && previous !== id) find(previous)?.spec.onHide?.();

    activeId = id;
    deps.panel.hidden = false;
    deps.splitter.hidden = false;
    paint();

    deps.onLayoutChange();
    tab.spec.onShow?.();
  };

  return {
    add(spec) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "panel-tab";
      button.role = "tab";
      button.ariaSelected = "false";
      button.tabIndex = -1;
      button.dataset["tab"] = spec.id;

      const label = document.createElement("span");
      label.className = "panel-tab-label";
      label.textContent = spec.label;

      const badge = document.createElement("span");
      badge.className = "panel-tab-badge";
      badge.hidden = true;

      button.append(label, badge);
      button.addEventListener("click", () => open(spec.id));

      deps.tabStrip.append(button);
      spec.body.hidden = true;
      if (spec.actions !== undefined) spec.actions.hidden = true;

      tabs.push({ spec, button, badge });
    },

    show: open,

    toggle(id) {
      if (!deps.panel.hidden && activeId === id) {
        this.close();
        return;
      }
      open(id);
    },

    close() {
      if (deps.panel.hidden) return;

      if (activeId !== null) find(activeId)?.spec.onHide?.();
      deps.panel.hidden = true;
      deps.splitter.hidden = true;

      // The active tab is remembered rather than cleared, so reopening the panel returns
      // to what you were reading. `active()` reports null while closed regardless.
      deps.onLayoutChange();
      deps.onClosed();
    },

    isOpen: () => !deps.panel.hidden,
    active: () => (deps.panel.hidden ? null : activeId),
    lastActive: () => activeId,

    badge(id, count) {
      const tab = find(id);
      if (tab === undefined) return;

      tab.badge.hidden = count <= 0;
      // Three digits is the width the strip can take without pushing the tabs around; a
      // project with 400 errors and one with 4000 need the same amount of alarm.
      tab.badge.textContent = count > 999 ? "999+" : String(count);
    },

    cycle(delta) {
      if (tabs.length === 0) return;

      const current = activeId === null ? 0 : tabs.findIndex((tab) => tab.spec.id === activeId);
      const next = (current + delta + tabs.length) % tabs.length;
      const target = tabs[next];
      if (target === undefined) return;

      open(target.spec.id);
      target.button.focus();
    },
  };
}
