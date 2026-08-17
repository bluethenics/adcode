/**
 * The commit browser: history the way a person reads it.
 *
 * Shaped after GitHub's commit list because that shape is what people already know - a
 * subject line per row, who and when underneath, and the hash last because it is the part
 * you copy rather than the part you scan. Opening a commit expands it in place instead of
 * navigating somewhere, so the list you were reading is still there when you come back.
 *
 * Restoring is the safe half of "go back": `git checkout <commit> -- <path>` puts the file
 * in the working tree as an uncommitted change. Nothing already committed is rewritten, so
 * a restore chosen by mistake is undone by discarding it - not by rescuing the branch out
 * of the reflog. That is the whole reason this offers no reset.
 */
import type { GitCommitDetailView, GitCommitView } from "../../shared/api.ts";

export interface CommitBrowser {
  readonly element: HTMLElement;
  refresh(): Promise<void>;
  /** Drop cached details so the next open re-reads them. */
  invalidate(): void;
}

export interface CommitBrowserDeps {
  /** Show one file's diff for one commit, read-only. */
  readonly openCommitDiff: (ref: string, shortHash: string, path: string) => void;
  /** Put a file back as it was at a commit, after asking. */
  readonly restoreFile: (ref: string, shortHash: string, path: string) => Promise<void>;
  readonly notify: (message: string) => void;
}

const PAGE = 30;

const KIND_LETTER: Readonly<Record<string, string>> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  none: "",
};

export function createCommitBrowser(deps: CommitBrowserDeps): CommitBrowser {
  const element = document.createElement("div");
  element.className = "scm-section scm-history";

  const title = document.createElement("div");
  title.className = "scm-section-title";
  title.textContent = "History";

  const list = document.createElement("div");
  list.className = "history-list";

  const more = document.createElement("button");
  more.className = "ghost-button history-more";
  more.type = "button";
  more.textContent = "Show more";
  more.hidden = true;

  const empty = document.createElement("p");
  empty.className = "empty-hint";
  empty.hidden = true;

  element.append(title, list, empty, more);

  let limit = PAGE;
  let openHash: string | null = null;
  /** Details are re-read only when asked for; a commit's contents cannot change. */
  const detailCache = new Map<string, GitCommitDetailView>();

  more.addEventListener("click", () => {
    limit += PAGE;
    void api.refresh();
  });

  /** "2 hours ago" reads faster than a timestamp when scanning a list. */
  function relativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return iso;

    const seconds = Math.round((Date.now() - then) / 1000);
    if (seconds < 60) return "just now";

    const steps: ReadonlyArray<readonly [limit: number, size: number, name: string]> = [
      [3600, 60, "minute"],
      [86_400, 3600, "hour"],
      [2_592_000, 86_400, "day"],
      [31_536_000, 2_592_000, "month"],
    ];

    for (const [bound, size, name] of steps) {
      if (seconds < bound) {
        const count = Math.floor(seconds / size);
        return `${count} ${name}${count === 1 ? "" : "s"} ago`;
      }
    }

    const years = Math.floor(seconds / 31_536_000);
    return `${years} year${years === 1 ? "" : "s"} ago`;
  }

  function buildFileRow(detail: GitCommitDetailView, file: GitCommitDetailView["files"][number]): HTMLElement {
    const row = document.createElement("div");
    row.className = "history-file";
    row.dataset["kind"] = file.kind;

    const open = document.createElement("button");
    open.className = "history-file-open";
    open.type = "button";
    open.title = `Show this file's changes in ${detail.shortHash}`;

    const letter = document.createElement("span");
    letter.className = "history-file-letter";
    letter.textContent = KIND_LETTER[file.kind] ?? "M";

    const path = document.createElement("span");
    path.className = "history-file-path";
    path.textContent = file.path;

    const stat = document.createElement("span");
    stat.className = "history-file-stat";
    // Both numbers always, even when one is zero: a lone "+4" reads as a total.
    const plus = document.createElement("span");
    plus.className = "stat-added";
    plus.textContent = `+${file.added}`;
    const minus = document.createElement("span");
    minus.className = "stat-removed";
    minus.textContent = `−${file.removed}`;
    stat.append(plus, minus);

    open.append(letter, path, stat);
    open.addEventListener("click", () => deps.openCommitDiff(detail.hash, detail.shortHash, file.path));

    const restore = document.createElement("button");
    restore.className = "history-restore";
    restore.type = "button";
    restore.title = `Restore ${file.path} as it was in ${detail.shortHash}`;
    restore.ariaLabel = restore.title;
    restore.textContent = "Restore";
    restore.addEventListener("click", (event) => {
      event.stopPropagation();
      void deps.restoreFile(detail.hash, detail.shortHash, file.path);
    });

    row.append(open, restore);
    return row;
  }

  function buildDetail(detail: GitCommitDetailView): HTMLElement {
    const box = document.createElement("div");
    box.className = "history-detail";

    if (detail.body.length > 0) {
      const body = document.createElement("p");
      body.className = "history-body";
      body.textContent = detail.body;
      box.append(body);
    }

    const summary = document.createElement("div");
    summary.className = "history-summary";
    const added = detail.files.reduce((total, file) => total + file.added, 0);
    const removed = detail.files.reduce((total, file) => total + file.removed, 0);
    summary.textContent = `${detail.files.length} file${detail.files.length === 1 ? "" : "s"} · +${added} −${removed}`;
    box.append(summary);

    if (detail.files.length === 0) {
      const none = document.createElement("p");
      none.className = "empty-hint";
      none.textContent = "This commit changed no files.";
      box.append(none);
      return box;
    }

    for (const file of detail.files) box.append(buildFileRow(detail, file));
    return box;
  }

  async function toggle(commit: GitCommitView, wrapper: HTMLElement): Promise<void> {
    // Clicking the open commit closes it, which is the only way back to a plain list.
    if (openHash === commit.hash) {
      openHash = null;
      wrapper.querySelector(".history-detail")?.remove();
      delete wrapper.dataset["open"];
      return;
    }

    openHash = commit.hash;
    for (const other of list.querySelectorAll<HTMLElement>(".history-commit[data-open]")) {
      other.querySelector(".history-detail")?.remove();
      delete other.dataset["open"];
    }

    wrapper.dataset["open"] = "true";

    let detail = detailCache.get(commit.hash) ?? null;
    if (detail === null) {
      const loading = document.createElement("p");
      loading.className = "empty-hint";
      loading.textContent = "Reading the commit…";
      wrapper.append(loading);

      detail = await window.adcode.git.commitDetail(commit.hash).catch(() => null);
      loading.remove();

      // The user may have closed it, or opened another, while this was in flight.
      if (openHash !== commit.hash) return;

      if (detail === null) {
        deps.notify("Could not read that commit.");
        delete wrapper.dataset["open"];
        return;
      }
      detailCache.set(commit.hash, detail);
    }

    wrapper.append(buildDetail(detail));
  }

  const api: CommitBrowser = {
    element,

    async refresh(): Promise<void> {
      const commits = await window.adcode.git.log(limit).catch((): GitCommitView[] => []);

      list.replaceChildren();
      empty.hidden = commits.length > 0;
      empty.textContent = "No commits yet.";
      more.hidden = commits.length < limit;

      for (const commit of commits) {
        const wrapper = document.createElement("div");
        wrapper.className = "history-commit";
        if (openHash === commit.hash) wrapper.dataset["open"] = "true";

        const head = document.createElement("button");
        head.className = "history-head";
        head.type = "button";

        const subject = document.createElement("span");
        subject.className = "history-subject";
        subject.textContent = commit.subject;

        const meta = document.createElement("span");
        meta.className = "history-meta";
        meta.textContent = `${commit.author} · ${relativeTime(commit.date)}`;

        const hash = document.createElement("span");
        hash.className = "history-hash";
        hash.textContent = commit.shortHash;

        head.append(subject, meta, hash);
        head.title = `${commit.hash}\n${commit.author}\n${commit.date}`;
        head.addEventListener("click", () => void toggle(commit, wrapper));

        wrapper.append(head);
        list.append(wrapper);

        // Re-expand whatever was open before the refresh, so restoring a file does not
        // collapse the commit the user is working through.
        if (openHash === commit.hash) {
          const detail = detailCache.get(commit.hash);
          if (detail !== undefined) wrapper.append(buildDetail(detail));
        }
      }
    },

    invalidate() {
      detailCache.clear();
    },
  };

  return api;
}
