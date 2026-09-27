/**
 * The Changes panel: every uncommitted file, what changed in it, and one button to save it.
 *
 * Laid out the way Cursor's is - a bar with the totals, the branch and Commit & Push, then
 * one row per file with its line counts, a revert arrow and an include checkbox - because
 * that is the shape people already read at a glance. What it adds for someone who has
 * never staged a file: the checkboxes start ticked (nothing staged means everything goes),
 * a commit message is written for them when they leave it empty, a new file's revert goes
 * to the Recycle Bin instead of vanishing, and a folder without Git gets one button to
 * start tracking. The rules are in `changesModel.ts`; this file only draws and dispatches.
 */
import type { AiWorkspaceTaskView, GitStatusView } from "../../shared/api.ts";
import { askThemed } from "../dialogs/confirmDialog.ts";
import { attachContextMenuDismissal, createContextMenu, type ContextMenuNode } from "./contextMenu.ts";
import { fileIcon } from "./fileIcons.ts";
import { createIcon, ICON } from "./icons.ts";
import {
  changeTotals,
  commitScope,
  defaultCommitMessage,
  diffLines,
  includeState,
  isNewFile,
  revertPlan,
  type ChangeEntry,
} from "./changesModel.ts";

const PATH = {
  changes: "M8 2.5v6M5 5.5h6M5 12.5h6",
  branch: "M5 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3zM5 11a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3zM11 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3zM5 5v6M11 6.5c0 2.5-6 2-6 4.5",
  chevron: "M5 6.5 8 9.5l3-3",
  revert: "M5.5 3.5 2.5 6.5l3 3M2.5 6.5H10a3 3 0 0 1 0 6H7",
} as const;

/** Fired on `window` after this panel changes the repository - a commit, a revert, a stage. */
export const GIT_CHANGED_EVENT = "adcode:git-changed";

export interface ChangesDeps {
  readonly root: () => string | null;
  /** Source Control in the IDE, for everything this panel leaves out. */
  readonly openSourceControl: (path?: string) => void;
  readonly reviewTask: (task: AiWorkspaceTaskView) => void;
  /** Re-read Git and redraw; called after every action. */
  readonly refresh: () => void;
}

export interface ChangesView {
  render(parent: HTMLElement, git: GitStatusView, pending: readonly AiWorkspaceTaskView[]): void;
}

export function createChangesView(deps: ChangesDeps): ChangesView {
  // Kept across redraws: the panel redraws on every file save, and none of this should reset.
  const expanded = new Set<string>();
  const diffCache = new Map<string, HTMLElement>();
  let message = "";
  let messageOpen = false;
  let status = "";
  let busy = false;
  let entries: readonly ChangeEntry[] = [];
  // The drawn caption and controls, so an action shows at once rather than after Git answers.
  let liveCaption: HTMLElement | null = null;
  let liveControls: (HTMLButtonElement | HTMLInputElement)[] = [];
  let menuTrigger: HTMLElement | null = null;
  const menu = createContextMenu(document.body);
  attachContextMenuDismissal(menu, () => menuTrigger?.focus(), false);

  const absolute = (path: string): string => {
    const root = deps.root() ?? "";
    const separator = root.includes("\\") ? "\\" : "/";
    return `${root.replace(/[\\/]+$/, "")}${separator}${path.replace(/[\\/]+$/, "").split("/").join(separator)}`;
  };

  /** Run one Git action: say what happened, then redraw from what Git now says. */
  async function act(work: () => Promise<string>): Promise<void> {
    if (busy) return;
    busy = true;
    status = "Working…";
    if (liveCaption !== null) liveCaption.textContent = status;
    for (const control of liveControls) control.disabled = true;
    try {
      status = await work();
    } catch (error) {
      status = error instanceof Error ? error.message : "That did not work. Try again, or open Source Control.";
    } finally {
      busy = false;
      deps.refresh();
      // Git has no change event; anything else in this window showing its state redraws on this.
      window.dispatchEvent(new Event(GIT_CHANGED_EVENT));
    }
  }

  function openMenu(trigger: HTMLElement, nodes: readonly ContextMenuNode[], alignRight = true): void {
    menuTrigger = trigger;
    trigger.setAttribute("aria-expanded", "true");
    const rect = trigger.getBoundingClientRect();
    menu.open(alignRight ? rect.right : rect.left, rect.bottom + 4, nodes, () => trigger.setAttribute("aria-expanded", "false"));
  }
  /** A menu button that closes its menu on a second click rather than reopening it. */
  function menuButton(button: HTMLButtonElement, nodes: () => readonly ContextMenuNode[] | Promise<readonly ContextMenuNode[]>): void {
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    let wasOpen = false;
    button.addEventListener("pointerdown", () => { wasOpen = menu.isOpen() && menuTrigger === button; });
    button.addEventListener("click", () => {
      if (wasOpen) { wasOpen = false; return; }
      void Promise.resolve(nodes()).then((list) => openMenu(button, list));
    });
  }

  /* ── Actions ─────────────────────────────────────────────────────────── */

  function commit(push: boolean): void {
    const scope = commitScope(entries);
    if (scope.blocked) {
      status = "Resolve the conflicts first - open Source Control to pick which version to keep.";
      deps.refresh();
      return;
    }
    if (entries.length === 0) return;
    const included = scope.mode === "all" ? entries : entries.filter((entry) => entry.staged !== "none");
    const text = message.trim() || defaultCommitMessage(included);
    void act(async () => {
      if (scope.mode === "all") {
        const staged = await window.adcode.git.stage(entries.map((entry) => entry.path));
        if (!staged.ok) return staged.message;
      }
      const committed = await window.adcode.git.commit(text);
      if (!committed.ok) return committed.message;
      message = "";
      messageOpen = false;
      if (!push) return `Committed “${text}”.`;
      const pushed = await pushNow();
      return pushed === "" ? `Committed “${text}” and pushed.` : `Committed “${text}”. ${pushed}`;
    });
  }

  /** Push, in plain words: "" when it worked, otherwise one sentence on what to do. */
  async function pushNow(): Promise<string> {
    const remotes = await window.adcode.git.remotes().catch(() => []);
    if (remotes.length === 0) return "It is saved on this computer; to push it, connect the project to GitHub in Source Control.";
    const result = await window.adcode.git.push();
    // Git's first line says what went wrong; the rest is advice for the command line.
    return result.ok ? "" : `Push needs attention: ${result.message.split("\n")[0]}`;
  }

  function toggleInclude(entry: ChangeEntry): void {
    const state = includeState(entry, entries);
    void act(async () => {
      // Nothing staged means everything is included; leaving one out stages the rest.
      if (!entries.some((item) => item.staged !== "none")) {
        const others = entries.filter((item) => item.path !== entry.path && !item.isConflicted).map((item) => item.path);
        const result = await window.adcode.git.stage(others);
        return result.ok ? `${entry.path} is left out of the next commit.` : result.message;
      }
      const result = state === "checked" ? await window.adcode.git.unstage([entry.path]) : await window.adcode.git.stage([entry.path]);
      return result.ok ? "" : result.message;
    });
  }

  async function revert(targets: readonly ChangeEntry[]): Promise<string> {
    const plans = targets.map((entry) => ({ entry, plan: revertPlan(entry) }));
    const unstage = plans.filter(({ plan }) => plan.unstage).map(({ entry }) => entry.path);
    if (unstage.length > 0) {
      const result = await window.adcode.git.unstage(unstage);
      if (!result.ok) return result.message;
    }
    const restore = plans.filter(({ plan }) => plan.restore).map(({ entry }) => entry.path);
    if (restore.length > 0) {
      const result = await window.adcode.git.discard(restore);
      if (!result.ok) return result.message;
    }
    for (const { entry } of plans.filter(({ plan }) => plan.trash)) {
      const result = await window.adcode.files.trash(absolute(entry.path));
      if (!result.ok) return `Could not move ${entry.path} to the Recycle Bin: ${result.message}`;
    }
    for (const { entry } of plans) expanded.delete(entry.path);
    return targets.length === 1 ? `Reverted ${targets[0]!.path}.` : `Reverted ${targets.length} files.`;
  }

  async function confirmRevert(entry: ChangeEntry): Promise<void> {
    const fresh = isNewFile(entry);
    const yes = await askThemed({
      title: `Revert ${entry.path}?`,
      body: fresh
        ? "This file is new since the last commit, so it moves to the Recycle Bin. You can restore it from there."
        : "Your changes to this file are thrown away and it goes back to how it was at the last commit.",
      confirmLabel: "Revert",
      danger: true,
    });
    if (yes) void act(() => revert([entry]));
  }

  async function confirmRevertAll(): Promise<void> {
    const targets = entries.filter((entry) => !entry.isConflicted);
    if (targets.length === 0) return;
    const yes = await askThemed({
      title: `Revert all ${targets.length} changed file${targets.length === 1 ? "" : "s"}?`,
      body: "Edited files go back to how they were at the last commit, and new files move to the Recycle Bin.",
      confirmLabel: "Revert all",
      danger: true,
    });
    if (yes) void act(() => revert(targets));
  }

  async function branchMenu(): Promise<readonly ContextMenuNode[]> {
    const branches = await window.adcode.git.branches().catch(() => []);
    const nodes: ContextMenuNode[] = [{ kind: "heading", label: "Switch branch" }];
    for (const branch of branches.slice(0, 12)) {
      nodes.push({
        label: branch.name,
        accelerator: branch.current ? "✓" : "",
        disabled: branch.current,
        run: () => { void act(async () => { const result = await window.adcode.git.checkout(branch.name); return result.ok ? `Switched to ${branch.name}.` : result.message; }); },
      });
    }
    nodes.push({ kind: "separator" }, { label: "More in Source Control…", run: () => deps.openSourceControl() });
    return nodes;
  }

  /* ── Drawing ─────────────────────────────────────────────────────────── */

  function iconButton(className: string, label: string, icon: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.append(createIcon(icon));
    return button;
  }

  function counts(entry: ChangeEntry, parent: HTMLElement): void {
    if (entry.added) {
      const plus = document.createElement("span");
      plus.className = "changes-added";
      plus.textContent = `+${entry.added}`;
      parent.append(plus);
    }
    if (entry.removed) {
      const minus = document.createElement("span");
      minus.className = "changes-removed";
      minus.textContent = `−${entry.removed}`;
      parent.append(minus);
    }
  }

  function drawDiff(entry: ChangeEntry, host: HTMLElement): void {
    const key = `${entry.path}|${entry.staged}|${entry.worktree}|${entry.added}|${entry.removed}`;
    const cached = diffCache.get(key);
    if (cached !== undefined) { host.replaceChildren(cached); return; }
    const note = document.createElement("p");
    note.className = "changes-diff-note";
    note.textContent = "Loading diff…";
    host.replaceChildren(note);
    void (async () => {
      let text = await window.adcode.git.diff(entry.path).catch(() => "");
      // Git has nothing to compare a new file with: show the whole file as added.
      if (text.trim().length === 0 && isNewFile(entry) && !entry.path.endsWith("/")) {
        const file = await window.adcode.files.read(absolute(entry.path)).catch(() => null);
        if (file !== null && !file.text.includes("\u0000")) {
          const body = file.text.replace(/\r?\n$/, "");
          text = ["@@ new file @@", ...body.split(/\r?\n/).map((line) => `+${line}`)].join("\n");
        }
      }
      const { lines, truncated } = diffLines(text);
      const block = document.createElement("div");
      if (lines.length === 0) {
        const empty = document.createElement("p");
        empty.className = "changes-diff-note";
        empty.textContent = entry.path.endsWith("/") ? "A new folder - open Source Control to see what is inside." : "No text changes to show (a binary file, or only its mode changed).";
        block.append(empty);
      } else {
        const pre = document.createElement("pre");
        pre.className = "changes-diff-text";
        for (const line of lines) {
          const span = document.createElement("span");
          span.className = `changes-diff-line changes-diff-${line.kind}`;
          span.textContent = line.text;
          pre.append(span);
        }
        block.append(pre);
        if (truncated) {
          const more = document.createElement("button");
          more.type = "button";
          more.className = "changes-link";
          more.textContent = "Diff is long - see the rest in Source Control";
          more.addEventListener("click", () => deps.openSourceControl(entry.path));
          block.append(more);
        }
      }
      diffCache.set(key, block);
      if (host.isConnected) host.replaceChildren(block);
    })();
  }

  function drawRow(entry: ChangeEntry, list: HTMLElement): void {
    const row = document.createElement("div");
    row.className = "changes-row";
    row.setAttribute("role", "listitem");
    row.dataset["path"] = entry.path;

    const file = document.createElement("button");
    file.type = "button";
    file.className = "changes-file";
    file.title = `${entry.path} - show what changed`;
    file.setAttribute("aria-expanded", String(expanded.has(entry.path)));
    const icon = fileIcon(entry.path.replace(/\/$/, ""));
    icon.classList.add("changes-file-icon");
    const name = document.createElement("span");
    name.className = "changes-file-name";
    const slash = entry.path.replace(/\/$/, "").lastIndexOf("/");
    if (slash > 0) {
      const dir = document.createElement("span");
      dir.className = "changes-file-dir";
      dir.textContent = entry.path.slice(0, slash + 1);
      name.append(dir);
    }
    name.append(document.createTextNode(entry.path.slice(slash + 1)));
    const lineCounts = document.createElement("span");
    lineCounts.className = "changes-counts";
    counts(entry, lineCounts);
    file.append(icon, name, lineCounts);

    const tag = document.createElement("span");
    tag.className = "changes-tag";
    if (entry.isConflicted) { tag.textContent = "Conflict"; tag.dataset["tone"] = "danger"; }
    else if (isNewFile(entry)) { tag.textContent = "New"; tag.dataset["tone"] = "success"; }
    else if (entry.worktree === "deleted" || entry.staged === "deleted") { tag.textContent = "Deleted"; tag.dataset["tone"] = "danger"; }
    else if (entry.added === null && entry.removed === null) tag.textContent = "Binary";

    const revertButton = iconButton("changes-icon-button changes-revert", `Revert ${entry.path}`, PATH.revert);
    revertButton.disabled = entry.isConflicted || busy;
    revertButton.addEventListener("click", () => { void confirmRevert(entry); });

    const include = document.createElement("input");
    include.type = "checkbox";
    include.className = "changes-include";
    const state = includeState(entry, entries);
    include.checked = state === "checked";
    include.indeterminate = state === "partial";
    include.disabled = entry.isConflicted || busy;
    include.title = entry.isConflicted
      ? "Resolve the conflict before committing this file"
      : state === "unchecked" ? "Left out of the next commit - tick to include" : "Included in the next commit - untick to leave it out";
    include.setAttribute("aria-label", `Include ${entry.path} in the next commit`);
    include.addEventListener("change", () => toggleInclude(entry));

    liveControls.push(revertButton, include);
    row.append(file, tag, revertButton, include);
    const diff = document.createElement("div");
    diff.className = "changes-diff";
    diff.hidden = !expanded.has(entry.path);
    if (!diff.hidden) drawDiff(entry, diff);
    file.addEventListener("click", () => {
      const open = !expanded.has(entry.path);
      if (open) expanded.add(entry.path);
      else expanded.delete(entry.path);
      file.setAttribute("aria-expanded", String(open));
      diff.hidden = !open;
      if (open) drawDiff(entry, diff);
    });
    list.append(row, diff);
  }

  function drawPending(parent: HTMLElement, pending: readonly AiWorkspaceTaskView[]): void {
    if (pending.length === 0) return;
    const section = document.createElement("section");
    section.className = "changes-pending";
    const heading = document.createElement("h3");
    heading.textContent = "Waiting to apply";
    section.append(heading);
    for (const task of pending) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "changes-pending-task";
      const title = document.createElement("span");
      title.textContent = task.prompt;
      const detail = document.createElement("small");
      detail.textContent = `${task.changedPaths.length} file${task.changedPaths.length === 1 ? "" : "s"} · open to apply or discard`;
      button.append(title, detail);
      button.addEventListener("click", () => deps.reviewTask(task));
      section.append(button);
    }
    parent.append(section);
  }

  function drawNoRepo(parent: HTMLElement): void {
    const empty = document.createElement("div");
    empty.className = "changes-empty";
    const title = document.createElement("h3");
    title.textContent = "Track your changes";
    const text = document.createElement("p");
    text.textContent = "This folder is not using Git yet. Turn it on to see every file the assistant changes, revert any of them, and save your work in commits.";
    const start = document.createElement("button");
    start.type = "button";
    start.className = "changes-primary";
    start.textContent = "Turn on version control";
    start.disabled = busy;
    liveControls.push(start);
    start.addEventListener("click", () => {
      void act(async () => { const result = await window.adcode.git.init(); return result.ok ? "Version control is on. Changes from here on appear in this list." : result.message; });
    });
    const other = document.createElement("button");
    other.type = "button";
    other.className = "changes-link";
    other.textContent = "Open Source Control";
    other.title = "Clone, connect a remote, or set up Git yourself";
    other.addEventListener("click", () => deps.openSourceControl());
    empty.append(title, text, start, other);
    if (status !== "") {
      const note = document.createElement("p");
      note.className = "changes-caption";
      note.setAttribute("role", "status");
      note.textContent = status;
      empty.append(note);
    }
    parent.append(empty);
  }

  return {
    render(parent, git, pending): void {
      liveCaption = null;
      liveControls = [];
      drawPending(parent, pending);
      if (!git.isRepo) { drawNoRepo(parent); return; }
      entries = git.entries;
      const scope = commitScope(entries);
      const totals = changeTotals(entries);

      const bar = document.createElement("div");
      bar.className = "changes-bar";
      const title = document.createElement("div");
      title.className = "changes-title";
      const label = document.createElement("span");
      label.className = "changes-title-label";
      label.textContent = entries.length === 0 ? "No uncommitted changes" : "Uncommitted changes";
      title.append(createIcon(PATH.changes), label);
      if (totals.added > 0) {
        const plus = document.createElement("span");
        plus.className = "changes-added";
        plus.textContent = `+${totals.added}`;
        title.append(plus);
      }
      if (totals.removed > 0) {
        const minus = document.createElement("span");
        minus.className = "changes-removed";
        minus.textContent = `−${totals.removed}`;
        title.append(minus);
      }

      const tools = document.createElement("div");
      tools.className = "changes-tools";
      const branch = document.createElement("button");
      branch.type = "button";
      branch.className = "changes-branch";
      const branchName = document.createElement("span");
      branchName.textContent = git.branch ?? "Detached HEAD";
      branch.append(createIcon(PATH.branch), branchName, createIcon(PATH.chevron));
      branch.title = `On ${git.branch ?? "a detached HEAD"} - switch branch`;
      branch.setAttribute("aria-label", `Branch ${git.branch ?? "detached HEAD"}. Switch branch`);
      menuButton(branch, branchMenu);

      const more = iconButton("changes-icon-button changes-more", "More actions", ICON.more);
      menuButton(more, () => [
        { label: "Include everything", disabled: entries.length === 0, run: () => { void act(async () => { const result = await window.adcode.git.unstage(entries.filter((entry) => entry.staged !== "none").map((entry) => entry.path)); return result.ok ? "Every file is included in the next commit." : result.message; }); } },
        { label: "Pull", run: () => { void act(async () => (await window.adcode.git.pull()).message); } },
        { label: "Push", run: () => { void act(async () => (await pushNow()) || "Pushed."); } },
        { kind: "separator" },
        { label: "Revert all changes…", danger: true, disabled: entries.length === 0, run: () => { void confirmRevertAll(); } },
        { kind: "separator" },
        { label: "Open Source Control", run: () => deps.openSourceControl() },
      ]);

      // With nothing to commit but commits still to push, the one button pushes them.
      const pushOnly = entries.length === 0 && git.ahead > 0;
      const split = document.createElement("div");
      split.className = "changes-commit";
      const primary = document.createElement("button");
      primary.type = "button";
      primary.className = "changes-commit-main";
      primary.textContent = pushOnly ? `Push ${git.ahead}` : "Commit & Push";
      primary.disabled = busy || scope.blocked || (entries.length === 0 && !pushOnly);
      primary.title = pushOnly
        ? `Push ${git.ahead} commit${git.ahead === 1 ? "" : "s"} to ${git.upstream ?? "the remote"}`
        : "Commit the included files and push them";
      primary.addEventListener("click", () => {
        if (pushOnly) void act(async () => (await pushNow()) || "Pushed.");
        else commit(true);
      });
      const options = iconButton("changes-commit-options", "Commit options", PATH.chevron);
      options.disabled = busy;
      menuButton(options, () => [
        { label: "Commit & Push", disabled: entries.length === 0 || scope.blocked, run: () => commit(true) },
        { label: "Commit only", disabled: entries.length === 0 || scope.blocked, run: () => commit(false) },
        { label: messageOpen ? "Hide the message box" : "Write the commit message…", disabled: entries.length === 0, run: () => { messageOpen = !messageOpen; deps.refresh(); } },
      ]);
      split.append(primary, options);
      liveControls.push(primary, options);
      tools.append(branch, more, split);
      bar.append(title, tools);
      parent.append(bar);

      const caption = document.createElement("p");
      caption.className = "changes-caption";
      caption.setAttribute("role", "status");
      caption.textContent = status !== ""
        ? status
        : scope.blocked
          ? "Conflicts need resolving before you can commit - open Source Control."
          : entries.length === 0
            ? pushOnly ? `${git.ahead} commit${git.ahead === 1 ? "" : "s"} not pushed yet.` : "Nothing to commit. Files the assistant or you change appear here."
            : scope.mode === "all"
              ? `Commit & Push includes all ${scope.count} file${scope.count === 1 ? "" : "s"}.`
              : `Commit & Push includes the ${scope.count} ticked file${scope.count === 1 ? "" : "s"}.`;
      parent.append(caption);
      liveCaption = caption;

      if (messageOpen && entries.length > 0) {
        const box = document.createElement("input");
        box.type = "text";
        box.className = "changes-message";
        box.value = message;
        const included = scope.mode === "all" ? entries : entries.filter((entry) => entry.staged !== "none");
        box.placeholder = defaultCommitMessage(included);
        box.setAttribute("aria-label", "Commit message (leave empty to use the suggestion)");
        box.addEventListener("input", () => { message = box.value; });
        box.addEventListener("keydown", (event) => {
          if (event.key === "Enter") { event.preventDefault(); commit(true); }
          if (event.key === "Escape") { event.preventDefault(); messageOpen = false; deps.refresh(); }
        });
        parent.append(box);
        requestAnimationFrame(() => { if (box.isConnected && document.activeElement === document.body) box.focus(); });
      }

      const list = document.createElement("div");
      list.className = "changes-list";
      list.setAttribute("role", "list");
      list.setAttribute("aria-label", "Uncommitted files");
      for (const entry of entries) drawRow(entry, list);
      parent.append(list);
      // Forget files that are no longer changed, so a later edit starts collapsed.
      for (const path of [...expanded]) if (!entries.some((entry) => entry.path === path)) expanded.delete(path);
    },
  };
}
