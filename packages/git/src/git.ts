/**
 * Git operations, over the git CLI.
 *
 * The CLI rather than a native binding: libgit2 would be a native module to rebuild per
 * Electron ABI and per platform, and it would still not be the git the user's hooks,
 * config, credential helpers, and SSH agent are set up for. Shelling out means the IDE's
 * git behaves exactly like the user's git, which is what they will expect the moment
 * anything goes wrong.
 *
 * Every mutating call returns a `GitResult` rather than throwing. Git uses exit codes
 * for ordinary answers - "nothing to commit", "not a repository" - so treating a non-zero
 * exit as an exception would turn routine states into crashes.
 */
import { isSafeCloneUrl, isSafePathArg, isSafeRef } from "./argSafety.ts";
import type {
  BlameLine,
  FileChange,
  GitBranch,
  GitCommit,
  GitExec,
  GitRemote,
  GitResult,
  GitStatus,
  GitStatusEntry,
  LineChange,
} from "./types.ts";

export type {
  BlameLine,
  FileChange,
  GitBranch,
  GitCommit,
  GitExec,
  GitRemote,
  GitResult,
  GitStatus,
  GitStatusEntry,
  LineChange,
} from "./types.ts";

/** Record separator for `--format`, chosen because it cannot appear in a commit subject. */
const FIELD = "\u001f";
const RECORD = "\u001e";

const ok = (message = ""): GitResult => ({ ok: true, message });
const fail = (message: string): GitResult => ({ ok: false, message });

/** Porcelain v2 status letters, in the order git documents them. */
function toFileChange(code: string): FileChange {
  switch (code) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
    case "C":
      return "renamed";
    case ".":
      return "none";
    default:
      return "modified";
  }
}

export interface GitDeps {
  readonly exec: GitExec;
  readonly root: string;
}

export interface Git {
  isRepo(): Promise<boolean>;
  init(): Promise<GitResult>;
  clone(url: string, target: string): Promise<GitResult>;
  cloneLocalPath(source: string, target: string): Promise<GitResult>;

  status(): Promise<GitStatus>;
  stage(paths: readonly string[]): Promise<GitResult>;
  stageAll(): Promise<GitResult>;
  unstage(paths: readonly string[]): Promise<GitResult>;
  discard(paths: readonly string[]): Promise<GitResult>;
  commit(message: string): Promise<GitResult>;

  push(): Promise<GitResult>;
  pull(): Promise<GitResult>;
  fetch(): Promise<GitResult>;
  remotes(): Promise<GitRemote[]>;

  branches(): Promise<GitBranch[]>;
  checkout(ref: string): Promise<GitResult>;
  createBranch(name: string): Promise<GitResult>;

  diff(path?: string): Promise<string>;
  lineChanges(path: string): Promise<LineChange[]>;
  log(limit?: number): Promise<GitCommit[]>;
  fileHistory(path: string, limit?: number): Promise<GitCommit[]>;
  blame(path: string): Promise<BlameLine[]>;
}

export function createGit(deps: GitDeps): Git {
  const run = (...args: string[]) => deps.exec.run(args, { cwd: deps.root });

  async function runResult(args: string[], successMessage = ""): Promise<GitResult> {
    const result = await run(...args);
    return result.code === 0
      ? ok(successMessage || result.stdout.trim())
      : fail(result.stderr.trim() || result.stdout.trim() || "git failed");
  }

  async function isRepo(): Promise<boolean> {
    const result = await run("rev-parse", "--is-inside-work-tree");
    return result.code === 0 && result.stdout.trim() === "true";
  }

  function parseCommits(stdout: string): GitCommit[] {
    return stdout
      .split(RECORD)
      .map((record) => record.trim())
      .filter((record) => record.length > 0)
      .map((record) => {
        const [hash = "", shortHash = "", author = "", date = "", subject = ""] = record.split(FIELD);
        return { hash, shortHash, author, date, subject };
      });
  }

  return {
    isRepo,

    init: () => runResult(["init"], "Initialised an empty repository."),

    async clone(url: string, target: string): Promise<GitResult> {
      // Checked before anything reaches git: `ext::` and `--upload-pack=` both turn a
      // clone into arbitrary command execution.
      if (!isSafeCloneUrl(url)) return fail("That is not a supported repository URL.");
      if (!isSafePathArg(target)) return fail("That destination path is not usable.");

      // `--` separates options from operands, so neither value can be read as a flag
      // even if the checks above were ever loosened.
      return runResult(["clone", "--", url, target], "Cloned.");
    },

    async cloneLocalPath(source: string, target: string): Promise<GitResult> {
      if (!isSafePathArg(source) || !isSafePathArg(target)) {
        return fail("That path is not usable.");
      }
      return runResult(["clone", "--", source, target], "Cloned.");
    },

    async status(): Promise<GitStatus> {
      // `-z` makes the record separator NUL, which is the only way a path containing a
      // space, a quote, or a newline survives parsing intact.
      const result = await run("status", "--porcelain=v2", "--branch", "-z");

      if (result.code !== 0) {
        return {
          branch: null,
          upstream: null,
          ahead: 0,
          behind: 0,
          entries: [],
          isClean: true,
          hasConflicts: false,
        };
      }

      const records = result.stdout.split("\u0000").filter((record) => record.length > 0);

      let branch: string | null = null;
      let upstream: string | null = null;
      let ahead = 0;
      let behind = 0;
      const entries: GitStatusEntry[] = [];

      for (let i = 0; i < records.length; i++) {
        const record = records[i]!;

        if (record.startsWith("# branch.head ")) {
          const value = record.slice("# branch.head ".length);
          branch = value === "(detached)" ? null : value;
          continue;
        }
        if (record.startsWith("# branch.upstream ")) {
          upstream = record.slice("# branch.upstream ".length);
          continue;
        }
        if (record.startsWith("# branch.ab ")) {
          const match = /\+(\d+) -(\d+)/.exec(record);
          if (match) {
            ahead = Number(match[1]);
            behind = Number(match[2]);
          }
          continue;
        }
        if (record.startsWith("#")) continue;

        // `1 XY ...  <path>` ordinary change, `2 XY ... <path>` rename (the old path is
        // the *next* NUL-separated record), `u ...` unmerged, `? <path>` untracked.
        if (record.startsWith("? ")) {
          entries.push({
            path: record.slice(2),
            staged: "none",
            worktree: "untracked",
            isConflicted: false,
          });
          continue;
        }

        if (record.startsWith("1 ") || record.startsWith("2 ")) {
          const isRename = record.startsWith("2 ");
          const parts = record.split(" ");
          const xy = parts[1] ?? "..";
          // Fields are fixed-width up to the path, which is everything after the 8th.
          const path = parts.slice(isRename ? 9 : 8).join(" ");

          entries.push({
            path,
            staged: toFileChange(xy[0] ?? "."),
            worktree: toFileChange(xy[1] ?? "."),
            isConflicted: false,
          });

          // A rename record is followed by its original path as its own record.
          if (isRename) i += 1;
          continue;
        }

        if (record.startsWith("u ")) {
          const parts = record.split(" ");
          entries.push({
            path: parts.slice(10).join(" "),
            staged: "modified",
            worktree: "modified",
            isConflicted: true,
          });
        }
      }

      return {
        branch,
        upstream,
        ahead,
        behind,
        entries,
        isClean: entries.length === 0,
        hasConflicts: entries.some((entry) => entry.isConflicted),
      };
    },

    async stage(paths: readonly string[]): Promise<GitResult> {
      if (paths.length === 0) return ok();
      if (!paths.every(isSafePathArg)) return fail("One of those paths is not usable.");
      return runResult(["add", "--", ...paths], "Staged.");
    },

    stageAll: () => runResult(["add", "-A"], "Staged all changes."),

    async unstage(paths: readonly string[]): Promise<GitResult> {
      if (paths.length === 0) return ok();
      if (!paths.every(isSafePathArg)) return fail("One of those paths is not usable.");

      // `restore --staged` restores the index *from HEAD*, so in a repository with no
      // commits yet there is nothing to restore from and it fails outright. That is the
      // very first thing a new user does - stage a file, change their mind - so the
      // no-HEAD case gets `rm --cached`, which simply removes the entry from the index.
      const hasHead = (await run("rev-parse", "--verify", "HEAD")).code === 0;

      return hasHead
        ? runResult(["restore", "--staged", "--", ...paths], "Unstaged.")
        : runResult(["rm", "--cached", "-r", "--", ...paths], "Unstaged.");
    },

    async discard(paths: readonly string[]): Promise<GitResult> {
      if (paths.length === 0) return ok();
      if (!paths.every(isSafePathArg)) return fail("One of those paths is not usable.");
      return runResult(["restore", "--", ...paths], "Discarded changes.");
    },

    async commit(message: string): Promise<GitResult> {
      // Refused here rather than by git, which would open an editor and hang the child.
      if (typeof message !== "string" || message.trim().length === 0) {
        return fail("A commit needs a message.");
      }
      return runResult(["commit", "-m", message], "Committed.");
    },

    push: () => runResult(["push"], "Pushed."),
    pull: () => runResult(["pull", "--ff-only"], "Pulled."),
    fetch: () => runResult(["fetch", "--all", "--prune"], "Fetched."),

    async remotes(): Promise<GitRemote[]> {
      const result = await run("remote", "-v");
      if (result.code !== 0) return [];

      const seen = new Map<string, string>();
      for (const line of result.stdout.split("\n")) {
        const [name, rest] = line.split("\t");
        if (name === undefined || rest === undefined) continue;
        if (!seen.has(name)) seen.set(name, rest.split(" ")[0] ?? "");
      }

      return [...seen].map(([name, url]) => ({ name, url }));
    },

    async branches(): Promise<GitBranch[]> {
      const result = await run(
        "for-each-ref",
        "--format=%(refname:short)\u001f%(HEAD)\u001f%(upstream:short)",
        "refs/heads",
      );
      if (result.code !== 0) return [];

      return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const [name = "", head = "", upstream = ""] = line.split(FIELD);
          return { name, current: head === "*", upstream: upstream.length > 0 ? upstream : null };
        });
    },

    async checkout(ref: string): Promise<GitResult> {
      if (!isSafeRef(ref)) return fail("That is not a usable branch name.");
      return runResult(["checkout", "--", ref].filter((arg) => arg !== "--"), `Switched to ${ref}.`);
    },

    async createBranch(name: string): Promise<GitResult> {
      if (!isSafeRef(name)) return fail("That is not a usable branch name.");
      return runResult(["checkout", "-b", name], `Created ${name}.`);
    },

    async diff(path?: string): Promise<string> {
      if (path !== undefined && !isSafePathArg(path)) return "";

      const args = path === undefined ? ["diff", "HEAD"] : ["diff", "HEAD", "--", path];
      const result = await run(...args);
      return result.code === 0 ? result.stdout : "";
    },

    async lineChanges(path: string): Promise<LineChange[]> {
      if (!isSafePathArg(path)) return [];

      // `-U0` gives hunk headers with no context, which is exactly the line ranges a
      // gutter needs and nothing else.
      const result = await run("diff", "-U0", "HEAD", "--", path);
      if (result.code !== 0) return [];

      const changes: LineChange[] = [];
      for (const line of result.stdout.split("\n")) {
        const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (match === null) continue;

        const removed = match[2] === undefined ? 1 : Number(match[2]);
        const addedStart = Number(match[3]);
        const added = match[4] === undefined ? 1 : Number(match[4]);

        if (added === 0) {
          // A pure deletion has no line in the working file; anchor it to the line above.
          changes.push({ kind: "deleted", startLine: Math.max(1, addedStart), lineCount: 1 });
        } else if (removed === 0) {
          changes.push({ kind: "added", startLine: addedStart, lineCount: added });
        } else {
          changes.push({ kind: "modified", startLine: addedStart, lineCount: added });
        }
      }

      return changes;
    },

    async log(limit = 50): Promise<GitCommit[]> {
      const result = await run(
        "log",
        `--max-count=${Math.max(1, Math.min(Math.floor(limit), 500))}`,
        `--format=%H${FIELD}%h${FIELD}%an${FIELD}%aI${FIELD}%s${RECORD}`,
      );
      return result.code === 0 ? parseCommits(result.stdout) : [];
    },

    async fileHistory(path: string, limit = 50): Promise<GitCommit[]> {
      if (!isSafePathArg(path)) return [];

      const result = await run(
        "log",
        `--max-count=${Math.max(1, Math.min(Math.floor(limit), 500))}`,
        `--format=%H${FIELD}%h${FIELD}%an${FIELD}%aI${FIELD}%s${RECORD}`,
        "--",
        path,
      );
      return result.code === 0 ? parseCommits(result.stdout) : [];
    },

    async blame(path: string): Promise<BlameLine[]> {
      if (!isSafePathArg(path)) return [];

      const result = await run("blame", "--line-porcelain", "--", path);
      if (result.code !== 0) return [];

      const lines: BlameLine[] = [];
      let hash = "";
      let author = "";
      let date = "";
      let summary = "";
      let lineNumber = 0;

      for (const line of result.stdout.split("\n")) {
        const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line);
        if (header !== null) {
          hash = header[1]!;
          lineNumber = Number(header[2]);
          continue;
        }

        if (line.startsWith("author ")) author = line.slice(7);
        else if (line.startsWith("author-time ")) {
          date = new Date(Number(line.slice(12)) * 1000).toISOString();
        } else if (line.startsWith("summary ")) summary = line.slice(8);
        else if (line.startsWith("\t")) {
          lines.push({ line: lineNumber, hash, author, date, summary });
        }
      }

      return lines;
    },
  };
}
