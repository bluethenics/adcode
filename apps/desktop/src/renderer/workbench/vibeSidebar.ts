import { createWorkspaceControls } from "./workspaceControls.ts";
import { formatTokens } from "../../shared/aiUsage.ts";
import { percentLeft, untilText } from "../../shared/tagflow.ts";
import { openWebAccount } from "../surface.ts";
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
import { createIcon as createWorkbenchIcon, ICON, type IconSource } from "./icons.ts";
import { attachContextMenuDismissal, createContextMenu, type ContextMenu, type ContextMenuNode } from "./contextMenu.ts";
import { describeVibeProject, projectName, recentProjectsFor, summarizeVibeChanges, VIBE_PAGES, type VibePage } from "./vibeSidebarModel.ts";
import { GIT_CHANGED_EVENT } from "./changesView.ts";
import { isWebSurface, usesWebFrame } from "../surface.ts";
import { brandMark } from "./brandMark.ts";
import { WEB_ICON } from "./webIcons.ts";
import { createChatTabs, createWebRail, type WebRail } from "./webShell.ts";
import type { AppMenu } from "./appMenu.ts";

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
  // The web frame's rows (webShell.ts).
  search: "M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.3 10.3l3.2 3.2",
  spark: "M8 2l1.5 4.5L14 8l-4.5 1.5L8 14 6.5 9.5 2 8l4.5-1.5z",
  gift: "M2.5 6h11v2.5h-11zM3.5 8.5V13.5h9V8.5M8 6v7.5M8 6C6.6 6 5 5.5 5 4.3 5 3 6.8 2.9 8 6zM8 6c1.4 0 3-.5 3-1.7C11 3 9.2 2.9 8 6z",
  chevronRight: "M6.5 4.5 10 8l-3.5 3.5",
  monitor: "M2 3h12v8H2zM6 14h4M8 11v3",
  book: "M2.5 3h4a1.5 1.5 0 0 1 1.5 1.5V13a1 1 0 0 0-1-1H2.5zM13.5 3h-4A1.5 1.5 0 0 0 8 4.5V13a1 1 0 0 1 1-1h4.5z",
  grid: "M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z",
  sidebar: "M2.5 3h11v10h-11zM6.5 3v10",
} as const;

// The desktop chrome keeps its existing icon set; a window wearing the web frame uses official
// Lucide nodes, so the frame reads the same on both surfaces and one icon name means one glyph.
const webPaths = new Map<string, IconSource>(Object.entries(PATH).map(([key, path]) => [path, WEB_ICON[key as keyof typeof PATH]]));
webPaths.set(ICON.earnings, WEB_ICON.earnings);
webPaths.set(ICON.close, WEB_ICON.close);
function createIcon(source: IconSource): SVGSVGElement {
  return createWorkbenchIcon(usesWebFrame() && typeof source === "string" ? webPaths.get(source) ?? source : source);
}

export interface VibeSidebarDeps {
  readonly chat: ChatWidget;
  readonly run: (command: string, arg?: string) => void;
  readonly projectRoot: () => string | null;
  /** The shared search box; it moves between the rail and the compact top bar. */
  readonly search: HTMLElement | null;
  /** The shared "More" button (`.project-tools`); its menu belongs to the dock. */
  readonly more: HTMLButtonElement;
  /**
   * The app's own menus behind the frame's button (`appMenu.ts`).
   *
   * Null when this window shows the menus its own way - the Code window, which has a title bar
   * to put them in, and macOS, where the system draws the menu bar - and the brand row leaves
   * the button out rather than pointing at nothing.
   */
  readonly appMenu: AppMenu | null;
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
  /** One click from a new version to installing it, at the right of the tabs row. */
  readonly updateButton?: HTMLButtonElement;
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
  /** The frame's rail, when this window wears the frame; built once the rows exist. */
  let webRail: WebRail | null = null;
  let webTabsTrailing: HTMLElement | null = null;
  /** The status bar's Run slot, which rides with the frame's tabs row instead (see `applyLayout`). */
  let webRunSlot: HTMLElement | null = null;
  let webTabChanges: HTMLButtonElement | null = null;
  let webTabPreview: HTMLButtonElement | null = null;
  try { collapsed = localStorage.getItem(COLLAPSED_KEY) === "true"; } catch { /* Optional preference. */ }
  let drawerOpen = false;
  let drawerTrigger: HTMLElement | null = null;

  const button = (className: string, label: string, icon: IconSource, run: () => void): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = className;
    control.title = label;
    control.setAttribute("aria-label", label);
    control.append(createIcon(icon));
    control.addEventListener("click", run);
    return control;
  };
  const navItem = (label: string, icon: IconSource, className: string, run: () => void) => {
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
  // A browser opens a private window on Ctrl+Shift+N before the page sees it; the web uses Alt+N.
  const newChord = isWebSurface() ? "Alt+N" : "Ctrl+Shift+N";
  shortcut.textContent = newChord;
  newConversation.control.append(shortcut);
  newConversation.control.title = `New conversation (${newChord})`;
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
    webRail?.setCurrent(current);
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

  // On the web there is no second window: the same button offers the desktop app, which has the full IDE.
  const web = isWebSurface();
  // The frame is worn by the web and by the desktop app's Vibe window alike (surface.ts); the
  // `web` flag above is only about which product this is, which is what the frame's words say.
  const frame = usesWebFrame();
  const workspaceControls = createWorkspaceControls({ run: deps.run, changes: () => deps.showContext("changes"), project: () => deps.showContext("project"), browser: () => deps.run("workspace.browser"), web });
  const ide = document.createElement("button");
  ide.type = "button";
  ide.className = "project-toolbar-action vibe-ide-button";
  ide.title = web ? "The desktop app adds the full IDE, local models and no daily limit" : "Open the full IDE in its own window - Vibe stays here";
  ide.setAttribute("aria-label", web ? "Get the desktop app" : "Open IDE in a separate window");
  const ideText = document.createElement("span");
  ideText.textContent = web ? "Get the desktop app" : "Open IDE";
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
  if (frame) {
    webRail = buildWebFrame();
    webRail.setCurrent("chat");
  } else {
    main.append(head, projectCard, pages, nav, conversations);
    element.append(main, footer);
  }

  /*
   * The frame (webShell.ts): an icon rail with the places and panels, a sidebar that reads like
   * a plan - credits, earnings, the project, the chats - and tabs along the top. Every control
   * here calls the same action as its desktop row above.
   *
   * On the web that is the whole window. On the desktop it is the whole window too, which means
   * the frame has to carry what the title bar and the status bar carried there: the app's own
   * menus (in a card of their own - `appMenu.ts`), the account, feedback, the More menu, the
   * update, the live session, Run. Where each of those sits is the frame stylesheet's business;
   * what this function does is move them, keeping the action each one calls - so a door that
   * moved is still the door.
   */
  function buildWebFrame(): WebRail {
    // One search icon, as Freebuff has, opening the same universal search the box did.
    const searchButton = button("web-sidebar-search", "Search everything", PATH.search, () => { deps.run("search.universal"); closeDrawer(); });
    const brand = document.createElement("div");
    brand.className = "web-sidebar-brand";
    const wordmark = document.createElement("span");
    wordmark.className = "web-sidebar-wordmark";
    wordmark.textContent = "ADCode";
    // The menus have no row of their own outside the Code window's title bar, so their button
    // sits beside the wordmark, where a window's own menus would be. Absent on macOS, where the
    // system draws the menu bar and there is nothing for the card to hold.
    const menuButton = deps.appMenu?.element ?? null;
    const dismiss = button("web-sidebar-search web-sidebar-close", "Close navigation", ICON.close, () => closeDrawer());
    brand.append(brandMark({ size: 24, plate: true, accent: true }), wordmark, ...(menuButton === null ? [] : [menuButton]), searchButton, dismiss);
    newConversation.control.querySelector("svg")?.replaceWith(createIcon(WEB_ICON.newChat));

    const credits = navItem("Included AI", PATH.spark, "web-credits-row", () => { deps.run("ai.showCredits"); closeDrawer(); });
    // On the web these rows open its account dialog, which is where a browser keeps earnings and
    // invites. The desktop has real panels for both, so they open those instead.
    const earningsRow = navItem("Earnings", ICON.earnings, "web-earnings-row", () => {
      if (web) openWebAccount("earnings");
      else deps.run("view.earnings");
      closeDrawer();
    });
    const invite = navItem("Invite friends, earn more", PATH.gift, "web-invite-row", () => {
      if (web) openWebAccount("invites");
      else deps.run("invite.open");
      closeDrawer();
    });
    const usage = document.createElement("div");
    usage.className = "vibe-nav web-usage";
    usage.append(credits.control, earningsRow.control, invite.control);
    // The cloud-time chip is made before the renderer; it belongs with the other allowances.
    const time = document.querySelector<HTMLElement>(".web-time");
    if (time !== null) usage.append(time);
    deps.onEarnings((label) => setBadge(earningsRow, "Earnings", label, false, label === "" ? "Your earnings" : `${label} available`));
    void watchCredits(credits);

    const projectLabel = document.createElement("h2");
    projectLabel.className = "vibe-nav-label";
    projectLabel.textContent = "Project";
    conversationsLabel.textContent = "Chats";

    const link = (label: string, icon: IconSource, run: () => void): HTMLButtonElement => {
      const row = button("vibe-nav-item web-link-row", label, icon, run);
      const text = document.createElement("span");
      text.className = "vibe-nav-text";
      text.textContent = label;
      row.append(text, createIcon(PATH.chevronRight));
      return row;
    };
    const links = document.createElement("div");
    links.className = "vibe-nav web-links";
    links.append(
      // Where the web offers the desktop app, the desktop offers what its menu bar used to put
      // on screen: the shortcuts, now that the menus live behind a button.
      web ? link("Desktop app", PATH.monitor, () => deps.run("workspace.openIde")) : link("Keyboard shortcuts", WEB_ICON.keyboard, () => deps.run("help.shortcuts")),
      link("Docs", PATH.book, () => window.open("https://adcode.bluethenics.com/docs", "_blank", "noopener")),
      link("All features", PATH.grid, () => document.getElementById("open-features")?.click()),
    );
    const promo = document.createElement("div");
    promo.className = "web-promo";
    const promoText = document.createElement("p");
    promoText.textContent = web
      ? "For local projects and local models, use ADCode on desktop."
      : "The IDE window has the editor, terminals, local projects and your own models.";
    promo.append(promoText, ide);

    const panel = document.createElement("div");
    panel.className = "web-sidebar-panel";
    main.append(brand, head, usage, projectLabel, projectCard, conversations);
    const panelFooter = document.createElement("div");
    panelFooter.className = "vibe-rail-footer web-sidebar-footer";
    panelFooter.append(links, promo);
    panel.append(main, panelFooter);

    // Controls that lived in the desktop title bar and status bar move to the rail: the account
    // and feedback buttons, the update (whose label becomes a tooltip - the icon carries the
    // state), and the live session, which takes the slot the web spends on its account item.
    const account = document.getElementById("account-toggle");
    const feedback = document.getElementById("report-toggle");
    const update = document.getElementById("status-update");
    const share = document.getElementById("status-collab");
    /*
     * The status bar drew the live session as a sparse 16px glyph, sized for a row with words
     * beside it. In the rail it stands alone among Lucide nodes, where that drawing read as a
     * faint mark; the same meaning, drawn at the weight of its neighbours. The button is
     * unchanged - the accent fill while hosting, its label and its panel are still its own -
     * so only the glyph inside it is swapped.
     */
    if (share !== null) share.querySelector("svg")?.replaceWith(createIcon(WEB_ICON.share));
    /* The first panel item. The web spends this slot on its account row - the account dialog is
       where a browser keeps everything account-shaped. The desktop's account button is already in
       the rail's footer, so on the desktop the slot goes to the live session instead, and it is
       the real button that moves: the accent fill that says "hosting" is its own state. */
    const accountPanel = web || share === null
      ? { id: "account", label: "Account", icon: WEB_ICON.account, run: () => { openWebAccount(); closeDrawer(); } }
      : { id: "share", control: share };
    const rail = createWebRail({
      home: () => { deps.showPage("chat"); closeDrawer(); },
      places: VIBE_PAGES.map((page) => ({ id: page.id, label: page.label, icon: WEB_ICON[page.id], run: () => { deps.showPage(page.id); closeDrawer(); } })),
      panels: [
        accountPanel,
        { id: "changes", label: "Changes", icon: WEB_ICON.changes, run: () => { deps.toggleContext("changes"); closeDrawer(); } },
        { id: "preview", label: "Preview", icon: WEB_ICON.preview, run: () => { deps.togglePreview(); closeDrawer(); } },
        { id: "automations", label: "Automations", shortLabel: "Schedule", icon: WEB_ICON.automations, run: () => { chat.openScheduleComposer(); closeDrawer(); } },
      ],
      footer: [
        notifications,
        ...(update === null ? [] : [update]),
        settings,
        deps.more,
        ...(feedback === null ? [] : [feedback]),
        ...(account === null ? [] : [account]),
      ],
    });
    // These controls originate in shared chrome; keep their behavior and badges intact.
    // The account button is the one that must not be keyed to an icon id: this swap replaces
    // its #account-glyph, so the account menu carries the photo state on the button itself.
    // More is the exception the other way - the toolbar drew it as a "⋯" character, not an svg,
    // so on the rail its text is what the icon replaces.
    for (const [control, icon] of [[deps.more, WEB_ICON.more], [feedback, WEB_ICON.feedback], [account, WEB_ICON.account]] as const) {
      if (control === null) continue;
      const glyph = control.querySelector("svg");
      if (glyph !== null) glyph.replaceWith(createIcon(icon));
      else if (control.childElementCount === 0) control.replaceChildren(createIcon(icon));
    }
    element.append(rail.element, panel);

    /*
     * With no title bar left to grab, the frame carries the places the window can be dragged by.
     * Two of them are built here - the strip above the rail's mark, and the free space between
     * the tabs and the actions - and the wordmark between them is the third (webFrame.css).
     * None of them overlaps a control: the OS claims a press inside a drag rect before the
     * renderer ever sees it, so a rect laid over a button is a button that has stopped working.
     */
    if (!web) {
      const railDrag = document.createElement("div");
      railDrag.className = "web-rail-drag";
      rail.element.prepend(railDrag);
    }

    const tabToggle = button("web-tabs-button", "Hide sidebar (Ctrl+B)", PATH.sidebar, () => toggle());
    const tabChanges = button("web-tabs-button", "Changes", WEB_ICON.changes, () => deps.toggleContext("changes"));
    const tabPreview = button("web-tabs-button web-tabs-preview", "Preview", WEB_ICON.preview, () => deps.togglePreview());
    tabPreview.append(document.createTextNode("Preview"));
    const tabs = createChatTabs({
      historyHost,
      newChat: () => { deps.showPage("chat"); deps.run("ai.newConversation"); },
      leading: [tabToggle],
      trailing: [...(deps.updateButton === undefined ? [] : [deps.updateButton]), tabChanges, tabPreview, workspaceControls.element],
    });
    webTabsTrailing = tabs.element.querySelector(".web-tabs-trailing");
    if (!web) {
      const tabsDrag = document.createElement("div");
      tabsDrag.className = "web-tabs-drag";
      webTabsTrailing?.before(tabsDrag);
    }
    // Run was a status bar control; the tabs row is the only row the frame has. `applyLayout`
    // sends it to the compact actions with the workspace switcher when the rail is a drawer.
    // The web has no run button, which is why this is read from the DOM rather than assumed.
    const runSlot = document.getElementById("status-run-slot");
    if (runSlot !== null && runSlot.firstElementChild !== null) webRunSlot = runSlot;
    webTabChanges = tabChanges;
    webTabPreview = tabPreview;
    tabChanges.setAttribute("aria-pressed", "false");
    tabPreview.setAttribute("aria-pressed", "false");
    document.body.append(tabs.element);
    return rail;
  }

  /** The session window's credits on the Credits row, as Freebuff shows its daily count. */
  async function watchCredits(row: { control: HTMLButtonElement; badge: HTMLElement }): Promise<void> {
    const paint = async (): Promise<void> => {
      const view = await window.adcode.aiUsage.allowance().catch(() => null);
      /*
       * Reported 2026-10-27 ("Ur doing Wrong marketing"): the badge said Unlimited while Heabsy
       * models stopped at their free weekly tokens. Tagflow is unlimited; Heabsy is not, so with
       * paid models on, the badge counts what is actually left of the Heabsy week.
       */
      const paid = view?.tokens;
      if (paid?.enabled === true) {
        const left = Math.max(0, paid.free.remaining) + Math.max(0, paid.purchased);
        const refill = paid.free.resetsAt === null ? "" : ` Refills in ${untilText(paid.free.resetsAt, Date.now())}.`;
        const week = percentLeft(paid.free.remaining, paid.free.limit);
        setBadge(row, "Included AI", week === 0 && paid.purchased > 0 ? "Purchased" : `${week}% left`, left <= 0,
          `Shared by Tagflow AI and all other included models: ${formatTokens(Math.max(0, paid.free.remaining))} of ${formatTokens(paid.free.limit)} free tokens left this week, then ${formatTokens(paid.purchased)} purchased.${refill}`);
        return;
      }
      if (view?.unlimited) { setBadge(row, "Included AI", "Unlimited", false, "Tagflow AI has no ADCode usage limit"); return; }
      const session = view?.credits?.session;
      if (session === undefined) { setBadge(row, "Included AI", "", false, "See your free AI usage"); return; }
      const left = Math.max(0, Math.floor(session.remaining));
      setBadge(row, "Included AI", `${percentLeft(left, session.limit)}% left`, left <= session.limit * 0.1, `${left.toLocaleString()} of ${session.limit.toLocaleString()} left in this session`);
    };
    window.adcode.aiUsage.onChanged(() => void paint());
    window.setInterval(() => { if (!document.hidden) void paint(); }, 60_000);
    await paint();
  }

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
  const topPreview = button("vibe-topbar-button vibe-topbar-preview", "Preview", web ? WEB_ICON.preview : PATH.preview, () => deps.togglePreview());
  topPreview.append(document.createTextNode("Preview"));
  const topIde = button("vibe-topbar-button vibe-topbar-ide", web ? "Get the desktop app" : "Open IDE in a separate window", PATH.ide, () => deps.run("workspace.openIde"));
  topIde.append(document.createTextNode(web ? "Desktop app" : "Open IDE"));
  const topChanges = button("vibe-topbar-button vibe-topbar-changes", "Review changes", WEB_ICON.changes, () => deps.toggleContext("changes"));
  topChanges.append(document.createTextNode("Changes"));
  topChanges.setAttribute("aria-pressed", "false");
  const compactActions = document.createElement("div");
  compactActions.className = "web-compact-actions";
  // The frame's compact top bar: what the rail holds as loose icons - a new chat, Changes,
  // Preview, the workspace switcher, Run - stacked where a narrow window can still reach it.
  if (frame) {
    const newChat = button("vibe-topbar-button web-new-chat", "New chat", WEB_ICON.newChat, () => { deps.showPage("chat"); deps.run("ai.newConversation"); });
    newChat.append(document.createTextNode("New chat"));
    const workspaceButton = workspaceControls.element.querySelector("button")!;
    workspaceButton.querySelector("svg")?.replaceWith(createIcon(WEB_ICON.workspace));
    const workspaceLabel = document.createElement("span");
    workspaceLabel.className = "web-workspace-label";
    workspaceLabel.textContent = "Workspace";
    workspaceButton.append(workspaceLabel);
    compactActions.append(newChat, topChanges, topPreview);
    topbar.append(menuToggle, topProject, topSearchHost, compactActions);
  } else {
    topbar.append(menuToggle, topProject, topSearchHost, topPreview, topIde, workspaceControls.element);
  }

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
      // The web has no IDE: Changes and Commit & Push are its source control.
      if (!web) {
        nodes.push({ label: "Source control", run: () => { closeDrawer(); deps.run("view.scm"); } });
        nodes.push({ label: "Browse files in the IDE", run: () => { closeDrawer(); deps.run("view.explorer"); } });
      }
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
    workspaceControls.update(root, git);
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
      webRail?.setBadge("changes", "");
      topChanges.setAttribute("aria-label", "Review changes");
      topChanges.removeAttribute("data-count");
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
    webRail?.setBadge("changes", changeSummary.badge);
    topChanges.setAttribute("aria-label", `Review changes — ${changeSummary.description}`);
    if (changeSummary.badge) topChanges.dataset["count"] = changeSummary.badge;
    else topChanges.removeAttribute("data-count");
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
    if (frame) {
      const host = isDocked ? webTabsTrailing : compactActions;
      if (host && workspaceControls.element.parentElement !== host) host.append(workspaceControls.element);
      if (host && webRunSlot !== null && webRunSlot.parentElement !== host) host.append(webRunSlot);
    }
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
      webRail?.setPressed("changes", tab === "changes");
      topChanges.setAttribute("aria-pressed", String(tab === "changes"));
      webTabChanges?.setAttribute("aria-pressed", String(tab === "changes"));
    },
    setPreviewOpen(open): void {
      preview.control.setAttribute("aria-pressed", String(open));
      topPreview.setAttribute("aria-pressed", String(open));
      webRail?.setPressed("preview", open);
      webTabPreview?.setAttribute("aria-pressed", String(open));
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
