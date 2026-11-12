/**
 * The Artifacts page: share a project, build one together with friends, or copy one.
 *
 * The owner who built this page could not work out how to use it with his own team, so the
 * first screen now answers one question - what do you want to do? - with three choices in
 * everyday words, and every result says what happened and what to press next. Words a person
 * reads are plain ("shared project", "invite code", "make my copy"); the ids, classes, IPC
 * and storage keys underneath keep their old names so nothing else has to move.
 *
 * - Start (id "discover") - work together, join a friend, find a project to copy, then live
 *   sessions, projects asking for help, and everything shared.
 * - This project - the open folder's relationship to a shared project: share it, publish a
 *   new version, send your copy's changes back, or bring in the latest accepted work.
 * - Sent to you (id "inbox") - changes people sent you, and the ones you sent.
 * - Your shared projects (id "mine") - your level and badges, what you share, what happened.
 */
import { contentFingerprint } from "@adcode/collab";
import {
  artifactShareMessage, changeStats, compactCount, decodeArtifactShare, encodeArtifactShare, findArtifactShare, lineDiff, timeAgo,
  type ArtifactChange, type ArtifactListing, type CommunityMe, type ImprovementDetail, type ImprovementSummary, type ListingSort,
} from "@adcode/community";
import type {
  ArtifactDetail, ArtifactPreview, ArtifactRoomActionView, ArtifactRoomSnapshot, ArtifactVisibility, ProjectLinkView,
} from "../../shared/community.ts";
import type { CollabPresenceView, CollabStatusView } from "../../shared/api.ts";
import { copyText } from "../clipboard.ts";
import { askThemed } from "../dialogs/confirmDialog.ts";
import { communityMe, forgetArtifactRemoved, rememberArtifactRemoved, withoutRemovedArtifacts } from "./communityMe.ts";
import { button, el, field } from "../dialogs/formDialog.ts";
import { createIcon, ICON } from "../workbench/icons.ts";
import { createAdcodeMascot } from "../mascot/adcodeMascot.ts";
import { formatBytes } from "./communityModel.ts";
import {
  activityFor, activityList, chip, createHubShell, detailDialog, door, errorText, list, plural, profileCard, progressBar, reportDialog, section,
  signedOutBox, starButton, stat, watchProgress,
} from "./communityShell.ts";

export type ArtifactsTab = "discover" | "project" | "inbox" | "mine";

export interface ArtifactsPageDeps {
  readonly openFolder: (root: string) => Promise<void>;
  /** Let the person pick another folder to open. */
  readonly pickFolder: () => void;
  readonly askAssistant: (prompt: string) => void;
  readonly signIn: () => void;
  readonly onUnread: (count: number) => void;
  readonly track: (event: string) => void;
  /** The active editor buffer, for lane presence and comment anchors. Null when nothing is open. */
  readonly activeFile: () => { readonly path: string; readonly content: string } | null;
  /** Open a teammate's file at their caret, so "who is working" is one click from their code. */
  readonly openAt: (relativePath: string, line: number, column: number) => void;
}

export interface ArtifactsPage {
  readonly element: HTMLElement;
  shown(): void;
  hidden(): void;
  showTab(tab: ArtifactsTab): void;
  shareProject(): void;
  poll(): Promise<void>;
}

const SORTS: readonly { readonly id: ListingSort; readonly label: string }[] = [
  { id: "trending", label: "Popular now" },
  { id: "new", label: "Newest" },
  { id: "top", label: "Most copied" },
];

/** Set once somebody has started or joined a session: from then on the explainer folds away. */
const TOGETHER_USED_KEY = "adcode.artifacts.togetherUsed";
/** Whether the folded explainer was left open, so it stays the way the person left it. */
const HOW_OPEN_KEY = "adcode.artifacts.howOpen";

/* Storage can be missing or refuse writes (a locked profile, a private window); the page then simply forgets. */
function readFlag(key: string): boolean {
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}
function writeFlag(key: string, value: boolean): void {
  try { window.localStorage.setItem(key, value ? "1" : "0"); } catch { /* Nothing to remember it in. */ }
}

/** What a choice on the first screen led to: one sentence, and the next thing to press. */
interface StartOutcome {
  readonly tone: "working" | "success" | "error" | "info";
  readonly message: string;
  /** An invite code to show large, with its own Copy button. */
  readonly code?: string;
  /** The ready-made message to send with the code, for a second Copy button. */
  readonly invite?: string;
  readonly actions?: readonly { readonly label: string; readonly run: () => void; readonly primary?: boolean }[];
}

/** An empty list that names the next step as a button, not only as words. */
function emptyWith(text: string, ...actions: HTMLElement[]): HTMLElement {
  const box = el("div", "community-empty");
  const row = el("div", "community-row-actions artifacts-empty-actions");
  row.append(...actions);
  box.append(el("p", "", text), row);
  return box;
}

/** A sentence that joins names the way a person would say them: "Asha, Ben and you". */
function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A plan step's status in words; the stored values stay as the room's rules spell them. */
const STEP_WORDS: Readonly<Record<string, string>> = { todo: "To do", doing: "Doing", done: "Done", blocked: "Stuck" };

/** Two letters at most: a lane should read as a person before it reads as a row. */
function roomInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase();
}

function roomStatusLabel(status: string): string {
  if (status === "working") return "Agent working";
  if (status === "waiting") return "Waiting";
  if (status === "awaiting") return "Awaiting handoff";
  if (status === "handoff") return "Handoff ready";
  if (status === "offline") return "Offline";
  return "Idle";
}

function roomChip(text: string, tone: string): HTMLElement {
  const node = chip(text, "community-chip community-live-chip");
  node.dataset["tone"] = tone;
  return node;
}

function roomFact(label: string, value: string, mono = false): HTMLElement {
  const node = el("span", "community-live-fact");
  node.append(el("span", "community-live-fact-label", label), el("strong", mono ? "community-live-fact-value community-live-file" : "community-live-fact-value", value));
  return node;
}

/** A single bar, filled from the left with transform so a repaint cannot make it jump. */
function roomMeter(percent: number, label: string): HTMLElement {
  const meter = el("div", "community-live-meter");
  meter.setAttribute("role", "progressbar");
  meter.setAttribute("aria-label", label);
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", "100");
  meter.setAttribute("aria-valuenow", String(Math.round(percent)));
  const fill = el("span", "community-live-meter-fill");
  fill.style.setProperty("--value", String(Math.max(0, Math.min(1, percent / 100))));
  meter.append(fill);
  return meter;
}

export function createArtifactsPage(deps: ArtifactsPageDeps): ArtifactsPage {
  let sort: ListingSort = "trending";
  let helpOnly = false;
  let me: CommunityMe | null = null;
  const accessKeys = new Map<string, string>();

  const shell = createHubShell<ArtifactsTab>({
    name: "artifacts",
    title: "Artifacts",
    summary: "Share a project, or build one together with friends - everyone's AI works from the same plan.",
    searchLabel: "Search shared projects",
    tabs: [
      { id: "discover", label: "Start" },
      { id: "project", label: "This project" },
      { id: "inbox", label: "Sent to you" },
      { id: "mine", label: "Your shared projects" },
    ],
    render: (tab) => (tab === "discover" ? renderDiscover() : tab === "project" ? renderProject() : tab === "inbox" ? renderInbox() : renderMine()),
  });
  const { say, attempt } = shell;

  /*
   * Buck stands beside the title and shows how things are going: a wave on arrival, typing
   * while something runs, a cheer when it worked, a wince when it did not. The words beside
   * him always say the same thing, so he is decoration to a screen reader.
   */
  // No size here: the stylesheet sizes him, smaller when the page is narrow.
  const buck = createAdcodeMascot({ mood: "idle" });
  const buckSlot = el("span", "artifacts-buck");
  buckSlot.append(buck.element);
  shell.element.querySelector(".community-header")?.prepend(buckSlot);

  /* ---------- Start: the three choices ---------- */

  let outcome: StartOutcome | null = null;
  let running = false;
  const outcomeBox = el("div", "artifacts-outcome");
  outcomeBox.setAttribute("role", "status");
  outcomeBox.setAttribute("aria-live", "polite");
  outcomeBox.hidden = true;

  function setOutcome(next: StartOutcome | null): void {
    outcome = next;
    drawOutcome();
    if (next === null) return;
    if (next.tone === "working") buck.setMood("working");
    else {
      buck.setMood("idle");
      if (next.tone === "success") buck.play("celebrating");
      else if (next.tone === "error") buck.play("error", 3200);
    }
  }

  function drawOutcome(): void {
    if (outcome === null) { outcomeBox.hidden = true; outcomeBox.replaceChildren(); return; }
    outcomeBox.hidden = false;
    outcomeBox.dataset["tone"] = outcome.tone;
    const parts: HTMLElement[] = [el("p", "artifacts-outcome-text", outcome.message)];
    if (outcome.code !== undefined) {
      const code = outcome.code;
      const row = el("div", "artifacts-code-row");
      // A text area so the whole code wraps into view on a narrow window instead of being cut off.
      const box = el("textarea", "ad-input artifacts-code");
      box.readOnly = true;
      box.rows = 1;
      box.spellcheck = false;
      box.value = code;
      box.setAttribute("aria-label", "Invite code");
      box.addEventListener("focus", () => box.select());
      const copy = button("Copy code", "ad-btn ad-btn-primary artifacts-big-btn", () => {
        void copyText(code).then((ok) => {
          copy.textContent = ok ? "Copied" : "Copy code";
          say(ok ? "Invite code copied. Paste it in a message to your friends." : "Could not copy. Select the code and copy it yourself.", ok ? "info" : "error");
          window.setTimeout(() => { copy.textContent = "Copy code"; }, 2400);
        });
      });
      row.append(box, copy);
      parts.push(row);
    }
    const actions = el("div", "artifacts-outcome-actions");
    if (outcome.invite !== undefined) {
      const invite = outcome.invite;
      actions.append(button("Copy a ready-made message", "ad-btn artifacts-big-btn", () => {
        void copyText(invite).then((ok) => say(ok ? "Message copied. It tells your friends how to install ADCode and join." : "Could not copy the message.", ok ? "info" : "error"));
      }));
    }
    for (const action of outcome.actions ?? []) {
      actions.append(button(action.label, action.primary === true ? "ad-btn ad-btn-primary artifacts-big-btn" : "ad-btn artifacts-big-btn", action.run));
    }
    if (actions.childElementCount > 0) parts.push(actions);
    outcomeBox.replaceChildren(...parts);
    // On a narrow window the result lands below the other two choices; bring it into view.
    if (outcome.tone !== "working" && outcomeBox.isConnected) {
      const box = outcomeBox.getBoundingClientRect();
      if (box.top < 0 || box.bottom > window.innerHeight) {
        const still = document.documentElement.dataset["reducedMotion"] === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        outcomeBox.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "nearest" });
      }
    }
  }

  /** The signed-in person's name, or null with the reason already said on the page. */
  async function personName(): Promise<string | null> {
    if (me !== null) return me.profile.name || "Builder";
    try {
      me = await communityMe();
      return me.profile.name || "Builder";
    } catch (failure) {
      const text = errorText(failure, "");
      setOutcome(/sign in/i.test(text)
        ? { tone: "info", message: "Sign in first - friends need to know who you are. Then press the button again.", actions: [{ label: "Sign in", run: deps.signIn, primary: true }] }
        : { tone: "error", message: `${text || "ADCode could not reach the shared projects service"}. Check your connection and try again.` });
      return null;
    }
  }

  function markTogetherUsed(): void {
    if (readFlag(TOGETHER_USED_KEY)) return;
    writeFlag(TOGETHER_USED_KEY, true);
    // Folded from now on, but left open for this visit so the steps do not jump away mid-read.
    writeFlag(HOW_OPEN_KEY, true);
  }

  /** "Work together on this project": share the open folder if needed, then start a session. */
  async function startTogether(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const person = await personName();
      if (person === null) return;
      setOutcome({ tone: "working", message: "Getting your project ready..." });
      const link = await window.adcode.community.projectLink().catch(() => null);
      if (link === null) { setOutcome({ tone: "error", message: "ADCode could not read the open folder. Open your project again and press Start working together." }); return; }
      if (link.root === null) {
        setOutcome({ tone: "info", message: "First choose the project folder you want to work on together, then press Start working together again.", actions: [{ label: "Choose a folder", run: deps.pickFolder, primary: true }] });
        return;
      }
      if (link.link === null) {
        setOutcome({ tone: "info", message: "Check what will be shared, then press Share and start. Only the project's own files go - never keys, .env files or anything .gitignore leaves out." });
        buck.setMood("idle");
        shareProject([], true);
        return;
      }
      if (link.link.role !== "owner") {
        const original = link.link;
        const key = original.shareCode === null || original.shareCode === undefined ? null : decodeArtifactShare(original.shareCode)?.key ?? null;
        setOutcome({
          tone: "info",
          message: `This folder is your copy of ${original.title}. Its owner runs the session, so join theirs - or share your copy as a project of your own.`,
          actions: [
            { label: "Join the owner's session", run: () => void liveRoom(original.artifactId, key, false), primary: true },
            { label: "Share my copy as my own", run: () => shareProject([], true) },
          ],
        });
        return;
      }
      await continueTogether(link.link.artifactId, link.link.title, person);
    } finally {
      running = false;
    }
  }

  /** The shared project exists: open its room, start live editing, and hand over the code. */
  async function continueTogether(id: string, title: string, person: string): Promise<void> {
    setOutcome({ tone: "working", message: "Starting a live session for your friends..." });
    try {
      const share = await window.adcode.community.shareArtifact(id);
      const key = decodeArtifactShare(share.shareCode)?.key ?? null;
      const invite = key === null ? undefined : artifactShareMessage(title, id, key);
      const openRoom = { label: "Open the team room", run: () => void liveRoom(id, null, true) };
      let room = await window.adcode.community.artifactRoom(id).catch(() => null);
      if (room !== null && room.open && room.hostUid !== room.selfId) {
        setOutcome({ tone: "success", message: "Someone on your team is already running a session for this project. Send this code to your friends so they can join it:", code: share.shareCode, ...(invite === undefined ? {} : { invite }), actions: [openRoom] });
        return;
      }
      if (room === null || !room.open) room = await window.adcode.community.openArtifactRoom(id, person, null, null, "Working together");
      let liveNote = "";
      if (room.liveInvite === null) {
        try {
          const previous = await window.adcode.collab.status().catch(() => null);
          if (previous !== null && previous.mode !== "off") await window.adcode.collab.leave().catch(() => null);
          const hosted = await window.adcode.collab.host({ bind: "internet", port: 0, displayName: person, artifactLive: true });
          if (hosted.invite === null) throw new Error(hosted.error ?? "Live editing could not start.");
          room = await window.adcode.community.setArtifactRoomLive(id, hosted.invite);
        } catch (failure) {
          liveNote = ` (Live editing did not start: ${errorText(failure, "no connection").replace(/\.$/, "")}. Press Start live editing in the team room to try again.)`;
        }
      }
      markTogetherUsed();
      deps.track("artifact_together_started");
      setOutcome({
        tone: "success",
        message: `Your project is shared. Send this code to your friends - they paste it under Join a friend:${liveNote}`,
        code: share.shareCode,
        ...(invite === undefined ? {} : { invite }),
        actions: [openRoom],
      });
      void renderDiscoverQuietly();
    } catch (failure) {
      setOutcome({ tone: "error", message: `${errorText(failure, "The session could not start").replace(/\.$/, "")}. Check your connection and press Start working together again.` });
    }
  }

  /** "Join a friend": find the code in whatever was pasted, download if needed, and join live. */
  async function joinFriend(text: string): Promise<void> {
    if (running) return;
    const parsed = findArtifactShare(text);
    if (parsed === null) {
      joinError.textContent = text.trim() === ""
        ? "Paste the invite code your friend sent you first."
        : "That is not an invite code. Paste the whole message your friend sent - ADCode finds the code in it.";
      joinError.hidden = false;
      joinInput.setAttribute("aria-invalid", "true");
      buck.play("error", 2400);
      joinInput.focus();
      return;
    }
    joinError.hidden = true;
    joinInput.removeAttribute("aria-invalid");
    running = true;
    try {
      const person = await personName();
      if (person === null) return;
      const { id, key } = parsed;
      setOutcome({ tone: "working", message: "Opening your friend's project..." });
      let detail: ArtifactDetail;
      try {
        detail = await window.adcode.community.openSharedArtifact(encodeArtifactShare(id, key));
      } catch (failure) {
        setOutcome({ tone: "error", message: `${errorText(failure, "That invite code did not open anything").replace(/\.$/, "")}. Ask your friend to send the code again - it may have been replaced.` });
        return;
      }
      accessKeys.set(id, key);
      const owner = detail.ownerName || "your friend";
      const current = await window.adcode.community.projectLink().catch(() => null);
      if (current?.link?.artifactId === id && current.link.role === "owner") {
        running = false;
        await startTogether();
        return;
      }
      let live = true;
      try {
        const room = await window.adcode.community.artifactRoom(id, key);
        live = room.open;
      } catch (failure) {
        // Not a member yet is fine - that is what joining is for. Not opened means nobody is working in it.
        live = !/has not been opened/i.test(errorText(failure, ""));
      }
      if (!live) {
        setOutcome({
          tone: "info",
          message: `You can open ${detail.title} by ${owner}, but nobody is working in it right now. Make your own copy, or ask ${owner} to press Start working together.`,
          actions: [
            { label: "Make my copy", run: () => void remix(id, detail.title, key), primary: true },
            { label: "See the project", run: () => showArtifact(detail, key) },
          ],
        });
        return;
      }
      if (current?.link?.artifactId !== id) {
        buck.setMood("idle");
        const proceed = await askThemed({
          title: `Join ${detail.title}?`,
          body: "To build it together you need the project's files on this computer. ADCode puts a copy in Documents → ADCode Projects, opens it, and joins everyone. The owner's copy stays the main one while you are live.",
          confirmLabel: "Download and join",
        });
        if (!proceed) { setOutcome({ tone: "info", message: "Nothing was downloaded. Press Join again whenever you are ready." }); return; }
        setOutcome({ tone: "working", message: `Downloading ${detail.title}...` });
        const root = await withProgress(`join-live:${id}`, `Downloading ${detail.title}`, () => window.adcode.community.remix(id, key), "The project could not be downloaded.");
        if (root === null) { setOutcome({ tone: "error", message: "The project could not be downloaded. Check your connection and press Join again." }); return; }
        await deps.openFolder(root);
      }
      setOutcome({ tone: "working", message: `Joining ${owner}...` });
      const joined = await window.adcode.community.joinArtifactRoom(id, key, person, false, null, null);
      const openRoom = { label: "Open the team room", run: () => void liveRoom(id, key, false), primary: true };
      let message = `You joined ${owner}'s project. Your changes sync live - open any file to see everyone's edits.`;
      if (joined.liveInvite === null) {
        message = `You joined ${owner}'s project. Your changes will sync live as soon as ${owner} starts live editing.`;
      } else {
        try {
          const previous = await window.adcode.collab.status().catch(() => null);
          if (previous !== null && previous.mode !== "off") await window.adcode.collab.leave().catch(() => null);
          await window.adcode.collab.join(joined.liveInvite, person);
        } catch {
          message = `You joined ${owner}'s project, but live editing could not connect yet. Open the team room and press Join live editing.`;
        }
      }
      joinInput.value = "";
      syncJoinButton();
      markTogetherUsed();
      deps.track("artifact_joined_friend");
      setOutcome({ tone: "success", message, actions: [openRoom] });
    } catch (failure) {
      setOutcome({ tone: "error", message: `${errorText(failure, "Could not join").replace(/\.$/, "")}. Check the code and your connection, then press Join again.` });
    } finally {
      running = false;
    }
  }

  const joinInput = el("input", "ad-input artifacts-join-input");
  joinInput.type = "text";
  joinInput.placeholder = "Paste code here";
  joinInput.autocomplete = "off";
  joinInput.spellcheck = false;
  joinInput.setAttribute("aria-label", "Invite code from a friend");
  const joinButton = button("Join", "ad-btn artifacts-big-btn", () => void joinFriend(joinInput.value));
  const joinError = el("p", "artifacts-join-error");
  joinError.setAttribute("role", "alert");
  joinError.hidden = true;
  /* Join turns primary once there is something to join with, so the first screen never offers two equal first presses. */
  function syncJoinButton(): void {
    joinButton.classList.toggle("ad-btn-primary", joinInput.value.trim() !== "");
  }
  joinInput.addEventListener("input", () => { syncJoinButton(); if (!joinError.hidden) { joinError.hidden = true; joinInput.removeAttribute("aria-invalid"); } });
  joinInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void joinFriend(joinInput.value);
  });

  const togetherLine = el("p", "artifacts-choice-text", "Shares the folder you have open and gives you a code to send your friends.");
  const togetherButton = button("Start working together", "ad-btn ad-btn-primary artifacts-big-btn", () => void startTogether());

  function choice(kind: string, icon: string, title: string, text: HTMLElement, ...controls: HTMLElement[]): HTMLElement {
    const card = el("article", "artifacts-choice");
    card.dataset["choice"] = kind;
    const tile = el("span", "artifacts-choice-icon");
    tile.setAttribute("aria-hidden", "true");
    tile.append(createIcon(icon));
    const head = el("div", "artifacts-choice-head");
    head.append(tile, el("h3", "artifacts-choice-title", title));
    const foot = el("div", "artifacts-choice-foot");
    foot.append(...controls);
    card.append(head, text, foot);
    return card;
  }

  const joinRow = el("div", "artifacts-join");
  joinRow.append(joinInput, joinButton);
  const choices = el("div", "artifacts-choices");
  choices.append(
    choice("together", ICON.projects, "Work together on this project", togetherLine, togetherButton),
    choice("join", ICON.search, "Join a friend", el("p", "artifacts-choice-text", "Paste the code a friend sent you. You will be in their project in a moment."), joinRow, joinError),
    choice("copy", ICON.checklist, "Find a project to copy", el("p", "artifacts-choice-text", "Look through projects people shared and make your own copy to change."), button("Browse shared projects", "ad-btn artifacts-big-btn", () => showAllShared())),
  );
  const start = el("section", "artifacts-start");
  start.setAttribute("aria-label", "What would you like to do?");
  start.append(choices, outcomeBox);

  /** Say which folder "this project" means before anybody presses, so the button holds no surprise. */
  function describeTogether(link: ProjectLinkView | null): void {
    togetherLine.replaceChildren();
    if (link === null || link.root === null) {
      togetherLine.textContent = "Pick the project folder to share, then send your friends a code.";
      togetherButton.textContent = "Choose a folder and start";
      return;
    }
    const name = link.link?.title ?? link.root.split(/[\\/]/).pop() ?? "this project";
    if (link.link?.role === "remix") {
      togetherLine.append(document.createTextNode("You have "), el("strong", "", name), document.createTextNode(" open - a copy of someone's project. Join its owner, or share it as your own."));
    } else {
      togetherLine.append(document.createTextNode("Shares "), el("strong", "", name), document.createTextNode(link.link === null ? " privately and gives you a code to send your friends." : " with your friends and gives you its invite code."));
    }
    togetherButton.textContent = "Start working together";
  }

  function howItWorks(): HTMLElement {
    const steps = el("ol", "artifacts-how-steps");
    const words: readonly (readonly [string, string])[] = [
      ["Share your project", "Press Start working together. You get an invite code."],
      ["Friends join with your code", "They paste it under Join a friend and press Join."],
      ["Everyone's AI sees the same plan and chat", "So nobody redoes what someone else just finished."],
    ];
    words.forEach(([title, line], index) => {
      const item = el("li", "artifacts-how-step");
      item.append(el("span", "artifacts-how-number", String(index + 1)), el("strong", "artifacts-how-title", title), el("span", "artifacts-how-line", line));
      steps.append(item);
    });
    const heading = "How working together works";
    if (!readFlag(TOGETHER_USED_KEY)) {
      const box = el("section", "artifacts-how");
      box.append(el("h2", "artifacts-how-heading", heading), steps);
      return box;
    }
    // Once someone has done it, the steps fold into one line they can open again.
    const box = el("details", "artifacts-how");
    box.open = readFlag(HOW_OPEN_KEY);
    box.addEventListener("toggle", () => writeFlag(HOW_OPEN_KEY, box.open));
    box.append(el("summary", "artifacts-how-heading", heading), steps);
    return box;
  }

  /** "Find a project to copy": the list is further down the same tab, so go there and land on it. */
  function showAllShared(): void {
    shell.search.value = "";
    if (helpOnly) { helpOnly = false; }
    const go = (): void => {
      const target = shell.panel("discover").querySelector<HTMLElement>("#artifacts-all-title");
      if (target === null) return;
      const still = document.documentElement.dataset["reducedMotion"] === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
      target.focus({ preventScroll: true });
    };
    if (shell.current() !== "discover") { shell.showTab("discover"); window.setTimeout(go, 400); return; }
    go();
  }

  /** Repaint Start behind a result, without the loading flash, so its live list catches up. */
  async function renderDiscoverQuietly(): Promise<void> {
    if (shell.current() === "discover" && shell.visible()) await renderDiscover();
  }

  /* ---------- Start: the lists ---------- */

  /* ---------- Discover ---------- */

  function artifactCard(artifact: ArtifactListing): HTMLElement {
    const card = el("article", "community-card community-artifact-card");
    const names = el("div", "community-card-names");
    names.append(button(artifact.title, "community-card-title", () => void openArtifact(artifact.id)), el("span", "community-card-by", `by ${artifact.ownerName} · v${artifact.version} · ${timeAgo(artifact.updatedAt, Date.now())}`));
    const top = el("div", "community-card-top");
    top.append(names);
    card.append(top, el("p", "community-card-text", artifact.description));
    if (artifact.helpWanted) {
      const help = el("p", "community-help-wanted");
      help.append(el("strong", "", "Asking for help: "), document.createTextNode(artifact.helpWanted));
      card.append(help);
    }
    const meta = el("div", "community-card-meta");
    meta.append(stat(artifact.remixes === 1 ? "copy" : "copies", compactCount(artifact.remixes)), stat(artifact.stars === 1 ? "star" : "stars", compactCount(artifact.stars)), stat(artifact.contributors === 1 ? "helper" : "helpers", compactCount(artifact.contributors)));
    for (const tag of artifact.tags.slice(0, 3)) meta.append(chip(tag));
    const foot = el("div", "community-card-foot");
    foot.append(el("span", "community-card-contributes", `${plural(artifact.fileCount, "file")} · ${formatBytes(artifact.bytes)}`), button("Make my copy", "ad-btn", () => void remix(artifact.id, artifact.title)));
    card.append(meta, foot);
    return card;
  }

  async function renderDiscover(): Promise<void> {
    const panel = shell.panel("discover");
    shell.loading(panel);
    const query = shell.search.value.trim();
    const doors = el("div", "community-doors");
    doors.append(
      door(ICON.checklist, "Help someone with their project", "Make a copy, improve it with your AI, and send your changes back. Accepted help is worth 20 points", () => { helpOnly = true; void renderDiscover(); }),
      door(ICON.edit, "Send your changes back", "Changed your copy of someone's project? Send it to its owner from This project", () => shell.showTab("project")),
      door(ICON.projects, "Share without working live", "List this project so anyone can make a copy and send you changes", () => shareProject()),
    );
    const bar = el("div", "community-bar");
    const help = button("Only projects asking for help", "community-category", () => { helpOnly = !helpOnly; void renderDiscover(); });
    help.setAttribute("aria-pressed", String(helpOnly));
    const sortSelect = el("select", "ad-select community-sort");
    sortSelect.setAttribute("aria-label", "Sort shared projects");
    for (const option of SORTS) sortSelect.append(new Option(option.label, option.id, false, option.id === sort));
    sortSelect.addEventListener("change", () => { sort = sortSelect.value as ListingSort; void renderDiscover(); });
    bar.append(el("p", "community-section-note", "Make my copy puts a project in a folder of your own. The owner sees anything you send back, file by file, before accepting it"), help, sortSelect);
    const [home, listings, live, link] = await Promise.all([
      query === "" && !helpOnly ? window.adcode.community.home().then((value) => value, () => null) : Promise.resolve(null),
      window.adcode.community.artifacts(sort, query, helpOnly).then((value) => value, () => null),
      query === "" && !helpOnly ? window.adcode.community.liveRooms().then((value) => value, () => []) : Promise.resolve([]),
      window.adcode.community.projectLink().then((value) => value, () => null),
    ]);
    describeTogether(link);
    const first = query === "" && !helpOnly;
    if (listings === null) {
      // The three choices still work offline enough to say why they cannot finish, so they stay.
      const box = el("div", "community-empty");
      box.append(el("p", "", "Shared projects could not be reached. Check your connection"), button("Try again", "ad-btn ad-btn-primary", () => void renderDiscover()));
      panel.replaceChildren(...(first ? [start, howItWorks()] : []), box);
      return;
    }
    const liveCards = live.filter((room) => room.open).map((room) => {
      const card = el("article", "community-card community-live-card");
      const top = el("div", "community-card-top");
      const names = el("div", "community-card-names");
      names.append(button(room.title, "community-card-title", () => void liveRoom(room.artifactId, null, false)), el("span", "community-card-by", `${room.hostName} · ${room.branch}`));
      top.append(names, roomChip("Live", "live"));
      card.append(top, el("p", "community-card-text", room.task || "A fresh live session"));
      const presence = el("div", "community-live-card-presence");
      presence.append(el("span", "community-live-signal-dot"), el("span", "community-card-by", `${plural(room.memberCount, "person", "people")} here`));
      card.append(presence, roomMeter(room.percent, "Plan progress"));
      const meta = el("div", "community-card-meta");
      meta.append(stat("done", `${room.percent}%`), stat("files", String(room.files.length)), stat("waiting", String(room.approvals + room.handoffs)));
      if (room.warnings > 0) meta.append(chip(`${room.warnings} overlap${room.warnings === 1 ? "" : "s"}`));
      card.append(meta);
      return card;
    });
    const all = section(helpOnly ? "Asking for help" : "All shared projects", home !== null && first ? `${plural(home.totals.artifacts, "shared project")} from ${plural(home.totals.creators, "person", "people")}` : "", el("div", ""));
    const allTitle = all.querySelector<HTMLElement>(".community-section-title");
    if (allTitle !== null) { allTitle.id = "artifacts-all-title"; allTitle.tabIndex = -1; }
    const empty = query
      ? emptyWith(`No shared projects match "${query}".`, button("Clear the search", "ad-btn ad-btn-primary", () => { shell.search.value = ""; void renderDiscover(); }))
      : helpOnly
        ? emptyWith("Nobody is asking for help right now.", button("Show all shared projects", "ad-btn ad-btn-primary", () => { helpOnly = false; void renderDiscover(); }))
        : emptyWith("Nobody has shared a project yet. Be the first.", button("Share this project", "ad-btn ad-btn-primary", () => shareProject()));
    panel.replaceChildren(
      ...(first ? [start, howItWorks()] : []),
      ...(liveCards.length > 0 ? [section("Live now", "Sessions with people and their AI working right now. Open one to watch or join", shell.grid(liveCards, ""))] : []),
      ...(home !== null && home.helpWanted.length > 0 ? [section("Asking for help", "These owners would like a hand. Make a copy, improve it, send your changes back", shell.grid(home.helpWanted.map(artifactCard), ""))] : []),
      all,
      bar,
      listings.length === 0 ? empty : shell.grid(listings.map(artifactCard), ""),
      ...(first ? [section("Other things you can do", "", doors)] : []),
    );
  }

  /* ---------- This project ---------- */

  async function renderProject(): Promise<void> {
    const panel = shell.panel("project");
    shell.loading(panel);
    const link = await attempt<ProjectLinkView>(() => window.adcode.community.projectLink(), "Could not read the open project.");
    if (link === null || link.root === null) {
      panel.replaceChildren(emptyWith(
        "No project folder is open. Open one to share it, or make a copy of someone else's project.",
        button("Open a folder", "ad-btn ad-btn-primary", deps.pickFolder),
        button("Find a project to copy", "ad-btn", () => showAllShared()),
      ));
      return;
    }
    const changed = link.changes.length;
    const behind = link.link !== null && link.latestVersion !== null && link.latestVersion > link.link.version;
    const banner = el("div", "community-banner");
    const actions = el("div", "community-row-actions");
    const words = el("p", "");
    if (link.link === null) {
      words.append(el("strong", "", link.root.split(/[\\/]/).pop() ?? "This project"), document.createTextNode(" is not shared yet. Work on it with friends, or share it so anyone can make a copy and send you changes."));
      actions.append(button("Work together on it", "ad-btn ad-btn-primary", () => { shell.showTab("discover"); void startTogether(); }), button("Share this project", "ad-btn", () => shareProject()));
    } else if (link.link.role === "owner") {
      words.append(el("strong", "", link.link.title), document.createTextNode(` · you share this as version ${link.link.version}. ${changed === 0 ? "No changes here since." : `${plural(changed, "file")} changed since.`}${behind ? ` Version ${link.latestVersion} has changes you accepted - bring them in.` : ""}`));
      if (behind) actions.append(button(`Get version ${link.latestVersion}`, "ad-btn ad-btn-primary", () => void pullLatest()));
      actions.append(button(changed > 0 ? "Publish new version" : "Edit details", changed > 0 && !behind ? "ad-btn ad-btn-primary" : "ad-btn", () => shareProject()), button("Invite code", "ad-btn", () => void (async () => {
        const detail = await attempt<ArtifactDetail>(() => window.adcode.community.artifact(link.link!.artifactId), "That shared project could not be loaded.");
        if (detail !== null) shareSettings(detail);
      })()), button("Team room", "ad-btn", () => void liveRoom(link.link!.artifactId, null, true)), button("See its page", "ad-btn", () => void openArtifact(link.link!.artifactId)));
    } else {
      words.append(document.createTextNode("Your copy of "), el("strong", "", link.link.title), document.createTextNode(` (version ${link.link.version}). ${changed === 0 ? "Change something, then send your changes back to the owner." : `${plural(changed, "file")} changed - ready to send back.`}${behind ? ` The original is at version ${link.latestVersion} now.` : ""}`));
      if (behind) actions.append(button("Get the latest version", "ad-btn", () => void pullLatest()));
      const send = button("Send your changes back", "ad-btn ad-btn-primary", () => sendImprovement(link));
      send.disabled = changed === 0;
      actions.append(send, button("Share as my own", "ad-btn", () => shareProject()), button("Team room", "ad-btn", () => {
        const key = link.link!.shareCode === null || link.link!.shareCode === undefined ? null : decodeArtifactShare(link.link!.shareCode)?.key ?? null;
        void liveRoom(link.link!.artifactId, key, false);
      }));
    }
    banner.append(words, actions);
    const parts: HTMLElement[] = [banner];
    if (link.link !== null && changed > 0) {
      const rows = link.changes.slice(0, 60).map((change) => {
        const row = el("li", "community-installed-row");
        const names = el("div", "community-card-names");
        names.append(el("span", "community-file-path", change.path));
        row.append(chip(change.kind, `community-chip community-change-${change.kind}`), names, el("span", "community-diffstat", `+${change.added} −${change.removed}`));
        return row;
      });
      parts.push(section("Changed here", `Since version ${link.link.version}`, list(rows, "")));
    }
    panel.replaceChildren(...parts);
  }

  async function pullLatest(): Promise<void> {
    const link = await window.adcode.community.projectLink().catch(() => null);
    const result = await withProgress(`pull:${link?.link?.artifactId ?? ""}`, "Downloading the latest version", () => window.adcode.community.pullLatest(), "Could not get the latest version.");
    if (result === null) return;
    say(result.conflicts.length === 0
      ? `Updated to version ${result.version}: ${plural(result.applied, "file")} changed`
      : `Updated to version ${result.version}. ${plural(result.conflicts.length, "file")} you edited were left alone: ${result.conflicts.slice(0, 4).join(", ")}`);
    shell.rerender();
  }

  /** A download with its bar in the page's status line; resolves with the action's result or null. */
  async function withProgress<R>(key: string, label: string, run: () => Promise<R>, fallback: string): Promise<R | null> {
    const bar = progressBar(label);
    const stop = watchProgress(key, bar.update);
    const line = el("div", "community-progress-line");
    line.append(bar.element);
    shell.element.querySelector(".community-tabs")?.after(line);
    try {
      const result = await attempt(run, fallback);
      if (result !== null) await bar.complete();
      return result;
    } finally {
      stop();
      line.remove();
    }
  }

  async function remix(id: string, name: string, key: string | null = null): Promise<void> {
    const ok = await askThemed({ title: `Make your own copy of ${name}?`, body: "ADCode copies the latest version into a new folder in Documents → ADCode Projects and opens it. Change anything you like; when you are happy, send your changes back from This project.", confirmLabel: "Make my copy" });
    if (!ok) return;
    buck.setMood("working");
    const root = await withProgress(`remix:${id}`, `Downloading ${name}`, () => window.adcode.community.remix(id, key), "That shared project could not be copied.");
    buck.setMood("idle");
    if (root === null) { buck.play("error", 2400); return; }
    buck.play("celebrating");
    deps.track("artifact_remixed");
    say(`Your copy is ready in ${root}. Change anything, then send your changes back from This project.`);
    await deps.openFolder(root);
  }

  async function openArtifact(id: string, key: string | null = null): Promise<void> {
    const detail = await attempt<ArtifactDetail>(() => window.adcode.community.artifact(id, key), "That shared project could not be loaded.");
    if (detail === null) return;
    if (key !== null) accessKeys.set(id, key);
    showArtifact(detail, key);
  }

  function showArtifact(detail: ArtifactDetail, key: string | null = null): void {
    const { dialog, card, finish } = detailDialog("community-detail", detail.title);
    card.append(el("p", "community-card-by", `by ${detail.ownerName} · version ${detail.version} · ${plural(detail.fileCount, "file")} · ${formatBytes(detail.bytes)}`), el("p", "result-summary", detail.description));
    if (detail.helpWanted) {
      const help = el("p", "community-help-wanted");
      help.append(el("strong", "", "Asking for help: "), document.createTextNode(detail.helpWanted));
      card.append(help);
    }
    const meta = el("div", "community-card-meta");
    meta.append(stat("copies", compactCount(detail.remixes)), stat("changes accepted", compactCount(detail.improvements)), chip(detail.visibility === "private" ? "Private - invite code only" : "Public"));
    card.append(meta);
    if (detail.contributorNames.length > 0) card.append(el("p", "community-card-by", `Improved by ${detail.contributorNames.join(", ")}`));
    if (detail.readme) card.append(el("h3", "community-dialog-subtitle", "Read me"), el("p", "community-readme-text", detail.readme));
    const files = el("details", "community-files");
    files.append(el("summary", "", plural(detail.paths.length, "file")));
    const paths = el("ul", "");
    for (const path of detail.paths.slice(0, 300)) paths.append(el("li", "", path));
    files.append(paths);
    card.append(files);
    if (detail.versions.length > 0) {
      const versions = el("ul", "community-versions");
      for (const version of detail.versions.slice(0, 8)) versions.append(el("li", "", `v${version.version} · ${version.authorName} · ${timeAgo(version.at, Date.now())} - ${version.message}`));
      card.append(el("h3", "community-dialog-subtitle", "History"), versions);
    }
    const buttons = el("div", "confirm-buttons community-dialog-actions");
    buttons.append(starButton("artifact", detail.id, detail.starred, detail.stars, say), button("Report", "ad-btn", () => { finish(); reportDialog("artifact", detail.id, detail.title, say); }));
    if (detail.shareCode !== null) buttons.append(button("Sharing and invite code", "ad-btn", () => { finish(); void shareSettings(detail); }));
    else buttons.append(button("Team room", "ad-btn", () => { finish(); void liveRoom(detail.id, accessKeys.get(detail.id) ?? key, false); }));
    buttons.append(button("Make my copy", "result-close", () => { finish(); void remix(detail.id, detail.title, accessKeys.get(detail.id) ?? key); }));
    card.append(buttons);
    dialog.showModal();
  }

  /**
   * Share the open project. Problems come first, before any field: a folder that is not a
   * project is refused outright, a folder too big says how to trim it, and files that look
   * like they hold a key can be left out with one click.
   */
  function shareProject(exclude: readonly string[] = [], together = false): void {
    void (async () => {
      const preview = await attempt<ArtifactPreview>(() => window.adcode.community.previewArtifact(exclude), "Open a project folder first.");
      if (preview === null) { if (together) setOutcome({ tone: "info", message: "Open the project folder you want to share first, then press Start working together again.", actions: [{ label: "Choose a folder", run: deps.pickFolder, primary: true }] }); return; }
      if (preview.blocked === "not-a-project") {
        const { dialog, card, finish } = detailDialog("community-share", "This folder cannot be shared");
        const callout = el("div", "community-callout");
        callout.dataset["tone"] = "danger";
        callout.append(el("p", "", preview.problems[0] ?? "Open a project folder to share it."));
        const buttons = el("div", "confirm-buttons");
        buttons.append(button("Close", "confirm-cancel", finish), button("Open a project folder", "result-close", () => { finish(); deps.pickFolder(); }));
        card.append(callout, buttons);
        dialog.showModal();
        return;
      }
      const owned = preview.link?.role === "owner";
      const { dialog, card, finish } = detailDialog("community-share", owned ? `Publish a new version of ${preview.link!.title}` : together ? `Share ${preview.name} with your friends` : `Share ${preview.name}`);
      const summary = el("p", "result-summary");

      if (preview.problems.length > 0) {
        const callout = el("div", "community-callout");
        callout.dataset["tone"] = "danger";
        callout.append(el("strong", "", "This needs trimming before it can be shared"));
        const items = el("ul", "community-problems");
        for (const problem of preview.problems.slice(0, 3)) items.append(el("li", "", problem));
        callout.append(items);
        card.append(callout);
      }
      if (preview.secrets.length > 0) {
        const callout = el("div", "community-callout");
        callout.dataset["tone"] = "warning";
        callout.append(el("strong", "", `${plural(preview.secrets.length, "file")} ${preview.secrets.length === 1 ? "looks like it holds" : "look like they hold"} a key or password`));
        const items = el("ul", "community-problems");
        for (const secret of preview.secrets.slice(0, 5)) {
          const item = el("li", "");
          item.append(el("span", "community-file-path", secret.path), document.createTextNode(` · line ${secret.line} · ${secret.kind}`));
          items.append(item);
        }
        if (preview.secrets.length > 5) items.append(el("li", "", `and ${preview.secrets.length - 5} more`));
        const leaveOut = button(`Leave ${preview.secrets.length === 1 ? "this file" : "these files"} out`, "ad-btn", () => { finish(); shareProject([...exclude, ...preview.secrets.map((secret) => secret.path)], together); });
        callout.append(items, el("p", "community-card-by", "They are never uploaded. Or move the value into .env, which is never shared, and open this again."), leaveOut);
        card.append(callout);
      }
      if (preview.skipped.length > 0) {
        const skipped = el("details", "community-files");
        skipped.append(el("summary", "", "What stays private"));
        const items = el("ul", "");
        for (const one of preview.skipped) items.append(el("li", "", `${compactCount(one.count)} × ${one.reason}`));
        skipped.append(items);
        card.append(skipped);
      }

      const blocked = preview.problems.length > 0 || preview.secrets.length > 0;
      const form = el("form", "form-dialog-form");
      const titleInput = el("input", "form-input");
      titleInput.required = true; titleInput.minLength = 3; titleInput.maxLength = 80;
      titleInput.value = owned ? preview.link!.title : preview.name;
      const description = el("textarea", "form-input");
      description.rows = 3; description.required = true; description.minLength = 10; description.maxLength = 500;
      description.value = preview.readme?.replace(/^#.*\n/, "").trim().slice(0, 300) ?? "";
      // Working together should be one press: a description is required, so offer one that says what is true.
      if (together && description.value.length < 10) description.value = `${preview.name}, built together with friends in ADCode.`;
      const help = el("input", "form-input");
      help.maxLength = 500;
      help.placeholder = "Add dark mode, write tests, make it work on phones";
      const tags = el("input", "form-input");
      tags.placeholder = "game, beginner, react";
      const visibility = el("select", "ad-select");
      visibility.append(new Option("Public - anyone on ADCode can find it", "public"), new Option("Private - only friends with the invite code", "private"));
      // A project you are building with friends starts private; nobody else needs to see it.
      if (together && !owned) visibility.value = "private";
      const message = el("input", "form-input");
      message.maxLength = 300;
      message.placeholder = owned ? "What changed in this version" : "First version";
      const describeVisibility = (): void => {
        summary.textContent = visibility.value === "private"
          ? `${plural(preview.files, "file")} - ${formatBytes(preview.bytes)}. Nobody can find it on Start. Only friends you send its invite code can open it, join it or make a copy.`
          : `${plural(preview.files, "file")} - ${formatBytes(preview.bytes)} will be public. Anyone signed in to ADCode can find it and make a copy.`;
      };
      visibility.addEventListener("change", describeVisibility);
      describeVisibility();
      for (const input of [titleInput, description, help, tags, visibility, message]) input.disabled = blocked;
      const error = el("p", "form-notice");
      error.setAttribute("role", "alert");
      error.hidden = true;
      const buttons = el("div", "confirm-buttons");
      const labelFor = (): string => together ? "Share and start" : owned ? "Publish version" : visibility.value === "private" ? "Share privately" : "Share";
      let label = labelFor();
      const submit = el("button", "result-close", label);
      submit.type = "submit";
      submit.disabled = blocked;
      buttons.append(button("Cancel", "confirm-cancel", () => {
        finish();
        if (together) setOutcome({ tone: "info", message: "Nothing was shared. Press Start working together whenever you are ready." });
      }), submit);
      const fields = [
        field("Title", titleInput),
        field("What is it?", description, "One or two sentences. The README is shown on the page too."),
        field("Who can open it?", visibility, "Private projects stay off Start. Send their invite code to friends."),
      ];
      const extras = [
        field("What would you like help with?", help, "Projects that ask are listed under Asking for help."),
        field("Tags", tags, "Up to 6, separated by commas."),
        field("Note for this version", message),
      ];
      if (together) {
        // The extras matter for strangers browsing, not for friends you are about to invite.
        const more = el("details", "community-files");
        more.append(el("summary", "", "More details (optional)"), ...extras);
        form.append(...fields, more, error, buttons);
      } else form.append(fields[0]!, fields[1]!, extras[0]!, extras[1]!, fields[2]!, extras[2]!, error, buttons);
      visibility.addEventListener("change", () => {
        label = labelFor();
        submit.textContent = label;
      });
      card.insertBefore(summary, card.firstChild);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        submit.disabled = true;
        submit.textContent = "Sharing";
        void window.adcode.community.publishArtifact({
          title: titleInput.value, description: description.value, helpWanted: help.value, message: message.value, exclude,
          visibility: visibility.value as ArtifactVisibility,
          tags: tags.value.split(",").map((tag) => tag.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "")).filter(Boolean).slice(0, 6),
        }).then((detail) => {
          finish();
          forgetArtifactRemoved(detail.id);
          deps.track("artifact_shared");
          if (together) {
            void (async () => {
              const person = await personName();
              if (person !== null) await continueTogether(detail.id, detail.title, person);
            })();
            return;
          }
          say(visibility.value === "private"
            ? `${detail.title} is shared privately. Press Invite code to copy the code for your friends.`
            : `${detail.title} is shared as version ${detail.version}. Changes people send you arrive under Sent to you.`);
          shell.showTab("project");
        }, (failure: unknown) => {
          error.textContent = errorText(failure, "It could not be shared.");
          error.hidden = false;
          submit.disabled = false;
          submit.textContent = label;
        });
      });
      card.append(form);
      dialog.showModal();
      if (!blocked) titleInput.focus();
    })();
  }

  function shareSettings(detail: ArtifactDetail): void {
    if (detail.shareCode === null) return;
    let shareCode = detail.shareCode;
    let visibility = detail.visibility;
    const { dialog, card, finish } = detailDialog("community-share", `Sharing ${detail.title}`);
    const summary = el("p", "result-summary");
    const code = el("textarea", "form-input");
    code.readOnly = true;
    code.rows = 2;
    code.value = shareCode;
    const visibilitySelect = el("select", "ad-select");
    visibilitySelect.setAttribute("aria-label", "Who can open it");
    visibilitySelect.append(new Option("Public - anyone on ADCode can find it", "public"), new Option("Private - only friends with the invite code", "private"));
    visibilitySelect.value = visibility;
    const error = el("p", "form-notice");
    error.hidden = true;
    const describe = (): void => {
      summary.textContent = visibility === "private"
        ? "Private: nobody can find it on Start. Anyone you send the invite code to can open it, join it and make a copy. Making a new code stops the old one working."
        : "Public: anyone on ADCode can find it on Start. The invite code below also opens it directly.";
    };
    describe();
    const save = button("Save who can open it", "ad-btn", () => {
      void (async () => {
        const next = await attempt<ArtifactDetail>(() => window.adcode.community.setArtifactVisibility(detail.id, visibilitySelect.value as ArtifactVisibility), "The visibility could not be changed.");
        if (next === null) return;
        visibility = next.visibility;
        detail = next;
        visibilitySelect.value = visibility;
        describe();
        say(next.visibility === "private" ? `${next.title} is private now. Only friends with the invite code can open it.` : `${next.title} is public now. Anyone can find it on Start.`);
      })();
    });
    const copy = button("Copy code", "ad-btn ad-btn-primary", () => { void copyText(shareCode).then((ok) => say(ok ? "Invite code copied. Paste it in a message to your friends." : "Could not copy the code", ok ? "info" : "error")); });
    const copyInvite = button("Copy a ready-made message", "ad-btn", () => { void copyText(artifactShareMessage(detail.title, detail.id, decodeArtifactShare(shareCode)!.key)).then((ok) => say(ok ? "Message copied. It tells your friends how to install ADCode and join." : "Could not copy the message", ok ? "info" : "error")); });
    const rotate = button("Make a new code", "ad-btn", () => {
      void (async () => {
        if (!await askThemed({ title: "Make a new invite code?", body: "The old code stops working. Friends who already joined or made a copy keep what they have.", confirmLabel: "Make a new code", danger: true })) return;
        const next = await attempt<{ shareCode: string }>(() => window.adcode.community.rotateArtifactShare(detail.id), "The code could not be replaced.");
        if (next === null) return;
        shareCode = next.shareCode;
        code.value = shareCode;
        say("New invite code ready. The old one stopped working - send the new one to your friends.");
      })();
    });
    const live = button("Open the team room", "ad-btn", () => { finish(); void liveRoom(detail.id, null, true); });
    const buttons = el("div", "confirm-buttons");
    buttons.append(button("Close", "confirm-cancel", finish), rotate, live, copyInvite, copy);
    const saveRow = el("div", "community-row-actions");
    saveRow.append(save);
    card.append(field("Invite code", code, "Send this to friends. They paste it under Join a friend on Start."), buttons, el("h3", "community-dialog-subtitle", "Who can open it?"), visibilitySelect, summary, saveRow, error);
    dialog.showModal();
  }

  async function liveRoom(id: string, key: string | null, owner: boolean): Promise<void> {
    if (me === null) {
      const loaded = await attempt<CommunityMe>(() => communityMe(), "Sign in to ADCode to use a team room.");
      if (loaded === null) return;
      me = loaded;
    }
    const person = me.profile.name || "Builder";
    let laneStatus: "idle" | "working" = "idle";
    let laneTask = "";
    let laneProvider = "";
    let laneModel = "";
    let aiReady: boolean | null = null;
    try {
      const ai = await window.adcode.ai.status();
      aiReady = ai.ready;
      laneProvider = ai.activeProvider;
      laneModel = ai.activeModel;
      const runs = await window.adcode.ai.runs();
      laneStatus = runs.length > 0 ? "working" : "idle";
      laneTask = runs[0]?.title ?? "";
    } catch { /* Signed out or no model: the lane stays idle. */ }
    const stopRuns = window.adcode.ai.onRunsChanged((runs) => {
      laneStatus = runs.length > 0 ? "working" : "idle";
      laneTask = runs[0]?.title ?? "";
    });
    let current: ArtifactRoomSnapshot;
    try {
      current = await window.adcode.community.artifactRoom(id, key);
    } catch (failure) {
      const message = errorText(failure, "The team room could not be loaded.");
      if (message.includes("has not been opened")) {
        if (!owner) { stopRuns(); say("Nobody is working in this project right now. Ask its owner to press Start working together."); return; }
        if (!await askThemed({ title: "Open the team room?", body: "Friends you invite see who is here, one shared plan and the room chat, and every person's AI works from the same picture.", confirmLabel: "Open room" })) { stopRuns(); return; }
        const opened = await attempt<ArtifactRoomSnapshot>(() => window.adcode.community.openArtifactRoom(id, person, null), "The team room could not be opened.");
        if (opened === null) { stopRuns(); return; }
        current = opened;
      } else if (message.includes("Join this live room first")) {
        let joined = await attempt<ArtifactRoomSnapshot>(() => window.adcode.community.joinArtifactRoom(id, key, person, false, aiReady, null), "Could not join the team room.");
        if (joined === null) joined = await attempt<ArtifactRoomSnapshot>(() => window.adcode.community.joinArtifactRoom(id, key, person, true, aiReady, null), "Could not watch the team room.");
        if (joined === null) { stopRuns(); return; }
        current = joined;
      } else {
        stopRuns();
        say(message);
        return;
      }
    }
    const { dialog, card, finish } = detailDialog("community-live", current.title);
    const body = el("div", "community-live-body");
    const status = el("p", "community-live-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    const busy = el("div", "community-live-busy");
    busy.setAttribute("aria-hidden", "true");
    busy.append(el("span", "community-live-busy-bar"));
    card.append(status, busy, body);
    /*
     * The code friends need, shown in the room so the host never has to go looking for it.
     * A guest who came in with a code can pass the same one on; the owner's is fetched once.
     */
    let inviteCode: string | null = null;
    if (key !== null) { try { inviteCode = encodeArtifactShare(id, key); } catch { inviteCode = null; } }
    /** Where the code row's content sits in the current drawing, so it can fill in by itself. */
    let inviteHolder: HTMLElement | null = null;
    function inviteParts(): HTMLElement[] {
      if (inviteCode === null) {
        return [el("p", "community-live-now-text", current.self.role === "owner" ? "Getting the code..." : "Ask the owner for the invite code if a friend wants to join.")];
      }
      const code = inviteCode;
      const box = el("input", "ad-input community-live-now-code");
      box.readOnly = true;
      box.value = code;
      box.setAttribute("aria-label", "Invite code");
      box.addEventListener("focus", () => box.select());
      const copy = button("Copy code", "ad-btn ad-btn-primary", () => {
        void copyText(code).then((ok) => flash(ok ? "Invite code copied. Friends paste it under Join a friend on the Artifacts page." : "Could not copy. Select the code and copy it yourself.", ok ? "success" : "error"));
      });
      const line = el("div", "community-live-now-code-row");
      line.append(box, copy);
      return [line];
    }
    if (inviteCode === null && current.self.role === "owner") {
      void window.adcode.community.shareArtifact(id).then((share) => {
        inviteCode = share.shareCode;
        // Only the code row changes, so whatever the person is typing elsewhere is left alone.
        inviteHolder?.replaceChildren(...inviteParts());
      }, () => {
        inviteHolder?.replaceChildren(el("p", "community-live-now-text", "The code could not be fetched. Close the room and open it again, or copy it from Invite code on This project."));
      });
    }
    /* The advanced tools stay folded or open across the room's five-second redraws. */
    let moreOpen = false;
    let liveStatus: CollabStatusView | null = null;
    let livePresence: readonly CollabPresenceView[] = [];
    let liveFromRoom = false;
    /** When each person's cursor last moved, so "active" means recently active, not merely connected. */
    const liveSeen = new Map<string, number>();
    const editors = el("section", "community-live-editors t-panel-slide");
    editors.dataset["open"] = "false";
    editors.hidden = true;
    let editorsOpen = false;
    let editorsHideTimer: number | undefined;
    let lastOnline = -1;
    let lastActive = -1;
    let statusTimer: number | undefined;
    function flash(message: string, tone: "info" | "success" | "error" = "info"): void {
      const text = el("span", "community-live-status-text", message);
      status.replaceChildren();
      if (tone === "success") {
        const check = el("span", "t-success-check");
        check.dataset["state"] = "in";
        check.setAttribute("aria-hidden", "true");
        check.append(createIcon(ICON.check));
        status.append(check);
      }
      status.append(text);
      status.dataset["tone"] = tone;
      status.hidden = false;
      window.clearTimeout(statusTimer);
      statusTimer = window.setTimeout(() => { status.hidden = true; }, tone === "error" ? 9000 : 4000);
    }
    function setBusy(value: boolean): void {
      card.dataset["busy"] = value ? "true" : "false";
      body.setAttribute("aria-busy", value ? "true" : "false");
      body.inert = value;
    }
    const act = async (action: ArtifactRoomActionView): Promise<void> => {
      setBusy(true);
      flash("Saving the change");
      try {
        const next = await window.adcode.community.artifactRoomAction(id, key, action);
        current = next;
        draw();
        flash("Saved", "success");
      } catch (failure) {
        flash(errorText(failure, "That room action could not be saved."), "error");
      } finally {
        setBusy(false);
      }
    };
    const refresh = async (quiet = false): Promise<void> => {
      if (!quiet) { setBusy(true); flash("Refreshing the room"); }
      try {
        const next = await window.adcode.community.artifactRoom(id, key);
        current = next;
        draw();
        if (!quiet) flash("Up to date", "success");
      } catch (failure) {
        if (!quiet) flash(errorText(failure, "The live room could not be refreshed."), "error");
      } finally {
        if (!quiet) setBusy(false);
      }
    };
    function setEditorsOpen(open: boolean): void {
      if (open === editorsOpen) return;
      editorsOpen = open;
      window.clearTimeout(editorsHideTimer);
      if (open) {
        editors.hidden = false;
        editors.dataset["open"] = "false";
        void editors.offsetHeight;
        editors.dataset["open"] = "true";
        return;
      }
      lastOnline = -1;
      lastActive = -1;
      editors.dataset["open"] = "false";
      editorsHideTimer = window.setTimeout(() => {
        if (!editorsOpen) editors.hidden = true;
      }, 200);
    }

    function liveCountChip(value: number, label: string, animate: boolean, tone: "ready" | "working"): HTMLElement {
      const node = roomChip("", tone);
      const group = el("span", `t-digit-group${animate ? " is-animating" : ""}`);
      const characters = String(value).split("");
      characters.forEach((character, index) => {
        const digit = el("span", "t-digit", character);
        if (characters.length > 2 && index === characters.length - 2) digit.dataset["stagger"] = "1";
        else if (characters.length > 2 && index === characters.length - 1) digit.dataset["stagger"] = "2";
        group.append(digit);
      });
      node.append(group, document.createTextNode(` ${label}`));
      return node;
    }

    function liveAvatarStack(people: CollabStatusView["participants"]): HTMLElement {
      const stack = el("div", "community-live-avatar-stack t-avatar-group");
      stack.setAttribute("aria-hidden", "true");
      for (const person of people.slice(0, 4)) {
        const avatar = el("span", "community-live-avatar community-live-stack-avatar t-avatar", roomInitials(person.name));
        avatar.style.setProperty("--lane-colour", person.colour);
        avatar.title = person.name;
        avatar.append(el("span", "community-live-avatar-dot"));
        stack.append(avatar);
      }
      if (people.length > 4) stack.append(el("span", "community-live-stack-more", `+${people.length - 4}`));

      const avatars = [...stack.querySelectorAll<HTMLElement>(".t-avatar")];
      const styles = getComputedStyle(document.documentElement);
      const number = (name: string, fallback: number): number => {
        const value = Number.parseFloat(styles.getPropertyValue(name));
        return Number.isFinite(value) ? value : fallback;
      };
      const easing = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback;
      const setShifts = (activeIndex: number | null, phase: "in" | "out"): void => {
        const lift = number("--avatar-lift", -3);
        const falloff = number("--avatar-falloff", 0.45);
        const scale = number("--avatar-scale", 1.06);
        const timing = phase === "out"
          ? easing("--avatar-ease-out", "cubic-bezier(0.34, 1.56, 0.64, 1)")
          : easing("--avatar-ease", "cubic-bezier(0.22, 1, 0.36, 1)");
        avatars.forEach((avatar, index) => {
          avatar.style.transitionTimingFunction = timing;
          if (activeIndex === null) {
            avatar.style.setProperty("--shift", "0px");
            avatar.style.setProperty("--scale-active", "1");
            return;
          }
          const distance = Math.abs(index - activeIndex);
          avatar.style.setProperty("--shift", `${(lift * Math.pow(falloff, distance)).toFixed(3)}px`);
          avatar.style.setProperty("--scale-active", index === activeIndex ? String(scale) : "1");
        });
      };
      avatars.forEach((avatar, index) => avatar.addEventListener("mouseenter", () => setShifts(index, "in")));
      stack.addEventListener("mouseleave", () => setShifts(null, "out"));
      return stack;
    }

    function drawEditors(): void {
      const session = liveStatus;
      const running = current.liveInvite !== null && session !== null
        && (session.mode === "hosting" || session.mode === "joined" || session.mode === "connecting");
      if (!running) { setEditorsOpen(false); return; }

      const now = Date.now();
      const presenceById = new Map(livePresence.map((one) => [one.participantId, one]));
      const active = livePresence.filter((one) => one.path !== null && now - (liveSeen.get(one.participantId) ?? 0) < 120_000).length;
      const online = session.participants.length;
      const onlineChanged = online !== lastOnline;
      const activeChanged = active !== lastActive;
      lastOnline = online;
      lastActive = active;
      const head = el("div", "community-live-editors-head");
      const words = el("div", "");
      words.append(
        el("h2", "community-section-title", "Live editors"),
        el("p", "community-section-note", "The same project, on everyone's machine. Changes land as they type - no branch, no pull request."),
      );
      const side = el("div", "community-live-editors-side");
      if (online > 0) side.append(liveAvatarStack(session.participants));
      side.append(liveCountChip(online, "online", onlineChanged, "ready"));
      if (active > 0) side.append(liveCountChip(active, "active now", activeChanged, "working"));
      head.append(words, side);

      const rows = el("ul", "community-live-list community-live-editors-list");
      for (const person of session.participants) {
        const presence = presenceById.get(person.id);
        const isActive = presence !== undefined && presence.path !== null && now - (liveSeen.get(person.id) ?? 0) < 120_000;
        const row = el("li", "community-live-row community-live-editor");
        row.dataset["active"] = String(isActive);
        if (person.id === session.selfId) row.dataset["you"] = "true";

        const avatar = el("span", "community-live-avatar", roomInitials(person.name));
        avatar.style.setProperty("--lane-colour", person.colour);
        avatar.setAttribute("aria-hidden", "true");
        avatar.append(el("span", "community-live-avatar-dot"));
        const copy = el("div", "community-live-grow");
        const title = el("div", "community-live-member-title");
        title.append(el("strong", "", person.name));
        if (person.id === session.selfId) title.append(el("span", "community-live-you", "You"));
        title.append(roomChip(person.role === "host" ? "Host" : person.role === "editor" ? "Can edit" : "View only", person.role === "viewer" ? "warning" : "ready"));
        copy.append(title);
        if (presence !== undefined && presence.path !== null) {
          const where = el("span", "community-live-file", `${presence.path}:${presence.cursor.line}:${presence.cursor.column}`);
          copy.append(where);
        } else {
          copy.append(el("span", "community-card-by", "Online · no file open"));
        }
        row.append(avatar, copy);

        if (presence !== undefined && presence.path !== null) {
          row.append(button("Go to", "ad-btn", () => {
            // The room is modal, so opening the file behind it would look like nothing happened.
            // Close the room; the live session itself keeps running in the status bar.
            finish();
            deps.openAt(presence.path!, presence.cursor.line, presence.cursor.column);
          }));
        }
        if (person.id !== session.selfId && person.role !== "host" && session.mode === "hosting") {
          const access = el("select", "ad-select community-live-access");
          access.setAttribute("aria-label", `Access for ${person.name}`);
          for (const role of ["editor", "viewer"] as const) access.append(new Option(role === "editor" ? "Can edit" : "View only", role, false, role === person.role));
          access.addEventListener("change", () => {
            void (async () => {
              const next = await attempt<CollabStatusView>(() => window.adcode.collab.setRole(person.id, access.value === "editor" ? "editor" : "viewer"), "That access change could not be saved.");
              if (next !== null) { liveStatus = next; drawEditors(); }
            })();
          });
          row.append(access);
        }
        rows.append(row);
      }
      if (rows.childElementCount === 0) rows.append(el("li", "community-live-row community-live-empty", "Waiting for the first person to join"));
      const foot = el("p", "community-section-note", "Cursor colours match the carets in the editor. The host's copy autosaves every 4 minutes.");
      editors.replaceChildren(head, rows, foot);
      setEditorsOpen(true);
    }

    async function refreshLive(): Promise<void> {
      const [nextStatus, nextPresence] = await Promise.all([
        window.adcode.collab.status().catch(() => null),
        window.adcode.collab.presenceList().catch(() => [] as readonly CollabPresenceView[]),
      ]);
      liveStatus = nextStatus;
      livePresence = nextPresence;
      const now = Date.now();
      for (const one of nextPresence) if (one.path !== null) liveSeen.set(one.participantId, now);
      drawEditors();
    }

    function draw(): void {
      const actions = el("div", "confirm-buttons community-dialog-actions");
      if (current.open) {
        if (current.self.role === "owner") {
          actions.append(button(current.liveInvite === null ? "Start live editing" : "Stop live editing", current.liveInvite === null ? "ad-btn ad-btn-primary" : "ad-btn", () => {
            void (async () => {
              if (current.liveInvite !== null) {
                await window.adcode.collab.leave().catch(() => null);
                liveStatus = null;
                livePresence = [];
                liveSeen.clear();
                liveFromRoom = false;
                drawEditors();
                await act({ action: "setLive", invite: null });
                return;
              }
              let started: CollabStatusView;
              try {
                started = await window.adcode.collab.host({ bind: "internet", port: 0, displayName: person, artifactLive: true });
              } catch (failure) {
                flash(`${errorText(failure, "Live editing could not start").replace(/\.$/, "")}. Check you are signed in and online, then press Start live editing again.`, "error");
                return;
              }
              if (started.invite === null) { flash(`${(started.error ?? "Live editing could not start").replace(/\.$/, "")}. Press Start live editing to try again.`, "error"); return; }
              liveStatus = started;
              liveFromRoom = true;
              await act({ action: "setLive", invite: started.invite });
              drawEditors();
              flash("Live editing is on. Everyone in this room now edits the same files - send friends the invite code to bring them in.", "success");
            })();
          }));
          actions.append(button("Close room", "ad-btn", () => {
            void (async () => {
              if (!await askThemed({ title: "Close this team room?", body: "Everyone can still read it, but nobody can change anything in it. Press Start working together later to open it again.", confirmLabel: "Close room", danger: true })) return;
              const next = await attempt<ArtifactRoomSnapshot>(() => window.adcode.community.closeArtifactRoom(id), "The room could not be closed.");
              if (next !== null) { current = next; draw(); }
            })();
          }));
        } else if (current.liveInvite !== null) {
          actions.append(button("Join live editing", "ad-btn ad-btn-primary", () => {
            void (async () => {
              /*
               * A live session binds Monaco models, so there must be a project open before the
               * socket connects. With none, download this artifact first - the same copy the
               * host is sharing - instead of joining into an empty workbench and seeing nothing.
               */
              const opened = await window.adcode.workspace.current().catch(() => null);
              if (opened === null) {
                const proceed = await askThemed({
                  title: "Open this live project?",
                  body: "Live editing needs the project's files on this computer. ADCode will download a copy to Documents → ADCode Projects, open it, and join everyone else. The host's copy stays the source of truth while you are live.",
                  confirmLabel: "Download and join",
                });
                if (!proceed) return;
                const root = await withProgress(`join-live:${id}`, `Preparing ${current.title}`, () => window.adcode.community.remix(id, key), "The project could not be downloaded.");
                if (root === null) return;
                await deps.openFolder(root);
              }
              try {
                const joined = await window.adcode.collab.join(current.liveInvite!, person);
                liveStatus = joined;
                liveFromRoom = true;
                await refreshLive();
                flash("You are editing live. Open any file to see everyone's changes as they type.", "success");
              } catch (failure) {
                flash(`${errorText(failure, "Could not join live editing").replace(/\.$/, "")}. Ask the host to keep the room open, then press Join live editing again.`, "error");
              }
            })();
          }));
        }
        if (current.self.role !== "owner") {
          const selfMember = current.members.find((one) => one.uid === current.selfId);
          actions.append(button(selfMember?.watching === true ? "Join as editor" : "Watch only", "ad-btn", () => {
            void (async () => {
              const next = await attempt<ArtifactRoomSnapshot>(
                () => window.adcode.community.joinArtifactRoom(id, key, person, !(selfMember?.watching === true), aiReady, null),
                "Could not change how you joined.",
              );
              if (next !== null) { current = next; draw(); }
            })();
          }));
        }
        actions.append(button("Leave room", "ad-btn", () => {
          void (async () => {
            if (liveFromRoom) await window.adcode.collab.leave().catch(() => null);
            await window.adcode.community.leaveArtifactRoom(id).catch(() => null);
            stopRuns();
            finish();
          })();
        }));
        actions.append(button("Refresh", "ad-btn", () => { void refresh(); void refreshLive(); }));
      } else actions.append(el("p", "community-section-note", "This room is closed and read-only."));
      const planDone = current.plan.filter((step) => step.status === "done").length;
      const planTotal = current.plan.length;
      const present = current.members.filter((member) => member.present && member.lane.status !== "offline").length;
      const canDecide = current.open && (current.self.role === "owner" || current.self.role === "editor");
      const needsYou = current.approvals.filter((approval) => approval.status === "pending" && approval.requestedBy !== current.selfId && canDecide).length
        + current.handoffs.filter((handoff) => handoff.acceptedAt === 0 && handoff.toUid === current.selfId).length;
      /*
       * "Right now": the four things a person opening the room needs - who is here, the code
       * to bring a friend in, what the team is doing next, and a box to talk to everyone.
       * Everything else in the room is one fold further down.
       */
      const now = el("section", "community-live-now");
      now.setAttribute("aria-label", "Right now");
      const nowHead = el("div", "community-live-now-head");
      const signal = el("div", "community-live-signal");
      signal.dataset["state"] = current.open ? "live" : "closed";
      const signalDot = el("span", "community-live-signal-dot");
      signalDot.setAttribute("aria-hidden", "true");
      signal.append(signalDot, el("span", "community-live-signal-label", current.open ? "Live" : "Closed - read only"));
      nowHead.append(el("h2", "community-live-now-title", "Right now"), signal);
      if (needsYou > 0) nowHead.append(roomChip(`${needsYou} waiting on you - see More team tools`, "attention"));
      now.append(nowHead);

      const nowRow = (label: string, ...content: HTMLElement[]): HTMLElement => {
        const row = el("div", "community-live-now-row");
        const value = el("div", "community-live-now-value");
        value.append(...content);
        row.append(el("span", "community-live-now-label", label), value);
        return row;
      };

      const here = current.members.filter((member) => member.present && member.lane.status !== "offline");
      const faces = el("div", "community-live-now-faces");
      faces.setAttribute("aria-hidden", "true");
      for (const member of here.slice(0, 6)) {
        const avatar = el("span", "community-live-avatar", roomInitials(member.name));
        avatar.style.setProperty("--lane-colour", member.colour);
        faces.append(avatar);
      }
      const others = here.filter((member) => member.uid !== current.selfId).map((member) => member.name);
      const youHere = here.some((member) => member.uid === current.selfId);
      const whoText = others.length === 0
        ? (youHere ? "Only you so far. Send the invite code below to bring friends in." : "Nobody is here right now.")
        : `${nameList(youHere ? [...others, "you"] : others)} ${here.length === 1 ? "is" : "are"} here.`;
      now.append(nowRow("Who is here", faces, el("p", "community-live-now-text", whoText)));

      const inviteRow = nowRow("Invite code", ...inviteParts());
      inviteHolder = inviteRow.querySelector<HTMLElement>(".community-live-now-value");
      now.append(inviteRow);

      const nextStep = current.plan.find((step) => step.status === "doing" && step.ownerUid === current.selfId)
        ?? current.plan.find((step) => step.status === "doing")
        ?? current.plan.find((step) => step.status === "todo");
      const stepValue: HTMLElement[] = [];
      if (nextStep === undefined) {
        stepValue.push(el("p", "community-live-now-text", planTotal === 0 ? "No plan yet. Add the first step under The plan." : "Every step is done. Add the next one under The plan."));
      } else {
        const ownerName = nextStep.ownerUid === current.selfId ? "you" : current.members.find((one) => one.uid === nextStep.ownerUid)?.name;
        const line = el("p", "community-live-now-text");
        line.append(el("strong", "", nextStep.title), document.createTextNode(ownerName ? ` - ${ownerName === "you" ? "you are" : `${ownerName} is`} on it` : " - nobody has taken it yet"));
        stepValue.push(line);
        if (nextStep.ownerUid === null && current.open && (current.self.role === "owner" || current.self.role === "editor")) {
          stepValue.push(button("I will do it", "ad-btn", () => void act({ action: "plan", operation: "claim", id: nextStep.id })));
        }
      }
      const meter = el("div", "community-live-meter-wrap");
      const meterText = el("div", "community-live-meter-text");
      meterText.append(el("span", "", "Plan"), el("span", "community-live-meter-count", `${planDone} of ${planTotal} done`));
      meter.append(meterText, roomMeter(planTotal === 0 ? 0 : (planDone / planTotal) * 100, "Plan progress"));
      stepValue.push(meter);
      now.append(nowRow("Next step", ...stepValue));

      // The session's branch and task, for the tools fold: useful, but not what anybody looks for first.
      const head = el("div", "community-live-head");
      const facts = el("div", "community-live-facts");
      facts.append(
        roomFact("Branch", current.branch, true),
        roomFact("Task", current.task || "No task set"),
        roomFact("Here", `${present} ${present === 1 ? "person" : "people"}`),
        roomFact("Synced", current.lastSyncedAt > 0 ? timeAgo(current.lastSyncedAt, Date.now()) : "Not yet"),
      );
      head.append(facts);

      const checks = el("ul", "community-live-list community-live-checks");
      for (const check of current.checks) {
        const row = el("li", "community-live-row community-live-check");
        row.dataset["state"] = check.ok === true ? "ready" : check.ok === false ? "blocked" : "unchecked";
        const mark = el("span", "community-live-check-mark");
        mark.setAttribute("aria-hidden", "true");
        const copy = el("div", "community-live-grow");
        copy.append(el("strong", "", check.label), el("p", "community-card-by", check.detail));
        row.append(mark, copy, roomChip(check.ok === true ? "Ready" : check.ok === false ? "Blocked" : "Not checked", check.ok === true ? "ready" : check.ok === false ? "blocked" : "unchecked"));
        checks.append(row);
      }
      const ready = current.checks.filter((check) => check.ok === true).length;
      const members = el("ul", "community-live-list community-live-members");
      for (const member of current.members) {
        const row = el("li", "community-live-row community-live-member");
        row.dataset["lane"] = member.lane.status;
        if (member.uid === current.selfId) row.dataset["you"] = "true";
        const avatar = el("span", "community-live-avatar", roomInitials(member.name));
        avatar.style.setProperty("--lane-colour", member.colour);
        avatar.setAttribute("aria-hidden", "true");
        avatar.append(el("span", "community-live-avatar-dot"));
        const lane = el("div", "community-live-grow");
        const title = el("div", "community-live-member-title");
        title.append(el("strong", "", member.name));
        if (member.uid === current.selfId) title.append(el("span", "community-live-you", "You"));
        title.append(roomChip(roomStatusLabel(member.lane.status), member.lane.status), chip(member.role, "community-chip community-live-chip community-live-role"));
        lane.append(title);
        if (member.lane.task) lane.append(el("p", "community-live-task", member.lane.task));
        const where = [member.lane.provider, member.lane.model].filter(Boolean).join(" / ");
        if (where) lane.append(el("p", "community-card-by", `${where}${member.lane.sponsorUid ? ` · paid by ${current.members.find((one) => one.uid === member.lane.sponsorUid)?.name ?? "a teammate"}` : ""}`));
        if (member.presence.path) lane.append(el("span", "community-live-file", `${member.presence.path}${member.presence.line === null ? "" : `:${member.presence.line}`}`));
        lane.append(el("span", "community-card-by", `${member.watching ? "Watching" : "Editing"} · seen ${timeAgo(member.lastSeen, Date.now())}`));
        row.append(avatar, lane);
        if (current.open && member.uid !== current.selfId && member.lane.status === "handoff" && (current.self.role === "owner" || current.self.role === "editor")) {
          row.append(button("Take over", "ad-btn", () => void act({ action: "takeover", targetUid: member.uid })));
        } else if (current.open && member.uid === current.selfId && member.lane.status !== "offline" && member.lane.status !== "handoff") {
          row.append(button("Hand off", "ad-btn", () => void act({ action: "handoff" })));
        }
        members.append(row);
      }
      const people = el("div", "");
      people.append(checks, members);
      const coordination = el("ul", "community-live-list community-live-coordination");
      for (const warning of current.warnings) {
        const row = el("li", "community-live-row community-live-warning");
        row.dataset["kind"] = warning.kind;
        const mark = el("span", "community-live-warning-mark");
        mark.setAttribute("aria-hidden", "true");
        const detail = warning.kind === "locked" ? `${warning.name} locked this file`
          : warning.kind === "planned" ? `${warning.name} plans to edit this file${warning.detail ? `: ${warning.detail}` : ""}`
          : warning.kind === "adjacent" ? `${warning.name} is working on something related${warning.detail ? `: ${warning.detail}` : ""}`
          : `${warning.name} is also editing this file`;
        const copy = el("div", "community-live-grow");
        copy.append(el("strong", "", warning.path || "Related work"), el("p", "community-card-by", detail));
        row.append(mark, copy);
        coordination.append(row);
      }
      for (const lock of current.locks) {
        const row = el("li", "community-live-row community-live-lock");
        const copy = el("div", "community-live-grow");
        copy.append(el("strong", "community-live-file", lock.path), el("span", "community-card-by", `Held by ${lock.name}`));
        row.append(copy);
        if (current.open && (lock.uid === current.selfId || current.self.role === "owner")) row.append(button("Unlock", "ad-btn", () => void act({ action: "lock", operation: "unlock", path: lock.path })));
        coordination.append(row);
      }
      if (coordination.childElementCount === 0) coordination.append(el("li", "community-live-row community-live-empty", "No file overlaps. Lock a file before a big edit so everyone can see it is taken"));
      const lockForm = el("form", "community-live-form");
      const lockPath = el("input", "form-input");
      lockPath.placeholder = "File to lock, e.g. src/app.ts";
      lockForm.append(lockPath, button("Lock file", "ad-btn", () => {
        if (lockPath.value.trim() === "") return;
        void act({ action: "lock", operation: "lock", path: lockPath.value.trim() });
      }));
      if (!current.open || (current.self.role !== "owner" && current.self.role !== "editor")) lockForm.hidden = true;
      const plan = el("ul", "community-live-list community-live-plan");
      for (const step of current.plan) {
        const row = el("li", "community-live-row community-live-step");
        row.dataset["status"] = step.status;
        const ownerName = current.members.find((one) => one.uid === step.ownerUid)?.name;
        const copy = el("div", "community-live-grow");
        const title = el("div", "community-live-step-title");
        title.append(el("strong", "", step.title), roomChip(STEP_WORDS[step.status] ?? step.status, step.status));
        copy.append(title);
        const bits = [ownerName ? `With ${ownerName}` : "Nobody has taken it yet"];
        if (step.paths !== undefined && step.paths.length > 0) bits.push(step.paths.join(", "));
        copy.append(el("span", "community-card-by", bits.join(" · ")));
        row.append(copy);
        if (current.open && (current.self.role === "owner" || current.self.role === "editor")) {
          const status = el("select", "ad-select");
          status.setAttribute("aria-label", `How far along ${step.title} is`);
          for (const value of ["todo", "doing", "done", "blocked"]) status.append(new Option(STEP_WORDS[value] ?? value, value, false, value === step.status));
          status.addEventListener("change", () => void act({ action: "plan", operation: "move", id: step.id, status: status.value }));
          row.append(status);
          if (step.status === "todo" && step.ownerUid !== current.selfId) {
            row.append(button(step.ownerUid === null ? "I will do it" : "Ask to take over", "ad-btn", () => void act(step.ownerUid === null
              ? { action: "plan", operation: "claim", id: step.id }
              : { action: "plan", operation: "request", id: step.id })));
          }
        }
        plan.append(row);
      }
      if (plan.childElementCount === 0) plan.append(el("li", "community-live-row community-live-empty", "No steps yet. Add the first one below - everyone's AI reads this list"));
      const steps = el("form", "community-live-form");
      const stepTitle = el("input", "form-input");
      stepTitle.placeholder = "A step, e.g. Make the sign-in page";
      stepTitle.setAttribute("aria-label", "New plan step");
      stepTitle.maxLength = 200;
      steps.append(stepTitle, button("Add step", "ad-btn", () => {
        if (stepTitle.value.trim().length < 3) return;
        void act({ action: "plan", operation: "add", title: stepTitle.value.trim() });
      }));
      const pendingApprovals = current.approvals.filter((approval) => approval.status === "pending");
      const approvals = el("ul", "community-live-list community-live-approvals");
      for (const approval of pendingApprovals) {
        const mineToAnswer = canDecide && approval.requestedBy !== current.selfId;
        const row = el("li", "community-live-row community-live-approval");
        row.dataset["action"] = mineToAnswer ? "needs-you" : "waiting";
        const copy = el("div", "community-live-grow");
        const title = el("div", "community-live-approval-title");
        title.append(el("strong", "", approval.title), roomChip(approval.kind, "kind"));
        if (mineToAnswer) title.append(roomChip("Waiting on you", "attention"));
        copy.append(title);
        const meta = [approval.requestedName];
        if (approval.detail) meta.push(approval.detail);
        if (approval.paths.length > 0) meta.push(approval.paths.join(", "));
        copy.append(el("p", "community-card-by", meta.join(" · ")));
        row.append(copy);
        if (mineToAnswer) row.append(button("Approve", "ad-btn ad-btn-primary", () => void act({ action: "decideApproval", id: approval.id, accept: true })), button("Decline", "ad-btn", () => void act({ action: "decideApproval", id: approval.id, accept: false })));
        approvals.append(row);
      }
      if (approvals.childElementCount === 0) approvals.append(el("li", "community-live-row community-live-empty", "Nothing waiting. Ask before a push, a command or a takeover"));
      const approvalForm = el("form", "community-live-form");
      const approvalKind = el("select", "ad-select");
      approvalKind.setAttribute("aria-label", "What needs approving");
      const KIND_WORDS: Readonly<Record<string, string>> = { push: "Push code", network: "Use the internet", command: "Run a command", "plan-transfer": "Take over a plan step", handoff: "Hand off work" };
      for (const value of ["push", "network", "command", "plan-transfer", "handoff"]) approvalKind.append(new Option(KIND_WORDS[value] ?? value, value));
      const approvalTitle = el("input", "form-input");
      approvalTitle.placeholder = "The exact action, e.g. Push feat/live";
      approvalTitle.maxLength = 200;
      const approvalDetail = el("input", "form-input");
      approvalDetail.placeholder = "What it changes, and how to check it";
      approvalDetail.maxLength = 2000;
      const approvalPaths = el("input", "form-input");
      approvalPaths.placeholder = "Files, e.g. src/app.ts, src/db.ts";
      approvalForm.append(approvalKind, approvalTitle, approvalDetail, approvalPaths, button("Ask the room", "ad-btn", () => {
        if (approvalTitle.value.trim().length < 3) return;
        void act({
          action: "requestApproval", kind: approvalKind.value, title: approvalTitle.value.trim(),
          detail: approvalDetail.value.trim(), paths: approvalPaths.value.split(",").map((one) => one.trim()).filter(Boolean),
        });
      }));
      if (!current.open || (current.self.role !== "owner" && current.self.role !== "editor")) approvalForm.hidden = true;

      const handoffs = el("ul", "community-live-list community-live-handoffs");
      for (const handoff of current.handoffs) {
        if (handoff.acceptedAt !== 0) continue;
        const row = el("li", "community-live-row community-live-handoff");
        row.dataset["for-you"] = String(handoff.toUid === current.selfId);
        const copy = el("div", "community-live-grow");
        const title = el("div", "community-live-handoff-title");
        title.append(el("strong", "", `${handoff.fromName} → ${handoff.toName ?? "anyone"}`));
        if (handoff.toUid === current.selfId) title.append(roomChip("For you", "attention"));
        copy.append(title, el("p", "community-live-task", handoff.note || "No note. The branch and plan travel with it."));
        copy.append(el("span", "community-card-by", `${handoff.branch} · ${handoff.planDone}/${handoff.planTotal} steps done`));
        row.append(copy);
        if (current.open && handoff.toUid === current.selfId) row.append(button("Accept", "ad-btn ad-btn-primary", () => void act({ action: "acceptHandoff", id: handoff.id })));
        handoffs.append(row);
      }
      if (handoffs.childElementCount === 0) handoffs.append(el("li", "community-live-row community-live-empty", "No handoff waiting. Hand the branch, plan and fresh notes to a teammate"));
      const handoffForm = el("form", "community-live-form");
      const handoffTo = el("select", "ad-select");
      for (const member of current.members) if (member.uid !== current.selfId) handoffTo.append(new Option(member.name, member.uid));
      const handoffNote = el("input", "form-input");
      handoffNote.placeholder = "What is done, and where to start";
      handoffNote.maxLength = 1000;
      handoffForm.append(handoffTo, handoffNote, button("Offer handoff", "ad-btn", () => {
        if (handoffTo.value === "") return;
        void act({ action: "offerHandoff", toUid: handoffTo.value, note: handoffNote.value.trim() });
      }));
      if (!current.open || current.members.length < 2 || current.self.role === "viewer") handoffForm.hidden = true;
      const notes = el("ul", "community-live-list community-live-notes");
      for (const note of current.notes.filter((one) => !one.retired)) {
        const row = el("li", "community-live-row community-live-note");
        row.dataset["stale"] = String(note.stale === true);
        const copy = el("div", "community-live-grow");
        const title = el("div", "community-live-note-title");
        title.append(el("strong", "community-live-file", note.path));
        if (note.stale === true) title.append(roomChip("Code moved on", "warning"));
        copy.append(title, el("p", "community-live-task", note.text));
        copy.append(el("span", "community-card-by", `${note.authorName}${note.commit ? ` · ${note.commit.slice(0, 7)}` : ""} · ${timeAgo(note.updatedAt, Date.now())}`));
        row.append(copy);
        if (current.open && (note.authorId === current.selfId || current.self.role === "owner")) row.append(button("Retire", "ad-btn", () => void act({ action: "note", operation: "retire", id: note.id })));
        notes.append(row);
      }
      if (notes.childElementCount === 0) notes.append(el("li", "community-live-row community-live-empty", "No pinned notes yet. Pin what the code cannot say"));
      const noteForm = el("form", "community-live-form");
      const notePath = el("input", "form-input");
      notePath.placeholder = "File, e.g. src/app.ts";
      const noteText = el("input", "form-input");
      noteText.placeholder = "What should everyone know?";
      noteText.maxLength = 2000;
      const noteCommit = el("input", "form-input");
      noteCommit.placeholder = "Commit (optional)";
      noteCommit.maxLength = 64;
      noteForm.append(notePath, noteText, noteCommit, button("Pin note", "ad-btn", () => {
        if (notePath.value.trim() === "" || noteText.value.trim().length < 3) return;
        const file = deps.activeFile();
        const anchor = file !== null && file.path === notePath.value.trim() ? contentFingerprint(file.content) : null;
        void act({
          action: "note", operation: "add", path: notePath.value.trim(), text: noteText.value.trim(),
          ...(noteCommit.value.trim() ? { commit: noteCommit.value.trim() } : {}), ...(anchor === null ? {} : { anchor }),
        });
      }));
      const comments = el("ul", "community-live-list community-live-comments");
      for (const comment of current.comments.filter((one) => !one.resolved)) {
        const row = el("li", "community-live-row community-live-comment");
        row.dataset["stale"] = String(comment.stale === true);
        const copy = el("div", "community-live-grow");
        const title = el("div", "community-live-comment-title");
        title.append(el("strong", "community-live-file", `${comment.path}:${comment.line}`));
        if (comment.stale === true) title.append(roomChip("Code moved on", "warning"));
        if (comment.linkedKind) title.append(roomChip(`Linked ${comment.linkedKind}`, "linked"));
        copy.append(title, el("p", "community-live-task", comment.text));
        copy.append(el("span", "community-card-by", `${comment.authorName} · ${comment.anchorKind ?? "file"} · ${timeAgo(comment.at, Date.now())}`));
        row.append(copy);
        const mine = comment.authorId === current.selfId || current.self.role === "owner";
        if (current.open && mine) row.append(button("Resolve", "ad-btn", () => void act({ action: "comment", operation: "resolve", id: comment.id })));
        if (current.open && current.self.role !== "viewer" && comment.text.trim().length >= 3) {
          row.append(button("Make plan step", "ad-btn", () => {
            void (async () => {
              const stepId = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
              const next = await attempt<ArtifactRoomSnapshot>(() => window.adcode.community.artifactRoomAction(id, key, {
                action: "plan", operation: "add", id: stepId, title: comment.text.trim().slice(0, 200), paths: [comment.path], ownerUid: current.selfId,
              }), "The plan step could not be added.");
              if (next === null) return;
              current = next;
              await act({ action: "comment", operation: "link", id: comment.id, linkedKind: "plan", linkedId: stepId });
            })();
          }));
        }
        if (current.open && current.self.role !== "viewer") row.append(button("Ask my agent", "ad-btn", () => {
          void (async () => {
            await act({ action: "comment", operation: "link", id: comment.id, linkedKind: "prompt" });
            deps.askAssistant(`In the shared live room for "${current.title}", there is a comment on ${comment.path}:${comment.line}: "${comment.text}". Read that file, make the change, and explain what you changed. If it is a question, answer it first.`);
          })();
        }));
        comments.append(row);
      }
      if (comments.childElementCount === 0) comments.append(el("li", "community-live-row community-live-empty", "No open comments. Anchor one to a file, a hunk or a moment"));
      const commentForm = el("form", "community-live-form");
      const commentPath = el("input", "form-input");
      commentPath.placeholder = "File";
      const commentLine = el("input", "form-input");
      commentLine.placeholder = "Line";
      commentLine.type = "number";
      commentLine.min = "1";
      const commentAnchor = el("select", "ad-select");
      for (const value of ["file", "hunk", "session", "transcript"]) commentAnchor.append(new Option(value, value));
      const commentHunk = el("input", "form-input");
      commentHunk.placeholder = "Diff hunk or transcript moment";
      commentHunk.maxLength = 240;
      const commentText = el("input", "form-input");
      commentText.placeholder = "Comment";
      commentForm.append(commentPath, commentLine, commentAnchor, commentHunk, commentText, button("Comment", "ad-btn", () => {
        if (commentPath.value.trim() === "" || commentText.value.trim() === "") return;
        if (commentAnchor.value === "hunk" && commentHunk.value.trim() === "") return;
        const file = deps.activeFile();
        const anchor = file !== null && file.path === commentPath.value.trim() ? contentFingerprint(file.content) : null;
        void act({
          action: "comment", operation: "add", path: commentPath.value.trim(), line: Number(commentLine.value || 1),
          text: commentText.value.trim(), anchorKind: commentAnchor.value,
          ...(commentAnchor.value === "hunk" || commentAnchor.value === "transcript" ? { hunk: commentHunk.value.trim() } : {}),
          ...(anchor === null ? {} : { anchor }),
        });
      }));
      const chat = el("ul", "community-live-list community-live-chat");
      for (const message of current.messages.slice(-30)) {
        const row = el("li", "community-live-row community-live-message");
        row.append(el("strong", "community-live-message-name", message.name), el("time", "community-live-message-time", timeAgo(message.at, Date.now())), el("p", "community-live-message-text", message.text));
        chat.append(row);
      }
      if (chat.childElementCount === 0) chat.append(el("li", "community-live-row community-live-empty", "No messages yet. Say hello, and say which part you are taking"));
      const chatForm = el("form", "community-live-form community-live-now-chat");
      const chatText = el("input", "form-input");
      chatText.placeholder = current.open ? "Write to everyone here" : "This room is closed";
      chatText.setAttribute("aria-label", "Message to everyone in the room");
      chatText.disabled = !current.open;
      const sendChat = (): void => {
        if (chatText.value.trim() === "") return;
        void act({ action: "post", text: chatText.value.trim() });
      };
      const sendButton = button("Send", "ad-btn ad-btn-primary", sendChat);
      sendButton.disabled = !current.open;
      // Enter sends, the way every chat box does; the form must never navigate the window.
      chatForm.addEventListener("submit", (event) => { event.preventDefault(); sendChat(); });
      chatForm.append(chatText, sendButton);
      now.append(nowRow("Talk to everyone", chat, chatForm));
      const activity = el("ul", "community-live-list community-live-activity");
      for (const item of current.activity.slice(0, 12)) {
        const row = el("li", "community-live-row community-live-event");
        row.append(el("time", "", timeAgo(item.at, Date.now())), el("span", "", item.text));
        activity.append(row);
      }
      if (activity.childElementCount === 0) activity.append(el("li", "community-live-row community-live-empty", "Nothing has happened yet"));
      // Enter in a one-field form would otherwise submit it and navigate the whole window away.
      for (const form of [lockForm, steps, approvalForm, handoffForm, noteForm, commentForm]) form.addEventListener("submit", (event) => event.preventDefault());
      /** One tool in the fold: its name, one line on what it is for, then the list and its form. */
      const tool = (title: string, line: string, ...parts: HTMLElement[]): HTMLElement => {
        const wrap = el("section", "community-section community-live-tool");
        const words = el("div", "community-section-head");
        const text = el("div", "");
        text.append(el("h3", "community-section-title", title), el("p", "community-section-note", line));
        words.append(text);
        wrap.append(words, ...parts);
        return wrap;
      };
      const more = el("details", "community-live-more");
      more.open = moreOpen;
      more.addEventListener("toggle", () => { moreOpen = more.open; });
      const moreSummary = el("summary", "community-live-more-summary");
      moreSummary.append(
        el("span", "community-live-more-title", needsYou > 0 ? `More team tools · ${needsYou} waiting on you` : "More team tools"),
        el("span", "community-live-more-note", "File locks, approvals, handoffs, pinned notes, comments and what happened"),
      );
      more.append(
        moreSummary,
        tool("Session", "The branch and task everyone in this room is working on.", head),
        tool("Coordination", "Warns when two people touch the same file. Lock a file before a big change so nobody else edits it.", coordination, lockForm),
        tool("Approvals", pendingApprovals.length === 0 ? "Ask the team before a push, a command or taking over someone's work. Nothing is waiting." : `Ask the team before a push, a command or a takeover. ${pendingApprovals.length} waiting for an answer.`, approvals, approvalForm),
        tool("Handoffs", "Pass your work to a teammate - the branch, the plan and fresh notes go with it.", handoffs, handoffForm),
        tool("Shared Brain", "Notes pinned to files, for the things the code cannot say.", notes, noteForm),
        tool("Comments", "A note on a line of code, a change or a moment. It can become a plan step or a job for your AI.", comments, commentForm),
        tool("Activity", "Everything that happened in this room, newest first.", activity),
      );
      body.replaceChildren(
        now,
        actions,
        editors,
        tool("The plan", planTotal === 0 ? "One list of steps everyone - and everyone's AI - works from. No steps yet." : `One list of steps everyone - and everyone's AI - works from. ${planDone} of ${planTotal} done.`, plan, steps),
        tool("People and their AI", `Who is here and what each person's AI is doing. ${ready} of ${current.checks.length} join checks ready.`, people),
        more,
      );
      drawEditors();
    }
    const beat = async (): Promise<void> => {
      const file = deps.activeFile();
      const self = current.members.find((one) => one.uid === current.selfId);
      const holding = self?.lane.status === "awaiting" || self?.lane.status === "handoff";
      await window.adcode.community.artifactRoomAction(id, key, {
        action: "heartbeat",
        watching: self?.watching ?? false,
        path: file?.path ?? null,
        line: null,
        provider: laneProvider,
        model: laneModel,
        status: holding ? self!.lane.status : laneStatus,
        task: holding ? self!.lane.task : laneTask,
        hasAgent: aiReady,
        files: file === null ? [] : [{ path: file.path, fingerprint: contentFingerprint(file.content) }],
      }).catch(() => null);
    };
    const timer = window.setInterval(() => {
      if (!dialog.open) { window.clearInterval(timer); return; }
      void beat();
      if (card.contains(document.activeElement)) return;
      void refresh(true);
    }, 5000);
    const offStatus = window.adcode.collab.onStatus((next) => {
      liveStatus = next;
      drawEditors();
    });
    const offPresence = window.adcode.collab.onPresence((next) => {
      const now = Date.now();
      for (const one of next) if (one.path !== null) liveSeen.set(one.participantId, now);
      livePresence = next;
      drawEditors();
    });
    void refreshLive();
    dialog.addEventListener("close", () => {
      offStatus();
      offPresence();
      window.clearInterval(timer);
      window.clearTimeout(statusTimer);
      stopRuns();
    });
    void beat();
    draw();
    dialog.showModal();
  }

  function sendImprovement(link: ProjectLinkView): void {
    const { dialog, card, finish } = detailDialog("community-share", `Send your changes back to ${link.link!.title}`);
    const files = el("ul", "community-changes");
    for (const change of link.changes.slice(0, 40)) {
      const row = el("li", "");
      row.append(chip(change.kind, `community-chip community-change-${change.kind}`), document.createTextNode(" "), el("span", "community-file-path", change.path), document.createTextNode(" "), el("span", "community-diffstat", `+${change.added} −${change.removed}`));
      files.append(row);
    }
    card.append(el("p", "result-summary", `${plural(link.changes.length, "file")} changed since version ${link.link!.version}. The owner sees exactly these changes and accepts or declines them.`), files);
    const form = el("form", "form-dialog-form");
    const titleInput = el("input", "form-input");
    titleInput.required = true; titleInput.minLength = 3; titleInput.maxLength = 100;
    titleInput.placeholder = "Add a delete button to each todo";
    const message = el("textarea", "form-input");
    message.rows = 4; message.maxLength = 4000;
    message.placeholder = "What you changed and why, and how to check it works";
    const error = el("p", "form-notice");
    error.setAttribute("role", "alert");
    error.hidden = true;
    const buttons = el("div", "confirm-buttons");
    const submit = el("button", "result-close", "Send your changes");
    submit.type = "submit";
    buttons.append(button("Ask AI to describe it", "ad-btn", () => {
      finish();
      deps.askAssistant(`I changed these files in my copy of "${link.link!.title}": ${link.changes.map((change) => `${change.path} (${change.kind})`).join(", ")}. Read them and write a short title (under 80 characters) and a description for the owner: what changed, why it is better, and how to check it works.`);
    }), button("Cancel", "confirm-cancel", finish), submit);
    form.append(field("Title", titleInput), field("Message to the owner", message), error, buttons);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit.disabled = true;
      void window.adcode.community.sendImprovement(titleInput.value, message.value).then(() => {
        finish();
        deps.track("improvement_sent");
        say("Your changes were sent. The owner's answer will appear under Sent to you.");
      }, (failure: unknown) => {
        error.textContent = errorText(failure, "It could not be sent.");
        error.hidden = false;
        submit.disabled = false;
      });
    });
    card.append(form);
    dialog.showModal();
    titleInput.focus();
  }

  /* ---------- Sent to you (id "inbox") ---------- */

  function diffView(change: ArtifactChange): HTMLElement {
    const details = el("details", "community-diff");
    const stats = changeStats(change);
    const summaryRow = el("summary", "");
    summaryRow.append(chip(change.kind, `community-chip community-change-${change.kind}`), document.createTextNode(" "), el("span", "community-file-path", change.path), document.createTextNode(" "), el("span", "community-diffstat", `+${stats.added} −${stats.removed}`));
    const pre = el("pre", "community-diff-lines");
    for (const line of lineDiff(change.before, change.after).slice(0, 800)) {
      pre.append(el("span", `community-diff-${line.kind}`, `${line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : line.kind === "skip" ? "⋯ " : "  "}${line.text}\n`));
    }
    details.append(summaryRow, pre);
    return details;
  }

  async function reviewImprovement(summaryRow: ImprovementSummary, owner: boolean): Promise<void> {
    const detail = await attempt<ImprovementDetail>(() => window.adcode.community.improvement(summaryRow.id), "That improvement could not be loaded.");
    if (detail === null) return;
    const { dialog, card, finish } = detailDialog("community-review", detail.title);
    card.append(el("p", "community-card-by", `${detail.authorName} → ${detail.artifactTitle} · from version ${detail.baseVersion} · ${timeAgo(detail.at, Date.now())} · ${detail.status}`));
    if (detail.message) card.append(el("p", "result-summary", detail.message));
    if (detail.conflicts.length > 0) {
      const callout = el("div", "community-callout");
      callout.dataset["tone"] = "warning";
      callout.append(el("p", "", `These files changed since this was made: ${detail.conflicts.join(", ")}. Accept, use theirs replaces them with the contributor's version.`));
      card.append(callout);
    }
    const diffs = el("div", "community-diffs");
    for (const change of detail.changes) diffs.append(diffView(change));
    if (detail.changes.length <= 3) diffs.querySelectorAll("details").forEach((one) => { one.open = true; });
    card.append(diffs);
    if (detail.reply) card.append(el("p", "community-card-by", `Owner's reply: ${detail.reply}`));
    if (owner && detail.status === "open") {
      const reply = el("textarea", "form-input");
      reply.rows = 2; reply.maxLength = 2000;
      reply.placeholder = "Say thanks, or why not (optional)";
      card.append(field("Reply", reply));
      const buttons = el("div", "confirm-buttons community-dialog-actions");
      const decide = (accept: boolean, force: boolean) => void attempt(async () => {
        const result = await window.adcode.community.decide(detail.id, accept, reply.value, force);
        finish();
        if (accept) deps.track("improvement_accepted");
        say(accept ? `Accepted. ${detail.artifactTitle} is now version ${result.mergedVersion} - press Get version ${result.mergedVersion} on This project to bring it into your folder.` : `Declined. ${detail.authorName} has been told.`);
        shell.rerender();
      }, accept ? "It could not be accepted." : "It could not be declined.");
      buttons.append(button("Ask AI to review it", "ad-btn", () => {
        finish();
        deps.askAssistant(`Review this improvement someone sent to my project "${detail.artifactTitle}". Title: ${detail.title}. Message: ${detail.message || "(none)"}. Changes:\n\n${detail.changes.slice(0, 20).map((change) => `--- ${change.path} (${change.kind})\n${lineDiff(change.before, change.after).filter((line) => line.kind !== "same").slice(0, 120).map((line) => `${line.kind === "add" ? "+" : line.kind === "remove" ? "-" : "…"} ${line.text}`).join("\n")}`).join("\n\n")}\n\nIs it safe and correct? List concerns, most serious first, and say whether you would accept it.`);
      }), button("Decline", "ad-btn", () => decide(false, false)));
      buttons.append(detail.conflicts.length > 0 ? button("Accept, use theirs", "result-close", () => decide(true, true)) : button("Accept", "result-close", () => decide(true, false)));
      card.append(buttons);
    }
    dialog.showModal();
  }

  async function loadMe(panel: HTMLElement, signedOutText: string): Promise<CommunityMe | null> {
    shell.loading(panel);
    try {
      me = await communityMe();
      applyUnread(me);
      return me;
    } catch (error) {
      panel.replaceChildren(/sign in/i.test(errorText(error, "")) ? signedOutBox(signedOutText, deps.signIn) : el("p", "community-empty", "This could not be loaded"));
      return null;
    }
  }

  async function renderInbox(): Promise<void> {
    const panel = shell.panel("inbox");
    const result = await loadMe(panel, "Sign in to see the changes people send you");
    if (result === null) return;
    const STATUS: Readonly<Record<string, string>> = { open: "Waiting for an answer", accepted: "Accepted", declined: "Declined" };
    const row = (item: ImprovementSummary, owner: boolean): HTMLElement => {
      const node = el("li", "community-installed-row");
      const names = el("div", "community-card-names");
      names.append(button(item.title, "community-card-title", () => void reviewImprovement(item, owner)), el("span", "community-card-by", `${owner ? `from ${item.authorName} · ${item.artifactTitle}` : `to ${item.artifactTitle}`} · ${plural(item.files, "file")} · ${timeAgo(item.at, Date.now())}`));
      node.append(names, chip(STATUS[item.status] ?? item.status, `community-chip community-status-${item.status}`));
      if (owner && item.status === "open") node.append(button("Look and decide", "ad-btn ad-btn-primary", () => void reviewImprovement(item, owner)));
      return node;
    };
    const waiting = result.inbox.filter((item) => item.status === "open").length;
    panel.replaceChildren(
      section(`Changes people sent you${waiting > 0 ? ` · ${waiting} waiting` : ""}`, "Open one to see every changed line, then accept or decline it", result.inbox.length === 0
        ? emptyWith("Nobody has sent you changes yet. Share a project and say what you would like help with.", button("Share this project", "ad-btn ad-btn-primary", () => shareProject()))
        : list(result.inbox.map((item) => row(item, true)), "")),
      section("Changes you sent", "Whether the owner accepted them, and what they said", result.sent.length === 0
        ? emptyWith("You have not sent anyone changes yet. Find a project asking for help, make a copy and improve it.", button("Find someone asking for help", "ad-btn ad-btn-primary", () => { helpOnly = true; shell.showTab("discover"); }))
        : list(result.sent.map((item) => row(item, false)), "")),
    );
  }

  /**
   * A relay from before a removal was deployed can keep the artifact in `me()`. Confirm
   * each row once per visit: a removed artifact answers "not shared any more", so it is
   * remembered locally and leaves this list even before the server is updated.
   */
  const checkedArtifacts = new Set<string>();
  async function hideGoneArtifacts(artifacts: readonly ArtifactListing[]): Promise<readonly ArtifactListing[]> {
    const unchecked = artifacts.filter((artifact) => !checkedArtifacts.has(artifact.id));
    await Promise.all(unchecked.map(async (artifact) => {
      try {
        await window.adcode.community.artifact(artifact.id);
      } catch (failure) {
        if (/not shared any more/i.test(errorText(failure, ""))) rememberArtifactRemoved(artifact.id);
      } finally {
        checkedArtifacts.add(artifact.id);
      }
    }));
    return withoutRemovedArtifacts(artifacts);
  }

  async function renderMine(): Promise<void> {
    const panel = shell.panel("mine");
    const result = await loadMe(panel, "Sign in to share projects and see who copied and improved them");
    if (result === null) return;
    const artifacts = await hideGoneArtifacts(result.artifacts);
    const rows = artifacts.map((artifact) => {
      const node = el("li", "community-installed-row");
      const names = el("div", "community-card-names");
      names.append(button(artifact.title, "community-card-title", () => void openArtifact(artifact.id)), el("span", "community-card-by", `version ${artifact.version} · ${plural(artifact.remixes, "copy", "copies")} · ${artifact.openImprovements} waiting for you`));
      node.append(names, button("Stop sharing", "ad-btn", () => void (async () => {
        if (!await askThemed({ title: `Stop sharing ${artifact.title}?`, body: "Nobody new can open it, join it or copy it. Copies people already made stay theirs.", confirmLabel: "Stop sharing", danger: true })) return;
        if (await attempt(() => window.adcode.community.removeArtifact(artifact.id), "Could not stop sharing it.") !== null) { rememberArtifactRemoved(artifact.id); say(`${artifact.title} is no longer shared. Copies people made stay theirs.`); shell.rerender(); }
      })()));
      return node;
    });
    const share = button("Share this project", "ad-btn ad-btn-primary", () => shareProject());
    panel.replaceChildren(
      profileCard(result, shell.entering()),
      section("Your shared projects", "Projects you share", rows.length === 0
        ? emptyWith("You have not shared a project yet.", share, button("Work together with friends", "ad-btn", () => { shell.showTab("discover"); void startTogether(); }))
        : list(rows, ""), rows.length === 0 ? undefined : button("Share this project", "ad-btn", () => shareProject())),
      section("Activity", "Copies, stars, accepted changes and badges", activityList(result.activity.filter((item) => activityFor("artifacts", item)), "Nothing has happened yet. Share a project to get started")),
    );
  }

  function applyUnread(result: CommunityMe): void {
    shell.setBadge("inbox", result.inbox.filter((item) => item.status === "open").length);
    const unread = result.activity.filter((item) => !item.read && activityFor("artifacts", item)).length;
    shell.setBadge("mine", unread);
    shell.setChip(`${result.profile.level.name} · ${compactCount(result.profile.points)} pts`, () => shell.showTab("mine"));
    deps.onUnread(unread + result.inbox.filter((item) => item.status === "open").length);
  }

  return {
    element: shell.element,
    shown: () => {
      if (!shell.visible()) {
        deps.track("artifacts_opened");
        // A wave hello each visit, unless something is still running from before.
        if (!running) buck.play("greeting");
      }
      shell.shown();
    },
    hidden: shell.hidden,
    showTab: shell.showTab,
    shareProject: () => shareProject(),
    async poll() {
      try { me = await communityMe(); applyUnread(me); } catch { /* Signed out or offline: no badge. */ }
    },
  };
}
