import type { ChatWidget } from "../ai/chatWidget.ts";
import { createSplitter } from "./splitter.ts";
import type { WorkspaceMode } from "./workspaceMode.ts";
import type { createProjectContext, ContextTab } from "./projectContext.ts";
import { createIcon } from "./icons.ts";
import { createContextMenu, attachContextMenuDismissal, type ContextMenuNode } from "./contextMenu.ts";
import { createVibeSidebar, type VibeSidebar } from "./vibeSidebar.ts";
import { createVibePages } from "./vibePages.ts";
import { createFloatingPanel, type FloatingPanel } from "./floatingPanel.ts";
import type { VibePage } from "./vibeSidebarModel.ts";

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
  readonly run: (command: string, arg?: string) => void;
  readonly projectRoot: () => string | null;
  readonly layoutChanged: () => void;
  readonly openNotifications: () => void;
  readonly onUnreadNotifications: (listener: (count: number) => void) => void;
  readonly onEarnings: (listener: (label: string) => void) => void;
}

const contextTitle = (tab: ContextTab): string => tab === "changes" ? "Changes" : "Project overview";

/**
 * Reparent the live widget: streams, proposals and conversations keep one owner.
 *
 * Nothing docks on the right any more. In Vibe the conversation is the Chat page; in the IDE
 * it is a floating panel over the editor. Changes and the project overview open as a
 * floating panel in both windows, so the editor and the conversation keep the full width.
 */
export function createAssistantDock(deps: AssistantDockDeps) {
  const { chat, workbench, sidebar } = deps;
  let docked = true;
  const windowMode: WorkspaceMode = window.location.hash === "#/ide" ? "code" : "vibe";
  let mode: WorkspaceMode = windowMode;
  let codeAssistantOpen = false;
  let contextOpen = false;
  const vibe = document.createElement("section");
  vibe.className = "vibe-workspace assistant-dock";
  vibe.id = "vibe-workspace";
  vibe.setAttribute("aria-label", "Vibe project session");
  document.getElementById("editor-area")?.append(vibe);
  // Chat, Agents and Tools share the centre; only one shows at a time.
  const pages = createVibePages();
  vibe.append(pages.element);
  // Changes and the project overview: a floating panel, never a right-hand column.
  const contextPanel = createFloatingPanel({
    id: "context",
    title: "Changes",
    content: deps.context.element,
    // Wide enough for the Changes list: a path, its line counts, a revert arrow and a checkbox.
    defaultSize: { width: 560, height: 640 },
    anchor: "centre",
    onVisibilityChange: (open) => {
      if (open || !contextOpen) return;
      // Closed from its own header or Escape.
      contextOpen = false;
      deps.context.setVisible(false);
      syncContextState();
    },
  });
  // The panel's own tabs switch between the overview and Changes; the title follows them.
  deps.context.element.addEventListener("click", () => contextPanel.setTitle(contextTitle(deps.context.selected())));
  // The IDE's assistant floats over the editor instead of taking a column beside it.
  const assistantHost = document.createElement("div");
  assistantHost.className = "floating-assistant-host";
  const assistantPanel: FloatingPanel | null = windowMode === "code"
    ? createFloatingPanel({
      id: "assistant",
      title: "Assistant",
      content: assistantHost,
      defaultSize: { width: 420, height: 560 },
      anchor: "bottom-right",
      className: "assistant-dock",
      onVisibilityChange: (open) => {
        if (open || !codeAssistantOpen) return;
        codeAssistantOpen = false;
        chat.hidden();
        syncAssistantChrome();
      },
    })
    : null;

  const toolbar = document.createElement("div");
  toolbar.className = "project-toolbar";
  toolbar.setAttribute("aria-label", "Project and layout");
  toolbar.dataset["windowRole"] = windowMode;
  const chatAction = (action: string): void => {
    chat.element.querySelector<HTMLButtonElement>(`[data-chat-action="${action}"]`)?.click();
  };
  const search = document.getElementById("command-centre-slot");

  const more = document.createElement("button");
  more.type = "button";
  more.className = "project-toolbar-action project-tools";
  more.textContent = "⋯";
  more.title = "More tools";
  more.setAttribute("aria-label", "More tools");
  more.setAttribute("aria-haspopup", "menu");
  more.setAttribute("aria-expanded", "false");
  const toolsMenu = createContextMenu(document.body);
  // The fixed toolbar does not move when an editor or chat textarea scrolls.
  attachContextMenuDismissal(toolsMenu, () => more.focus(), false);
  const earnings = (): void => deps.run("view.earnings");
  const allFeatures = (): void => { document.getElementById("open-features")?.click(); };
  // Vibe's sidebar already shows its workflows, so its menu is only the less frequent
  // routes, grouped by what they act on. Code keeps the list its users learned.
  const vibeTools = (): readonly ContextMenuNode[] => [
    { kind: "heading", label: "Project" },
    { label: "Browse files in the IDE", run: () => deps.run("view.explorer") },
    { label: "Search in files", run: () => deps.run("view.search") },
    { label: "Source control", run: () => deps.run("view.scm") },
    { label: "Terminal", accelerator: "Ctrl+`", run: deps.toggleTerminal },
    { label: "Project overview", run: () => showContext("project") },
    { kind: "heading", label: "Assistant" },
    { label: "Models & connections", run: () => deps.run("ai.connect") },
    { label: "Set up AI team", run: () => chat.openTeamSetup() },
    { label: "Team, schedules and activity", run: () => chatAction("inspector") },
    { label: "Copy conversation as Markdown", run: () => chatAction("share") },
    { kind: "heading", label: "ADCode" },
    { label: "Earnings", run: earnings },
    { label: "Settings", accelerator: "Ctrl+,", run: () => deps.run("settings.open") },
    { label: "All features", run: allFeatures },
  ];
  const codeTools = (): readonly ContextMenuNode[] => [
    { label: "Preview app", run: deps.openPreview },
    { label: "Files", run: deps.showFiles },
    { label: "Search in files", run: () => deps.run("view.search") },
    { label: "Source control", run: () => deps.run("view.scm") },
    { label: "Terminal", run: deps.toggleTerminal },
    { label: "Project overview", run: () => toggleContext("project") },
    { kind: "separator" },
    { label: "AI assistant", run: open },
    { label: "Agents", run: () => deps.run("agents.open") },
    { label: "Tools", run: () => deps.run("tools.open") },
    { label: "Set up AI team", run: () => chat.openTeamSetup() },
    { label: "Changes", run: () => deps.run("workspace.changes") },
    { kind: "separator" },
    { label: "Earnings", run: earnings },
    { label: "Settings", run: () => deps.run("settings.open") },
    { label: "All features", run: allFeatures },
  ];
  let moreWasOpen = false;
  more.addEventListener("pointerdown", () => { moreWasOpen = toolsMenu.isOpen(); });
  more.addEventListener("click", () => {
    if (moreWasOpen) { moreWasOpen = false; return; }
    const rect = more.getBoundingClientRect();
    more.setAttribute("aria-expanded", "true");
    // Opened beside a rail button, the menu should read downwards from it; from the top
    // bar's right edge it should hang to the left.
    const inRail = windowMode === "vibe" && document.body.dataset["vibeRail"] === "docked";
    toolsMenu.open(inRail ? rect.right + 4 : rect.right, inRail ? rect.top : rect.bottom + 4,
      windowMode === "vibe" ? vibeTools() : codeTools(),
      () => more.setAttribute("aria-expanded", "false"));
  });

  let vibeSidebar: VibeSidebar | null = null;
  const assistantButton = document.createElement("button");
  if (windowMode === "code") {
    const project = document.createElement("button");
    project.className = "project-toolbar-name";
    project.title = "Show project files";
    const projectName = document.createElement("span");
    project.append(createIcon("M2 4.5h4l1.5 2H14v7H2z"), projectName);
    project.addEventListener("click", deps.showFiles);
    const updateProject = (): void => { projectName.textContent = deps.projectRoot()?.split(/[\\/]/).pop() || "Open a project"; };
    const subtitle = document.getElementById("sidebar-subtitle");
    if (subtitle) new MutationObserver(updateProject).observe(subtitle, { childList: true, characterData: true, subtree: true });
    updateProject();
    const vibeButton = document.createElement("button");
    vibeButton.type = "button";
    vibeButton.className = "project-toolbar-action code-toolbar-action code-vibe-button";
    vibeButton.append(createIcon("M8 2 9.5 6.5 14 8 9.5 9.5 8 14 6.5 9.5 2 8 6.5 6.5z"), document.createTextNode("Vibe"));
    vibeButton.title = "Open Vibe window";
    vibeButton.addEventListener("click", () => void window.adcode.window.openVibe());
    const terminalButton = document.createElement("button");
    terminalButton.className = "project-toolbar-action code-toolbar-action code-terminal-button";
    terminalButton.append(createIcon("M2 3h12v10H2zM4.5 5.5 7 8l-2.5 2.5M8 10.5h3"), document.createTextNode("Terminal"));
    terminalButton.title = "Toggle terminal";
    terminalButton.addEventListener("click", deps.toggleTerminal);
    assistantButton.className = "project-toolbar-action code-toolbar-action code-assistant-button";
    assistantButton.append(createIcon("M8 2l1.5 4.5L14 8l-4.5 1.5L8 14 6.5 9.5 2 8l4.5-1.5z"), document.createTextNode("Assistant"));
    assistantButton.title = "Show the AI assistant over the code (Ctrl+I)";
    assistantButton.setAttribute("aria-controls", "floating-assistant");
    assistantButton.addEventListener("click", () => codeAssistantOpen ? close() : open());
    const agentsButton = document.createElement("button");
    agentsButton.type = "button";
    agentsButton.className = "project-toolbar-action code-toolbar-action code-agents-button";
    agentsButton.append(createIcon("M5.5 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM11 7.5a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM2 13c0-2 1.6-3.5 3.5-3.5S9 11 9 13M9.8 10.1c.4-.3.8-.4 1.2-.4 1.4 0 2.5 1.1 2.5 2.6"), document.createTextNode("Agents"));
    agentsButton.title = "Agents working in parallel, and your saved agents";
    agentsButton.addEventListener("click", () => deps.run("agents.open"));
    toolbar.append(project, ...(search ? [search] : []), vibeButton, terminalButton, agentsButton, assistantButton, more);
  } else {
    vibeSidebar = createVibeSidebar({
      chat,
      run: deps.run,
      projectRoot: deps.projectRoot,
      search,
      more,
      toggleContext,
      showContext,
      togglePreview: deps.openPreview,
      showPage: (page) => pages.show(page),
      onPageChange: (listener) => pages.onChange(listener),
      openNotifications: deps.openNotifications,
      onUnreadNotifications: deps.onUnreadNotifications,
      onEarnings: deps.onEarnings,
      onLayoutChange: () => { mountDock(); deps.layoutChanged(); },
    });
    toolbar.append(vibeSidebar.topbar, vibeSidebar.element);
    const subtitle = document.getElementById("sidebar-subtitle");
    if (subtitle) new MutationObserver(() => vibeSidebar?.refresh()).observe(subtitle, { childList: true, characterData: true, subtree: true });
    const previewPane = document.querySelector<HTMLElement>(".preview-pane");
    const syncPreview = (): void => vibeSidebar?.setPreviewOpen(previewPane !== null && !previewPane.hidden);
    if (previewPane) new MutationObserver(syncPreview).observe(previewPane, { attributes: true, attributeFilter: ["hidden"] });
    syncPreview();
  }
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
  // The Vibe rail is a fixed sidebar on wide screens - resizable like the rest
  // of the workbench, with its width on the body so both the rail and the
  // offset content read the same value.
  const RAIL_KEY = "adcode.vibe.rail.width";
  let railWidth = 272;
  try { railWidth = Math.max(232, Math.min(400, Number(localStorage.getItem(RAIL_KEY)) || 272)); } catch { /* Optional storage. */ }
  document.body.style.setProperty("--vibe-rail-width", `${railWidth}px`);
  const railSplitter = document.createElement("div");
  railSplitter.id = "vibe-rail-splitter";
  document.body.append(railSplitter);
  createSplitter({
    element: railSplitter, axis: "x", sign: 1, label: "Resize vibe sidebar", reset: 272,
    current: () => railWidth,
    apply: (value) => {
      railWidth = Math.max(232, Math.min(400, window.innerWidth * 0.4, value));
      document.body.style.setProperty("--vibe-rail-width", `${railWidth}px`);
    },
    commit: () => {
      try { localStorage.setItem(RAIL_KEY, String(railWidth)); } catch { /* Optional storage. */ }
    },
  });
  const brand = document.createElement("span");
  brand.className = "workbench-brand";
  brand.textContent = "ADCode";
  document.getElementById("titlebar")?.prepend(brand);
  document.body.dataset["agentWorkbench"] = "true";

  function syncContextState(): void {
    vibeSidebar?.setContextTab(contextOpen ? deps.context.selected() : null);
  }
  /** The title bar's assistant button and the toolbar's say whether the IDE assistant is up. */
  function syncAssistantChrome(): void {
    const shown = mode === "code" && codeAssistantOpen;
    // Nothing reserves a grid column any more; these stay false so no stale rule applies.
    workbench.dataset["assistantOpen"] = "false";
    workbench.dataset["contextOpen"] = "false";
    document.getElementById("ai-toggle")?.setAttribute("aria-expanded", String(shown));
    assistantButton.setAttribute("aria-pressed", String(shown));
  }
  function open(): void {
    if (!docked) { deps.openExpanded(); return; }
    if (mode === "vibe") {
      pages.show("chat");
      chat.shown();
      chat.element.querySelector<HTMLElement>(".chat-input")?.focus();
      return;
    }
    codeAssistantOpen = true;
    mountPresentation();
    chat.shown();
  }
  function close(): void {
    if (!docked) { deps.closeExpanded(); return; }
    if (mode === "vibe") {
      if (contextOpen) {
        contextOpen = false;
        mountPresentation();
      }
      return;
    }
    codeAssistantOpen = false;
    mountPresentation();
    chat.hidden();
  }
  function mountDock(): void {
    sidebar.dataset["agents"] = "false";
    if (mode === "vibe") pages.host("chat").append(chat.element);
    else assistantHost.append(chat.element);
    // In Vibe the conversation list always lives in the sidebar - docked or in the drawer.
    chat.setDocked(true, mode === "vibe" ? vibeSidebar?.historyHost : undefined);
    // The floating panel has its own close button; a second one inside it would be noise.
    const close = chat.element.querySelector<HTMLButtonElement>('[aria-label="Close Assistant"]');
    if (close) close.hidden = true;
  }
  function mountPresentation(): void {
    vibe.hidden = mode !== "vibe";
    if (!docked) return;
    mountDock();
    chat.element.hidden = false;
    deps.context.element.hidden = false;
    if (contextOpen) contextPanel.open();
    else contextPanel.close();
    deps.context.setVisible(contextOpen);
    if (assistantPanel !== null) {
      if (mode === "code" && codeAssistantOpen) assistantPanel.open();
      else assistantPanel.close();
    }
    syncAssistantChrome();
    if (mode === "vibe" || codeAssistantOpen) chat.shown(false);
    else chat.hidden();
    syncContextState();
  }
  function showContext(tab: ContextTab): void {
    if (!docked) setMode(mode);
    contextOpen = true;
    contextPanel.setTitle(contextTitle(tab));
    mountPresentation();
    contextPanel.raise();
    deps.context.show(tab);
    syncContextState();
  }
  /** A sidebar row that opens a context tab closes it again when that tab is showing. */
  function toggleContext(tab: ContextTab): void {
    if (contextOpen && deps.context.selected() === tab) {
      contextOpen = false;
      mountPresentation();
      return;
    }
    showContext(tab);
  }
  // The first setMode call below settles the restored mode before first paint;
  // only later, user-initiated switches animate.
  let modeSettled = false;

  /**
   * Ease the newly shown surface in after a mode switch.
   *
   * Swapping Vibe and Code reparents the live chat, flips the toolbar between a
   * rail and a top bar, and shows and hides whole regions in one frame - that
   * single-frame jump is the shutter. A short fade-and-rise over the incoming
   * surface masks it. Transform and opacity only (§1), via the Web Animations
   * API so there is no class to clean up and nothing to transition back.
   */
  function playModeEnter(next: WorkspaceMode): void {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    } catch {
      return;
    }
    const surface = next === "vibe" ? vibe : workbench.querySelector<HTMLElement>(":scope > .main");
    const targets: readonly (HTMLElement | null)[] = [
      document.querySelector<HTMLElement>(".project-toolbar"),
      surface,
    ];
    for (const target of targets) {
      if (target === null || typeof target.animate !== "function") continue;
      target.animate(
        [
          { opacity: "0", transform: "translateY(6px)" },
          { opacity: "1", transform: "translateY(0)" },
        ],
        { duration: 220, easing: "ease-out" },
      );
    }
  }

  function setMode(next: WorkspaceMode, focus = false): void {
    if (next !== windowMode) {
      void (next === "code" ? window.adcode.window.openIde() : window.adcode.window.openVibe());
      return;
    }
    if (!docked) { deps.closeExpanded(); docked = true; }
    const changed = mode !== next;
    mode = next;
    if (changed) codeAssistantOpen = false;
    document.body.dataset["workspaceMode"] = mode;
    if (changed) contextOpen = false;
    deps.layoutChanged();
    hintText.textContent = mode === "vibe"
      ? "Describe what to build or change - edits land as it works, and Undo in the chat takes any turn back."
      : "Open a file from Explorer. Use search above to find files and commands.";
    try { hint.hidden = localStorage.getItem(`adcode.hint.${mode}.v1`) === "seen"; } catch { hint.hidden = false; }
    document.body.dataset["modeHint"] = String(!hint.hidden);
    mountPresentation();
    if (modeSettled && changed) playModeEnter(mode);
    modeSettled = true;
    if (focus) requestAnimationFrame(() => {
      if (mode === "vibe") chat.element.querySelector<HTMLElement>(".chat-input")?.focus();
      else deps.focusEditor();
    });
  }
  setMode(mode);
  return {
    open, close,
    setMode,
    mode: () => mode,
    /** Vibe only: switch the centre to Chat, Agents or Tools. */
    showPage(page: VibePage): void { pages.show(page); },
    page: () => pages.current(),
    onPageChange: (listener: (page: VibePage) => void) => pages.onChange(listener),
    /** Where the Agents and Tools pages mount their content in Vibe. */
    pageHost: (page: VibePage) => pages.host(page),
    /** Preview and the panels all float now, so there is no column to make room in. */
    accommodatePreview(): void {},
    showContext,
    /** Ctrl+B in Vibe: hide or show the sidebar instead of opening the IDE's explorer. */
    toggleVibeSidebar(): void { vibeSidebar?.toggle(); },
    revealHistory(): void { vibeSidebar?.revealHistory(); },
    isDocked: () => docked,
    togglePresentation(): void {
      if (docked) {
        if (mode === "vibe") { setMode("code", true); open(); return; }
        codeAssistantOpen = false;
        assistantPanel?.close();
        syncAssistantChrome();
        chat.hidden();
        docked = false;
        sidebar.dataset["agents"] = "false";
        chat.setDocked(false);
        // Expanded, the chat is a popup of its own with no panel around it: it needs its Close.
        const closeControl = chat.element.querySelector<HTMLButtonElement>('[aria-label="Close Assistant"]');
        if (closeControl) closeControl.hidden = false;
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
