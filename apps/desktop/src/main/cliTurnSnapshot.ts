/**
 * Undo for a coding CLI's turn.
 *
 * ADCode's own assistant writes through its file tools, and each write lands in the turn's
 * checkpoint as it happens (aiCheckpoints.ts). A coding CLI - Claude Code, Codex, an ACP agent -
 * writes from its own process, so those writes never pass through ADCode. This module rebuilds
 * the same checkpoint from the outside: how each file read before the turn, and how it reads
 * after it.
 *
 * Which files: the ones the CLI says it edited (Claude Code's Write/Edit `file_path`, Codex's
 * `file_change.changes[].path`, an ACP edit's locations), plus - when the CLI ran something that
 * can write files without naming them, such as a shell command - every file git sees change
 * during the turn.
 *
 * How a file read before the turn, in order of trust:
 *   1. Files git already saw as changed when the turn started are read then, so a person's own
 *      unsaved-to-git work is put back exactly as it was.
 *   2. A file git saw as clean is read from the commit the turn started on (t3code's idea:
 *      a clean file needs no copy, the commit already is one). `cat-file --filters` gives it
 *      with the line endings the checkout has.
 *   3. A file git does not track and does not ignore did not exist: Undo deletes it.
 *   4. Otherwise (no git, or an ignored file) the file as read when the CLI first named it,
 *      which is before it ran the tool for every CLI that asks first; a file it is too late
 *      for is left out rather than restored wrong.
 *
 * Limits, stated rather than hidden: a person's own edit saved during the turn, to a file the
 * fallback picks up, is part of the turn's change. Undo still refuses, file by file, when a
 * file changed after the turn ended.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

export interface CliSnapshotDeps {
  /** git in the workspace folder: its stdout, or null when it failed or is not installed. */
  git(args: readonly string[]): Promise<Buffer | null>;
  /** A workspace file's bytes, or null when there is none. */
  read(path: string): Promise<Buffer | null>;
}

export interface CliSnapshotLimits {
  /** Files changed at the start whose contents are kept. Past it, such a file is left out. */
  readonly maxStartFiles?: number;
  /** Bigger files are left out: Undo is for source, not for a database the agent rebuilt. */
  readonly maxFileBytes?: number;
}

/** Where a turn's file changes go: the checkpoint turn's own `record`. */
export interface SnapshotRecorder {
  record(path: string, before: string | null, after: string | null, encoding?: "utf8" | "base64"): void;
}

export interface CliTurnSnapshot {
  /** The CLI named these files (absolute or workspace-relative): keep how each reads now. */
  touch(paths: readonly string[]): void;
  /** The CLI ran something that may write files it does not name: ask git at the end too. */
  noteUnnamedWrites(): void;
  /** Record every file the turn changed into `recorder`; the paths recorded, in order. */
  finish(recorder: SnapshotRecorder): Promise<string[]>;
}

/** A path as the workspace names it - `src/a.ts` - or null when it is outside the workspace. */
export function workspaceRelative(root: string, path: string): string | null {
  const trimmed = path.trim();
  if (trimmed === "" || trimmed.includes("\u0000")) return null;
  let rel = trimmed;
  if (isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    const folder = resolve(root);
    const file = resolve(trimmed);
    // Windows paths compare without case: `e:\proj` and `E:\proj` are the same folder.
    const fold = (value: string): string => (process.platform === "win32" ? value.toLowerCase() : value);
    const start = folder.endsWith(sep) ? folder : `${folder}${sep}`;
    if (!fold(file).startsWith(fold(start))) return null;
    rel = file.slice(start.length);
  }
  const portable = rel.replaceAll("\\", "/").replace(/^\.\//, "");
  if (portable === "" || isAbsolute(portable) || /^[A-Za-z]:\//.test(portable)) return null;
  const parts = portable.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  return portable;
}

/**
 * `git status --porcelain=v1 -z` entries as workspace paths. A rename names its new path first
 * and its old one after; both changed.
 */
export function parsePorcelainZ(output: string, prefix: string): string[] {
  const fields = output.split("\u0000");
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    if (field.length < 4) continue;
    const code = field.slice(0, 2);
    paths.push(field.slice(3));
    if (code.includes("R") || code.includes("C")) {
      const old = fields[index + 1];
      if (old !== undefined && old !== "") paths.push(old);
      index += 1;
    }
  }
  return paths
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length))
    .filter((path) => path !== "" && !path.endsWith("/"));
}

const binary = (bytes: Buffer | null): boolean => bytes !== null && bytes.includes(0);

/** Tools that can write files without naming them: a shell command, a helper agent, an MCP tool. */
export function writesUnnamed(kind: string): boolean {
  return kind === "execute" || kind === "other";
}

/**
 * An outside agent's tool row as the chat shows it: paths inside the workspace as the workspace
 * names them (`src/a.ts`, as ADCode's own rows read), the folder taken out of the detail line.
 */
export function outsideToolForChat<T extends { readonly detail: string; readonly paths?: readonly string[] }>(tool: T, root: string): T {
  const folder = resolve(root);
  const escaped = [folder, folder.replaceAll("\\", "/")].map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const detail = tool.detail.replace(new RegExp(`(?:${escaped})[\\\\/]`, process.platform === "win32" ? "gi" : "g"), "");
  const paths = tool.paths?.map((path) => workspaceRelative(root, path) ?? path);
  return { ...tool, detail, ...(paths === undefined ? {} : { paths }) };
}

/**
 * The real git and file system, for a workspace folder. `resolvePath` is the caller's check
 * that a path stays inside the workspace (aiSandbox's `resolveSandboxPath`).
 */
export function workspaceSnapshotDeps(root: string, resolvePath: (root: string, path: string) => Promise<string> = async (folder, path) => join(folder, path)): CliSnapshotDeps {
  return {
    git: (args) => new Promise((done) => {
      execFile("git", [...args], { cwd: root, encoding: "buffer", windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => done(error === null ? stdout : null));
    }),
    async read(path) {
      try {
        return await readFile(await resolvePath(root, path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return null;
        throw error;
      }
    },
  };
}

/**
 * Starts watching a turn in `root`. Reads git's view of the folder once, now, so the files a
 * person had already changed are kept as they were.
 */
export async function startCliTurnSnapshot(root: string, deps: CliSnapshotDeps, limits: CliSnapshotLimits = {}): Promise<CliTurnSnapshot> {
  const maxStartFiles = limits.maxStartFiles ?? 400;
  const maxFileBytes = limits.maxFileBytes ?? 2_000_000;
  const text = async (args: readonly string[]): Promise<string | null> => (await deps.git(args))?.toString("utf8") ?? null;
  const readCapped = async (path: string): Promise<Buffer | null | undefined> => {
    const bytes = await deps.read(path).catch(() => undefined);
    return bytes !== undefined && bytes !== null && bytes.length > maxFileBytes ? undefined : bytes;
  };

  // The commit the turn starts on, and the workspace's place in its repository (a workspace may
  // be a folder inside one). Null head: not a repository, or one with no commit yet.
  const head = (await text(["rev-parse", "--verify", "-q", "HEAD"]))?.trim() || null;
  const prefix = head === null ? "" : (await text(["rev-parse", "--show-prefix"]))?.trim() ?? "";
  const statusArgs = ["-c", "core.quotepath=off", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."];
  const startStatus = head === null ? null : await text(statusArgs);
  const changedAtStart = new Set(startStatus === null ? [] : parsePorcelainZ(startStatus, prefix));
  /** How each file read when the turn started; undefined = not kept (too many, too big). */
  const atStart = new Map<string, Buffer | null | undefined>();
  let kept = 0;
  for (const path of changedAtStart) {
    atStart.set(path, kept < maxStartFiles ? await readCapped(path) : undefined);
    kept += 1;
  }

  /** Every file the CLI named. */
  const named = new Set<string>();
  /** How each named file read when it was named, for the files neither git nor the start holds. */
  const touched = new Map<string, Promise<Buffer | null | undefined>>();
  let unnamed = false;

  async function before(path: string): Promise<Buffer | null | undefined> {
    if (atStart.has(path)) return atStart.get(path);
    if (head !== null) {
      // Clean when the turn started: the commit holds it, with the checkout's line endings.
      const committed = await deps.git(["cat-file", "--filters", `${head}:./${path}`]);
      if (committed !== null) return committed.length > maxFileBytes ? undefined : committed;
      // Not in the commit, not changed at the start, and git would have listed it: it was not there.
      const ignored = (await deps.git(["check-ignore", "-q", "--", path])) !== null;
      if (!ignored) return null;
    }
    return touched.get(path) ?? undefined;
  }

  return {
    touch(paths) {
      for (const raw of paths) {
        const path = workspaceRelative(root, raw);
        if (path === null || named.has(path)) continue;
        named.add(path);
        // A file already changed when the turn began was read then; reading it again could be too late.
        if (!atStart.has(path)) touched.set(path, readCapped(path));
      }
    },
    noteUnnamedWrites() {
      unnamed = true;
    },
    async finish(recorder) {
      const candidates = new Set<string>(named);
      if (unnamed && head !== null) {
        for (const path of changedAtStart) candidates.add(path);
        const endStatus = await text(statusArgs);
        if (endStatus !== null) for (const path of parsePorcelainZ(endStatus, prefix)) candidates.add(path);
      }
      const recorded: string[] = [];
      for (const path of [...candidates].sort()) {
        const was = await before(path);
        if (was === undefined) continue;
        const now = await readCapped(path);
        if (now === undefined) continue;
        if (was === null && now === null) continue;
        if (was !== null && now !== null && was.equals(now)) continue;
        const encoding = binary(was) || binary(now) ? "base64" : "utf8";
        recorder.record(path, was?.toString(encoding) ?? null, now?.toString(encoding) ?? null, encoding);
        recorded.push(path);
      }
      return recorded;
    },
  };
}
