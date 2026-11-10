/**
 * The Artifacts page: projects people share so others can remix and improve them.
 *
 * - Discover - projects asking for help, and everything shared, by trend.
 * - This project - the open folder's relationship to an artifact: share it, publish a new
 *   version, send your remix's improvement back, or bring in the latest accepted work.
 * - Inbox - improvements people sent you, and the ones you sent.
 * - Your artifacts - your level and badges, what you share, and what happened to it.
 */
import { contentFingerprint } from "@adcode/collab";
import {
  artifactShareMessage, changeStats, compactCount, decodeArtifactShare, lineDiff, timeAgo, type ArtifactChange,
  type ArtifactListing, type CommunityMe, type ImprovementDetail, type ImprovementSummary, type ListingSort,
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
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "top", label: "Most remixed" },
];

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
    summary: "Share a project, let others improve it, and accept what you like",
    searchLabel: "Search shared projects",
    tabs: [
      { id: "discover", label: "Discover" },
      { id: "project", label: "This project" },
      { id: "inbox", label: "Inbox" },
      { id: "mine", label: "Your artifacts" },
    ],
    render: (tab) => (tab === "discover" ? renderDiscover() : tab === "project" ? renderProject() : tab === "inbox" ? renderInbox() : renderMine()),
  });
  const { say, attempt } = shell;

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
      help.append(el("strong", "", "Help wanted: "), document.createTextNode(artifact.helpWanted));
      card.append(help);
    }
    const meta = el("div", "community-card-meta");
    meta.append(stat(artifact.remixes === 1 ? "remix" : "remixes", compactCount(artifact.remixes)), stat(artifact.stars === 1 ? "star" : "stars", compactCount(artifact.stars)), stat(artifact.contributors === 1 ? "contributor" : "contributors", compactCount(artifact.contributors)));
    for (const tag of artifact.tags.slice(0, 3)) meta.append(chip(tag));
    const foot = el("div", "community-card-foot");
    foot.append(el("span", "community-card-contributes", `${plural(artifact.fileCount, "file")} · ${formatBytes(artifact.bytes)}`), button("Remix", "ad-btn ad-btn-primary", () => void remix(artifact.id, artifact.title)));
    card.append(meta, foot);
    return card;
  }

  async function renderDiscover(): Promise<void> {
    const panel = shell.panel("discover");
    shell.loading(panel);
    const query = shell.search.value.trim();
    const doors = el("div", "community-doors");
    doors.append(
      door(ICON.projects, "Share this project", "Anyone on ADCode can remix it and send you improvements", () => shareProject()),
      door(ICON.search, "Open a shared artifact", "Paste an adartifact: code to open a friend's public or private project", () => openSharedDialog()),
      door(ICON.checklist, "Help someone", "Improve a project with your AI and send it back. Accepted work is worth 20 points", () => { helpOnly = true; void renderDiscover(); }),
      door(ICON.edit, "Send an improvement", "Changed a remix? Send it to its owner from This project", () => shell.showTab("project")),
    );
    const bar = el("div", "community-bar");
    const help = button("Help wanted only", "community-category", () => { helpOnly = !helpOnly; void renderDiscover(); });
    help.setAttribute("aria-pressed", String(helpOnly));
    const sortSelect = el("select", "ad-select community-sort");
    sortSelect.setAttribute("aria-label", "Sort artifacts");
    for (const option of SORTS) sortSelect.append(new Option(option.label, option.id, false, option.id === sort));
    sortSelect.addEventListener("change", () => { sort = sortSelect.value as ListingSort; void renderDiscover(); });
    bar.append(el("p", "community-section-note", "Remix copies a project into a folder of your own. The owner reviews anything you send back, file by file"), help, sortSelect);
    const [home, listings, live] = await Promise.all([
      query === "" && !helpOnly ? window.adcode.community.home().then((value) => value, () => null) : Promise.resolve(null),
      window.adcode.community.artifacts(sort, query, helpOnly).then((value) => value, () => null),
      query === "" && !helpOnly ? window.adcode.community.liveRooms().then((value) => value, () => []) : Promise.resolve([]),
    ]);
    if (listings === null) { shell.offline(panel, "Shared projects could not be reached. Check your connection", () => void renderDiscover()); return; }
    if (home !== null) shell.setSummary(`${plural(home.totals.artifacts, "shared project")} · ${plural(home.totals.creators, "creator")}`);
    const liveCards = live.filter((room) => room.open).map((room) => {
      const card = el("article", "community-card community-live-card");
      const top = el("div", "community-card-top");
      const names = el("div", "community-card-names");
      names.append(button(room.title, "community-card-title", () => void liveRoom(room.artifactId, null, false)), el("span", "community-card-by", `${room.hostName} · ${room.branch}`));
      top.append(names, roomChip("Live", "live"));
      card.append(top, el("p", "community-card-text", room.task || "A clean live session"));
      const presence = el("div", "community-live-card-presence");
      presence.append(el("span", "community-live-signal-dot"), el("span", "community-card-by", `${plural(room.memberCount, "person", "people")} here`));
      card.append(presence, roomMeter(room.percent, "Plan progress"));
      const meta = el("div", "community-card-meta");
      meta.append(stat("done", `${room.percent}%`), stat("files", String(room.files.length)), stat("waiting", String(room.approvals + room.handoffs)));
      if (room.warnings > 0) meta.append(chip(`${room.warnings} overlap${room.warnings === 1 ? "" : "s"}`));
      card.append(meta);
      return card;
    });
    panel.replaceChildren(
      ...(query === "" && !helpOnly ? [doors] : []),
      ...(liveCards.length > 0 ? [section("Live now", "Sessions with people and agents working right now", shell.grid(liveCards, ""))] : []),
      ...(home !== null && home.helpWanted.length > 0 ? [section("Help wanted", "Owners asked for a hand", shell.grid(home.helpWanted.map(artifactCard), ""))] : []),
      section(helpOnly ? "Asking for help" : "All shared projects", "", el("div", "")),
      bar,
      shell.grid(listings.map(artifactCard), query ? `No shared projects match "${query}"` : helpOnly ? "Nobody is asking for help right now" : "No shared projects yet. Share yours from This project"),
    );
  }

  /* ---------- This project ---------- */

  async function renderProject(): Promise<void> {
    const panel = shell.panel("project");
    shell.loading(panel);
    const link = await attempt<ProjectLinkView>(() => window.adcode.community.projectLink(), "Could not read the open project.");
    if (link === null || link.root === null) {
      const box = el("div", "community-empty");
      box.append(el("p", "", "Open a project folder to share it, or remix a shared project from Discover"), button("Open a folder", "ad-btn ad-btn-primary", deps.pickFolder));
      panel.replaceChildren(box);
      return;
    }
    const changed = link.changes.length;
    const behind = link.link !== null && link.latestVersion !== null && link.latestVersion > link.link.version;
    const banner = el("div", "community-banner");
    const actions = el("div", "community-row-actions");
    const words = el("p", "");
    if (link.link === null) {
      words.append(el("strong", "", link.root.split(/[\\/]/).pop() ?? "This project"), document.createTextNode(" is not shared. Share it and anyone on ADCode can remix it and send you improvements."));
      actions.append(button("Share this project", "ad-btn ad-btn-primary", () => shareProject()));
    } else if (link.link.role === "owner") {
      words.append(el("strong", "", link.link.title), document.createTextNode(` · you share this as version ${link.link.version}. ${changed === 0 ? "No local changes since." : `${plural(changed, "file")} changed since.`}${behind ? ` Version ${link.latestVersion} has accepted improvements.` : ""}`));
      if (behind) actions.append(button(`Get version ${link.latestVersion}`, "ad-btn ad-btn-primary", () => void pullLatest()));
      actions.append(button(changed > 0 ? "Publish new version" : "Edit listing", changed > 0 && !behind ? "ad-btn ad-btn-primary" : "ad-btn", () => shareProject()), button("Open", "ad-btn", () => void openArtifact(link.link!.artifactId)), button("Live room", "ad-btn", () => void liveRoom(link.link!.artifactId, null, true)));
    } else {
      words.append(document.createTextNode("Remix of "), el("strong", "", link.link.title), document.createTextNode(` v${link.link.version}. ${changed === 0 ? "Change something, then send it back as an improvement." : `${plural(changed, "file")} changed - ready to send.`}${behind ? ` The original is at version ${link.latestVersion}.` : ""}`));
      if (behind) actions.append(button("Get latest", "ad-btn", () => void pullLatest()));
      const send = button("Send improvement", "ad-btn ad-btn-primary", () => sendImprovement(link));
      send.disabled = changed === 0;
      actions.append(send, button("Share as my own", "ad-btn", () => shareProject()), button("Live room", "ad-btn", () => {
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
    const ok = await askThemed({ title: `Remix ${name}?`, body: "ADCode copies the latest version into a new folder in Documents �?� ADCode Projects and opens it. When you are happy with your changes, send them back from This project.", confirmLabel: "Remix" });
    if (!ok) return;
    const root = await withProgress(`remix:${id}`, `Downloading ${name}`, () => window.adcode.community.remix(id, key), "That artifact could not be remixed.");
    if (root === null) return;
    deps.track("artifact_remixed");
    say(`Remixed into ${root}`);
    await deps.openFolder(root);
  }

  async function openArtifact(id: string, key: string | null = null): Promise<void> {
    const detail = await attempt<ArtifactDetail>(() => window.adcode.community.artifact(id, key), "That artifact could not be loaded.");
    if (detail === null) return;
    if (key !== null) accessKeys.set(id, key);
    showArtifact(detail, key);
  }

  function showArtifact(detail: ArtifactDetail, key: string | null = null): void {
    const { dialog, card, finish } = detailDialog("community-detail", detail.title);
    card.append(el("p", "community-card-by", `by ${detail.ownerName} · version ${detail.version} · ${plural(detail.fileCount, "file")} · ${formatBytes(detail.bytes)}`), el("p", "result-summary", detail.description));
    if (detail.helpWanted) {
      const help = el("p", "community-help-wanted");
      help.append(el("strong", "", "Help wanted: "), document.createTextNode(detail.helpWanted));
      card.append(help);
    }
    const meta = el("div", "community-card-meta");
    meta.append(stat("remixes", compactCount(detail.remixes)), stat("improvements", compactCount(detail.improvements)), chip(detail.visibility === "private" ? "Private link" : "Public"));
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
    if (detail.shareCode !== null) buttons.append(button("Sharing and live", "ad-btn", () => { finish(); void shareSettings(detail); }));
    else buttons.append(button("Live room", "ad-btn", () => { finish(); void liveRoom(detail.id, accessKeys.get(detail.id) ?? key, false); }));
    buttons.append(button("Remix", "result-close", () => { finish(); void remix(detail.id, detail.title, accessKeys.get(detail.id) ?? key); }));
    card.append(buttons);
    dialog.showModal();
  }

  /**
   * Share the open project. Problems come first, before any field: a folder that is not a
   * project is refused outright, a folder too big says how to trim it, and files that look
   * like they hold a key can be left out with one click.
   */
  function shareProject(exclude: readonly string[] = []): void {
    void (async () => {
      const preview = await attempt<ArtifactPreview>(() => window.adcode.community.previewArtifact(exclude), "Open a project folder first.");
      if (preview === null) return;
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
      const { dialog, card, finish } = detailDialog("community-share", owned ? `Publish a new version of ${preview.link!.title}` : `Share ${preview.name}`);
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
        const leaveOut = button(`Leave ${preview.secrets.length === 1 ? "this file" : "these files"} out`, "ad-btn", () => { finish(); shareProject([...exclude, ...preview.secrets.map((secret) => secret.path)]); });
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
      const help = el("input", "form-input");
      help.maxLength = 500;
      help.placeholder = "Add dark mode, write tests, make it work on phones";
      const tags = el("input", "form-input");
      tags.placeholder = "game, beginner, react";
      const visibility = el("select", "ad-select");
      visibility.append(new Option("Public - listed in Discover", "public"), new Option("Private - only people with the code", "private"));
      const message = el("input", "form-input");
      message.maxLength = 300;
      message.placeholder = owned ? "What changed in this version" : "First version";
      const describeVisibility = (): void => {
        summary.textContent = visibility.value === "private"
          ? `${plural(preview.files, "file")} - ${formatBytes(preview.bytes)}. It stays out of Discover until you set it public. Only people with its share code can open or remix it.`
          : `${plural(preview.files, "file")} - ${formatBytes(preview.bytes)} will be public. Anyone signed in to ADCode can remix it.`;
      };
      visibility.addEventListener("change", describeVisibility);
      describeVisibility();
      for (const input of [titleInput, description, help, tags, visibility, message]) input.disabled = blocked;
      const error = el("p", "form-notice");
      error.setAttribute("role", "alert");
      error.hidden = true;
      const buttons = el("div", "confirm-buttons");
      let label = owned ? "Publish version" : "Share";
      const submit = el("button", "result-close", label);
      submit.type = "submit";
      submit.disabled = blocked;
      buttons.append(button("Cancel", "confirm-cancel", finish), submit);
      form.append(
        field("Title", titleInput),
        field("What is it?", description, "One or two sentences. The README is shown on the page too."),
        field("What would you like help with?", help, "Optional. Projects that ask are listed under Help wanted."),
        field("Tags", tags, "Up to 6, separated by commas."),
        field("Who can open it?", visibility, "Private artifacts stay out of Discover. Share their code with friends."),
        field("Note for this version", message),
        error, buttons,
      );
      visibility.addEventListener("change", () => {
        label = owned ? "Publish version" : visibility.value === "private" ? "Create private link" : "Share";
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
          say(visibility.value === "private" ? `${detail.title} is private. Open Sharing and live to copy its code.` : `${detail.title} is shared as version ${detail.version}. Improvements people send arrive in Inbox`);
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

  function openSharedDialog(): void {
    const { dialog, card, finish } = detailDialog("community-share", "Open a shared artifact");
    card.append(el("p", "result-summary", "Paste the whole code a friend sent you. It starts with adartifact: and works for public and private projects."));
    const code = el("input", "form-input");
    code.placeholder = "adartifact:...";
    code.setAttribute("aria-label", "Artifact code");
    const error = el("p", "form-notice");
    error.hidden = true;
    const open = button("Open", "result-close", () => {
      void (async () => {
        const text = code.value.trim();
        const decoded = decodeArtifactShare(text);
        if (decoded === null) {
          error.textContent = "That code is not complete. Paste the line that starts with adartifact:.";
          error.hidden = false;
          return;
        }
        const detail = await attempt<ArtifactDetail>(() => window.adcode.community.openSharedArtifact(text), "That artifact could not be opened.");
        if (detail === null) return;
        accessKeys.set(detail.id, decoded.key);
        finish();
        showArtifact(detail, decoded.key);
      })();
    });
    const buttons = el("div", "confirm-buttons");
    buttons.append(button("Cancel", "confirm-cancel", finish), open);
    card.append(field("Artifact code", code), error, buttons);
    dialog.showModal();
    code.focus();
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
    visibilitySelect.append(new Option("Public - listed in Discover", "public"), new Option("Private - only people with the code", "private"));
    visibilitySelect.value = visibility;
    const error = el("p", "form-notice");
    error.hidden = true;
    const describe = (): void => {
      summary.textContent = visibility === "private"
        ? "This artifact is unlisted. Anyone with the code can open and remix it; rotating the code locks out old links."
        : "This artifact is listed in Discover. The code below also opens it directly.";
    };
    describe();
    const save = button("Save visibility", "ad-btn ad-btn-primary", () => {
      void (async () => {
        const next = await attempt<ArtifactDetail>(() => window.adcode.community.setArtifactVisibility(detail.id, visibilitySelect.value as ArtifactVisibility), "The visibility could not be changed.");
        if (next === null) return;
        visibility = next.visibility;
        detail = next;
        visibilitySelect.value = visibility;
        describe();
        say(next.visibility === "private" ? `${next.title} is private now` : `${next.title} is listed in Discover`);
      })();
    });
    const copy = button("Copy code", "ad-btn", () => { void copyText(shareCode).then((ok) => say(ok ? "Share code copied" : "Could not copy the code")); });
    const copyInvite = button("Copy invitation", "ad-btn", () => { void copyText(artifactShareMessage(detail.title, detail.id, decodeArtifactShare(shareCode)!.key)).then((ok) => say(ok ? "Invitation copied" : "Could not copy the invitation")); });
    const rotate = button("Replace code", "ad-btn", () => {
      void (async () => {
        if (!await askThemed({ title: "Replace the share code?", body: "Every old link stops working. People already remixing keep their copy.", confirmLabel: "Replace code", danger: true })) return;
        const next = await attempt<{ shareCode: string }>(() => window.adcode.community.rotateArtifactShare(detail.id), "The code could not be replaced.");
        if (next === null) return;
        shareCode = next.shareCode;
        code.value = shareCode;
        say("New share code ready. The old one stopped working");
      })();
    });
    const live = button("Open live room", "ad-btn", () => { finish(); void liveRoom(detail.id, null, true); });
    const buttons = el("div", "confirm-buttons");
    buttons.append(button("Close", "confirm-cancel", finish), copy, copyInvite, rotate, save, live);
    card.append(visibilitySelect, summary, field("Share code", code, "Only people you send this to can open a private artifact."), error, buttons);
    dialog.showModal();
  }

  async function liveRoom(id: string, key: string | null, owner: boolean): Promise<void> {
    if (me === null) {
      const loaded = await attempt<CommunityMe>(() => communityMe(), "Sign in to ADCode to use a live room.");
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
      const message = errorText(failure, "The live room could not be loaded.");
      if (message.includes("has not been opened")) {
        if (!owner) { say("The owner has not opened this live room yet."); return; }
        if (!await askThemed({ title: "Open the live room?", body: "Friends you invite can see everyone's agent lane, one shared plan, pinned notes, comments and the room chat while their agents work on the same project.", confirmLabel: "Open room" })) return;
        const opened = await attempt<ArtifactRoomSnapshot>(() => window.adcode.community.openArtifactRoom(id, person, null), "The live room could not be opened.");
        if (opened === null) return;
        current = opened;
      } else if (message.includes("Join this live room first")) {
        let joined = await attempt<ArtifactRoomSnapshot>(() => window.adcode.community.joinArtifactRoom(id, key, person, false, aiReady, null), "Could not join the live room.");
        if (joined === null) joined = await attempt<ArtifactRoomSnapshot>(() => window.adcode.community.joinArtifactRoom(id, key, person, true, aiReady, null), "Could not watch the live room.");
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
          actions.append(button(current.liveInvite === null ? "Share project live" : "Stop live project", "ad-btn ad-btn-primary", () => {
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
              const started = await attempt(() => window.adcode.collab.host({ bind: "internet", port: 0, displayName: person, artifactLive: true }), "The live project could not start. Sign in and check your connection.");
              if (started === null) return;
              if (started.invite === null) { say(errorText(started.error, "The live project could not start.")); return; }
              liveStatus = started;
              liveFromRoom = true;
              await act({ action: "setLive", invite: started.invite });
              drawEditors();
              flash("Live project started. Everyone in this room can edit the same project", "success");
            })();
          }));
          actions.append(button("Close room", "ad-btn", () => {
            void (async () => {
              if (!await askThemed({ title: "Close this live room?", body: "The room becomes read-only. Start it again later to keep collaborating.", confirmLabel: "Close room", danger: true })) return;
              const next = await attempt<ArtifactRoomSnapshot>(() => window.adcode.community.closeArtifactRoom(id), "The room could not be closed.");
              if (next !== null) { current = next; draw(); }
            })();
          }));
        } else if (current.liveInvite !== null) {
          actions.append(button("Join live project", "ad-btn ad-btn-primary", () => {
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
              const joined = await attempt(() => window.adcode.collab.join(current.liveInvite!, person), "Could not join the live project. Ask the host to keep the room open and try again.");
              if (joined !== null) {
                liveStatus = joined;
                liveFromRoom = true;
                await refreshLive();
                flash("Joined the live project. Open any file to see everyone's edits as they happen", "success");
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
      const head = el("header", "community-live-head");
      const signal = el("div", "community-live-signal");
      signal.dataset["state"] = current.open ? "live" : "closed";
      const signalDot = el("span", "community-live-signal-dot");
      signalDot.setAttribute("aria-hidden", "true");
      signal.append(signalDot, el("span", "community-live-signal-label", current.open ? "Live session" : "Read-only"));
      const facts = el("div", "community-live-facts");
      facts.append(
        roomFact("Branch", current.branch, true),
        roomFact("Task", current.task || "No task set"),
        roomFact("Here", `${present} ${present === 1 ? "person" : "people"}`),
        roomFact("Synced", current.lastSyncedAt > 0 ? timeAgo(current.lastSyncedAt, Date.now()) : "Not yet"),
      );
      head.append(signal, facts);
      if (needsYou > 0) head.append(roomChip(`${needsYou} waiting on you`, "attention"));
      const meter = el("div", "community-live-meter-wrap");
      const meterText = el("div", "community-live-meter-text");
      meterText.append(el("span", "", "Plan"), el("span", "community-live-meter-count", `${planDone} of ${planTotal} done`));
      meter.append(meterText, roomMeter(planTotal === 0 ? 0 : (planDone / planTotal) * 100, "Plan progress"));
      head.append(meter);

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
        title.append(el("strong", "", step.title), roomChip(step.status, step.status));
        copy.append(title);
        const bits = [ownerName ? `With ${ownerName}` : "Unclaimed"];
        if (step.paths !== undefined && step.paths.length > 0) bits.push(step.paths.join(", "));
        copy.append(el("span", "community-card-by", bits.join(" · ")));
        row.append(copy);
        if (current.open && (current.self.role === "owner" || current.self.role === "editor")) {
          const status = el("select", "ad-select");
          for (const value of ["todo", "doing", "done", "blocked"]) status.append(new Option(value, value, false, value === step.status));
          status.addEventListener("change", () => void act({ action: "plan", operation: "move", id: step.id, status: status.value }));
          row.append(status);
          if (step.status === "todo" && step.ownerUid !== current.selfId) {
            row.append(button(step.ownerUid === null ? "Claim" : "Ask to take over", "ad-btn", () => void act(step.ownerUid === null
              ? { action: "plan", operation: "claim", id: step.id }
              : { action: "plan", operation: "request", id: step.id })));
          }
        }
        plan.append(row);
      }
      if (plan.childElementCount === 0) plan.append(el("li", "community-live-row community-live-empty", "No steps yet. Add the first one below"));
      const steps = el("form", "community-live-form");
      const stepTitle = el("input", "form-input");
      stepTitle.placeholder = "Next step";
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
      for (const value of ["push", "network", "command", "plan-transfer", "handoff"]) approvalKind.append(new Option(value, value));
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
      if (chat.childElementCount === 0) chat.append(el("li", "community-live-row community-live-empty", "No messages yet. Say what you are taking"));
      const chatForm = el("form", "community-live-form");
      const chatText = el("input", "form-input");
      chatText.placeholder = current.open ? "Message everyone" : "This room is closed";
      chatText.disabled = !current.open;
      chatForm.append(chatText, button("Send", "ad-btn", () => {
        if (chatText.value.trim() === "") return;
        void act({ action: "post", text: chatText.value.trim() });
      }));
      const activity = el("ul", "community-live-list community-live-activity");
      for (const item of current.activity.slice(0, 12)) {
        const row = el("li", "community-live-row community-live-event");
        row.append(el("time", "", timeAgo(item.at, Date.now())), el("span", "", item.text));
        activity.append(row);
      }
      if (activity.childElementCount === 0) activity.append(el("li", "community-live-row community-live-empty", "Nothing has happened yet"));
      body.replaceChildren(
        head,
        actions,
        editors,
        section("People and agents", `${ready} of ${current.checks.length} join checks ready · ${present} here`, people),
        section("Coordination", "Overlaps are advisory: agree before editing the same file", coordination, lockForm),
        section("Approvals", pendingApprovals.length === 0 ? "Nothing waiting" : `${pendingApprovals.length} waiting for an answer`, approvals, approvalForm),
        section("Handoffs", "The branch, plan and fresh notes travel together", handoffs, handoffForm),
        section("One plan", planTotal === 0 ? "No steps yet" : `${planDone} of ${planTotal} done`, plan, steps),
        section("Shared Brain", "Pinned to files, not people", notes, noteForm),
        section("Comments", "Attached to a file, a hunk or a moment", comments, commentForm),
        section("Room chat", "", chat, chatForm),
        section("Activity", "", activity),
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
    const { dialog, card, finish } = detailDialog("community-share", `Send an improvement to ${link.link!.title}`);
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
    const submit = el("button", "result-close", "Send improvement");
    submit.type = "submit";
    buttons.append(button("Ask AI to describe it", "ad-btn", () => {
      finish();
      deps.askAssistant(`I changed these files in my remix of "${link.link!.title}": ${link.changes.map((change) => `${change.path} (${change.kind})`).join(", ")}. Read them and write a short title (under 80 characters) and a description for the owner: what changed, why it is better, and how to check it works.`);
    }), button("Cancel", "confirm-cancel", finish), submit);
    form.append(field("Title", titleInput), field("Message to the owner", message), error, buttons);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit.disabled = true;
      void window.adcode.community.sendImprovement(titleInput.value, message.value).then(() => {
        finish();
        deps.track("improvement_sent");
        say("Improvement sent. Its status shows in Inbox");
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

  /* ---------- Inbox ---------- */

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
        say(accept ? `Accepted. ${detail.artifactTitle} is at version ${result.mergedVersion}. Bring it into your folder from This project` : "Declined. The contributor was told");
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
    const result = await loadMe(panel, "Sign in to see improvements people send you");
    if (result === null) return;
    const row = (item: ImprovementSummary, owner: boolean): HTMLElement => {
      const node = el("li", "community-installed-row");
      const names = el("div", "community-card-names");
      names.append(button(item.title, "community-card-title", () => void reviewImprovement(item, owner)), el("span", "community-card-by", `${owner ? `from ${item.authorName} · ${item.artifactTitle}` : `to ${item.artifactTitle}`} · ${plural(item.files, "file")} · ${timeAgo(item.at, Date.now())}`));
      node.append(names, chip(item.status, `community-chip community-status-${item.status}`));
      return node;
    };
    const waiting = result.inbox.filter((item) => item.status === "open").length;
    panel.replaceChildren(
      section(`For you${waiting > 0 ? ` · ${waiting} waiting` : ""}`, "What people sent to your artifacts, waiting ones first", list(result.inbox.map((item) => row(item, true)), "Nothing yet. Share a project and say what you need help with")),
      section("You sent", "Their status and the owner's reply", list(result.sent.map((item) => row(item, false)), "None yet. Help wanted on Discover is a good place to start")),
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
    const result = await loadMe(panel, "Sign in to share projects and see who remixed and improved them");
    if (result === null) return;
    const artifacts = await hideGoneArtifacts(result.artifacts);
    const rows = artifacts.map((artifact) => {
      const node = el("li", "community-installed-row");
      const names = el("div", "community-card-names");
      names.append(button(artifact.title, "community-card-title", () => void openArtifact(artifact.id)), el("span", "community-card-by", `v${artifact.version} · ${plural(artifact.remixes, "remix", "remixes")} · ${artifact.openImprovements} waiting`));
      node.append(names, button("Stop sharing", "ad-btn", () => void (async () => {
        if (!await askThemed({ title: `Stop sharing ${artifact.title}?`, body: "It leaves the community. Remixes people already made stay theirs.", confirmLabel: "Stop sharing", danger: true })) return;
        if (await attempt(() => window.adcode.community.removeArtifact(artifact.id), "Could not stop sharing it.") !== null) { rememberArtifactRemoved(artifact.id); say(`${artifact.title} is no longer shared`); shell.rerender(); }
      })()));
      return node;
    });
    panel.replaceChildren(
      profileCard(result, shell.entering()),
      section("Your artifacts", "Projects you share", list(rows, "No projects shared yet"), button("Share this project", "ad-btn", () => shareProject())),
      section("Activity", "Remixes, stars, improvements and badges", activityList(result.activity.filter((item) => activityFor("artifacts", item)), "Nothing yet")),
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
    shown: () => { if (!shell.visible()) deps.track("artifacts_opened"); shell.shown(); },
    hidden: shell.hidden,
    showTab: shell.showTab,
    shareProject: () => shareProject(),
    async poll() {
      try { me = await communityMe(); applyUnread(me); } catch { /* Signed out or offline: no badge. */ }
    },
  };
}
