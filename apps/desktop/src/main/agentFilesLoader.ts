/**
 * Agent files on disk: `.adcode/agents/*.md` and `.claude/agents/*.md`, in the project and in
 * the person's home folder (packages/ai `agentFiles.ts` reads them).
 *
 * Read when a turn starts and held for the turn, so the sync places that list task agents (the
 * roster, a helper's route) see the same set the turn began with.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_FOLDERS, readAgentFiles, type AgentFile, type AgentFileScope } from "@adcode/ai";
import { recordDebug } from "./debugLog.ts";

const MAX_FILES = 40;
const MAX_FILE_BYTES = 64_000;
const FRESH_MS = 5_000;

const cache = new Map<string, { readonly at: number; readonly agents: readonly AgentFile[] }>();
const reported = new Set<string>();

const keyFor = (root: string | null): string => (root === null ? "" : resolve(root).toLowerCase());

async function folderFiles(folder: string, label: string, scope: AgentFileScope): Promise<{ origin: string; text: string; scope: AgentFileScope }[]> {
  let names: string[];
  try {
    names = (await readdir(folder)).filter((name) => /\.md$/i.test(name)).sort().slice(0, MAX_FILES);
  } catch {
    return [];
  }
  const files: { origin: string; text: string; scope: AgentFileScope }[] = [];
  for (const name of names) {
    const path = join(folder, name);
    try {
      if ((await stat(path)).size > MAX_FILE_BYTES) continue;
      files.push({ origin: `${label}/${name}`, text: await readFile(path, "utf8"), scope });
    } catch { /* Gone or unreadable: skipped. */ }
  }
  return files;
}

/** Read the agent files for a project (and the person's own), and keep them for `fileAgentsFor`. */
export async function refreshFileAgents(root: string | null): Promise<readonly AgentFile[]> {
  const key = keyFor(root);
  const hit = cache.get(key);
  if (hit !== undefined && Date.now() - hit.at < FRESH_MS) return hit.agents;
  const home = homedir();
  const sameAsHome = root !== null && resolve(root).toLowerCase() === resolve(home).toLowerCase();
  const files = [
    // The project's first: it knows its own work best. Then the person's, for every project.
    ...(root === null || sameAsHome ? [] : (await Promise.all(AGENT_FOLDERS.map((folder) => folderFiles(join(root, folder), folder, "project")))).flat()),
    ...(await Promise.all(AGENT_FOLDERS.map((folder) => folderFiles(join(home, folder), `~/${folder}`, "user")))).flat(),
  ];
  const { agents, problems } = readAgentFiles(files);
  for (const problem of problems) {
    if (reported.has(problem)) continue;
    reported.add(problem);
    recordDebug("warn", "ai:agents", problem);
  }
  cache.set(key, { at: Date.now(), agents });
  return agents;
}

/** The agent files last read for a project; empty until a turn there has read them. */
export function fileAgentsFor(root: string | null): readonly AgentFile[] {
  return cache.get(keyFor(root))?.agents ?? [];
}
