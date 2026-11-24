/**
 * Team: a group chat for a shared project - the people in it and the AI, in one thread.
 *
 * Redesigned 18 November 2026. It used to be a panel of its own, with icon-only buttons and a
 * "Send to team" / "Ask AI" pair, and the person who asked for it found it hard to use. It now
 * wears the solo chat's own clothes - the same header, bubbles and composer - so a team chat
 * reads like any other chat, with three differences that make it a group (after ChatGPT's group
 * chats): everyone's messages carry their name and colour, the AI is a participant you call in
 * (the AI switch beside Send, or start a message with @ai), and Invite sits in the header.
 *
 * The data is unchanged: the project service holds the projects, their sessions and messages;
 * this polls the open one every few seconds while it is on screen and keeps each session's
 * unsent draft. Signed out, or with no project yet, it says what Team is and offers the one
 * step that unlocks it.
 */
import { renderChatMessageHtml } from "../ai/chatMarkdown.ts";
import { ArrowUp, Check, Copy, Ellipsis, ExternalLink, FolderGit2, FolderOpen, Link2, LogOut, MessageSquare, Plus, Sparkles, Users, Archive, RefreshCw, Radio } from "lucide";
import type { ProjectChatMessage, SharedProjectLibrary, SharedProjectSnapshot, TeamGitHubReadiness } from "../../shared/api.ts";
import { createFloatingPanel } from "../workbench/floatingPanel.ts";
import { createIcon } from "../workbench/icons.ts";
import { BUY_TOKENS_URL } from "../../shared/tagflow.ts";
import { GITHUB_ADDRESS_HELP, githubRemoteFromInput } from "../../shared/githubRepository.ts";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(label: string, icon: Parameters<typeof createIcon>[0] | null, className: string, action: () => void): HTMLButtonElement {
  const node = element("button", "", className);
  node.type = "button";
  if (icon !== null) node.append(createIcon(icon));
  node.append(element("span", label));
  node.addEventListener("click", action);
  return node;
}
function iconButton(label: string, icon: Parameters<typeof createIcon>[0], className: string, action: () => void): HTMLButtonElement {
  const node = element("button", "", className);
  node.type = "button";
  node.title = label;
  node.setAttribute("aria-label", label);
  node.append(createIcon(icon));
  node.addEventListener("click", action);
  return node;
}

/** A stable hue per person, so the same teammate always has the same colour. */
export function personHue(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length === 0 ? "?" : parts.length === 1 ? parts[0]!.slice(0, 2) : `${parts[0]![0]!}${parts[parts.length - 1]![0]!}`).toUpperCase();
}
/** A message meant for the AI: the switch is on, or it starts with @ai. The mention is dropped. */
export function aiRequest(text: string, switchOn: boolean): { readonly ask: boolean; readonly text: string } {
  const mention = /^\s*@ai\b[\s,:]*/i;
  if (mention.test(text)) return { ask: true, text: text.replace(mention, "").trim() || text.trim() };
  return { ask: switchOn, text: text.trim() };
}

function avatar(id: string, name: string, className = "team-avatar"): HTMLElement {
  const node = element("span", initials(name), className);
  node.style.setProperty("--hue", String(personHue(id)));
  node.title = name;
  node.setAttribute("aria-hidden", "true");
  return node;
}

export function createSharedWorkspacePanel(deps: {
  prompt: (title: string, detail: string, value: string) => Promise<string | null>;
  confirm: (title: string, detail: string, label: string) => Promise<boolean>;
  signIn: () => void;
  openLocalProjects: () => void;
  /**
   * Open a team chat in the real chat (Vibe): returns the local chat's id. Without it, the panel
   * draws the chat itself - the IDE window's floating fallback.
   */
  openChat?: (projectId: string, sessionId: string) => Promise<string | null>;
  /** The real chat is showing a team chat ("chat"), or the panel's own empty states are ("empty"). */
  onModeChange?: (mode: "chat" | "opening" | "empty") => void;
}) {
  const inChat = deps.openChat !== undefined;
  let chatId: string | null = null;
  /* ── Sidebar: the projects, each with its chats ─────────────────────── */
  const sidebar = element("aside", "", "team-nav-inner shared-library");
  const quota = element("p", "", "team-quota");
  const share = button("Share project", Plus, "team-nav-button team-nav-button-primary", () => void shareCurrent());
  share.title = "Make the open GitHub project a team project; everyone you invite chats here with you and the AI";
  const join = button("Join", Link2, "team-nav-button", () => void joinPrompt());
  join.title = "Paste an invite someone sent you";
  const refresh = iconButton("Refresh", RefreshCw, "team-nav-icon", () => void task(async () => { await loadLibrary(); if (snapshot) await poll(); }));
  const navActions = element("div", "", "team-nav-actions");
  navActions.append(share, join, refresh);
  const list = element("div", "", "team-project-list shared-project-list");
  const upgrade = button("More projects with a plan", null, "team-nav-link", () => { window.open(`${BUY_TOKENS_URL}#plans`, "_blank", "noopener"); });
  upgrade.hidden = true;
  sidebar.append(navActions, quota, list, upgrade);

  /* ── The chat ───────────────────────────────────────────────────────── */
  const main = element("section", "", "team-chat shared-main");
  const header = element("header", "", "chat-header team-chat-header");
  const titles = element("div", "", "team-chat-titles");
  const title = element("h2", "Team", "chat-conversation-title team-chat-title");
  const subtitle = element("p", "", "team-chat-subtitle");
  titles.append(title, subtitle);
  const people = element("div", "", "team-avatars");
  const invite = button("Invite", Users, "team-header-button team-invite", () => void copyInvite());
  invite.title = "Copy the invite link - anyone with it can join this project's chats";
  const more = iconButton("More", Ellipsis, "team-header-icon", () => toggleMenu());
  more.setAttribute("aria-haspopup", "menu");
  more.setAttribute("aria-expanded", "false");
  const menu = element("div", "", "team-menu");
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  const headerActions = element("div", "", "team-header-actions");
  headerActions.append(people, invite, more, menu);
  header.append(titles, headerActions);

  const status = element("p", "", "team-status collab-error");
  status.setAttribute("role", "status");
  status.hidden = true;

  const transcript = element("div", "", "chat-transcript team-transcript shared-transcript");
  transcript.setAttribute("role", "log");
  transcript.setAttribute("aria-label", "Team chat");
  transcript.setAttribute("aria-live", "polite");
  const older = button("Load earlier messages", null, "team-older", () => void task(async () => {
    if (!snapshot || !messages.length) return;
    const earlier = await window.adcode.collab.sharedSnapshot(snapshot.id, snapshot.selectedSession, messages[0]!.seq);
    hasOlder = earlier.hasOlder; mergeMessages(earlier.messages); renderMessages(false);
  }));
  older.hidden = true;

  const composer = element("form", "", "chat-composer team-composer shared-composer");
  const composerMain = element("div", "", "chat-composer-main team-composer-main");
  const input = element("textarea", "", "chat-input team-input");
  input.rows = 2;
  input.maxLength = 8000;
  input.placeholder = "Message the team · start with @ai to ask the assistant";
  input.setAttribute("aria-label", "Message the team");
  const aiSwitch = button("AI replies", Sparkles, "team-ai-switch", () => setAi(!aiOn, true));
  aiSwitch.setAttribute("aria-pressed", "false");
  aiSwitch.title = "When on, the assistant answers your message - and everyone in the chat sees its reply";
  const hint = element("span", "Enter to send · Shift+Enter for a new line", "team-composer-hint");
  const send = iconButton("Send", ArrowUp, "chat-send team-send", () => void post());
  send.type = "submit";
  const footer = element("div", "", "chat-composer-footer team-composer-footer");
  footer.append(aiSwitch, hint, send);
  composerMain.append(input, footer);
  composer.append(composerMain);
  composer.addEventListener("submit", (event) => { event.preventDefault(); void post(); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void post(); }
  });
  input.addEventListener("input", () => {
    const key = draftKey(); if (key) drafts.set(key, input.value); nonce = null;
    input.style.height = "auto"; input.style.height = `${String(Math.min(input.scrollHeight, 160))}px`;
  });
  const empty = element("div", "", "team-empty");
  empty.hidden = true;
  main.append(header, status, transcript, empty, composer);
  transcript.append(older);

  /** Above the real chat in Vibe: the chat's title, its people, Invite, AI replies and the menu. */
  const strip = element("div", "", "team-strip");
  if (inChat) {
    strip.append(header, status);
    headerActions.prepend(aiSwitch);
  }
  const content = element("div", "", "shared-workspace");
  content.append(sidebar, main);

  /* ── State ──────────────────────────────────────────────────────────── */
  let library: SharedProjectLibrary | null = null, snapshot: SharedProjectSnapshot | null = null;
  let selected: string | null = null, generation = 0, polling: number | undefined, posting = false, busy = false, nonce: string | null = null;
  let messages: ProjectChatMessage[] = [], hasOlder = false, aiOn = false;
  const drafts = new Map<string, string>();
  const expandedProjects = new Set<string>();
  const projectSnapshots = new Map<string, SharedProjectSnapshot>();
  const panel = createFloatingPanel({ id: "shared-projects", title: "Team", content, defaultSize: { width: 1080, height: 760 }, anchor: "centre",
    onVisibilityChange: (open) => { if (!open) { generation++; clearTimeout(polling); } },
  });
  let integrated: { host: HTMLElement; show: () => void } | null = null;
  let active = false;
  const isVisible = () => integrated ? active : panel.isOpen();
  function reveal() { if (integrated) { active = true; integrated.host.hidden = false; integrated.show(); } else panel.open(); }
  function draftKey() { return snapshot?.selectedSession ? `${snapshot.id}:${snapshot.selectedSession}` : null; }
  // IPC rejections arrive as "Error invoking remote method 'x': Error: <the real sentence>".
  let statusTimer: number | undefined;
  function say(message: string, tone: "error" | "info" = "error") {
    const clean = message.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, "");
    status.textContent = clean; status.hidden = !clean; status.dataset["tone"] = tone;
    window.clearTimeout(statusTimer);
    if (clean && tone === "info") statusTimer = window.setTimeout(() => { status.hidden = true; }, 4000);
  }
  function setAi(on: boolean, save = false) {
    if (save && chatId !== null) void window.adcode.team.setAi(chatId, on);
    aiOn = on; aiSwitch.setAttribute("aria-pressed", String(on)); aiSwitch.classList.toggle("is-on", on); input.placeholder = on ? "Ask the assistant - the whole team sees its answer" : "Message the team · start with @ai to ask the assistant"; }

  /** Opening Team while something else loads: it runs next, never dropped. */
  let queuedOpen: (() => Promise<void>) | null = null;
  async function task(work: () => Promise<void>) {
    if (busy) return; busy = true; generation++; clearTimeout(polling);
    for (const control of [share, join, refresh]) control.disabled = true;
    try { await work(); } catch (error) {
      const message = error instanceof Error ? error.message : "The team service could not connect.";
      if (/sign in/i.test(message) && library === null) showSignedOut(); else say(message);
    } finally {
      busy = false; for (const control of [share, join, refresh]) control.disabled = false; schedule();
      if (queuedOpen !== null) { const next = queuedOpen; queuedOpen = null; void task(next); }
    }
  }

  /* ── Empty states: what Team is, and the one step that unlocks it ──── */
  /*
   * Where errors show. In Vibe the status line lives in the strip above a team chat, and the
   * strip is hidden while no team chat is open - so before 2.6.6 a failed "Share this project"
   * from the empty state wrote its reason into a hidden element and the button seemed to do
   * nothing. Any empty state brings the line back into the panel, above the card.
   */
  function statusInPanel() { if (status.parentElement !== main || status.nextElementSibling !== transcript) main.insertBefore(status, transcript); }
  function showEmpty(kind: "signed-out" | "no-projects" | "no-chats") {
    clearChat();
    chatId = null;
    deps.onModeChange?.("empty");
    statusInPanel();
    if (inChat && kind === "no-chats") main.prepend(header);
    empty.hidden = false; transcript.hidden = true; composer.hidden = true; headerActions.hidden = true;
    header.hidden = kind !== "no-chats";
    navActions.hidden = kind === "signed-out";
    empty.replaceChildren();
    const card = element("div", "", "team-empty-card");
    const icon = element("div", "", "team-empty-icon");
    icon.append(createIcon(Users));
    if (kind === "signed-out") {
      title.textContent = "Team"; subtitle.textContent = "";
      card.append(icon, element("h3", "Chat with your team and the AI together"), element("p", "Everyone in a shared project sees the same chats and the assistant's answers. Your solo chats stay private.", "team-empty-lead"),
        button("Sign in to start", null, "team-cta", deps.signIn));
      quota.textContent = "Sign in to see the projects you share.";
    } else if (kind === "no-projects") {
      title.textContent = "Team"; subtitle.textContent = "No team projects yet";
      card.append(icon, element("h3", "Start a team chat"), element("p", "Share this project and invite people, or join a project someone shared with you.", "team-empty-lead"));
      const options = element("div", "", "team-empty-options");
      const shareOption = element("div", "", "team-option");
      shareOption.append(element("strong", "Share this project"), element("p", "Turns the open GitHub project into a team project. You get an invite link to send.", "team-option-text"), button("Share this project", Plus, "team-cta", () => void shareCurrent()));
      const joinOption = element("div", "", "team-option");
      const joinInput = element("input", "", "team-join-input");
      joinInput.placeholder = "Paste an invite";
      joinInput.setAttribute("aria-label", "Project invite");
      const joinButton = button("Join", Link2, "team-cta team-cta-secondary", () => void joinWith(joinInput.value));
      joinInput.addEventListener("keydown", (event) => { if (event.key === "Enter") void joinWith(joinInput.value); });
      const joinRow = element("div", "", "team-join-row");
      joinRow.append(joinInput, joinButton);
      joinOption.append(element("strong", "Join with an invite"), element("p", "Got an invite from a teammate? Paste it here.", "team-option-text"), joinRow);
      options.append(shareOption, joinOption);
      card.append(options);
    } else {
      const project = snapshot;
      title.textContent = project?.name ?? "Team"; subtitle.textContent = project === null ? "" : `${project.repository} · ${String(project.memberCount)} of ${String(project.memberLimit)} people`;
      headerActions.hidden = false;
      card.append(icon, element("h3", `No chats in ${project?.name ?? "this project"} yet`), element("p", "Start one: everyone in the project can read it, write in it and ask the AI.", "team-empty-lead"),
        button("Start a team chat", MessageSquare, "team-cta", () => void newChat(project?.id ?? null)));
    }
    empty.append(card);
  }

  /**
   * "Connect this project to GitHub": the steps between an ordinary folder and a team project.
   *
   * A team project is keyed by its github.com repository, and until 2.6.6 Team only said so -
   * one sentence, whatever was actually missing, and no way to fix it from here. Each step now
   * has its own button, done steps are ticked, and the card re-reads the project after every
   * step, so it always shows the next real one.
   */
  function showConnect(readiness: TeamGitHubReadiness) {
    clearChat();
    chatId = null;
    deps.onModeChange?.("empty");
    statusInPanel();
    empty.hidden = false; transcript.hidden = true; composer.hidden = true; headerActions.hidden = true; header.hidden = true;
    // Share and Join in the sidebar talk to the project service, which needs the account.
    navActions.hidden = !connectSignedIn;
    title.textContent = "Team"; subtitle.textContent = "";
    say("");
    const tracked = !["no-folder", "no-git", "not-repo", "untrusted"].includes(readiness.state);
    const ready = readiness.state === "ready";
    const card = element("div", "", "team-empty-card team-connect");
    card.dataset["state"] = readiness.state;
    const icon = element("div", "", "team-empty-icon");
    icon.append(createIcon(FolderGit2));
    card.append(icon, element("h3", ready ? "Ready to share" : "Connect this project to GitHub"),
      element("p", "A team project is a GitHub repository: everyone you invite chats about the same code, and each person's AI works in their own copy of it.", "team-empty-lead"));
    const note = element("p", readiness.message, "team-connect-note");
    note.dataset["tone"] = ready ? "done" : "next";
    card.append(note);

    const steps = element("ol", "", "team-connect-steps");
    const step = (heading: string, text: string, state: "done" | "current" | "todo", ...controls: HTMLElement[]) => {
      const item = element("li", "", "team-connect-step");
      item.dataset["status"] = state;
      const mark = element("span", "", "team-connect-mark");
      if (state === "done") mark.append(createIcon(Check));
      const body = element("div", "", "team-connect-body");
      body.append(element("strong", heading), element("p", text, "team-option-text"));
      if (controls.length > 0 && state !== "done") { const row = element("div", "", "team-join-row"); row.append(...controls); body.append(row); }
      item.append(mark, body);
      steps.append(item);
    };

    // 1. A Git repository ADCode can read.
    const first: HTMLElement[] = [];
    if (readiness.state === "no-folder") first.push(button("Open a project", FolderOpen, "team-cta", deps.openLocalProjects));
    else if (readiness.state === "no-git") first.push(button("Download Git", ExternalLink, "team-cta", () => { window.open("https://git-scm.com/downloads", "_blank", "noopener"); }), button("Check again", RefreshCw, "team-cta team-cta-secondary", () => void recheckGitHub()));
    else if (readiness.state === "not-repo") first.push(button("Start tracking", Plus, "team-cta", () => void gitStep(() => window.adcode.git.init())));
    else if (readiness.state === "untrusted") first.push(button("Trust this folder", Check, "team-cta", () => void gitStep(async () => {
      if (!await deps.confirm("Trust this folder?", "Git refuses repositories it cannot confirm you own, which is every repository on a FAT32 or USB drive. Trusting it lets Git - and its hooks - run here. Trust it only if you made it or know where it came from.", "Trust folder")) return null;
      return window.adcode.git.trust();
    })));
    step("Track this folder with Git", tracked ? `${readiness.folder} is a Git repository.` : readiness.state === "no-folder" ? "Open the folder you want your team to work on." : "Git records every change, which is what GitHub stores and your teammates download.", tracked ? "done" : "current", ...first);

    // 2. An empty repository on GitHub, made in the browser - ADCode never gets that permission.
    const name = (readiness.folder || "my-project").replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "my-project";
    step("Make an empty repository on GitHub", ready ? `GitHub repository: ${readiness.repository}.` : "Opens github.com/new with this folder's name filled in. Leave README, .gitignore and licence off so your first push goes through, then press Create repository.",
      ready ? "done" : tracked ? "current" : "todo",
      button("Open GitHub", ExternalLink, "team-cta team-cta-secondary", () => { window.open(`https://github.com/new?name=${encodeURIComponent(name)}&visibility=private`, "_blank", "noopener"); }));

    // 3. Its address, added as this project's remote.
    const address = element("input", "", "team-join-input team-connect-address");
    address.placeholder = "https://github.com/you/project.git";
    address.setAttribute("aria-label", "GitHub repository address");
    address.disabled = !tracked;
    const connect = button("Connect", Link2, "team-cta", () => void connectAddress(address.value));
    connect.disabled = !tracked;
    address.addEventListener("keydown", (event) => { if (event.key === "Enter") void connectAddress(address.value); });
    step("Paste its address", ready ? `This project pushes to github.com/${readiness.repository} (remote "${readiness.remote}").` : "On the new repository's page, copy the HTTPS address and paste it here.", ready ? "done" : tracked ? "current" : "todo", address, connect);

    // 4. Share.
    // The Git steps are local and need no account; sharing does, so only this step asks for it.
    const shareNow = connectSignedIn
      ? button("Share this project", Plus, "team-cta", () => void task(createShared))
      : button("Sign in to share", null, "team-cta", deps.signIn);
    shareNow.disabled = !ready;
    step("Share it with your team", ready ? (connectSignedIn ? "You get an invite link to send. So teammates can open the code too, commit and push it from Source Control." : "Team projects belong to your account: sign in, then press Share this project.") : "Unlocks once the project is connected.", ready ? "current" : "todo", shareNow);
    card.append(steps);

    const back = button(library !== null && library.projects.length > 0 ? "Back to team projects" : "Back", null, "team-nav-link", () => void task(async () => { await loadLibrary(); if (library !== null && library.projects.length > 0) { const target = selected ?? library.projects[0]?.id; if (target) await openProject(target); } }));
    card.append(back);
    empty.replaceChildren(card);
    (ready ? shareNow : tracked ? address : card.querySelector<HTMLElement>(".team-connect-step[data-status='current'] button"))?.focus({ preventScroll: true });
  }
  /** Whether Share is offered or sign-in is asked for; the Git steps work either way. */
  let connectSignedIn = true;
  async function recheckGitHub() { await task(async () => { showConnect(await window.adcode.collab.sharedGitHub()); }); }
  async function gitStep(work: () => Promise<{ readonly ok: boolean; readonly message: string } | null>) {
    await task(async () => {
      const result = await work();
      if (result === null) return;
      const next = await window.adcode.collab.sharedGitHub();
      showConnect(next);
      if (!result.ok) throw new Error(result.message);
    });
  }
  async function connectAddress(raw: string) {
    if (!raw.trim()) { say("Paste the repository's address from GitHub first - it looks like https://github.com/you/project.git."); return; }
    // Checked here first, with the parser and words main uses, so a typo is answered at once.
    if (githubRemoteFromInput(raw) === null) { say(GITHUB_ADDRESS_HELP); return; }
    await task(async () => {
      const next = await window.adcode.collab.sharedConnectGitHub(raw.trim());
      showConnect(next);
      if (next.state === "ready") say(`Connected to github.com/${next.repository}. ${connectSignedIn ? "Press Share this project." : "Sign in, then share it."}`, "info");
    });
  }
  function showSignedOut() { library = null; renderLibrary(); showEmpty("signed-out"); }
  /** In Vibe, while a team chat is being opened: the chat's shape, not this panel's own chat. */
  function showOpening() {
    empty.hidden = false; transcript.hidden = true; composer.hidden = true; header.hidden = true;
    const skeleton = element("div", "", "team-skeleton");
    skeleton.setAttribute("aria-busy", "true");
    skeleton.setAttribute("aria-label", "Opening the team chat");
    for (const kind of ["them", "ai", "you", "ai"]) {
      const row = element("div", "", `team-skeleton-row is-${kind}`);
      row.append(element("span", "", "team-skeleton-line"), element("span", "", "team-skeleton-line is-short"));
      skeleton.append(row);
    }
    skeleton.append(element("div", "", "team-skeleton-composer"));
    empty.replaceChildren(skeleton);
    deps.onModeChange?.("opening");
  }
  function showChat() {
    if (inChat) { if (chatId === null) showOpening(); return; }
    empty.hidden = true; transcript.hidden = false; headerActions.hidden = false; header.hidden = false; navActions.hidden = false; }

  /* ── Sidebar ────────────────────────────────────────────────────────── */
  function renderLibrary() {
    const focusedSession = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement.dataset["session"] : undefined;
    list.replaceChildren();
    if (!library) { upgrade.hidden = true; return; }
    quota.textContent = `${library.limits.plan === "free" ? "Free" : library.limits.plan} · ${String(library.owned)}/${String(library.limits.projects)} owned projects · up to ${String(library.limits.members)} people each`;
    upgrade.hidden = library.owned < library.limits.projects;
    for (const project of library.projects) {
      const group = element("div", "", "team-project shared-project-group");
      const head = element("div", "", "team-project-head");
      const toggle = element("button", "", "team-project-toggle");
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", String(expandedProjects.has(project.id)));
      toggle.append(createIcon(FolderOpen), element("span", project.name, "team-project-name"), element("span", String(project.memberCount), "team-project-count"));
      toggle.title = `${project.repository} · ${String(project.memberCount)} people`;
      toggle.addEventListener("click", () => {
        if (expandedProjects.has(project.id)) expandedProjects.delete(project.id); else expandedProjects.add(project.id);
        if (!projectSnapshots.has(project.id)) void window.adcode.collab.sharedSnapshot(project.id).then((next) => { projectSnapshots.set(project.id, next); renderLibrary(); }).catch((error: unknown) => say(error instanceof Error ? error.message : "Could not load its chats."));
        renderLibrary();
      });
      const add = iconButton(`New chat in ${project.name}`, Plus, "team-project-add", () => void newChat(project.id));
      head.append(toggle, add);
      group.append(head);
      if (expandedProjects.has(project.id)) {
        const rows = element("div", "", "team-sessions");
        const known = projectSnapshots.get(project.id);
        for (const session of known?.sessions ?? []) {
          const row = element("button", "", "team-session shared-history-row");
          row.type = "button";
          row.dataset["session"] = session.id;
          const current = project.id === selected && session.id === snapshot?.selectedSession;
          row.setAttribute("aria-current", String(current));
          row.append(element("span", "", "team-session-dot"), element("span", session.title, "team-session-title"));
          if (session.pending) row.append(element("span", "AI…", "team-session-pending"));
          row.addEventListener("click", () => { reveal(); void openSession(project.id, session.id); });
          rows.append(row);
        }
        if (!known) rows.append(element("p", "Loading…", "team-muted"));
        else if (known.sessions.length === 0) rows.append(element("p", "No chats yet", "team-muted"));
        group.append(rows);
      }
      list.append(group);
    }
    if (focusedSession !== undefined) list.querySelector<HTMLElement>(`[data-session="${CSS.escape(focusedSession)}"]`)?.focus({ preventScroll: true });
  }

  // Only a definite "signed out" skips the request: a host without the call, or one that cannot
  // tell, asks the service as before and shows its answer.
  async function loadLibrary() {
    const account = typeof window.adcode.account.status === "function" ? await window.adcode.account.status().catch(() => null) : null;
    if (account !== null && account.state !== "linked") { showSignedOut(); return; }
    library = await window.adcode.collab.sharedLibrary();
    navActions.hidden = false;
    renderLibrary();
    if (library.projects.length === 0) showEmpty("no-projects");
  }
  async function openProject(id: string) {
    const request = ++generation; clearTimeout(polling); selected = id; expandedProjects.add(id); renderLibrary();
    const next = await window.adcode.collab.sharedSnapshot(id);
    if (request !== generation) return; apply(next, true); schedule();
  }
  async function openSession(projectId: string, sessionId: string) {
    await task(async () => { const id = ++generation; const next = await window.adcode.collab.sharedSnapshot(projectId, sessionId); if (id !== generation) return; apply(next, true); await openInChat(); });
  }
  /** Show the selected session in the real chat (Vibe), with the strip above it. */
  async function openInChat() {
    if (!inChat || snapshot?.selectedSession == null) return;
    if (header.parentElement !== strip) strip.prepend(header);
    if (status.parentElement !== strip) strip.append(status);
    const opened = await deps.openChat!(snapshot.id, snapshot.selectedSession);
    if (opened === null) { if (chatId === null) showEmpty("no-chats"); return; }
    chatId = opened;
    header.hidden = false; headerActions.hidden = false;
    const state = await window.adcode.team.state(opened).catch(() => null);
    setAi(state?.aiReplies ?? true);
    deps.onModeChange?.("chat");
  }
  async function newChat(projectId: string | null) {
    const id = projectId ?? snapshot?.id ?? null;
    if (id === null) return;
    const name = await deps.prompt("Name this team chat", "Everyone in the project sees this name.", "New team chat");
    if (name === null || !name.trim()) return;
    reveal();
    await task(async () => { if (snapshot?.id !== id) await openProject(id); apply(await window.adcode.collab.sharedSession(id, name.trim().slice(0, 100)), true); if (inChat) await openInChat(); else input.focus(); });
  }
  /** Share the open project: at once when it is on GitHub, otherwise the steps that get it there. */
  async function shareCurrent() {
    await task(async () => {
      const readiness = await window.adcode.collab.sharedGitHub();
      // Reached from the library, which only loads for a signed-in account.
      connectSignedIn = true;
      if (readiness.state !== "ready") { showConnect(readiness); return; }
      await createShared();
    });
  }
  async function createShared() {
    const created = await window.adcode.collab.sharedCreate(); await loadLibrary(); await openProject(created.id); say("Project shared. Press Invite to copy the link for your team.", "info");
  }
  async function joinPrompt() {
    const invite = await deps.prompt("Join a team project", "Paste the invite a teammate sent you.", "");
    if (invite?.trim()) await joinWith(invite);
  }
  async function joinWith(raw: string) {
    const code = raw.trim();
    if (!code) return;
    await task(async () => { const joined = await window.adcode.collab.sharedJoin(code); await loadLibrary(); await openProject(joined.id); say(`You joined ${joined.name}.`, "info"); });
  }
  async function copyInvite() {
    if (!snapshot?.invite) { say("Only the project's owner can invite people."); return; }
    await window.adcode.clipboard.writeText(snapshot.invite);
    say("Invite copied - send it to the people you want in this chat. They paste it under Join with invite.", "info");
  }

  /* ── Header menu ────────────────────────────────────────────────────── */
  function toggleMenu(force?: boolean) {
    const open = force ?? menu.hidden;
    menu.hidden = !open;
    more.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector<HTMLElement>("button")?.focus();
  }
  document.addEventListener("pointerdown", (event) => { if (!menu.hidden && !menu.contains(event.target as Node) && !more.contains(event.target as Node)) toggleMenu(false); });
  menu.addEventListener("keydown", (event) => { if (event.key === "Escape") { toggleMenu(false); more.focus(); } });
  function menuItem(label: string, icon: Parameters<typeof createIcon>[0], run: () => void, danger = false) {
    const item = button(label, icon, `team-menu-item${danger ? " is-danger" : ""}`, () => { toggleMenu(false); run(); });
    item.setAttribute("role", "menuitem");
    return item;
  }
  function renderMenu(next: SharedProjectSnapshot) {
    menu.replaceChildren();
    const meName = next.members.find((member) => member.uid === next.selfId)?.name ?? "Teammate";
    menu.append(element("p", `${String(next.memberCount)} of ${String(next.memberLimit)} people`, "team-menu-heading"));
    for (const member of next.members) {
      const row = element("div", "", "team-menu-person shared-member");
      row.append(avatar(member.uid, member.name), element("span", `${member.name}${member.uid === next.ownerId ? " · owner" : ""}`), element("span", `${String(member.messages)} messages`, "team-muted"));
      if (next.selfId === next.ownerId && member.uid !== next.ownerId) {
        const remove = button("Remove", null, "team-menu-remove", () => void task(async () => {
          if (!await deps.confirm(`Remove ${member.name}?`, "They lose access to this project's chats and live files, and the invite is replaced.", "Remove")) return;
          await window.adcode.collab.sharedManage(next.id, "remove", member.uid); await poll();
        }));
        row.append(remove);
      }
      menu.append(row);
    }
    menu.append(element("hr", "", "team-menu-rule"));
    if (next.invite) menu.append(menuItem("Copy invite", Copy, () => void copyInvite()));
    if (next.liveInvite) menu.append(menuItem("Join live files", Radio, () => void task(async () => { await window.adcode.collab.join(next.liveInvite!, meName); })));
    else if (!next.archived) menu.append(menuItem("Edit files together live", Radio, () => void task(async () => { await window.adcode.collab.host({ bind: "internet", port: 0, displayName: meName, sharedProjectId: next.id }); await poll(); })));
    if (next.ownerId === next.selfId && !next.archived) {
      menu.append(menuItem("Replace invite", Link2, () => void task(async () => {
        if (await deps.confirm("Replace the invite?", "The old invite stops working. People already in keep access.", "Replace invite")) apply(await window.adcode.collab.sharedManage(next.id, "invite") as SharedProjectSnapshot, false);
      })));
      menu.append(menuItem("Archive project", Archive, () => void task(async () => {
        if (!await deps.confirm("Archive this project?", "Live files end and its chats become read-only. It stops using one of your project slots.", "Archive project")) return;
        await window.adcode.collab.sharedManage(next.id, "archive"); await loadLibrary(); await openProject(next.id);
      }), true));
    }
    if (next.ownerId !== next.selfId) menu.append(menuItem("Leave project", LogOut, () => void task(async () => {
      if (!await deps.confirm("Leave this project?", "You lose access to its chats and live files.", "Leave project")) return;
      await window.adcode.collab.sharedManage(next.id, "remove", next.selfId); projectSnapshots.delete(next.id); expandedProjects.delete(next.id); clearProject(); await loadLibrary();
    }), true));
    menu.append(menuItem("Local projects and Git", FolderOpen, deps.openLocalProjects));
  }

  /* ── Messages ───────────────────────────────────────────────────────── */
  function schedule() { clearTimeout(polling); if (isVisible()) polling = window.setTimeout(() => { void poll(); }, inChat && chatId !== null ? 8000 : 3000); }
  async function poll() {
    if (!isVisible() || !snapshot) return;
    const request = generation, id = snapshot.id, session = snapshot.selectedSession;
    try {
      if (document.visibilityState !== "hidden") {
        const next = await window.adcode.collab.sharedSnapshot(id, session);
        if (request !== generation) return; apply(next, false);
      }
    } catch (error) {
      if (request === generation) {
        const message = error instanceof Error ? error.message : "Connection interrupted. Retrying…";
        if (/not a member|access removed/i.test(message)) { clearProject(); void loadLibrary().catch(() => {}); }
        say(message);
      }
    } finally { if (request === generation) schedule(); }
  }
  function mergeMessages(incoming: ProjectChatMessage[]) { const merged = new Map(messages.map((m) => [m.seq, m])); for (const m of incoming) merged.set(m.seq, m); messages = [...merged.values()].sort((a, b) => a.seq - b.seq); }
  const dayLabel = (at: number): string => {
    const day = new Date(at), today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    return day.toDateString() === today.toDateString() ? "Today" : day.toDateString() === yesterday.toDateString() ? "Yesterday" : day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  };
  function renderMessages(scroll: boolean) {
    const distance = transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop, previousHeight = transcript.scrollHeight, previousTop = transcript.scrollTop;
    const previousFirst = Number(transcript.dataset["first"] ?? Number.MAX_SAFE_INTEGER);
    const pending = snapshot?.sessions.find((s) => s.id === snapshot?.selectedSession)?.pending === true;
    const key = `${messages.map((m) => `${String(m.seq)}:${m.id}`).join(",")}|${String(pending)}`;
    if (transcript.dataset["messages"] !== key) {
      transcript.dataset["messages"] = key; transcript.dataset["first"] = String(messages[0]?.seq ?? Number.MAX_SAFE_INTEGER);
      transcript.replaceChildren(older);
      let lastDay = "", lastAuthor = "";
      for (const message of messages) {
        const day = dayLabel(message.at);
        if (day !== lastDay) { transcript.append(element("div", day, "team-day")); lastDay = day; lastAuthor = ""; }
        const mine = message.kind === "member" && message.authorId === snapshot?.selfId;
        const row = element("div", "", `team-row shared-message ${mine ? "is-mine" : message.kind === "assistant" ? "is-ai" : "is-other"}`);
        row.dataset["kind"] = message.kind;
        const author = message.kind === "assistant" ? `ai:${message.authorId}` : message.authorId;
        const continued = author === lastAuthor;
        lastAuthor = author;
        if (continued) row.classList.add("is-continued");
        const time = new Date(message.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        if (message.kind === "assistant") {
          const requester = snapshot?.members.find((member) => member.uid === message.authorId)?.name ?? "a teammate";
          const meta = element("div", "", "team-meta");
          const mark = element("span", "", "team-ai-mark"); mark.append(createIcon(Sparkles));
          meta.append(mark, element("strong", "AI"), element("span", `asked by ${requester} · ${time}`, "team-meta-detail"));
          const body = element("div", "", "chat-bubble chat-bubble-assistant team-bubble shared-message-text");
          body.innerHTML = renderChatMessageHtml(message.text);
          row.append(meta, body);
        } else if (message.kind === "error") {
          row.append(element("div", message.text, "team-error-line shared-message-text"));
        } else {
          if (!mine && !continued) row.append(avatar(message.authorId, message.authorName));
          const stack = element("div", "", "team-stack");
          if (!continued) {
            const meta = element("div", "", "team-meta");
            if (!mine) { const name = element("strong", message.authorName); name.style.setProperty("--hue", String(personHue(message.authorId))); meta.append(name); }
            meta.append(element("span", time, "team-meta-detail"));
            stack.append(meta);
          }
          // Text only: a member's message is never markup, whatever it contains.
          stack.append(element("div", message.text, `chat-bubble chat-bubble-user team-bubble shared-message-text${mine ? "" : " team-bubble-other"}`));
          row.append(stack);
        }
        transcript.append(row);
      }
      if (pending) {
        const typing = element("div", "", "team-row is-ai team-typing");
        const dots = element("div", "", "chat-bubble chat-bubble-assistant team-bubble");
        dots.append(element("span"), element("span"), element("span"));
        dots.setAttribute("aria-label", "The AI is replying");
        typing.append(dots);
        transcript.append(typing);
      }
      if (!messages.length) {
        const start = element("div", "", "team-start");
        start.append(element("strong", snapshot?.selectedSession ? `This is the start of ${snapshot.sessions.find((s) => s.id === snapshot?.selectedSession)?.title ?? "this chat"}` : "Pick a chat"),
          element("p", "Say hi, or start a message with @ai to ask the assistant - everyone in the project sees its answer.", "team-muted"));
        transcript.append(start);
      }
      if (scroll || distance < 60) transcript.scrollTop = transcript.scrollHeight;
      else transcript.scrollTop = previousTop + ((messages[0]?.seq ?? Number.MAX_SAFE_INTEGER) < previousFirst ? Math.max(0, transcript.scrollHeight - previousHeight) : 0);
    }
    older.hidden = !hasOlder;
  }

  function apply(next: SharedProjectSnapshot, reset: boolean) {
    const changed = reset || next.id !== snapshot?.id || next.selectedSession !== snapshot?.selectedSession;
    const previous = snapshot;
    snapshot = next; selected = next.id; projectSnapshots.set(next.id, next); expandedProjects.add(next.id);
    if (library) library = { ...library, projects: library.projects.map((project) => project.id === next.id ? next : project) };
    renderLibrary(); say("");
    if (!next.selectedSession) { showEmpty("no-chats"); renderMenu(next); paintPeople(next); return; }
    showChat();
    if (changed) { messages = []; hasOlder = next.hasOlder; input.value = drafts.get(draftKey() ?? "") ?? ""; nonce = null; }
    mergeMessages(next.messages);
    title.textContent = next.sessions.find((session) => session.id === next.selectedSession)?.title ?? "Team chat";
    subtitle.textContent = `${next.name} · ${String(next.memberCount)} ${next.memberCount === 1 ? "person" : "people"}${next.archived ? " · archived, read-only" : ""}`;
    if (!previous || previous.id !== next.id || JSON.stringify(previous.members) !== JSON.stringify(next.members) || previous.invite !== next.invite || previous.liveInvite !== next.liveInvite || previous.archived !== next.archived || previous.selfId !== next.selfId) {
      renderMenu(next); paintPeople(next);
    }
    invite.hidden = !next.invite;
    renderMessages(changed);
    // In Vibe the real chat has the composer; this panel only ever shows its skeleton.
    composer.hidden = next.archived || inChat;
    send.disabled = posting || next.archived;
  }
  function paintPeople(next: SharedProjectSnapshot) {
    people.replaceChildren(...next.members.slice(0, 4).map((member) => avatar(member.uid, member.name, "team-avatar team-avatar-stacked")));
    if (next.members.length > 4) people.append(element("span", `+${String(next.members.length - 4)}`, "team-avatar team-avatar-stacked team-avatar-more"));
    people.title = next.members.map((member) => member.name).join(", ");
  }
  function clearChat() {
    generation++; clearTimeout(polling); messages = []; hasOlder = false;
    transcript.replaceChildren(older); delete transcript.dataset["messages"]; older.hidden = true;
  }
  function clearProject() {
    clearChat(); snapshot = null; selected = null;
    menu.replaceChildren(); people.replaceChildren();
    title.textContent = "Team"; subtitle.textContent = "";
    composer.hidden = true;
  }
  async function post() {
    if (posting || !snapshot?.selectedSession || !input.value.trim() || snapshot.archived) return;
    const id = snapshot.id, session = snapshot.selectedSession, submitted = input.value, request = generation;
    const { ask, text } = aiRequest(submitted, aiOn);
    nonce ??= crypto.randomUUID(); posting = true; send.disabled = true; say("");
    try {
      const next = await window.adcode.collab.sharedMessage(id, session, text, ask, nonce);
      if (request !== generation) return;
      if (input.value === submitted) { input.value = ""; input.style.height = ""; drafts.delete(`${id}:${session}`); nonce = null; }
      apply(next, false); transcript.scrollTop = transcript.scrollHeight;
    } catch (error) { say(error instanceof Error ? error.message : "Your message could not be sent. It is still here, so you can try again."); }
    finally { posting = false; if (snapshot) send.disabled = snapshot.archived; }
  }

  window.adcode.account.onChanged(() => { projectSnapshots.clear(); clearProject(); void task(() => loadLibrary()); });
  window.adcode.collab.onSharedChanged((id) => { if (isVisible() && id === snapshot?.id) void poll(); });
  composer.hidden = true;

  return {
    mount(host: HTMLElement, navigation: HTMLElement, show: () => void) {
      panel.close(); integrated = { host, show };
      host.classList.add("shared-chat-host"); host.hidden = true; host.append(main);
      sidebar.classList.add("shared-library-inline"); navigation.append(sidebar);
      void task(() => loadLibrary());
    },
    /** The strip above the real chat; empty until a team chat is open. */
    strip,
    /** "Team: Connect This Project to GitHub": the steps card, whatever the project's state. */
    connectGitHub() {
      reveal();
      const run = async () => {
        const account = typeof window.adcode.account.status === "function" ? await window.adcode.account.status().catch(() => null) : null;
        connectSignedIn = account === null || account.state === "linked";
        showConnect(await window.adcode.collab.sharedGitHub());
      };
      if (busy) queuedOpen = run; else void task(run);
    },
    close() { active = false; clearTimeout(polling); generation++; toggleMenu(false); if (integrated) integrated.host.hidden = true; else panel.close(); },
    open(id?: string) {
      reveal();
      if (inChat && chatId === null) showOpening();
      const run = async () => {
        await loadLibrary();
        if (library === null || library.projects.length === 0) return;
        const target = id ?? selected ?? library.projects[0]?.id;
        if (target) { await openProject(target); await openInChat(); }
      };
      if (busy) queuedOpen = run; else void task(run);
    },
  };
}
