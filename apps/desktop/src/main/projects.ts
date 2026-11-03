import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseRecent, recentKey, type RecentFolder } from "./recentsStore.ts";
import type { ProjectDetailsView } from "../shared/api.ts";

/** Independent of the twelve-item recent menu: projects survive recent-menu eviction. */
export function createProjectsStore(directory: string) {
  const file = join(directory, "projects.json");
  let pending = Promise.resolve();
  async function read(): Promise<RecentFolder[]> {
    try {
      const value: unknown = JSON.parse(await readFile(file, "utf8"));
      return Array.isArray(value) ? value.map(parseRecent).filter((p): p is RecentFolder => p !== null) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  return {
    async list() { await pending; return read(); },
    remember(entries: readonly RecentFolder[]): Promise<void> {
      const task = pending.then(async () => {
        const projects = new Map((await read()).map(p => [recentKey(p.path), p]));
        for (const entry of entries) {
          const key = recentKey(entry.path), previous = projects.get(key);
          if (!previous || entry.openedAt >= previous.openedAt) projects.set(key, entry);
        }
        await mkdir(directory, { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify([...projects.values()].sort((a, b) => b.openedAt - a.openedAt)), "utf8");
        await rename(`${file}.tmp`, file);
      });
      pending = task.catch(() => {});
      return task;
    },
  };
}

function git(root: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", [...args], { cwd: root, timeout: 15_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } },
    (error, stdout) => error ? reject(new Error("Project history could not be read. Check that the folder exists, contains a Git repository, and Git is installed.")) : resolve(stdout));
  });
}

/** Local history only: no credentials, network fetches, or arbitrary renderer Git arguments. */
export async function readProjectDetails(root: string): Promise<ProjectDetailsView> {
  await git(root, ["rev-parse", "--show-toplevel"]);
  const [branch, remote, status, head] = await Promise.allSettled([
    git(root, ["symbolic-ref", "--short", "HEAD"]),
    git(root, ["config", "--get", "remote.origin.url"]),
    git(root, ["status", "--porcelain=v1", "-z"]),
    git(root, ["rev-parse", "--verify", "HEAD"]),
  ]);
  if (status.status === "rejected") throw status.reason;
  const [authors, log, count] = head.status === "fulfilled" ? await Promise.all([
    git(root, ["shortlog", "-sne", "--all", "--group=author", "--group=trailer:co-authored-by"]),
    git(root, ["log", "--all", "-20", "--format=%h%x00%aN%x00%aI%x00%s"]),
    git(root, ["rev-list", "--all", "--count"]),
  ]) : ["", "", "0"];
  // Credentials embedded in remote URLs must never reach the UI.
  const rawRemote = remote.status === "fulfilled" ? remote.value.trim() : "";
  let repository = rawRemote.replace(/^(https?:\/\/)[^/]*@/, "$1").split(/[?#]/)[0] ?? "";
  if (!/^(?:https?:\/\/|git@)[\w.-]+[/:][\w./-]+$/.test(repository)) repository = "";
  const records = status.value.split("\0").filter(Boolean);
  let changedFiles = 0;
  for (let i = 0; i < records.length; i++) {
    changedFiles++;
    if (/[RC]/.test((records[i] ?? "").slice(0, 2))) i++;
  }
  return {
    commitCount: Number(count.trim()),
    branch: branch.status === "fulfilled" ? branch.value.trim() : "Detached HEAD",
    repository: repository || null,
    changedFiles,
    contributors: authors.split("\n").flatMap(line => {
      const match = /^\s*(\d+)\s+(.+) <([^<>]*)>$/.exec(line);
      return match ? [{ name: match[2]!, email: match[3]!, commits: Number(match[1]) }] : [];
    }),
    commits: log.split("\n").filter(Boolean).map(line => {
      const [hash = "", author = "", date = "", ...subject] = line.split("\0");
      return { hash, author, date, subject: subject.join("\0") };
    }),
  };
}
