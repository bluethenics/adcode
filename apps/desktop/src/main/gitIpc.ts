/**
 * IPC handlers for git and search.
 *
 * Every argument is validated here as well as inside `@adcode/git`. The renderer is
 * hostile by assumption (§1), and the package's own argument checks exist for the same
 * reason - two layers, because a branch name that reaches `git` as an option is the kind
 * of mistake that only has to happen once.
 */
import { ipcMain } from "electron";
import { CHANNELS, type GitOutcome, type GitStatusView } from "../shared/api.ts";
import { gitForWorkspace, invalidateFileCache, quickOpen, searchForWorkspace } from "./sourceControl.ts";

const isString = (value: unknown): value is string => typeof value === "string";

const NO_WORKSPACE: GitOutcome = { ok: false, message: "Open a folder first." };

const EMPTY_STATUS: GitStatusView = {
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  isRepo: false,
  isClean: true,
  hasConflicts: false,
  entries: [],
};

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every(isString)) return null;
  return value;
}

export function registerGitIpc(): void {
  ipcMain.handle(CHANNELS.gitStatus, async (): Promise<GitStatusView> => {
    const git = gitForWorkspace();
    if (git === null) return EMPTY_STATUS;

    if (!(await git.isRepo())) return EMPTY_STATUS;

    const status = await git.status();
    return {
      branch: status.branch,
      upstream: status.upstream,
      ahead: status.ahead,
      behind: status.behind,
      isRepo: true,
      isClean: status.isClean,
      hasConflicts: status.hasConflicts,
      entries: status.entries.map((entry) => ({
        path: entry.path,
        staged: entry.staged,
        worktree: entry.worktree,
        isConflicted: entry.isConflicted,
      })),
    };
  });

  const pathsHandler = (
    channel: string,
    action: (git: NonNullable<ReturnType<typeof gitForWorkspace>>, paths: string[]) => Promise<GitOutcome>,
  ): void => {
    ipcMain.handle(channel, async (_event, paths: unknown): Promise<GitOutcome> => {
      const git = gitForWorkspace();
      if (git === null) return NO_WORKSPACE;

      const list = stringList(paths);
      if (list === null) return { ok: false, message: "Expected a list of paths." };

      const result = await action(git, list);
      invalidateFileCache();
      return result;
    });
  };

  pathsHandler(CHANNELS.gitStage, (git, paths) => git.stage(paths));
  pathsHandler(CHANNELS.gitUnstage, (git, paths) => git.unstage(paths));
  pathsHandler(CHANNELS.gitDiscard, (git, paths) => git.discard(paths));

  ipcMain.handle(CHANNELS.gitCommit, async (_event, message: unknown): Promise<GitOutcome> => {
    const git = gitForWorkspace();
    if (git === null) return NO_WORKSPACE;
    if (!isString(message)) return { ok: false, message: "A commit needs a message." };
    return git.commit(message);
  });

  ipcMain.handle(CHANNELS.gitPush, async () => gitForWorkspace()?.push() ?? NO_WORKSPACE);
  ipcMain.handle(CHANNELS.gitPull, async () => gitForWorkspace()?.pull() ?? NO_WORKSPACE);
  ipcMain.handle(CHANNELS.gitFetch, async () => gitForWorkspace()?.fetch() ?? NO_WORKSPACE);
  ipcMain.handle(CHANNELS.gitInit, async () => gitForWorkspace()?.init() ?? NO_WORKSPACE);

  ipcMain.handle(CHANNELS.gitClone, async (_event, url: unknown, target: unknown): Promise<GitOutcome> => {
    const git = gitForWorkspace();
    if (git === null) return NO_WORKSPACE;
    if (!isString(url) || !isString(target)) return { ok: false, message: "Expected a URL and a folder." };
    return git.clone(url, target);
  });

  ipcMain.handle(
    CHANNELS.gitAddRemote,
    async (_event, name: unknown, url: unknown): Promise<GitOutcome> => {
      const git = gitForWorkspace();
      if (git === null) return NO_WORKSPACE;
      if (!isString(name) || !isString(url)) {
        return { ok: false, message: "Expected a remote name and a URL." };
      }
      return git.addRemote(name, url);
    },
  );

  ipcMain.handle(CHANNELS.gitRemotes, async () => (await gitForWorkspace()?.remotes()) ?? []);

  ipcMain.handle(CHANNELS.gitBranches, async () => (await gitForWorkspace()?.branches()) ?? []);

  ipcMain.handle(CHANNELS.gitCheckout, async (_event, ref: unknown): Promise<GitOutcome> => {
    const git = gitForWorkspace();
    if (git === null) return NO_WORKSPACE;
    if (!isString(ref)) return { ok: false, message: "Expected a branch name." };

    const result = await git.checkout(ref);
    invalidateFileCache();
    return result;
  });

  ipcMain.handle(CHANNELS.gitCreateBranch, async (_event, name: unknown): Promise<GitOutcome> => {
    const git = gitForWorkspace();
    if (git === null) return NO_WORKSPACE;
    if (!isString(name)) return { ok: false, message: "Expected a branch name." };
    return git.createBranch(name);
  });

  ipcMain.handle(CHANNELS.gitLog, async (_event, limit: unknown) =>
    (await gitForWorkspace()?.log(typeof limit === "number" ? limit : 50)) ?? [],
  );

  ipcMain.handle(CHANNELS.gitFileHistory, async (_event, path: unknown) =>
    isString(path) ? ((await gitForWorkspace()?.fileHistory(path)) ?? []) : [],
  );

  ipcMain.handle(CHANNELS.gitBlame, async (_event, path: unknown) =>
    isString(path) ? ((await gitForWorkspace()?.blame(path)) ?? []) : [],
  );

  ipcMain.handle(CHANNELS.gitLineChanges, async (_event, path: unknown) =>
    isString(path) ? ((await gitForWorkspace()?.lineChanges(path)) ?? []) : [],
  );

  ipcMain.handle(CHANNELS.gitDiff, async (_event, path: unknown) =>
    (await gitForWorkspace()?.diff(isString(path) ? path : undefined)) ?? "",
  );

  ipcMain.handle(CHANNELS.gitShowFile, async (_event, ref: unknown, path: unknown) =>
    isString(ref) && isString(path)
      ? ((await gitForWorkspace()?.showFile(ref, path)) ?? null)
      : null,
  );

  /*
   * The commit browser.
   *
   * `restoreFile` is the only one of these that writes, and it writes only the working
   * tree: no commit is rewritten, so a restore is reviewed and then kept or discarded
   * like any other edit.
   */
  ipcMain.handle(CHANNELS.gitCommitDetail, async (_event, ref: unknown) =>
    isString(ref) ? ((await gitForWorkspace()?.commitDetail(ref)) ?? null) : null,
  );

  ipcMain.handle(CHANNELS.gitCommitFileDiff, async (_event, ref: unknown, path: unknown) =>
    isString(ref) && isString(path)
      ? ((await gitForWorkspace()?.commitFileDiff(ref, path)) ?? "")
      : "",
  );

  ipcMain.handle(CHANNELS.gitRestoreFile, async (_event, ref: unknown, path: unknown): Promise<GitOutcome> => {
    if (!isString(ref) || !isString(path)) return { ok: false, message: "Expected a revision and a path." };

    const git = gitForWorkspace();
    if (git === null) return NO_WORKSPACE;

    const result = await git.restoreFile(ref, path);
    // The restored file differs from what the cache last read for it.
    if (result.ok) invalidateFileCache();
    return result;
  });

  /* ── Search ───────────────────────────────────────────────────────────── */

  /** The renderer's query object, narrowed once and reused by search and replace. */
  const readQuery = (query: unknown) => {
    const q = (query ?? {}) as Record<string, unknown>;
    if (!isString(q["pattern"]) || q["pattern"].length === 0) return null;

    return {
      pattern: q["pattern"],
      isRegex: q["isRegex"] === true,
      caseSensitive: q["caseSensitive"] === true,
      wholeWord: q["wholeWord"] === true,
      ...(isString(q["include"]) && q["include"].length > 0 ? { include: q["include"] } : {}),
      ...(isString(q["exclude"]) && q["exclude"].length > 0 ? { exclude: q["exclude"] } : {}),
    };
  };

  ipcMain.handle(CHANNELS.searchRun, async (_event, query: unknown) => {
    const search = searchForWorkspace();
    if (search === null) return [];

    const parsed = readQuery(query);
    if (parsed === null) return [];

    const results = [];
    // Collected rather than streamed: `ipcMain.handle` is request/response, and a search
    // panel that fills incrementally needs a channel of its own. Bounded meanwhile, so a
    // broad pattern cannot return a hundred thousand rows.
    for await (const hit of search.search({ ...parsed, maxResults: 1000 })) {
      results.push(hit);
    }

    return results;
  });

  ipcMain.handle(
    CHANNELS.searchReplace,
    async (_event, query: unknown, replacement: unknown) => {
      const search = searchForWorkspace();
      const parsed = readQuery(query);

      if (search === null || parsed === null || !isString(replacement)) {
        return { files: 0, replacements: 0 };
      }

      const summary = await search.replaceAll(parsed, replacement);
      // Files on disk just changed under the editor; the source-control view and the
      // quick-open index are both stale now.
      invalidateFileCache();
      return summary;
    },
  );

  ipcMain.handle(CHANNELS.quickOpen, async (_event, query: unknown) =>
    isString(query) ? quickOpen(query) : [],
  );
}
