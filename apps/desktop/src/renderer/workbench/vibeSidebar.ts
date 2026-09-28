/**
 * The Vibe window's sidebar: one place to start, switch project, and see what needs you.
 *
 * It replaced a rail where most workflows were `display: none` and reachable only through a
 * fourteen-item "Tools" menu. Everything a Vibe user does often now has a visible row, and
 * the row that can be waiting on the user - Changes - carries a live badge,
 * because a conversation-first window hides the editor that would otherwise show it.
 *
 * The sidebar has two presentations and one DOM:
 *  - docked: a fixed rail beside the conversation, resizable, on windows wide enough;
 *  - compact: a slim top bar with the same sidebar as a slide-in drawer, on narrow windows
 *    or when the user collapses the rail with Ctrl+B.
 * Both are driven by `data-vibe-rail` / `data-vibe-drawer` on <body>. Sponsored cards are
 * not part of it: in Vibe they arrive top-right, with every other notification.
 */
import type { ChatWidget } from "../ai/chatWidget.ts";
import type { AiWorkspaceTaskView, GitStatusView } from "../../shared/api.ts";
import type { ContextTab } from "./projectContext.ts";
import { createIcon, ICON } from "./icons.ts";
import { attachContextMenuDismissal, createContextMenu, type ContextMenu, type ContextMenuNode } from "./contextMenu.ts";
import { describeVibeProject, projectName, recentProjectsFor, summarizeVibeChanges, VIBE_PAGES, type VibePage } from "./vibeSidebarModel.ts";
import { GIT_CHANGED_EVENT } from "./changesView.ts";

/** Below this width the rail would squeeze the conversation, so it becomes a drawer. */
export const VIBE_DOCK_MIN_WIDTH = 1120;
const COLLAPSED_KEY = "adcode.vibe.rail.collapsed";
/** Git status is cheap but not free; changes made outside ADCode surface within this. */
const POLL_MS = 20_000;

const PATH = {
  menu: "M2.5 4h11M2.5 8h11M2.5 12h11",
  folder: "M2 4.5h4l1.5 2H14v7H2z",
  chevron: "M5 6.5 8 9.5l3-3",
  changes: "M3.5 2.5h6l3 3v8h-9zM6 7.5h4M8 5.5v4M6 11h4",
  preview: "M2.5 3.5h11v8h-11zM5 14h6",
  automations: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3.2l2 1.3",
  chat: "M2.5 3.5h11v7.5h-6l-3 2.5V11h-2z",
  agents: "M5.5 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM11 7.5a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM2 13c0-2 1.6-3.5 3.5-3.5S9 11 9 13M9.8 10.1c.4-.3.8-.4 1.2-.4 1.4 0 2.5 1.1 2.5 2.6",
  tools: "M10.6 2.6a3 3 0 0 0-3.1 3.9l-4.9 4.9 2 2 4.9-4.9a3 3 0 0 0 3.9-3.1l-1.9 1.9-1.8-.2-.2-1.8z",
  bell: "M8 2a3 3 0 0 0-3 3v2c0 1-.5 2-1.5 3h9C11.5 9 11 8 11 7V5a3 3 0 0 0-3-3zM6.5 12a1.5 1.5 0 0 0 3 0",
  // The activity bar's gear, scaled from its 24-unit grid to this 16-unit one.
  gear: "M6.89 3.53L7.11 1.87L8.89 1.87L9.11 3.53A4.6 4.6 0 0 1 10.8 4.35L12.25 3.48L13.35 4.87L12.18 6.08A4.6 4.6 0 0 1 12.6 7.92L14.18 8.5L13.79 10.23L12.11 10.07A4.6 4.6 0 0 1 10.93 11.55L11.46 13.15L9.86 13.91L8.94 12.5A4.6 4.6 0 0 1 7.06 12.5L6.14 13.91L4.54 13.15L5.07 11.55A4.6 4.6 0 0 1 3.89 10.07L2.21 10.23L1.82 8.5L3.4 7.92A4.6 4.6 0 0 1 3.82 6.08L2.65 4.87L3.75 3.48L5.2 4.35A4.6 4.6 0 0 1 6.89 3.53ZM8 5.93a2.07 2.07 0 1 0 0 4.14 2.07 2.07 0 0 0 0-4.14z",
  ide: "M5 4.5 1.5 8 5 11.5M11 4.5 14.5 8 11 11.5M9.5 2.5l-3 11",
} as const;

export interface VibeSidebarDeps {
  readonly chat: ChatWidget;
  readonly run: (command: string, arg?: string) => void;
  readonly projectRoot: () => string | null;
  /** The shared search box; it moves between the rail and the compact top bar. */
  readonly search: HTMLElement | null;
  /** The shared "More" button (`.project-tools`); its menu belongs to the dock. */
  readonly more: HTMLButtonElement;
  readonly toggleContext: (tab: Exclude<ContextTab, "project">) => void;
  readonly showContext: (tab: ContextTab) => void;
  readonly togglePreview: () => void;
  /** Switch Vibe's centre to a page. */
  readonly showPage: (page: VibePage) => void;
  readonly onPageChange: (listener: (page: VibePage) => void) => void;
  readonly openNotifications: () => void;
  readonly onUnreadNotifications: (listener: (count: number) => void) => void;
  readonly onEarnings: (listener: (label: string) => void) => void;
  readonly onLayoutChange: () => void;
}

export interface VibeSidebar {
  readonly element: HTMLElement;
  readonly topbar: HTMLElement;
  readonly historyHost: HTMLElement;
  /** Show which context tab is open so Changes reads as pressed. */
  setContextTab(tab: ContextTab | null): void;
  setPreviewOpen(open: boolean): void;
  /** Re-read project, Git and task state for the card and badges. */
  refresh(): void;
  isDocked(): boolean;
  /** Ctrl+B: dock/undock on a wide window, open/close the drawer on a narrow one. */
  toggle(): void;
  /** Make the conversation list visible and focus its search. */
  revealHistory(): void;
  closeDrawer(): void;
}

export function createVibeSidebar(deps: VibeSidebarDeps): VibeSidebar {
  const { chat } = deps;
  const element = document.createElement("div");
  element.className = "vibe-sidebar";
  element.id = "vibe-sidebar";
  element.setAttribute("role", "navigation");
  element.setAttribute("aria-label", "Vibe sidebar");

  let collapsed = false;
  try { collapsed = localStorage.getItem(COLLAPSED_KEY) === "true"; } catch { /* Optional preference. */ }
  let drawerOpen = false;
  let drawerTrigger: HTMLElement | null = null;

  const button = (className: string, label: string, icon: string, run: () => void): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = className;
    control.title = label;
    control.setAttribute("aria-label", label);
    control.append(createIcon(icon));
    control.addEventListener("click", run);
    return control;
  };
  const navItem = (label: string, icon: string, className: string, run: () => void) => {
    const control = button(`vibe-nav-item ${className}`, label, icon, run);
    const text = document.createElement("span");
    text.className = "vibe-nav-text";
    text.textContent = label;
    const badge = document.createElement("span");
    badge.className = "vibe-badge";
    badge.hidden = true;
    control.append(text, badge);
    return { control, badge };
  };
  const setBadge = (item: { control: HTMLButtonElement; badge: HTMLElement }, label: string, text: string, attention: boolean, description: string): void => {
    item.badge.hidden = text === "";
    item.badge.textContent = text;
    item.badge.dataset["attention"] = String(attention);
    const full = `${label} - ${description}`;
    item.control.title = full;
    item.control.setAttribute("aria-label", full);
  };

  /* ── Start ───────────────────────────────────────────────────────────── */

  const newConversation = navItem("New conversation", ICON.plus, "vibe-new-button", () => {
    deps.showPage("chat");
    deps.run("ai.newConversation");
    closeDrawer();
  });
  const shortcut = document.createElement("kbd");
  shortcut.className = "vibe-shortcut";
  shortcut.textContent = "Ctrl+Shift+N";
  newConversation.control.append(shortcut);
  newConversation.control.title = "New conversation (Ctrl+Shift+N)";
  const searchHost = document.createElement("div");
  searchHost.className = "vibe-search-host";
  const head = document.createElement("div");
  head.className = "vibe-sidebar-head";
  head.append(newConversation.control, searchHost);

  /* ── Project switcher ────────────────────────────────────────────────── */

  const projectMenu = createContextMenu(document.body);
  let menuTrigger: HTMLButtonElement | null = null;
  attachContextMenuDismissal(projectMenu, () => menuTrigger?.focus(), false);
  const projectCard = document.createElement("button");
  projectCard.type = "button";
  projectCard.className = "vibe-project-card";
  projectCard.setAttribute("aria-haspopup", "menu");
  projectCard.setAttribute("aria-expanded", "false");
  const cardText = document.createElement("span");
  cardText.className = "vibe-project-text";
  const cardName = document.createElement("strong");
  cardName.className = "vibe-project-name";
  const cardMeta = document.createElement("span");
  cardMeta.className = "vibe-project-meta";
  cardText.append(cardName, cardMeta);
  const cardChevron = createIcon(PATH.chevron);
  cardChevron.classList.add("vibe-project-chevron");
  projectCard.append(createIcon(PATH.folder), cardText, cardChevron);
  wireMenuButton(projectCard, projectMenu, openProjectMenu);

  /* ── Workflows ───────────────────────────────────────────────────────── */

  const changes = navItem("Changes", PATH.changes, "vibe-changes-button", () => { deps.toggleContext("changes"); closeDrawer(); });
  changes.control.setAttribute("aria-controls", "workspace-context-content");
  const preview = navItem("Preview", PATH.preview, "vibe-preview-nav", () => { deps.togglePreview(); closeDrawer(); });
  preview.control.title = "Show the running app in a floating window";
  const automations = navItem("Automations", PATH.automations, "vibe-automations-button", () => { chat.openScheduleComposer(); closeDrawer(); });
  automations.control.title = "Schedule AI messages for this project";
  /* Pages first: Chat, Agents and Tools each fill the centre. The rows after them open
   * floating panels over whichever page is showing. */
  const PAGE_DETAIL: Readonly<Record<VibePage, { icon: string; title: string }>> = {
    chat: { icon: PATH.chat, title: "The conversation with the assistant" },
    agents: { icon: PATH.agents, title: "Agents working in parallel, and your saved agents" },
    tools: { icon: PATH.tools, title: "Built-in tools, MCP servers, skills and project memory" },
  };
  const pageItems = new Map<VibePage, HTMLButtonElement>();
  for (const page of VIBE_PAGES) {
    const item = navItem(page.label, PAGE_DETAIL[page.id].icon, `vibe-page-item vibe-page-${page.id}`, () => {
      deps.showPage(page.id);
      closeDrawer();
    });
    item.control.title = PAGE_DETAIL[page.id].title;
    item.control.dataset["page"] = page.id;
    item.control.setAttribute("aria-controls", `vibe-page-${page.id}`);
    pageItems.set(page.id, item.control);
  }
  function markPage(current: VibePage): void {
    for (const [id, control] of pageItems) {
      if (id === current) control.setAttribute("aria-current", "page");
      else control.removeAttribute("aria-current");
    }
  }
  markPage("chat");
  deps.onPageChange(markPage);
  const pages = document.createElement("div");
  pages.className = "vibe-nav vibe-pages-nav";
  pages.append(...pageItems.values());
  const nav = document.createElement("div");
  nav.className = "vibe-nav";
  nav.append(changes.control, preview.control, automations.control);

  /* ── Conversations ───────────────────────────────────────────────────── */

  const conversationsLabel = document.createElement("h2");
  conversationsLabel.className = "vibe-nav-label vibe-conversations-label";
  conversationsLabel.textContent = "Conversations";
  const historyHost = document.createElement("div");
  historyHost.className = "vibe-history-host";
  // Opening a conversation from the drawer is a navigation; the drawer has done its job.
  historyHost.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest(".chat-history-open")) {
      deps.showPage("chat");
      closeDrawer();
    }
  });
  const conversations = document.createElement("section");
  conversations.className = "vibe-conversations";
  conversations.setAttribute("aria-labelledby", "vibe-conversations-label");
  conversationsLabel.id = "vibe-conversations-label";
  conversations.append(conversationsLabel, historyHost);

  /* ── Footer ──────────────────────────────────────────────────────────── */

  const ide = document.createElement("button");
  ide.type = "button";
  ide.className = "project-toolbar-action vibe-ide-button";
  ide.title = "Open the full IDE in its own window - Vibe stays here";
  ide.setAttribute("aria-label", "Open IDE in a separate window");
  const ideText = document.createElement("span");
  ideText.textContent = "Open IDE";
  const ideExternal = createIcon(ICON.external);
  ideExternal.classList.add("vibe-ide-external");
  ide.append(createIcon(PATH.ide), ideText, ideExternal);
  ide.addEventListener("click", () => { deps.run("workspace.openIde"); closeDrawer(); });

  const notifications = button("vibe-footer-button vibe-notifications-button", "Notifications", PATH.bell, () => deps.openNotifications());
  const unread = document.createElement("span");
  unread.className = "vibe-unread-count";
  unread.hidden = true;
  notifications.append(unread);
  deps.onUnreadNotifications((count) => {
    unread.hidden = count === 0;
    unread.textContent = count > 9 ? "9+" : String(count);
    const label = count === 0 ? "Notifications" : `Notifications, ${count} unread`;
    notifications.setAttribute("aria-label", label);
    notifications.title = label;
  });
  const earnings = button("vibe-footer-button vibe-earnings-button", "Earnings", ICON.earnings, () => deps.run("view.earnings"));
  const earningsAmount = document.createElement("span");
  earningsAmount.className = "vibe-earnings-amount";
  earnings.append(earningsAmount);
  deps.onEarnings((label) => {
    earningsAmount.textContent = label;
    const full = label === "" ? "Earnings" : `Earnings: ${label} available`;
    earnings.title = full;
    earnings.setAttribute("aria-label", full);
  });
  const settings = button("vibe-footer-button vibe-settings-button", "Settings", PATH.gear, () => deps.run("settings.open"));
  deps.more.classList.add("vibe-footer-button");
  const footerRow = document.createElement("div");
  footerRow.className = "vibe-footer-row";
  footerRow.append(notifications, earnings, settings, deps.more);
  const footer = document.createElement("div");
  footer.className = "vibe-rail-footer";
  footer.append(ide, footerRow);

  const main = document.createElement("div");
  main.className = "vibe-rail-main";
  main.append(head, projectCard, pages, nav, conversations);
  element.append(main, footer);

  /* ── Compact top bar ─────────────────────────────────────────────────── */

  const topbar = document.createElement("div");
  topbar.className = "vibe-topbar";
  const menuToggle = button("vibe-topbar-button vibe-sidebar-toggle", "Show sidebar (Ctrl+B)", PATH.menu, () => toggle());
  menuToggle.setAttribute("aria-controls", element.id);
  menuToggle.setAttribute("aria-expanded", "false");
  const topProject = document.createElement("button");
  topProject.type = "button";
  topProject.className = "vibe-topbar-project";
  topProject.setAttribute("aria-haspopup", "menu");
  topProject.setAttribute("aria-expanded", "false");
  const topProjectName = document.createElement("span");
  topProject.append(createIcon(PATH.folder), topProjectName, createIcon(PATH.chevron));
  wireMenuButton(topProject, projectMenu, openProjectMenu);
  const topSearchHost = document.createElement("div");
  topSearchHost.className = "vibe-topbar-search";
  const topPreview = button("vibe-topbar-button vibe-topbar-preview", "Preview", PATH.preview, () => deps.togglePreview());
  topPreview.append(document.createTextNode("Preview"));
  const topIde = button("vibe-topbar-button vibe-topbar-ide", "Open IDE in a separate window", PATH.ide, () => deps.run("workspace.openIde"));
  topIde.append(document.createTextNode("Open IDE"));
  topbar.append(menuToggle, topProject, topSearchHost, topPreview, topIde);

  const scrim = document.createElement("div");
  scrim.className = "vibe-drawer-scrim";
  scrim.addEventListener("click", () => closeDrawer());
  document.body.append(scrim);

  /* ── Menus ───────────────────────────────────────────────────────────── */

  function wireMenuButton(trigger: HTMLButtonElement, menu: ContextMenu, open: (trigger: HTMLButtonElement) => void): void {
    // The menu closes on any outside pointerdown, which includes its own trigger - so
    // without remembering it was open, a second click would reopen instead of closing.
    let wasOpen = false;
    trigger.addEventListener("pointerdown", () => { wasOpen = menu.isOpen() && menuTrigger === trigger; });
    trigger.addEventListener("click", () => {
      if (wasOpen) { wasOpen = false; return; }
      open(trigger);
    });
  }

  async function openProjectMenu(trigger: HTMLButtonElement): Promise<void> {
    const root = deps.projectRoot();
    const recents = await window.adcode.workspace.recents().catch(() => []);
    const others = recentProjectsFor(recents, root);
    const names = others.map((folder) => folder.name);
    const nodes: ContextMenuNode[] = [];
    if (others.length > 0) {
      nodes.push({ kind: "heading", label: "Switch project" });
      for (const folder of others) {
        const parent = folder.path.split(/[\\/]/).filter(Boolean).slice(-2, -1)[0];
        const duplicate = names.filter((name) => name === folder.name).length > 1;
        nodes.push({
          label: duplicate && parent !== undefined ? `${folder.name} (${parent})` : folder.name,
          run: () => { closeDrawer(); deps.run("workspace.openRecentAt", folder.path); },
        });
      }
      nodes.push({ kind: "separator" });
    }
    nodes.push({ label: "Open folder…", accelerator: "Ctrl+O", run: () => { closeDrawer(); deps.run("workspace.open"); } });
    nodes.push({ label: "Clone repository…", run: () => { closeDrawer(); deps.run("workspace.clone"); } });
    if (root !== null) {
      nodes.push({ kind: "separator" });
      nodes.push({ label: "Project overview", run: () => { closeDrawer(); deps.showContext("project"); } });
      nodes.push({ label: "Source control", run: () => { closeDrawer(); deps.run("view.scm"); } });
      nodes.push({ label: "Browse files in the IDE", run: () => { closeDrawer(); deps.run("view.explorer"); } });
      nodes.push({ kind: "separator" });
      nodes.push({ label: "Close project", run: () => { closeDrawer(); deps.run("workspace.close"); } });
    }
    menuTrigger = trigger;
    trigger.setAttribute("aria-expanded", "true");
    const rect = trigger.getBoundingClientRect();
    projectMenu.open(rect.left, rect.bottom + 4, nodes, () => trigger.setAttribute("aria-expanded", "false"));
  }

  /* ── State ───────────────────────────────────────────────────────────── */

  let generation = 0;
  function paintProject(root: string | null, git: GitStatusView | null): void {
    const name = projectName(root);
    cardName.textContent = name;
    cardMeta.textContent = describeVibeProject(root, git);
    projectCard.title = root === null ? "Open a project folder" : `${root} - switch project`;
    projectCard.setAttribute("aria-label", root === null ? "No project open. Open or switch project" : `Project ${name}, ${cardMeta.textContent}. Switch project`);
    projectCard.dataset["empty"] = String(root === null);
    topProjectName.textContent = root === null ? "Open a project" : name;
    topProject.title = projectCard.title;
    topProject.setAttribute("aria-label", projectCard.getAttribute("aria-label") ?? name);
  }
  async function refresh(): Promise<void> {
    const request = ++generation;
    const root = deps.projectRoot();
    if (root === null) {
      paintProject(null, null);
      setBadge(changes, "Changes", "", false, "Open a project to see its changes");
      return;
    }
    if (cardName.textContent !== projectName(root)) paintProject(root, null);
    const [git, taskList] = await Promise.all([
      window.adcode.git.status().catch(() => null),
      window.adcode.aiWorkspace.list().catch((): readonly AiWorkspaceTaskView[] => []),
    ]);
    if (request !== generation || root !== deps.projectRoot()) return;
    paintProject(root, git);
    const changeSummary = summarizeVibeChanges(git, taskList);
    setBadge(changes, "Changes", changeSummary.badge, changeSummary.attention, changeSummary.description);
  }
  let refreshTimer: number | undefined;
  const scheduleRefresh = (): void => {
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => { refreshTimer = undefined; void refresh(); }, 150);
  };
  window.adcode.aiWorkspace.onChanged(scheduleRefresh);
  window.adcode.workspace.onFilesChanged(scheduleRefresh);
  window.adcode.workspace.onChanged(scheduleRefresh);
  window.addEventListener("focus", scheduleRefresh);
  window.addEventListener(GIT_CHANGED_EVENT, scheduleRefresh);
  // Git has no change event; commits and edits made outside ADCode surface on this beat.
  window.setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
  paintProject(deps.projectRoot(), null);

  /* ── Layout ──────────────────────────────────────────────────────────── */

  const docked = (): boolean => !collapsed && window.innerWidth >= VIBE_DOCK_MIN_WIDTH;
  function applyLayout(): void {
    const isDocked = docked();
    const previous = document.body.dataset["vibeRail"];
    const next = isDocked ? "docked" : "compact";
    document.body.dataset["vibeRail"] = next;
    if (isDocked && drawerOpen) closeDrawer(false);
    if (deps.search !== null) (isDocked ? searchHost : topSearchHost).append(deps.search);
    menuToggle.title = isDocked ? "Hide sidebar (Ctrl+B)" : "Show sidebar (Ctrl+B)";
    menuToggle.setAttribute("aria-label", menuToggle.title);
    element.inert = !isDocked && !drawerOpen;
    // Not on the first call: the owner is still being built and lays itself out after.
    if (previous !== undefined && previous !== next) deps.onLayoutChange();
  }
  function openDrawer(): void {
    if (docked() || drawerOpen) return;
    // Return focus to whatever opened the drawer; the menu button when that was nothing.
    const active = document.activeElement;
    drawerTrigger = active instanceof HTMLElement && active !== document.body && !element.contains(active) ? active : menuToggle;
    drawerOpen = true;
    document.body.dataset["vibeDrawer"] = "open";
    element.inert = false;
    menuToggle.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => newConversation.control.focus());
  }
  function closeDrawer(restoreFocus = true): void {
    if (!drawerOpen) return;
    drawerOpen = false;
    document.body.dataset["vibeDrawer"] = "closed";
    element.inert = !docked();
    menuToggle.setAttribute("aria-expanded", "false");
    if (restoreFocus && element.contains(document.activeElement)) (drawerTrigger ?? menuToggle).focus();
    drawerTrigger = null;
  }
  function toggle(): void {
    if (window.innerWidth >= VIBE_DOCK_MIN_WIDTH) {
      collapsed = !collapsed;
      try { localStorage.setItem(COLLAPSED_KEY, String(collapsed)); } catch { /* Optional preference. */ }
      applyLayout();
      if (!collapsed) requestAnimationFrame(() => newConversation.control.focus());
      return;
    }
    if (drawerOpen) closeDrawer();
    else openDrawer();
  }
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !drawerOpen || projectMenu.isOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    closeDrawer();
  });
  document.body.dataset["vibeDrawer"] = "closed";
  applyLayout();
  window.addEventListener("resize", applyLayout);
  void refresh();

  return {
    element,
    topbar,
    historyHost,
    setContextTab(tab): void {
      changes.control.setAttribute("aria-pressed", String(tab === "changes"));
    },
    setPreviewOpen(open): void {
      preview.control.setAttribute("aria-pressed", String(open));
      topPreview.setAttribute("aria-pressed", String(open));
    },
    // Called once per project switch, so no debounce: the card must not show the old name.
    refresh: () => { void refresh(); },
    isDocked: docked,
    toggle,
    revealHistory(): void {
      if (!docked()) openDrawer();
      requestAnimationFrame(() => historyHost.querySelector<HTMLInputElement>(".chat-history-search")?.focus());
    },
    closeDrawer: () => closeDrawer(),
  };
}
