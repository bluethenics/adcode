import { createEditorPair, type EditorHost, type EditorHostDeps } from "./editorHost.ts";
import { EditorGroups } from "./editorGroups.ts";
import { ICON, iconButton } from "../workbench/icons.ts";
import { createSplitter } from "../workbench/splitter.ts";
import type { GitOverlay } from "./gitOverlay.ts";

interface WorkspaceTab { readonly path: string; readonly name: string; readonly dirty: boolean }
export interface EditorWorkspace extends EditorHost {
  split(): void;
  collapse(): void;
  refreshTabs(tabs: readonly WorkspaceTab[]): void;
}

/** Composes file chrome around two views of one buffer store. */
export function createEditorWorkspace(
  container: HTMLElement, deps: EditorHostDeps,
  activateFile: (path: string) => void,
): EditorWorkspace {
  const groups = new EditorGroups();
  let tabs: readonly WorkspaceTab[] = [];
  let syncing = false;
  let ratio = 0.5;
  container.classList.add("editor-workspace");
  const panels = ([0, 1] as const).map((index) => {
    const panel = document.createElement("section");
    panel.className = "editor-file-panel";
    panel.setAttribute("aria-label", `File panel ${index + 1}`);
    const header = document.createElement("header");
    header.className = "editor-file-header";
    const number = document.createElement("span");
    number.className = "editor-group-number";
    number.textContent = String(index + 1).padStart(2, "0");
    number.setAttribute("aria-hidden", "true");
    const select = document.createElement("select");
    select.className = "editor-file-picker";
    select.setAttribute("aria-label", `File in panel ${index + 1}`);
    select.addEventListener("change", () => {
      groups.focus(index);
      activateFile(select.value);
    });
    const action = iconButton(
      index === 0 ? "Split editor right" : "Merge editor panels",
      index === 0 ? "M2 2.5h12v11H2zM8 2.5v11" : ICON.close,
    );
    action.id = index === 0 ? "editor-split" : "editor-merge";
    action.addEventListener("click", () => index === 0 ? split() : collapse());
    const content = document.createElement("div");
    content.className = "editor-file-content";
    header.append(number, select, action);
    panel.append(header, content);
    return { panel, select, action, content };
  });
  const first = panels[0]!;
  const second = panels[1]!;
  const divider = document.createElement("div");
  divider.className = "editor-divider";
  container.append(first.panel, divider, second.panel);

  const views = createEditorPair([first.content, second.content], deps);
  const current = (): EditorHost => views[groups.active];

  function render(): void {
    container.dataset["split"] = String(groups.isSplit);
    container.dataset["ready"] = String(groups.paths.some((path) => path !== null));
    second.panel.hidden = !groups.isSplit;
    divider.hidden = !groups.isSplit;
    first.action.hidden = groups.isSplit;
    first.action.disabled = groups.paths[0] === null;
    panels.forEach(({ panel, select }, index) => {
      const path = groups.paths[index] ?? null;
      panel.dataset["active"] = String(index === groups.active);
      panel.dataset["path"] = path ?? "";
      select.replaceChildren();
      for (const tab of tabs) {
        const option = document.createElement("option");
        option.value = tab.path;
        option.textContent = `${tab.dirty ? "● " : ""}${tab.name}`;
        option.title = tab.path;
        select.append(option);
      }
      select.value = path ?? "";
      select.title = path === null ? "Open a file to start" : deps.displayPath(path);
      select.disabled = path === null;
    });
    container.style.setProperty("--editor-first", `${ratio}fr`);
    container.style.setProperty("--editor-second", `${1 - ratio}fr`);
    divider.setAttribute("aria-valuemin", "25");
    divider.setAttribute("aria-valuemax", "75");
    divider.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  }

  function layout(): void {
    views[0].layout();
    if (groups.isSplit) views[1].layout();
  }

  function syncViews(): void {
    syncing = true;
    try {
      views.forEach((view, index) => {
        const path = groups.paths[index];
        if (path === null || path === undefined) view.deactivate();
        else view.activate(path);
      });
      render();
      layout();
      if (groups.paths[groups.active] !== null) current().focus();
    } finally { syncing = false; }
  }

  function split(): void {
    const path = groups.paths[groups.active];
    if (path === null) return;
    if (!groups.isSplit) groups.split(tabs.find((tab) => tab.path !== path)?.path ?? path);
    syncViews();
    activateFile(groups.paths[groups.active]!);
  }

  function collapse(): void {
    groups.collapse();
    syncViews();
    const path = groups.paths[0];
    if (path !== null) activateFile(path);
  }

  views.forEach((view, index) => view.onFocus(() => {
    if (syncing || groups.active === index) return;
    groups.focus(index as 0 | 1);
    render();
    const path = groups.paths[groups.active];
    if (path !== null) activateFile(path);
  }));

  createSplitter({
    element: divider, axis: "x", label: "Resize file panels", sign: 1,
    current: () => container.clientWidth * ratio,
    apply: (size) => {
      ratio = Math.max(0.25, Math.min(0.75, size / Math.max(1, container.clientWidth)));
      render();
      layout();
    },
    reset: container.clientWidth / 2,
    commit: () => {},
  });
  // Use the current width for reset, including after window/sidebar resizing.
  divider.addEventListener("dblclick", () => { ratio = 0.5; render(); layout(); });
  divider.addEventListener("keydown", (event) => {
    if (event.key === "Home") { ratio = 0.5; render(); layout(); }
  });
  const observer = new ResizeObserver(layout);
  observer.observe(container);
  render();

  // Async callers capture the overlay for the file they requested. Keep that binding,
  // while subscribing resolution handlers to both surfaces.
  const overlays = views.map((view) => new Proxy(view.git, {
    get(target, property: keyof GitOverlay) {
      if (property === "onResolved") return (listener: () => void) =>
        views.forEach((entry) => entry.git.onResolved(listener));
      const value = target[property];
      return value.bind(target);
    },
  }));

  const composed: Partial<EditorWorkspace> = {
    split, collapse, layout,
    refreshTabs(next) { tabs = next; render(); },
    activate(path) {
      groups.open(path);
      current().activate(path);
      render();
    },
    close(path) {
      views.forEach((view) => view.close(path));
      groups.close(path);
      syncViews();
    },
    rename(before, after) {
      // Save each cursor before the shared old model is disposed by the first view.
      views.forEach((view, index) => { if (groups.paths[index] === before) view.deactivate(); });
      views.forEach((view) => view.rename(before, after));
      groups.rename(before, after);
      syncViews();
    },
    setReadOnly(path, value) { views.forEach((view) => view.setReadOnly(path, value)); },
    applySettings(values) { views.forEach((view) => view.applySettings(values)); },
    setBreakpoints(points) { views.forEach((view) => view.setBreakpoints(points)); },
    setPausedLine(path, line) { views.forEach((view) => view.setPausedLine(path, line)); },
    onBreakpointToggle(listener) { views.forEach((view) => view.onBreakpointToggle(listener)); },
    onSaveRequested(listener) { views.forEach((view) => view.onSaveRequested(listener)); },
    onFocus(listener) { views.forEach((view) => view.onFocus(listener)); },
    onCursorChange(listener) {
      views.forEach((view, index) => view.onCursorChange((line, column) => {
        if (!syncing && groups.active === index) listener(line, column);
      }));
    },
    onHumanInput(listener) {
      const unsubscribe = views.map((view) => view.onHumanInput(listener));
      return () => unsubscribe.forEach((dispose) => dispose());
    },
  };
  // Path operations use the shared buffer store; editing actions and overlays follow focus.
  return new Proxy(views[0] as EditorWorkspace, {
    get(_target, property: keyof EditorWorkspace) {
      if (property === "git") return overlays[groups.active];
      if (property in composed) return composed[property];
      const host = current();
      const value = host[property as keyof EditorHost];
      return typeof value === "function" ? value.bind(host) : value;
    },
  });
}
