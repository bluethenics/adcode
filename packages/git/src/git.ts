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
  GitCommitDetail,
  GitCommitFile,
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
  GitCommitDetail,
  GitCommitFile,
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

export type RepoState = "repo" | "none" | "untrusted";

export interface Git {
  isRepo(): Promise<boolean>;
  /** Whether the folder is a repository git will use, has none, or has one git refuses. */
  repoState(): Promise<RepoState>;
  /** Let git use this folder's repository (`safe.directory`). Only on the user's say-so. */
  trust(): Promise<GitResult>;
  /** Create a repository; one made on a drive that records no owner is trusted at once. */
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
  /** Point the repository at a remote, or correct the URL of one it already has. */
  addRemote(name: string, url: string): Promise<GitResult>;
  remotes(): Promise<GitRemote[]>;

  branches(): Promise<GitBranch[]>;
  checkout(ref: string): Promise<GitResult>;
  createBranch(name: string): Promise<GitResult>;

  diff(path?: string): Promise<string>;
  lineChanges(path: string): Promise<LineChange[]>;
  log(limit?: number): Promise<GitCommit[]>;
  fileHistory(path: string, limit?: number): Promise<GitCommit[]>;
  blame(path: string): Promise<BlameLine[]>;
  /** A file's contents at a revision, or null if it was not there. */
  showFile(ref: string, path: string): Promise<string | null>;

  /** One commit, opened: its full message and every file it touched. Null if not found. */
  commitDetail(ref: string): Promise<GitCommitDetail | null>;
  /** The diff of a single file within a single commit. Empty when unavailable. */
  commitFileDiff(ref: string, path: string): Promise<string>;
  /**
   * Put one file back the way it was at a commit.
   *
   * The file lands in the working tree as an uncommitted change. Nothing already
   * committed is rewritten, so a restore chosen by mistake is undone by discarding it
   * rather than by rescuing the branch out of the reflog.
   */
  restoreFile(ref: string, path: string): Promise<GitResult>;
}

export function createGit(deps: GitDeps): Git {
  const run = (...args: string[]) => deps.exec.run(args, { cwd: deps.root });

  async function runResult(args: string[], successMessage = ""): Promise<GitResult> {
    const result = await run(...args);
    return result.code === 0
      ? ok(successMessage || result.stdout.trim())
      : fail(result.stderr.trim() || result.stdout.trim() || "git failed");
  }

  /**
   * "untrusted": a repository is there, but git refuses to use it - it cannot confirm who
   * owns the folder (a FAT32 or exFAT drive records no owner at all, or another account
   * made it) and the folder is not in `safe.directory`. Told apart from "none" so the UI
   * can offer to trust it instead of offering to create a repository that already exists.
   */
  async function repoState(): Promise<RepoState> {
    const result = await run("rev-parse", "--is-inside-work-tree");
    if (result.code === 0 && result.stdout.trim() === "true") return "repo";
    return /dubious ownership/i.test(result.stderr) ? "untrusted" : "none";
  }

  async function isRepo(): Promise<boolean> {
    return (await repoState()) === "repo";
  }

  /** Add this folder to `safe.directory` in the user's global config, as git itself suggests. */
  async function trust(): Promise<GitResult> {
    const path = deps.root.replace(/\\/g, "/").replace(/\/+$/, "");
    const listed = await run("config", "--global", "--get-all", "safe.directory");
    const already = listed.stdout.split(/\r?\n/).map((line) => line.trim().toLowerCase());
    if (already.includes(path.toLowerCase()) || already.includes("*")) return ok("Git already trusts this folder.");
    return runResult(["config", "--global", "--add", "safe.directory", path], "Git now trusts this folder.");
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
    repoState,
    trust,

    async init(): Promise<GitResult> {
      // A repository git already refuses is not this call's to vouch for: trusting one
      // somebody else made lets its hooks run here, so that is asked for, not assumed.
      if ((await repoState()) === "untrusted") {
        return fail("This folder already has a Git repository that Git does not trust yet. Trust it only if you know where it came from.");
      }
      const result = await runResult(["init"], "Initialised an empty repository.");
      // On a drive that records no owner, git refuses even the repository it has just
      // made. This one was created a moment ago, by this call, so it is vouched for.
      if (result.ok && (await repoState()) === "untrusted") {
        const trusted = await trust();
        if (!trusted.ok) return fail(`Created the repository, but Git will not use it until it is trusted: ${trusted.message}`);
      }
      return result;
    },

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
      /*
       * Per-file line counts, for change lists that read `+110` rather than `M`.
       *
       * `--numstat -z` prints `added\tremoved\tpath\0` per file, with `-` for
       * binary files and no row at all for untracked ones. `--no-renames` keeps
       * a rename as one row under its current path (the same precedent as
       * `commitDetail` below), and `-z` means quoted C-style paths never appear,
       * so splitting on NUL is exact - including for paths with spaces.
       */
      async function numstat(cached: boolean): Promise<Map<string, { added: number; removed: number }>> {
        const counts = new Map<string, { added: number; removed: number }>();
        const args = cached
          ? ["diff", "--no-renames", "--cached", "--numstat", "-z"]
          : ["diff", "--no-renames", "--numstat", "-z"];
        const output = await run(...args);
        if (output.code !== 0) return counts;
        for (const record of output.stdout.split("\0")) {
          if (record.length === 0) continue;
          const [addedRaw, removedRaw, path] = record.split("\t");
          if (path === undefined || path.length === 0) continue;
          const added = Number(addedRaw);
          const removed = Number(removedRaw);
          if (!Number.isFinite(added) || !Number.isFinite(removed)) continue;
          counts.set(path, { added, removed });
        }
        return counts;
      }

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
            added: null,
            removed: null,
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
            added: null,
            removed: null,
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
            added: null,
            removed: null,
          });
        }
      }

      /*
       * Fold the two numstat runs into the rows. Staged and worktree counts
       * add up to the file's total uncommitted change; a side git cannot
       * number (untracked, binary, conflicted) stays null and the UI shows
       * New or nothing instead of a fabricated zero.
       */
      const [cachedCounts, worktreeCounts] = await Promise.all([numstat(true), numstat(false)]);
      const counted = entries.map((entry) => {
        const staged = cachedCounts.get(entry.path);
        const worktree = worktreeCounts.get(entry.path);
        if (staged === undefined && worktree === undefined) return entry;
        return {
          ...entry,
          added: (staged?.added ?? 0) + (worktree?.added ?? 0),
          removed: (staged?.removed ?? 0) + (worktree?.removed ?? 0),
        };
      });

      return {
        branch,
        upstream,
        ahead,
        behind,
        entries: counted,
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

      /*
       * Answered here rather than by git, for the same reason the empty message is.
       *
       * `git commit` with an empty index exits non-zero and prints three paragraphs to
       * stdout - the branch, every unstaged file, every untracked file, and finally the line
       * that matters. Handing that to a toast is not reporting, it is forwarding. And the
       * advice it ends with is `use "git add"`, which is not something a person can act on in
       * a window that has a checkbox for exactly this.
       *
       * `diff --cached --name-only` is the check, and it works in a repository with no
       * commits yet - where `--quiet` against HEAD would fail outright, and where a beginner
       * making their first commit actually is.
       */
      const staged = await run("diff", "--cached", "--name-only");
      if (staged.code === 0 && staged.stdout.trim().length === 0) {
        return fail("Nothing is staged yet. Tick the + beside a file to include it in this commit.");
      }

      /*
       * The first-commit wall, answered before git hits it.
       *
       * A machine that has never run git has no `user.name` or `user.email`, and git refuses to
       * record a commit without them. Its own message is four paragraphs ending in two
       * `git config --global` commands - which is sound advice on a command line and close to
       * useless inside a window, where the person reading it has no prompt in front of them.
       *
       * `git var GIT_COMMITTER_IDENT` is the authoritative check rather than reading the two
       * config keys: it is what git itself resolves, so it accounts for every source an identity
       * can come from - local, global, system, environment - and for the auto-detection that
       * sometimes succeeds. Guessing from `config --get` would refuse commits that would in fact
       * have worked.
       *
       * The suggestion names the terminal because this application ships one. Telling somebody
       * to run a command they have no way to run is the failure being fixed, not a smaller
       * version of it.
       */
      const identity = await run("var", "GIT_COMMITTER_IDENT");
      if (identity.code !== 0) {
        return fail(
          "Git needs a name and email before it can record who made this commit. " +
            'Open the terminal and run: git config --global user.name "Your Name" ' +
            'and git config --global user.email "you@example.com"',
        );
      }

      return runResult(["commit", "-m", message], "Committed.");
    },

    /**
     * Push, setting the upstream on the first one.
     *
     * A branch that has never been pushed has no upstream, and plain `git push` refuses it with
     * a message ending in `git push --set-upstream origin <branch>`. That is the right advice at
     * a prompt and unusable in a window with a Push button and no way to type it - the same
     * shape of failure as the missing identity above.
     *
     * So the first push does what the user pressed the button for. The conditions are narrow on
     * purpose: only when there is no upstream already, only when the branch is a real branch
     * rather than a detached HEAD, and only when the remote to use is unambiguous - `origin`, or
     * the single remote if there is exactly one and it is named something else. With two remotes
     * and no upstream there is a genuine choice to make, and guessing at it would push someone's
     * work to a place they did not choose. That case falls through to git, whose message is then
     * the honest answer.
     */
    async push(): Promise<GitResult> {
      const current = await run("symbolic-ref", "--quiet", "--short", "HEAD");
      const branch = current.stdout.trim();

      // Detached HEAD, or the branch name is not one we would put on a command line.
      if (current.code !== 0 || branch.length === 0 || !isSafeRef(branch)) {
        return runResult(["push"], "Pushed.");
      }

      const upstream = await run("rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branch}@{upstream}`);
      if (upstream.code === 0 && upstream.stdout.trim().length > 0) {
        return runResult(["push"], "Pushed.");
      }

      const configured = await run("remote");
      const names = configured.stdout
        .split("\n")
        .map((name) => name.trim())
        .filter((name) => name.length > 0);

      // No remote at all: git's "No configured push destination" is the accurate answer, and
      // inventing one here would be worse than repeating it.
      if (names.length === 0) return runResult(["push"], "Pushed.");

      const remote = names.includes("origin") ? "origin" : names.length === 1 ? names[0] ?? null : null;
      if (remote === null || !isSafeRef(remote)) return runResult(["push"], "Pushed.");

      return runResult(
        ["push", "--set-upstream", remote, branch],
        `Pushed, and set ${remote}/${branch} as the upstream.`,
      );
    },
    pull: () => runResult(["pull", "--ff-only"], "Pulled."),
    fetch: () => runResult(["fetch", "--all", "--prune"], "Fetched."),

    /**
     * Point this repository at a remote - normally the GitHub repository it will be pushed to.
     *
     * `git init` leaves a repository with nowhere to push, and nothing in this UI could fix
     * that: Push said "No configured push destination" and advised `git remote add`, a command
     * the window has no way to run. This is that command.
     *
     * The URL goes through `isSafeCloneUrl`, the same guard `clone` uses and for the same
     * reason: a remote URL is pasted from a chat window or a browser, and `ext::` transports
     * turn a later `git fetch` into arbitrary command execution. The check belongs here rather
     * than at the moment of fetching, because by then the dangerous value is already stored in
     * the repository's config and will be used by commands nobody reviewed.
     *
     * Replaces an existing remote of the same name rather than failing. Someone correcting a
     * URL they mistyped is the common case, and `git remote add` on an existing name fails with
     * "remote origin already exists" - which is accurate and leaves them stuck.
     */
    async addRemote(name: string, url: string): Promise<GitResult> {
      if (!isSafeRef(name)) return fail("That is not a usable remote name.");
      if (!isSafeCloneUrl(url)) return fail("That is not a usable repository URL.");

      const existing = await run("remote", "get-url", name);

      return existing.code === 0
        ? runResult(["remote", "set-url", name, url], `Updated ${name}.`)
        : runResult(["remote", "add", name, url], `Connected ${name}.`);
    },

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

    async commitDetail(ref: string): Promise<GitCommitDetail | null> {
      if (!isSafeRef(ref)) return null;

      const header = await run(
        "show",
        "--no-patch",
        `--format=%H${FIELD}%h${FIELD}%an${FIELD}%aI${FIELD}%s${FIELD}%b`,
        ref,
      );
      if (header.code !== 0) return null;

      const [hash, shortHash, author, date, subject, ...rest] = header.stdout.split(FIELD);
      if (hash === undefined || shortHash === undefined) return null;

      /*
       * Two passes, because no single format gives both.
       *
       * `--name-status` says *how* each file changed and `--numstat` says by how much,
       * and neither carries the other's column. They are keyed together by path.
       *
       * `--root` is what makes the first commit in a repository openable: without it
       * `git show` has no parent to diff against and reports no files at all, so a new
       * project's only commit would appear to have touched nothing.
       */
      const kinds = new Map<string, FileChange>();
      const statusOut = await run("show", "--no-renames", "--root", "--name-status", "--format=", ref);
      for (const line of statusOut.stdout.split("\n")) {
        const [code, path] = line.trim().split("\t");
        if (code === undefined || path === undefined || path.length === 0) continue;
        // The same letters porcelain v2 uses, so the vocabulary matches `status`.
        kinds.set(path, toFileChange(code[0] ?? ""));
      }

      const files: GitCommitFile[] = [];
      const numstat = await run("show", "--no-renames", "--root", "--numstat", "--format=", ref);
      for (const line of numstat.stdout.split("\n")) {
        const [added, removed, path] = line.trim().split("\t");
        if (path === undefined || path.length === 0) continue;

        files.push({
          path,
          kind: kinds.get(path) ?? "modified",
          // Binary files report "-" rather than a count; zero is the honest answer for
          // "how many lines changed" in a file that has no lines.
          added: Number.parseInt(added ?? "0", 10) || 0,
          removed: Number.parseInt(removed ?? "0", 10) || 0,
        });
      }

      return {
        hash,
        shortHash,
        author: author ?? "",
        date: date ?? "",
        subject: subject ?? "",
        // A body containing the field separator would have been split; rejoining restores it.
        body: rest.join(FIELD).trim(),
        files,
      };
    },

    async commitFileDiff(ref: string, path: string): Promise<string> {
      if (!isSafeRef(ref) || !isSafePathArg(path)) return "";

      const result = await run("show", "--no-renames", "--root", "--format=", ref, "--", path);
      return result.code === 0 ? result.stdout : "";
    },

    async restoreFile(ref: string, path: string): Promise<GitResult> {
      if (!isSafeRef(ref)) return fail("that revision is not a usable name");
      if (!isSafePathArg(path)) return fail("that path is not a usable argument");

      // `--` separates the ref from the pathspec, so a file called `main` cannot be
      // mistaken for a branch. `checkout <ref> -- <path>` writes only the working tree
      // and the index; the branch and its history are untouched.
      return runResult(["checkout", ref, "--", path], `Restored ${path} from ${ref.slice(0, 7)}`);
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

    async showFile(ref: string, path: string): Promise<string | null> {
      if (!isSafeRef(ref) || !isSafePathArg(path)) return null;

      // `<ref>:<path>` is one argument, so a path that looked like a flag would still be
      // hidden behind the ref - but both halves are checked anyway, because relying on
      // the concatenation to sanitise the path is the kind of reasoning that ages badly.
      const result = await run("show", `${ref}:${path}`);
      return result.code === 0 ? result.stdout : null;
    },
  };
}
