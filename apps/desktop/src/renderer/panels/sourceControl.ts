/**
 * The source control view.
 *
 * Brief §4's Git group: stage/unstage/commit UI, branch switcher, file timeline. The
 * plumbing the user asked for directly - init, clone, push, pull - lives on the same
 * surface, because a source-control panel that cannot push is a diff viewer.
 */
import type { GitStatusView } from "../../shared/api.ts";

export interface SourceControlPanel {
  readonly element: HTMLElement;
  refresh(): Promise<void>;
  /** The file whose history the timeline shows; null hides it. */
  setActiveFile(path: string | null): void;
  /** §4: the timeline is a setting, so the shell can switch it off. */
  setTimelineEnabled(enabled: boolean): void;
}

export interface SourceControlDeps {
  readonly openFile: (path: string) => void;
  readonly workspaceRoot: () => string | null;
  readonly notify: (message: string) => void;
  /** Show a file as it was at a revision, read-only. */
  readonly openRevision: (path: string, ref: string, shortHash: string) => void;
  /** Show a locally kept version of a file, read-only. §4's local file history. */
  readonly openLocalVersion: (path: string, id: string, savedAt: string) => void;
  /** The absolute path of the open file, which local history is keyed by. */
  readonly absolutePath: (relative: string) => string;
}

const CHANGE_LABEL: Readonly<Record<string, string>> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  none: "",
};

export function createSourceControlPanel(deps: SourceControlDeps): SourceControlPanel {
  const element = document.createElement("div");
  element.className = "scm-panel";

  const header = document.createElement("div");
  header.className = "scm-header";

  const branchButton = document.createElement("button");
  branchButton.className = "ghost-button scm-branch";
  branchButton.title = "Switch branch";

  const syncLabel = document.createElement("span");
  syncLabel.className = "scm-sync";

  header.append(branchButton, syncLabel);

  const actions = document.createElement("div");
  actions.className = "scm-actions";

  function actionButton(label: string, title: string, run: () => Promise<{ ok: boolean; message: string }>): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "ghost-button";
    button.textContent = label;
    button.title = title;

    button.addEventListener("click", () => {
      button.disabled = true;
      void run()
        .then((result) => {
          deps.notify(result.message || (result.ok ? "Done." : "Failed."));
          return api.refresh();
        })
        .finally(() => {
          button.disabled = false;
        });
    });

    return button;
  }

  actions.append(
    actionButton("Pull", "Fetch and fast-forward", () => window.adcode.git.pull()),
    actionButton("Push", "Push the current branch", () => window.adcode.git.push()),
    actionButton("Fetch", "Fetch all remotes", () => window.adcode.git.fetch()),
  );

  const commitBox = document.createElement("form");
  commitBox.className = "scm-commit";

  const message = document.createElement("textarea");
  message.className = "scm-message";
  message.rows = 2;
  message.placeholder = "Commit message";
  message.setAttribute("aria-label", "Commit message");

  const commitButton = document.createElement("button");
  commitButton.className = "chat-send";
  commitButton.type = "submit";
  commitButton.textContent = "Commit";

  commitBox.append(message, commitButton);

  commitBox.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = message.value.trim();
    if (text.length === 0) {
      deps.notify("A commit needs a message.");
      return;
    }

    commitButton.disabled = true;
    void window.adcode.git
      .commit(text)
      .then((result) => {
        deps.notify(result.message);
        if (result.ok) message.value = "";
        return api.refresh();
      })
      .finally(() => {
        commitButton.disabled = false;
      });
  });

  // Ctrl+Enter commits - the convention every source-control box uses.
  message.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      commitBox.requestSubmit();
    }
  });

  const list = document.createElement("div");
  list.className = "scm-list";

  const empty = document.createElement("p");
  empty.className = "empty-hint";

  /* §4: file timeline. The history of whatever is open, not of the whole repository -
     "what happened to this file" is the question people actually ask. */
  const timeline = document.createElement("div");
  timeline.className = "scm-section scm-timeline";
  timeline.hidden = true;

  const timelineTitle = document.createElement("div");
  timelineTitle.className = "scm-section-title";

  const timelineList = document.createElement("div");
  timeline.append(timelineTitle, timelineList);

  element.append(header, actions, commitBox, list, empty, timeline);

  let activeFile: string | null = null;
  let timelineEnabled = true;
  let timelineGeneration = 0;

  async function renderTimeline(): Promise<void> {
    const mine = ++timelineGeneration;

    if (!timelineEnabled || activeFile === null) {
      timeline.hidden = true;
      timelineList.replaceChildren();
      return;
    }

    const commits = await window.adcode.git.fileHistory(activeFile);
    // A file opened, closed, and reopened while the history was loading must not end up
    // showing the previous file's commits.
    if (mine !== timelineGeneration) return;

    const file = activeFile;
    timelineTitle.textContent = `Timeline · ${file.split("/").pop() ?? file}`;

    timelineList.replaceChildren();

    if (commits.length === 0) {
      const none = document.createElement("p");
      none.className = "empty-hint";
      none.textContent = "No commits touch this file yet.";
      timelineList.append(none);
      timeline.hidden = false;
      return;
    }

    for (const commit of commits) {
      const row = document.createElement("button");
      row.className = "timeline-row";
      row.type = "button";
      row.title = `${commit.hash}\n${commit.author}\n${commit.date}`;

      const subject = document.createElement("span");
      subject.className = "timeline-subject";
      subject.textContent = commit.subject;

      const meta = document.createElement("span");
      meta.className = "timeline-meta";
      meta.textContent = `${commit.shortHash} · ${commit.author} · ${formatDate(commit.date)}`;

      row.append(subject, meta);
      row.addEventListener("click", () => deps.openRevision(file, commit.hash, commit.shortHash));
      timelineList.append(row);
    }

    timeline.hidden = false;
  }

  function fileRow(entry: GitStatusView["entries"][number], staged: boolean): HTMLElement {
    const row = document.createElement("div");
    row.className = "scm-row";
    if (entry.isConflicted) row.dataset["conflicted"] = "true";

    const status = document.createElement("span");
    status.className = "scm-status";
    status.textContent = entry.isConflicted
      ? "!"
      : (CHANGE_LABEL[staged ? entry.staged : entry.worktree] ?? "");
    status.dataset["kind"] = staged ? entry.staged : entry.worktree;

    const name = document.createElement("span");
    name.className = "scm-path";
    name.textContent = entry.path;
    name.title = entry.path;
    name.addEventListener("click", () => deps.openFile(entry.path));

    const action = document.createElement("button");
    action.className = "scm-stage";
    action.textContent = staged ? "−" : "+";
    action.title = staged ? "Unstage" : "Stage";
    action.addEventListener("click", () => {
      const call = staged
        ? window.adcode.git.unstage([entry.path])
        : window.adcode.git.stage([entry.path]);

      void call.then(() => api.refresh());
    });

    row.append(status, name, action);
    return row;
  }

  function section(title: string, entries: GitStatusView["entries"], staged: boolean): HTMLElement | null {
    if (entries.length === 0) return null;

    const wrapper = document.createElement("div");
    wrapper.className = "scm-section";

    const heading = document.createElement("div");
    heading.className = "scm-section-title";
    heading.textContent = `${title} (${entries.length})`;

    const bulk = document.createElement("button");
    bulk.className = "ghost-button";
    bulk.textContent = staged ? "Unstage all" : "Stage all";
    bulk.addEventListener("click", () => {
      const paths = entries.map((entry) => entry.path);
      const call = staged ? window.adcode.git.unstage(paths) : window.adcode.git.stage(paths);
      void call.then(() => api.refresh());
    });

    heading.append(bulk);
    wrapper.append(heading);
    for (const entry of entries) wrapper.append(fileRow(entry, staged));

    return wrapper;
  }

  async function showBranchSwitcher(): Promise<void> {
    const branches = await window.adcode.git.branches();
    if (branches.length === 0) return;

    const names = branches.map((branch) => (branch.current ? `${branch.name} (current)` : branch.name));
    const chosen = window.prompt(`Switch to branch:\n\n${names.join("\n")}\n\nName, or a new name to create:`);
    if (chosen === null || chosen.trim().length === 0) return;

    const target = chosen.trim();
    const exists = branches.some((branch) => branch.name === target);

    const result = exists
      ? await window.adcode.git.checkout(target)
      : await window.adcode.git.createBranch(target);

    deps.notify(result.message);
    await api.refresh();
  }

  branchButton.addEventListener("click", () => void showBranchSwitcher());

  const api: SourceControlPanel = {
    element,

    async refresh(): Promise<void> {
      if (deps.workspaceRoot() === null) {
        timeline.hidden = true;
        list.replaceChildren();
        empty.textContent = "Open a folder to use source control.";
        empty.hidden = false;
        header.hidden = true;
        actions.hidden = true;
        commitBox.hidden = true;
        return;
      }

      const status = await window.adcode.git.status();

      if (!status.isRepo) {
        timeline.hidden = true;
        list.replaceChildren();
        header.hidden = true;
        actions.hidden = true;
        commitBox.hidden = true;

        empty.replaceChildren();
        const text = document.createElement("span");
        text.textContent = "This folder is not a git repository. ";

        const init = document.createElement("button");
        init.className = "ghost-button";
        init.textContent = "Initialise";
        init.addEventListener("click", () => {
          void window.adcode.git.init().then((result) => {
            deps.notify(result.message);
            return api.refresh();
          });
        });

        empty.append(text, init);
        empty.hidden = false;
        return;
      }

      header.hidden = false;
      actions.hidden = false;
      commitBox.hidden = false;

      branchButton.textContent = status.branch ?? "detached";
      syncLabel.textContent =
        status.ahead === 0 && status.behind === 0
          ? status.upstream === null
            ? "no upstream"
            : "up to date"
          : `↑${status.ahead} ↓${status.behind}`;

      const staged = status.entries.filter((entry) => entry.staged !== "none" && !entry.isConflicted);
      const changed = status.entries.filter((entry) => entry.worktree !== "none" && !entry.isConflicted);
      const conflicted = status.entries.filter((entry) => entry.isConflicted);

      list.replaceChildren();
      for (const node of [
        section("Merge conflicts", conflicted, false),
        section("Staged", staged, true),
        section("Changes", changed, false),
      ]) {
        if (node !== null) list.append(node);
      }

      empty.textContent = status.isClean ? "No changes." : "";
      empty.hidden = !status.isClean;

      await renderTimeline();
    },

    setActiveFile(path) {
      if (path === activeFile) return;
      activeFile = path;
      void renderTimeline();
    },

    setTimelineEnabled(enabled) {
      timelineEnabled = enabled;
      void renderTimeline();
    },
  };

  return api;
}

/** A commit date, short enough for a sidebar. */
function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;

  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Local history is fine-grained enough that the time is what identifies a version. */
function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;

  return parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
