import type { ChatWidget } from "../ai/chatWidget.ts";
import { createSplitter } from "./splitter.ts";
import { createHelpPopover } from "../help/helpPopover.ts";
import { MODE_DESCRIPTION, MODE_STORAGE_KEY, workspaceMode, type WorkspaceMode } from "./workspaceMode.ts";
import type { createProjectContext, ContextTab } from "./projectContext.ts";
import { createIcon, ICON } from "./icons.ts";
import { createContextMenu, attachContextMenuDismissal } from "./contextMenu.ts";

interface AssistantDockDeps {
  readonly chat: ChatWidget;
  readonly workbench: HTMLElement;
  readonly sidebar: HTMLElement;
  readonly openExpanded: () => void;
  readonly closeExpanded: () => void;
  readonly expandedHost: HTMLElement;
  readonly showFiles: () => void;
  readonly toggleTerminal: () => void;
  readonly context: ReturnType<typeof createProjectContext>;
  readonly focusEditor: () => void;
  readonly openPreview: () => void;
  readonly run: (command: string) => void;
  readonly projectRoot: () => string | null;
  readonly layoutChanged: () => void;
}

/** Reparent the live widget: streams, proposals and conversations keep one owner. */
export function createAssistantDock(deps: AssistantDockDeps) {
  const { chat, workbench, sidebar } = deps;
  let docked = true;
  let mode: WorkspaceMode = "vibe";
  try { mode = workspaceMode(localStorage.getItem(MODE_STORAGE_KEY)); } catch { /* Optional preference. */ }
  let codeAssistantOpen = false;
  let contextOpen = false;
  const dockedPreviewOpen = (): boolean => !!document.querySelector('.preview-pane[data-placement="docked"]:not([hidden])');
  const vibe = document.createElement("section");
  vibe.className = "vibe-workspace assistant-dock";
  vibe.id = "vibe-workspace";
  vibe.setAttribute("aria-label", "Vibe project session");
  document.getElementById("editor-area")?.append(vibe);
  const divider = document.createElement("div");
  divider.id = "splitter-assistant";
  const dock = document.createElement("aside");
  dock.className = "assistant-dock";
  dock.id = "assistant-dock";
  dock.setAttribute("aria-label", "AI Assistant");
  workbench.append(divider, dock);
  let width = 440;
  let contextWidth = 320;
  try { width = Math.max(340, Math.min(640, Number(localStorage.getItem("adcode.assistant.width")) || 440)); } catch { /* Optional storage. */ }
  try { contextWidth = Math.max(300, Math.min(640, Number(localStorage.getItem("adcode.context.width")) || 320)); } catch { /* Optional storage. */ }
  workbench.style.setProperty("--assistant-width", `${width}px`);
  workbench.style.setProperty("--context-width", `${contextWidth}px`);
  createSplitter({
    element: divider, axis: "x", sign: -1, label: "Resize assistant or context", reset: () => contextOpen ? 320 : 440,
    current: () => dock.getBoundingClientRect().width,
    apply: value => {
      if (contextOpen) {
        contextWidth = Math.max(300, Math.min(640, window.innerWidth * .4, value));
        workbench.style.setProperty("--context-width", `${contextWidth}px`);
        return;
      }
      width = Math.max(340, Math.min(640, window.innerWidth * .48, value));
      workbench.style.setProperty("--assistant-width", `${width}px`);
    },
    commit: () => { try {
      localStorage.setItem("adcode.assistant.width", String(width));
      localStorage.setItem("adcode.context.width", String(contextWidth));
    } catch { /* Optional. */ } },
  });

  const toolbar = document.createElement("div");
  toolbar.className = "project-toolbar";
  toolbar.setAttribute("aria-label", "Project and layout");
  const railAction = (
    label: string,
    paths: string,
    run: () => void,
    className = "",
  ): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `vibe-nav-item vibe-rail-only${className ? ` ${className}` : ""}`;
    const text = document.createElement("span");
    text.textContent = label;
    button.append(createIcon(paths), text);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", run);
    return button;
  };
  const workspaceLabel = document.createElement("span");
  workspaceLabel.className = "vibe-nav-label vibe-rail-only";
  workspaceLabel.textContent = "Workspace";
  const newButton = railAction("New conversation", ICON.plus, () => {
    chat.element.querySelector<HTMLButtonElement>('.chat-header-actions [aria-label="Start a new conversation"]')?.click();
    chat.shown();
    requestAnimationFrame(() => chat.element.querySelector<HTMLElement>(".chat-input")?.focus());
  }, "vibe-new-button");
  const chatsLabel = document.createElement("span");
  chatsLabel.className = "vibe-nav-label vibe-rail-only";
  chatsLabel.textContent = "Chats & tasks";
  const chatsButton = railAction("History", "M3 2.5h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6l-3.5 2v-2H3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM5 6h6M5 8.5h4", () => {
    chat.element.querySelector<HTMLButtonElement>('[data-chat-action="history"]')?.click();
  }, "vibe-chats-button");
  chatsButton.setAttribute("aria-controls", "chat-history-panel");
  chatsButton.setAttribute("aria-expanded", "false");
  new MutationObserver(() => {
    chatsButton.setAttribute("aria-expanded", chat.element.dataset["historyOpen"] ?? "false");
  }).observe(chat.element, { attributes: true, attributeFilter: ["data-history-open"] });
  const tasksButton = railAction("Tasks & agents", "M3.5 3.5h9v9h-9zM6 1.5v4M10 1.5v4M6 7.5l1 1 2-2M6 11h4", () => deps.run("workspace.tasks"), "vibe-tasks-button");
  const chatAction = (action: string): void => {
    chat.element.querySelector<HTMLButtonElement>(`[data-chat-action="${action}"]`)?.click();
  };
  const modelsButton = railAction("Models", "M2.5 4h11v8h-11zM5 6.5h6M5 9h4", () => chatAction("models"), "vibe-models-button");
  const controlsButton = railAction("Tools & skills", "M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z", () => chatAction("controls"), "vibe-controls-button");
  const inspectorButton = railAction("Inspector", "M3 2.5h10v11H3zM5.5 5h5M5.5 7.5h5M5.5 10h3", () => chatAction("inspector"), "vibe-inspector-button");
  inspectorButton.setAttribute("aria-controls", "chat-inspector-panel");
  const shareButton = railAction("Share", "M8 10V2M5.5 4.5 8 2l2.5 2.5M3 9.5v3h10v-3", () => chatAction("share"), "vibe-share-button");
  const chatActionButtons = [
    ["inspector", inspectorButton],
    ["controls", controlsButton],
  ] as const;
  const syncChatActions = (): void => {
    for (const [action, button] of chatActionButtons) {
      const source = chat.element.querySelector<HTMLButtonElement>(`[data-chat-action="${action}"]`);
      button.setAttribute("aria-expanded", source?.getAttribute("aria-expanded") ?? "false");
    }
    const source = chat.element.querySelector<HTMLButtonElement>('[data-chat-action="share"]');
    const label = source?.textContent?.trim() || "Share";
    const text = shareButton.querySelector("span");
    if (text) text.textContent = label;
    shareButton.setAttribute("aria-label", label === "Share" ? "Copy conversation as markdown" : label);
  };
  for (const [action] of chatActionButtons) {
    const source = chat.element.querySelector<HTMLButtonElement>(`[data-chat-action="${action}"]`);
    if (source) new MutationObserver(syncChatActions).observe(source, { attributes: true, attributeFilter: ["aria-expanded"] });
  }
  const sourceShare = chat.element.querySelector<HTMLButtonElement>('[data-chat-action="share"]');
  if (sourceShare) new MutationObserver(syncChatActions).observe(sourceShare, { childList: true });
  syncChatActions();
  const toolbarSpacer = document.createElement("span");
  toolbarSpacer.className = "vibe-toolbar-spacer vibe-rail-only";
  const sponsoredSlot = document.createElement("div");
  sponsoredSlot.id = "vibe-sponsored-slot";
  sponsoredSlot.className = "vibe-sponsored-slot";
  sponsoredSlot.setAttribute("aria-live", "polite");
  const earningsButton = railAction("Earnings", ICON.earnings, () => document.getElementById("open-earnings")?.click(), "vibe-earnings-button");
  const settingsButton = railAction("Settings", "M8 2.5l1.1.4.9-.8 1.6 1-.3 1.1 1 .7v1.9l-1 .7.3 1.1-1.6 1-.9-.8-1.1.4L8 13.5l-1.1-.4-.9.8-1.6-1 .3-1.1-1-.7V9l1-.7-.3-1.1 1.6-1 .9.8zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z", () => deps.run("settings.open"), "vibe-settings-button");
  const switcher = document.createElement("div");
  switcher.className = "workspace-mode-switch";
  switcher.setAttribute("role", "group");
  switcher.setAttribute("aria-label", "Working mode");
  const modeButtons = new Map<WorkspaceMode, HTMLButtonElement>();
  for (const id of ["vibe", "code"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset["mode"] = id;
    button.textContent = id === "vibe" ? "Vibe" : "Code";
    button.prepend(createIcon(id === "vibe" ? "M8 2 9.5 6.5 14 8 9.5 9.5 8 14 6.5 9.5 2 8 6.5 6.5z" : "M5 4 1 8l4 4M11 4l4 4-4 4M9 2 7 14"));
    button.title = MODE_DESCRIPTION[id];
    button.addEventListener("click", () => setMode(id, true));
    switcher.append(button);
    modeButtons.set(id, button);
  }
  const help = createHelpPopover(document.body);
  const modeHelp = document.createElement("button");
  modeHelp.type = "button";
  modeHelp.className = "context-help";
  modeHelp.textContent = "?";
  modeHelp.setAttribute("aria-label", "About Vibe and Code modes");
  modeHelp.addEventListener("click", () => help.show(modeHelp, {
    id: "workspace.modes", title: "One project. Two ways to work.",
    plain: "Vibe puts your conversation first. Code puts your editor first.",
    why: "Switch at any time. Your conversation, unsaved files, running terminals and preview stay with you.",
    how: "Open a file to work in Code. Use Vibe to return to the same AI session.",
    group: "workbench", settingIds: [], related: [],
  }));
  toolbar.append(switcher, modeHelp);
  const project = document.createElement("button");
  project.className = "project-toolbar-name";
  project.title = "Show project files";
  const projectIcon = createIcon("M2 4.5h4l1.5 2H14v7H2z");
  const projectName = document.createElement("span");
  project.append(projectIcon, projectName);
  project.addEventListener("click", deps.showFiles);
  const subtitle = document.getElementById("sidebar-subtitle");
  const updateProject = (): void => { projectName.textContent = deps.projectRoot()?.split(/[\\/]/).pop() || "Open a project"; };
  if (subtitle) new MutationObserver(updateProject).observe(subtitle, { childList: true, characterData: true, subtree: true });
  updateProject();
  toolbar.append(project);
  const search = document.getElementById("command-centre-slot");
  if (search) toolbar.append(search);
  const contextButton = document.createElement("button");
  contextButton.className = "project-toolbar-action vibe-context-button";
  contextButton.textContent = "Context";
  contextButton.prepend(createIcon("M3 3.5h10v9H3zM5.5 6h5M5.5 8h5M5.5 10h3"));
  contextButton.title = "Project, changes and saved tasks";
  contextButton.addEventListener("click", () => {
    contextOpen = !contextOpen;
    mountPresentation();
  });
  const preview = document.createElement("button");
  preview.className = "project-toolbar-action vibe-preview-button";
  preview.textContent = "Preview";
  preview.prepend(createIcon("M2.5 3.5h11v8h-11zM5 14h6"));
  preview.addEventListener("click", deps.openPreview);
  const terminalButton = document.createElement("button");
  terminalButton.className = "project-toolbar-action code-toolbar-action code-terminal-button";
  terminalButton.append(createIcon("M2 3h12v10H2zM4.5 5.5 7 8l-2.5 2.5M8 10.5h3"), document.createTextNode("Terminal"));
  terminalButton.title = "Toggle terminal";
  terminalButton.addEventListener("click", deps.toggleTerminal);
  const assistantButton = document.createElement("button");
  assistantButton.className = "project-toolbar-action code-toolbar-action code-assistant-button";
  assistantButton.append(createIcon("M8 2l1.5 4.5L14 8l-4.5 1.5L8 14 6.5 9.5 2 8l4.5-1.5z"), document.createTextNode("Assistant"));
  assistantButton.title = "Show AI assistant beside code";
  assistantButton.setAttribute("aria-controls", "assistant-dock");
  assistantButton.addEventListener("click", () => codeAssistantOpen && !contextOpen ? close() : open());
  const more = document.createElement("button");
  more.className = "project-toolbar-action project-tools";
  more.textContent = "⋯";
  more.title = "More tools";
  more.setAttribute("aria-label", "More tools");
  more.setAttribute("aria-haspopup", "menu");
  more.setAttribute("aria-expanded", "false");
  const toolsMenu = createContextMenu(document.body);
  // The fixed toolbar does not move when an editor or chat textarea scrolls.
  attachContextMenuDismissal(toolsMenu, () => more.focus(), false);
  more.addEventListener("click", () => {
    const rect = more.getBoundingClientRect();
    more.setAttribute("aria-expanded", "true");
    toolsMenu.open(rect.right, rect.bottom + 4, [
      { label: "Files", run: deps.showFiles },
      { label: "Search in files", run: () => deps.run("view.search") },
      { label: "Source control", run: () => deps.run("view.scm") },
      { label: "Terminal", run: deps.toggleTerminal },
      { label: "Project context", run: () => { contextOpen = !contextOpen; mountPresentation(); } },
      { kind: "separator" },
      { label: "AI assistant", run: open },
      { label: "Tasks & agents", run: () => deps.run("workspace.tasks") },
      { label: "Review changes", run: () => deps.run("workspace.changes") },
      { kind: "separator" },
      { label: "Earnings", run: () => document.getElementById("open-earnings")?.click() },
      { label: "Settings", run: () => deps.run("settings.open") },
      { label: "All features", run: () => document.getElementById("open-features")?.click() },
    ], () => more.setAttribute("aria-expanded", "false"));
  });
  toolbar.append(
    preview,
    contextButton,
    terminalButton,
    assistantButton,
    more,
    workspaceLabel,
    newButton,
    chatsLabel,
    chatsButton,
    tasksButton,
    modelsButton,
    controlsButton,
    inspectorButton,
    shareButton,
    toolbarSpacer,
    sponsoredSlot,
    earningsButton,
    settingsButton,
  );
  workbench.before(toolbar);
  const hint = document.createElement("div");
  hint.className = "workspace-first-hint";
  hint.setAttribute("role", "note");
  const hintText = document.createElement("span");
  const dismissHint = document.createElement("button");
  dismissHint.type = "button";
  dismissHint.textContent = "Got it";
  dismissHint.setAttribute("aria-label", "Dismiss mode hint");
  dismissHint.addEventListener("click", () => {
    try { localStorage.setItem(`adcode.hint.${mode}.v1`, "seen"); } catch { /* Optional storage. */ }
    hint.hidden = true;
    document.body.dataset["modeHint"] = "false";
  });
  hint.append(hintText, dismissHint);
  workbench.before(hint);
  const brand = document.createElement("span");
  brand.className = "workbench-brand";
  brand.textContent = "ADCode";
  document.getElementById("titlebar")?.prepend(brand);
  document.body.dataset["agentWorkbench"] = "true";

  function showDock(show: boolean): void {
    dock.hidden = !show;
    divider.hidden = !show;
    workbench.dataset["assistantOpen"] = String(show);
    document.getElementById("ai-toggle")?.setAttribute("aria-expanded", String(show));
    assistantButton.setAttribute("aria-pressed", String(show && mode === "code" && !contextOpen));
  }
  function open(): void {
    if (!docked) { deps.openExpanded(); return; }
    if (mode === "vibe") {
      if (contextOpen && window.innerWidth < 1280) { contextOpen = false; mountPresentation(); }
      chat.shown();
      chat.element.querySelector<HTMLElement>(".chat-input")?.focus();
      return;
    }
    contextOpen = false;
    codeAssistantOpen = true;
    mountPresentation();
    showDock(true);
    chat.shown();
  }
  function close(): void {
    if (!docked) { deps.closeExpanded(); return; }
    if (mode === "vibe") { setMode("code", true); return; }
    codeAssistantOpen = false;
    contextOpen = false;
    deps.context.setVisible(false);
    contextButton.setAttribute("aria-pressed", "false");
    showDock(false);
    chat.hidden();
  }
  function mountDock(): void {
    sidebar.dataset["agents"] = "false";
    (mode === "vibe" ? vibe : dock).append(chat.element);
    chat.setDocked(true);
    const presentation = chat.element.querySelector<HTMLButtonElement>(".chat-presentation");
    if (presentation && mode === "vibe") {
      presentation.title = "Move this conversation beside your code";
      presentation.setAttribute("aria-label", presentation.title);
    }
    const close = chat.element.querySelector<HTMLButtonElement>('[aria-label="Close Assistant"]');
    if (close) close.hidden = mode === "vibe";
  }
  function mountPresentation(): void {
    vibe.hidden = mode !== "vibe";
    if (!docked) return;
    mountDock();
    const showingContext = contextOpen;
    workbench.dataset["contextOpen"] = String(showingContext);
    if (showingContext) dock.append(deps.context.element);
    deps.context.element.hidden = !showingContext;
    chat.element.hidden = mode === "code" && showingContext;
    deps.context.setVisible(showingContext);
    contextButton.setAttribute("aria-pressed", String(showingContext));
    showDock(mode === "vibe" ? showingContext : codeAssistantOpen || showingContext);
    if (mode === "vibe" || codeAssistantOpen) chat.shown(false);
    else chat.hidden();
  }
  function setMode(next: WorkspaceMode, focus = false): void {
    if (!docked) { deps.closeExpanded(); docked = true; }
    const changed = mode !== next;
    mode = next;
    if (changed) codeAssistantOpen = false;
    document.body.dataset["workspaceMode"] = mode;
    contextButton.hidden = mode === "code";
    for (const [id, button] of modeButtons) button.setAttribute("aria-pressed", String(mode === id));
    if (changed) contextOpen = false;
    deps.layoutChanged();
    hintText.textContent = mode === "vibe"
      ? "Describe what to build or change. Use Context → Changes to review the result."
      : "Open a file from Explorer. Use search above to find files and commands.";
    try { hint.hidden = localStorage.getItem(`adcode.hint.${mode}.v1`) === "seen"; } catch { hint.hidden = false; }
    document.body.dataset["modeHint"] = String(!hint.hidden);
    try { localStorage.setItem(MODE_STORAGE_KEY, mode); } catch { /* Optional storage. */ }
    mountPresentation();
    if (focus) requestAnimationFrame(() => {
      if (mode === "vibe") chat.element.querySelector<HTMLElement>(".chat-input")?.focus();
      else deps.focusEditor();
    });
  }
  setMode(mode);
  let previousWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if ((previousWidth >= 1080 && window.innerWidth < 1080) || (previousWidth >= 1280 && window.innerWidth < 1280)) {
      contextOpen = false;
      if (window.innerWidth < 1080) codeAssistantOpen = false;
      mountPresentation();
    }
    previousWidth = window.innerWidth;
  });
  return {
    open, close,
    setMode,
    mode: () => mode,
    accommodatePreview(): void {
      if (mode !== "vibe" || !dockedPreviewOpen() || !contextOpen) return;
      contextOpen = false;
      mountPresentation();
    },
    showContext(tab: ContextTab): void {
      if (!docked) setMode(mode);
      contextOpen = true;
      mountPresentation();
      deps.context.show(tab);
    },
    isDocked: () => docked,
    togglePresentation(): void {
      if (docked) {
        if (mode === "vibe") { setMode("code", true); open(); return; }
        showDock(false);
        chat.hidden();
        docked = false;
        sidebar.dataset["agents"] = "false";
        chat.setDocked(false);
        deps.expandedHost.append(chat.element);
        chat.element.hidden = false;
        deps.openExpanded();
      } else {
        deps.closeExpanded();
        docked = true;
        mountPresentation();
        open();
      }
    },
  };
}
