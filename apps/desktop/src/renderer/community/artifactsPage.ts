/**
 * The Artifacts page: projects people share so others can remix and improve them.
 *
 * - Discover - projects asking for help, and everything shared, by trend.
 * - This project - the open folder's relationship to an artifact: share it, publish a new
 *   version, send your remix's improvement back, or bring in the latest accepted work.
 * - Inbox - improvements people sent you, and the ones you sent.
 * - Your artifacts - your level and badges, what you share, and what happened to it.
 */
import {
  changeStats, compactCount, lineDiff, timeAgo, type ArtifactChange, type ArtifactListing, type CommunityMe, type ImprovementDetail,
  type ImprovementSummary, type ListingSort,
} from "@adcode/community";
import type { ArtifactDetail, ArtifactPreview, ProjectLinkView } from "../../shared/community.ts";
import { askThemed } from "../dialogs/confirmDialog.ts";
import { button, el, field } from "../dialogs/formDialog.ts";
import { ICON } from "../workbench/icons.ts";
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

export function createArtifactsPage(deps: ArtifactsPageDeps): ArtifactsPage {
  let sort: ListingSort = "trending";
  let helpOnly = false;
  let me: CommunityMe | null = null;

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
    const [home, listings] = await Promise.all([
      query === "" && !helpOnly ? window.adcode.community.home().then((value) => value, () => null) : Promise.resolve(null),
      window.adcode.community.artifacts(sort, query, helpOnly).then((value) => value, () => null),
    ]);
    if (listings === null) { shell.offline(panel, "Shared projects could not be reached. Check your connection", () => void renderDiscover()); return; }
    if (home !== null) shell.setSummary(`${plural(home.totals.artifacts, "shared project")} · ${plural(home.totals.creators, "creator")}`);
    panel.replaceChildren(
      ...(query === "" && !helpOnly ? [doors] : []),
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
      actions.append(button(changed > 0 ? "Publish new version" : "Edit listing", changed > 0 && !behind ? "ad-btn ad-btn-primary" : "ad-btn", () => shareProject()), button("Open", "ad-btn", () => void openArtifact(link.link!.artifactId)));
    } else {
      words.append(document.createTextNode("Remix of "), el("strong", "", link.link.title), document.createTextNode(` v${link.link.version}. ${changed === 0 ? "Change something, then send it back as an improvement." : `${plural(changed, "file")} changed - ready to send.`}${behind ? ` The original is at version ${link.latestVersion}.` : ""}`));
      if (behind) actions.append(button("Get latest", "ad-btn", () => void pullLatest()));
      const send = button("Send improvement", "ad-btn ad-btn-primary", () => sendImprovement(link));
      send.disabled = changed === 0;
      actions.append(send, button("Share as my own", "ad-btn", () => shareProject()));
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

  async function remix(id: string, name: string): Promise<void> {
    const ok = await askThemed({ title: `Remix ${name}?`, body: "ADCode copies the latest version into a new folder in Documents › ADCode Projects and opens it. When you are happy with your changes, send them back from This project.", confirmLabel: "Remix" });
    if (!ok) return;
    const root = await withProgress(`remix:${id}`, `Downloading ${name}`, () => window.adcode.community.remix(id), "That artifact could not be remixed.");
    if (root === null) return;
    deps.track("artifact_remixed");
    say(`Remixed into ${root}`);
    await deps.openFolder(root);
  }

  async function openArtifact(id: string): Promise<void> {
    const detail = await attempt<ArtifactDetail>(() => window.adcode.community.artifact(id), "That artifact could not be loaded.");
    if (detail === null) return;
    const { dialog, card, finish } = detailDialog("community-detail", detail.title);
    card.append(el("p", "community-card-by", `by ${detail.ownerName} · version ${detail.version} · ${plural(detail.fileCount, "file")} · ${formatBytes(detail.bytes)}`), el("p", "result-summary", detail.description));
    if (detail.helpWanted) {
      const help = el("p", "community-help-wanted");
      help.append(el("strong", "", "Help wanted: "), document.createTextNode(detail.helpWanted));
      card.append(help);
    }
    const meta = el("div", "community-card-meta");
    meta.append(stat("remixes", compactCount(detail.remixes)), stat("improvements", compactCount(detail.improvements)));
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
    buttons.append(starButton("artifact", detail.id, detail.starred, detail.stars, say), button("Report", "ad-btn", () => { finish(); reportDialog("artifact", detail.id, detail.title, say); }), button("Remix", "result-close", () => { finish(); void remix(detail.id, detail.title); }));
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
      card.append(el("p", "result-summary", `${plural(preview.files, "file")} · ${formatBytes(preview.bytes)} will be public. Anyone signed in to ADCode can remix it.`));

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
      const message = el("input", "form-input");
      message.maxLength = 300;
      message.placeholder = owned ? "What changed in this version" : "First version";
      for (const input of [titleInput, description, help, tags, message]) input.disabled = blocked;
      const error = el("p", "form-notice");
      error.setAttribute("role", "alert");
      error.hidden = true;
      const buttons = el("div", "confirm-buttons");
      const label = owned ? "Publish version" : "Share publicly";
      const submit = el("button", "result-close", label);
      submit.type = "submit";
      submit.disabled = blocked;
      buttons.append(button("Cancel", "confirm-cancel", finish), submit);
      form.append(
        field("Title", titleInput),
        field("What is it?", description, "One or two sentences. The README is shown on the page too."),
        field("What would you like help with?", help, "Optional. Projects that ask are listed under Help wanted."),
        field("Tags", tags, "Up to 6, separated by commas."),
        field("Note for this version", message),
        error, buttons,
      );
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        submit.disabled = true;
        submit.textContent = "Sharing";
        void window.adcode.community.publishArtifact({
          title: titleInput.value, description: description.value, helpWanted: help.value, message: message.value, exclude,
          tags: tags.value.split(",").map((tag) => tag.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "")).filter(Boolean).slice(0, 6),
        }).then((detail) => {
          finish();
          deps.track("artifact_shared");
          say(`${detail.title} is shared as version ${detail.version}. Improvements people send arrive in Inbox`);
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
      me = await window.adcode.community.me();
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

  async function renderMine(): Promise<void> {
    const panel = shell.panel("mine");
    const result = await loadMe(panel, "Sign in to share projects and see who remixed and improved them");
    if (result === null) return;
    const rows = result.artifacts.map((artifact) => {
      const node = el("li", "community-installed-row");
      const names = el("div", "community-card-names");
      names.append(button(artifact.title, "community-card-title", () => void openArtifact(artifact.id)), el("span", "community-card-by", `v${artifact.version} · ${plural(artifact.remixes, "remix", "remixes")} · ${artifact.openImprovements} waiting`));
      node.append(names, button("Stop sharing", "ad-btn", () => void (async () => {
        if (!await askThemed({ title: `Stop sharing ${artifact.title}?`, body: "It leaves the community. Remixes people already made stay theirs.", confirmLabel: "Stop sharing", danger: true })) return;
        if (await attempt(() => window.adcode.community.removeArtifact(artifact.id), "Could not stop sharing it.") !== null) { say(`${artifact.title} is no longer shared`); shell.rerender(); }
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
      try { me = await window.adcode.community.me(); applyUnread(me); } catch { /* Signed out or offline: no badge. */ }
    },
  };
}
