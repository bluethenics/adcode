/**
 * The live project dock beside the chat composer.
 *
 * Sharing an artifact makes a project available; a session is what makes it a place people
 * work together. This dock is the chat's door into that session: the owner starts one for
 * the project they shared, friends join from the open-session list or an artifact code, and
 * everyone sees the same online/working roster while the editor syncs their files.
 */
import { artifactShareMessage, decodeArtifactShare } from "@adcode/community";
import type { ArtifactRoomCard, ArtifactRoomSnapshot, ProjectLinkView } from "../../shared/community.ts";
import type { CollabStatusView } from "../../shared/api.ts";
import { copyText } from "../clipboard.ts";
import { askThemed } from "../dialogs/confirmDialog.ts";
import { communityMe } from "../community/communityMe.ts";
import { createAgentMascot, type AgentMood } from "../agents/agentMascot.ts";
import { defaultMascotFor } from "../agents/mascotStyle.ts";

/** How a member's mascot looks for what their assistant is doing. */
export function laneMood(lane: string, editing: boolean): AgentMood {
  if (lane === "working") return "thinking";
  if (lane === "waiting" || lane === "awaiting") return "alert";
  if (lane === "handoff") return "proud";
  return editing ? "happy" : "sleepy";
}

/** The newest room messages for the dock, oldest first, with who said each. */
export function dockMessages(room: ArtifactRoomSnapshot | null, limit = 40): readonly { readonly id: string; readonly name: string; readonly text: string; readonly mine: boolean; readonly kind: string; readonly at: number }[] {
  if (room === null) return [];
  return room.messages.slice(-limit).map((message) => ({ id: message.id, name: message.name, text: message.text, mine: message.uid === room.selfId && message.kind !== "agent", kind: message.kind, at: message.at }));
}

const SVG = "http://www.w3.org/2000/svg";
/** The line that runs while somebody's assistant is working: a drawn pulse, not a spinner. */
function signalLine(): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "chat-live-signal");
  svg.setAttribute("viewBox", "0 0 120 16");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  for (const name of ["chat-live-signal-track", "chat-live-signal-run"]) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("class", name);
    path.setAttribute("d", "M0 8h28l5-6 6 12 6-10 4 4h22l5-5 5 9 5-4h34");
    path.setAttribute("pathLength", "100");
    svg.append(path);
  }
  return svg;
}

export interface LiveSessionDockDeps {
  readonly currentFolder: () => string | null;
  /** Switch the workbench to a downloaded copy before joining. */
  readonly openFolderAt?: (root: string) => Promise<void>;
  readonly switchFolder?: () => void;
  readonly runCommand?: (command: string, arg?: string) => void;
  readonly openAccount?: () => void;
  readonly editorContext?: () => { readonly activeFile: string | null; readonly cursorLine: number | null } | null;
}

export interface LiveSessionSummary {
  readonly live: boolean;
  readonly open: boolean;
  readonly online: number;
  readonly working: number;
}

export interface LiveSessionDock {
  readonly element: HTMLElement;
  toggle(): void;
  close(): void;
  setWorkspace(root: string | null): void;
  refresh(): void;
  onChange(listener: (summary: LiveSessionSummary) => void): void;
}

interface Session {
  readonly id: string;
  readonly key: string | null;
  readonly title: string;
  readonly host: boolean;
}

const errorText = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^\[\d{3}\]\s*/, "").trim() || fallback;
};

const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "?"}${parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : ""}`.toUpperCase();
};

const statusLabel = (status: string): string => {
  if (status === "working") return "Agent working";
  if (status === "waiting") return "Waiting";
  if (status === "awaiting") return "Awaiting handoff";
  if (status === "handoff") return "Handoff ready";
  if (status === "offline") return "Offline";
  return "Online";
};

const statusTone = (status: string): string =>
  status === "working" || status === "waiting" || status === "awaiting" || status === "handoff" ? "working" : "ready";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function button(label: string, className: string, run: () => void): HTMLButtonElement {
  const element = node("button", className, label);
  element.type = "button";
  element.addEventListener("click", run);
  return element;
}

export function createLiveSessionDock(deps: LiveSessionDockDeps): LiveSessionDock {
  const element = node("aside", "chat-live-dock");
  element.hidden = true;
  element.setAttribute("aria-label", "Live project session");
  const summaryListeners = new Set<(summary: LiveSessionSummary) => void>();

  let root: string | null = null;
  let open = false;
  let dismissed: string | null = null;
  let busy = false;
  let notice = "";
  let noticeTone: "info" | "error" | "success" = "info";
  let link: ProjectLinkView | null = null;
  let room: ArtifactRoomSnapshot | null = null;
  let status: CollabStatusView | null = null;
  let rooms: readonly ArtifactRoomCard[] = [];
  let session: Session | null = null;
  let code = "";
  let me: { readonly name: string } | null = null;
  let signedIn = true;
  let aiReady: boolean | null = null;
  let aiProvider = "";
  let aiModel = "";
  let aiWorking = false;
  let aiTask = "";
  let refreshTimer: number | null = null;
  let polling = false;

  function live(): boolean {
    return session !== null || (status !== null && status.mode !== "off");
  }

  function people(): readonly {
    readonly id: string;
    readonly name: string;
    readonly colour: string;
    readonly role: string;
    readonly path: string | null;
    readonly lane: string;
    readonly watching: boolean;
  }[] {
    if (room !== null) {
      return room.members
        .filter((member) => member.present && member.lane.status !== "offline")
        .map((member) => ({
          id: member.uid,
          name: member.name,
          colour: member.colour,
          role: member.role,
          path: member.presence.path,
          lane: member.lane.status,
          watching: member.watching,
        }));
    }
    return (status?.participants ?? []).map((participant) => ({
      id: participant.id,
      name: participant.name,
      colour: participant.colour,
      role: participant.role,
      path: null,
      lane: "idle",
      watching: participant.role === "viewer",
    }));
  }

  function summary(): LiveSessionSummary {
    const roster = people();
    return {
      live: live(),
      open,
      online: roster.length,
      // A file open in the editor is the clearest sign somebody is working; an agent run
      // counts even before the heartbeat has caught up with their cursor.
      working: roster.filter((person) => person.path !== null || statusTone(person.lane) === "working").length,
    };
  }

  function notify(): void {
    const next = summary();
    for (const listener of summaryListeners) listener(next);
  }

  function say(message: string, tone: "info" | "error" | "success" = "info"): void {
    notice = message;
    noticeTone = tone;
  }

  function setOpen(next: boolean): void {
    open = next;
    element.hidden = !next;
    if (next) dismissed = null;
    else if (session !== null) dismissed = session.id;
    if (next) render();
    else notify();
  }

  function scheduleRefresh(): void {
    if (refreshTimer !== null) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void refresh(true);
    }, 250);
  }

  async function loadMe(): Promise<{ readonly name: string } | null> {
    try {
      const profile = await communityMe();
      signedIn = true;
      me = { name: profile.profile.name || "Builder" };
      return me;
    } catch (failure) {
      signedIn = !/sign in/i.test(errorText(failure, ""));
      me = null;
      return null;
    }
  }

  function keyFrom(linkValue: ProjectLinkView | null): string | null {
    const shareCode = linkValue?.link?.shareCode;
    return typeof shareCode === "string" ? decodeArtifactShare(shareCode)?.key ?? null : null;
  }

  function syncSessionFromLink(): void {
    if (session !== null || link?.link == null || status === null || status.mode === "off") return;
    // A GitHub project share is a different transport; it must not borrow this dock.
    if ((status.sharedProjectId ?? null) !== null || (status.projectInvite ?? null) !== null) return;
    session = {
      id: link.link.artifactId,
      key: keyFrom(link),
      title: link.link.title,
      host: status.mode === "hosting",
    };
  }

  async function loadRoom(): Promise<void> {
    if (session === null) { room = null; return; }
    try {
      room = await window.adcode.community.artifactRoom(session.id, session.key);
    } catch {
      room = null;
    }
  }

  async function sayHi(): Promise<void> {
    if (room === null || session === null || room.selfId === "") return;
    const context = deps.editorContext?.() ?? null;
    const self = room.members.find((member) => member.uid === room?.selfId);
    const holding = self?.lane.status === "awaiting" || self?.lane.status === "handoff";
    try {
      room = await window.adcode.community.artifactRoomAction(session.id, session.key, {
        action: "heartbeat",
        watching: false,
        path: context?.activeFile ?? null,
        line: context?.cursorLine ?? null,
        provider: aiProvider,
        model: aiModel,
        status: holding ? self!.lane.status : aiWorking ? "working" : "idle",
        task: holding ? self!.lane.task : aiTask,
        hasAgent: aiReady,
        files: [],
      });
    } catch {
      /* The room can close while the dock is still looking at it. */
    }
  }

  async function ensureLiveFiles(): Promise<void> {
    if (session === null || session.host || room?.liveInvite === null || room?.liveInvite === undefined) return;
    if (status !== null && status.mode !== "off") return;
    try {
      status = await window.adcode.collab.join(room.liveInvite, me?.name ?? "Builder");
      say("Live files connected. Open a file to see everyone's edits.", "success");
    } catch (failure) {
      say(errorText(failure, "The live files could not connect yet."), "error");
    }
  }

  async function refresh(quiet = false): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const [nextStatus, nextLink] = await Promise.all([
        window.adcode.collab.status().catch(() => null),
        window.adcode.community.projectLink().catch(() => null),
      ]);
      status = nextStatus;
      link = nextLink;
      syncSessionFromLink();
      await loadRoom();
      if (session !== null && room !== null && !room.open) {
        await window.adcode.collab.leave().catch(() => null);
        session = null;
        status = null;
        room = null;
        dismissed = null;
        say("This live session has ended.", "info");
      }
      if (room?.liveInvite !== null && room?.liveInvite !== undefined) await ensureLiveFiles();
      if (session === null) rooms = await window.adcode.community.liveRooms().catch(() => []);
      if (session !== null && (status?.mode === "hosting" || status?.mode === "joined" || status?.mode === "connecting")) {
        if (!open && dismissed !== session.id) setOpen(true);
      }
      if (!quiet || !element.contains(document.activeElement)) render();
      else notify();
    } finally {
      polling = false;
    }
  }

  async function openSessionList(): Promise<void> {
    if (busy) return;
    busy = true;
    render();
    rooms = await window.adcode.community.liveRooms().catch(() => []);
    busy = false;
    render();
  }

  async function start(): Promise<void> {
    if (busy) return;
    busy = true;
    say("");
    render();
    try {
      const profile = await loadMe();
      if (profile === null) { say("Sign in to start a live session.", "error"); return; }
      const current = await window.adcode.community.projectLink();
      link = current;
      if (current.root === null) { say("Open a project first.", "error"); return; }
      if (current.link === null) {
        say("Share this project once, then start a live session for it.");
        deps.runCommand?.("community.shareProject");
        return;
      }
      if (current.link.role !== "owner") { say("This is a remix. Its owner starts the live session; you can join one instead.", "error"); return; }

      const id = current.link.artifactId;
      const existing = await window.adcode.community.artifactRoom(id).catch(() => null);
      if (existing !== null && existing.open && existing.hostUid !== existing.selfId) {
        say("Someone else is hosting this project's session. Join it instead.", "error");
        return;
      }
      room = existing !== null && existing.open
        ? existing
        : await window.adcode.community.openArtifactRoom(id, profile.name, null, null, "Live from chat");

      const previous = await window.adcode.collab.status().catch(() => null);
      if (previous !== null && previous.mode !== "off") await window.adcode.collab.leave().catch(() => null);
      const hosted = await window.adcode.collab.host({
        bind: "internet",
        port: 0,
        displayName: profile.name,
        artifactLive: true,
      });
      if (hosted.invite === null) throw new Error(hosted.error ?? "The live files could not start.");
      status = hosted;
      room = await window.adcode.community.setArtifactRoomLive(id, hosted.invite);
      session = { id, key: null, title: room.title, host: true };
      dismissed = null;
      setOpen(true);
      void sayHi().then(() => refresh(true));
      say("Session live. Share the artifact code and friends can join from their chat.", "success");
    } catch (failure) {
      say(errorText(failure, "The live session could not start."), "error");
    } finally {
      busy = false;
      render();
    }
  }

  async function join(id: string, key: string | null): Promise<void> {
    if (busy) return;
    busy = true;
    say("");
    render();
    try {
      const profile = await loadMe();
      if (profile === null) { say("Sign in to join a live session.", "error"); return; }
      const snapshot = await window.adcode.community.artifactRoom(id, key);
      if (!snapshot.open) { say("That session has ended.", "error"); return; }

      const current = await window.adcode.community.projectLink().catch(() => null);
      if (current?.link?.artifactId !== id) {
        const proceed = await askThemed({
          title: `Join ${snapshot.title}?`,
          body: current?.link
            ? "Live editing needs this artifact's files, not the project you have open. ADCode will download a fresh copy, open it, and then join the session."
            : "Live editing needs this artifact's files on this computer. ADCode will download a copy, open it, and then join the session.",
          confirmLabel: "Download and join",
        });
        if (!proceed) return;
        const nextRoot = await window.adcode.community.remix(id, key);
        if (deps.openFolderAt !== undefined) await deps.openFolderAt(nextRoot);
        else await window.adcode.workspace.openPath(nextRoot);
        link = await window.adcode.community.projectLink().catch(() => null);
      }

      const previous = await window.adcode.collab.status().catch(() => null);
      if (previous !== null && previous.mode !== "off") await window.adcode.collab.leave().catch(() => null);
      room = await window.adcode.community.joinArtifactRoom(id, key, profile.name, false, aiReady, null);
      session = { id, key, title: room.title, host: room.hostUid === room.selfId };
      dismissed = null;
      setOpen(true);
      if (room.liveInvite === null) {
        say("You are in the room. Live files start when the host starts them.");
      } else {
        status = await window.adcode.collab.join(room.liveInvite, profile.name);
        say("Joined. Open a file to see everyone's edits.", "success");
      }
      void sayHi().then(() => refresh(true));
    } catch (failure) {
      say(errorText(failure, "That session could not be joined."), "error");
    } finally {
      busy = false;
      render();
    }
  }

  async function joinCode(): Promise<void> {
    const parsed = decodeArtifactShare(code);
    if (parsed === null) { say("Paste the whole artifact code that starts with adartifact:.", "error"); render(); return; }
    await join(parsed.id, parsed.key);
  }

  async function leave(): Promise<void> {
    if (busy || session === null) return;
    busy = true;
    render();
    try {
      if (session.host) await window.adcode.community.closeArtifactRoom(session.id).catch(() => null);
      else await window.adcode.community.leaveArtifactRoom(session.id).catch(() => null);
      await window.adcode.collab.leave().catch(() => null);
      session = null;
      room = null;
      status = null;
      say("You left the session.", "success");
      setOpen(false);
    } finally {
      busy = false;
      render();
    }
  }

  async function copyInvite(): Promise<void> {
    if (session === null) return;
    try {
      const share = await window.adcode.community.shareArtifact(session.id);
      const key = decodeArtifactShare(share.shareCode)?.key;
      if (key === undefined) throw new Error("The code could not be read.");
      const ok = await copyText(artifactShareMessage(session.title, session.id, key));
      say(ok ? "Invitation copied. Friends paste it under Join with code." : "The invitation could not be copied.", ok ? "success" : "error");
    } catch (failure) {
      say(errorText(failure, "The invitation could not be copied."), "error");
    }
    render();
  }

  function personRow(person: ReturnType<typeof people>[number]): HTMLElement {
    const row = node("li", "chat-live-person");
    row.dataset["tone"] = statusTone(person.lane);
    if (room !== null && person.id === room.selfId) row.dataset["you"] = "true";
    // Everyone gets a mascot of their own - the same one in every member's window - whose face says what their assistant is doing.
    const avatar = node("span", "chat-live-mascot");
    avatar.style.setProperty("--lane-colour", person.colour);
    avatar.setAttribute("aria-hidden", "true");
    avatar.title = initials(person.name);
    avatar.append(createAgentMascot({ look: defaultMascotFor(person.id), mood: laneMood(person.lane, person.path !== null), size: 26 }).element, node("span", "chat-live-avatar-dot"));
    const copy = node("span", "chat-live-person-copy");
    const top = node("span", "chat-live-person-top");
    top.append(node("strong", "", person.name));
    if (room !== null && person.id === room.selfId) top.append(node("span", "chat-live-you", "You"));
    top.append(node("span", "chat-live-role", person.role === "owner" ? "Host" : person.role === "editor" ? "Editor" : person.watching ? "Watching" : "Viewer"));
    copy.append(top);
    copy.append(node("span", "chat-live-where", person.path === null
      ? statusLabel(person.lane)
      : `${person.lane === "working" ? "Agent working" : "Editing"} · ${person.path}`));
    row.append(avatar, copy);
    return row;
  }

  /*
   * Room chat. The list and the box are made once and kept: the dock redraws every few
   * seconds, and a box rebuilt each time would drop what was being typed and the focus with it.
   */
  const chatList = node("ol", "chat-live-chat");
  chatList.setAttribute("aria-label", "Room chat");
  chatList.setAttribute("aria-live", "polite");
  const chatForm = node("form", "chat-live-chat-form");
  const chatInput = node("input", "chat-live-chat-input");
  chatInput.type = "text";
  chatInput.maxLength = 1000;
  chatInput.setAttribute("aria-label", "Message everyone in the room");
  const chatSend = node("button", "chat-live-action", "Send");
  chatSend.type = "submit";
  chatForm.append(chatInput, chatSend);
  let chatPinned = true;
  let chatSeen = "";
  chatList.addEventListener("scroll", () => { chatPinned = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 24; });
  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = chatInput.value.trim();
    if (message === "" || session === null || chatSend.disabled) return;
    chatSend.disabled = true;
    void window.adcode.community.artifactRoomAction(session.id, session.key, { action: "post", text: message }).then((next) => {
      room = next;
      chatInput.value = "";
      chatPinned = true;
      render();
    }, (error: unknown) => say(errorText(error, "That message was not sent. Try again."), "error")).finally(() => {
      chatSend.disabled = false;
      chatInput.focus();
    });
  });

  function chatSection(): HTMLElement {
    const messages = dockMessages(room);
    const newest = messages[messages.length - 1]?.id ?? "";
    // Only rebuilt when something was said: an unchanged list keeps its scroll position and selection.
    if (newest !== chatSeen || chatList.childElementCount !== Math.max(1, messages.length)) {
      const fresh = chatSeen !== "" && newest !== chatSeen;
      chatSeen = newest;
      chatList.replaceChildren();
      if (messages.length === 0) chatList.append(node("li", "chat-live-empty", "Say what you are taking, so nobody doubles up."));
      messages.forEach((message, index) => {
        const row = node("li", "chat-live-message");
        row.dataset["kind"] = message.kind;
        if (message.mine) row.dataset["mine"] = "true";
        if (fresh && index === messages.length - 1) row.dataset["enter"] = "true";
        if (message.kind !== "system") row.append(node("strong", "", message.kind === "agent" ? `${message.name}'s assistant` : message.mine ? "You" : message.name));
        row.append(node("span", "", message.text));
        chatList.append(row);
      });
    }
    const canPost = room !== null && room.open && room.self.role !== "viewer";
    chatInput.disabled = !canPost;
    chatInput.placeholder = canPost ? "Message everyone" : room?.open === false ? "This room has ended" : "Viewers can read the chat";
    const wrap = node("section", "chat-live-chat-wrap");
    wrap.append(node("p", "chat-live-label", "Room chat"), chatList, chatForm);
    return wrap;
  }

  function avatarStack(roster: ReturnType<typeof people>): HTMLElement {
    const stack = node("div", "chat-live-avatars");
    stack.setAttribute("aria-hidden", "true");
    for (const person of roster.slice(0, 5)) {
      const avatar = node("span", "chat-live-avatar", initials(person.name));
      avatar.style.setProperty("--lane-colour", person.colour);
      avatar.title = person.name;
      avatar.append(node("span", "chat-live-avatar-dot"));
      stack.append(avatar);
    }
    if (roster.length > 5) stack.append(node("span", "chat-live-more", `+${String(roster.length - 5)}`));
    return stack;
  }

  function renderLive(): void {
    const roster = people();
    const working = summary().working;
    const head = node("header", "chat-live-head");
    const titleWrap = node("div", "chat-live-title-wrap");
    titleWrap.append(node("span", "chat-live-signal-dot"), node("strong", "chat-live-title", session?.title ?? link?.link?.title ?? "Live session"));
    const headActions = node("div", "chat-live-head-actions");
    headActions.append(node("span", "chat-live-live-chip", "LIVE"));
    headActions.append(button("Hide", "chat-live-hide", () => setOpen(false)));
    head.append(titleWrap, headActions);

    const counts = node("div", "chat-live-counts");
    counts.append(
      node("span", "chat-live-count", `${String(roster.length)} online`),
      node("span", "chat-live-count", `${String(working)} working`),
      avatarStack(roster),
    );

    const list = node("ul", "chat-live-people");
    if (roster.length === 0) list.append(node("li", "chat-live-empty", "Waiting for the first person to join"));
    else for (const person of roster) list.append(personRow(person));

    const actions = node("div", "chat-live-actions");
    if (session?.host === true) {
      actions.append(button("Invite", "chat-live-action", () => { void copyInvite(); }));
      actions.append(button("End session", "chat-live-action chat-live-danger", () => { void leave(); }));
    } else {
      actions.append(button("Leave", "chat-live-action", () => { void leave(); }));
    }

    const foot = node("p", "chat-live-foot");
    if (room?.liveInvite === null) foot.textContent = "Waiting for the host to start live files. The room is open.";
    else if (status === null || status.mode === "off") foot.textContent = "Live files are not connected yet.";
    else foot.textContent = "Edits sync as they type. Cursor colours match the carets in the editor.";

    element.dataset["working"] = String(working > 0);
    const children: (HTMLElement | SVGSVGElement)[] = [head, signalLine(), counts, list];
    if (room !== null) children.push(chatSection());
    if (notice) children.push(node("p", `chat-live-notice chat-live-notice-${noticeTone}`, notice));
    children.push(foot, actions);
    element.replaceChildren(...children);
    // Follow the conversation, unless the person scrolled up to read.
    if (chatPinned) chatList.scrollTop = chatList.scrollHeight;
  }

  function renderIdle(): void {
    const head = node("header", "chat-live-head");
    const titleWrap = node("div", "chat-live-title-wrap");
    titleWrap.append(node("span", "chat-live-signal-dot"), node("strong", "chat-live-title", "Live session"));
    head.append(titleWrap, button("Hide", "chat-live-hide", () => setOpen(false)));
    const children: HTMLElement[] = [head];

    if (!signedIn) {
      children.push(node("p", "chat-live-copy", "Sign in to start a live session or join a friend's."));
      if (deps.openAccount !== undefined) children.push(button("Sign in", "chat-live-action chat-live-primary", deps.openAccount));
      if (notice) children.push(node("p", `chat-live-notice chat-live-notice-${noticeTone}`, notice));
      element.replaceChildren(...children);
      return;
    }

    if (root === null) {
      children.push(node("p", "chat-live-copy", "Open a project to start a live session for it."));
      if (deps.switchFolder !== undefined) children.push(button("Open a project", "chat-live-action chat-live-primary", deps.switchFolder));
      if (notice) children.push(node("p", `chat-live-notice chat-live-notice-${noticeTone}`, notice));
      element.replaceChildren(...children);
      return;
    }

    if (link?.link === null) {
      children.push(node("p", "chat-live-copy", "Share this project once. Then you can start a session for it and invite friends."));
      children.push(button("Share this project", "chat-live-action chat-live-primary", () => deps.runCommand?.("community.shareProject")));
    } else if (link !== null && link.link !== null) {
      if (link.link.role === "owner") {
        children.push(node("p", "chat-live-copy", `Start a session for ${link.link.title}. Everyone who joins edits the same files, live.`));
        children.push(button(busy ? "Starting…" : "Start live session", "chat-live-action chat-live-primary", () => { void start(); }));
      } else {
        children.push(node("p", "chat-live-copy", `${link.link.title} is a remix. Its owner starts the session; you can join one below.`));
      }
    }

    if (notice) children.push(node("p", `chat-live-notice chat-live-notice-${noticeTone}`, notice));

    const list = node("ul", "chat-live-rooms");
    const openRooms = rooms.filter((card) => card.open).slice(0, 4);
    if (openRooms.length === 0) list.append(node("li", "chat-live-empty", "No open sessions right now."));
    for (const card of openRooms) {
      const row = node("li", "chat-live-room");
      const copy = node("span", "chat-live-room-copy");
      copy.append(node("strong", "", card.title), node("span", "chat-live-room-by", `${card.hostName} · ${String(card.memberCount)} here`));
      row.append(copy, button("Join", "chat-live-action", () => { void join(card.artifactId, null); }));
      list.append(row);
    }
    children.push(node("p", "chat-live-label", "Open sessions"), list);

    // The composer itself is a form, and a form inside a form is invalid. This row
    // behaves like one without nesting another submit boundary in the chat.
    const form = node("div", "chat-live-code");
    const input = node("input", "chat-live-code-input");
    input.value = code;
    input.placeholder = "adartifact:…";
    input.setAttribute("aria-label", "Artifact code to join");
    input.addEventListener("input", () => { code = input.value; });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void joinCode();
    });
    form.append(input, button("Join with code", "chat-live-action", () => { void joinCode(); }));
    children.push(form);
    element.replaceChildren(...children);
  }

  function render(): void {
    if (element.hidden) { notify(); return; }
    if (busy) {
      element.replaceChildren(node("p", "chat-live-copy", "Connecting the session…"));
      notify();
      return;
    }
    if (live()) renderLive();
    else renderIdle();
    notify();
  }

  window.adcode.collab.onStatus((next) => {
    status = next;
    syncSessionFromLink();
    scheduleRefresh();
  });
  window.adcode.ai.status().then((ai) => {
    aiReady = ai.ready;
    aiProvider = ai.activeProvider;
    aiModel = ai.activeModel;
  }, () => undefined);
  window.adcode.ai.onRunsChanged((runs) => {
    aiWorking = runs.length > 0;
    aiTask = runs[0]?.title ?? "";
    scheduleRefresh();
  });
  window.setInterval(() => {
    if (!open && !live()) return;
    void sayHi().then(() => refresh(true));
  }, 5000);

  return {
    element,
    toggle: () => {
      if (open) { setOpen(false); return; }
      setOpen(true);
      if (live()) void refresh();
      else void openSessionList();
    },
    close: () => setOpen(false),
    setWorkspace: (next) => {
      if (next === root) return;
      root = next;
      link = null;
      room = null;
      if (!live()) session = null;
      code = "";
      if (open) void refresh();
    },
    refresh: () => { void refresh(); },
    onChange: (listener) => { summaryListeners.add(listener); listener(summary()); },
  };
}
