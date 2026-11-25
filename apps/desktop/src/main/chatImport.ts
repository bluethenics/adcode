/**
 * Finding other tools' conversations on this computer, and bringing them in.
 *
 * Only three known places are read, never the disk at large:
 *   - Claude Code:  ~/.claude/projects/<folder>/<session>.jsonl
 *   - Codex:        ~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl
 *   - OpenCode:     ~/.local/share/opencode/storage/{session,message,part}
 *
 * A scan reads the files to count and title what is there, and hands the window a list:
 * titles, folders, dates and counts. No message text crosses to the renderer until the
 * person chooses what to import, and then it goes straight into ADCode's own session store
 * (`aiSessions.ts`) - the conversations are never sent anywhere. The other tools' files are
 * only ever read.
 *
 * Desktop apps that keep conversations on their servers (Claude Desktop, ChatGPT) have
 * nothing on disk to read; their exported `conversations.json` is imported by `importChatFile`.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ChatImportEntry, ChatImportOptions, ChatImportPreview, ChatImportProject, ChatImportResult, ChatImportScan, ChatImportScanOptions, ChatImportSourceReport, ChatImportTool } from "../shared/api.ts";
import { sameWorkspace, sessionExists, writeSession } from "./aiSessions.ts";
import {
  CHAT_IMPORT_SOURCES,
  buildOpenCodeSession,
  importedSession,
  openCodePartText,
  parseClaudeCodeSession,
  parseCodexSession,
  parseExportFile,
  type ChatImportSource,
  type ImportedChat,
  type OpenCodeMessage,
} from "./chatImportModel.ts";

/** Newest conversations per tool by default; enough to move in, few enough to scan in seconds. */
const MAX_PER_SOURCE = 150;
/** The most a person can ask a scan to read per tool. */
const MAX_PER_SOURCE_CHOSEN = 1_000;
/** A chosen folder is walked this deep and no further, and stops after this many session files. */
const FOLDER_DEPTH = 5;
const FOLDER_FILES = 2_000;
/** What a preview shows: the opening of the conversation, not all of it. */
const PREVIEW_MESSAGES = 6;
const PREVIEW_CHARS = 600;
const ALL_TOOLS: readonly ChatImportTool[] = ["claude-code", "codex", "opencode"];
/** A session file larger than this is skipped: it is mostly tool output, and reading it would stall the scan. */
const MAX_FILE_BYTES = 48 * 1024 * 1024;
const MAX_EXPORT_BYTES = 256 * 1024 * 1024;

type Loader = () => Promise<ImportedChat | null>;
/** What the last scan found, by key, so an import reads exactly what was listed. */
const found = new Map<string, Loader>();
/** Conversations from a chosen export file, held until the person picks which to keep. */
const loaded = new Map<string, ImportedChat>();

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
export const importedSessionId = (source: ChatImportSource, sourceId: string): string => `imp-${hash(`${source}\n${sourceId}`).slice(0, 24)}`;

interface Candidate { readonly path: string; readonly modified: number; readonly size: number }

/** The newest `limit` of these files, leaving out any not touched since `since` (ms, 0 for any time). */
async function newest(files: readonly string[], limit = MAX_PER_SOURCE, since = 0): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const path of files) {
    try {
      const info = await stat(path);
      if (info.isFile() && info.mtimeMs >= since) out.push({ path, modified: info.mtimeMs, size: info.size });
    } catch {
      // Gone since it was listed.
    }
  }
  return out.sort((a, b) => b.modified - a.modified).slice(0, limit);
}

/** The scan options a person chose, held to their limits. The renderer is not trusted with sizes. */
export function scanLimits(options: ChatImportScanOptions | undefined, now: number): { tools: readonly ChatImportTool[]; perTool: number; since: number; onlyCurrentProject: boolean } {
  const chosen = options?.tools;
  const tools = Array.isArray(chosen) ? ALL_TOOLS.filter((tool) => chosen.includes(tool)) : ALL_TOOLS;
  const per = typeof options?.perTool === "number" && Number.isFinite(options.perTool) ? Math.round(options.perTool) : MAX_PER_SOURCE;
  const days = typeof options?.sinceDays === "number" && Number.isFinite(options.sinceDays) && options.sinceDays > 0 ? Math.min(options.sinceDays, 3_650) : null;
  return {
    tools,
    perTool: Math.max(10, Math.min(MAX_PER_SOURCE_CHOSEN, per)),
    since: days === null ? 0 : now - days * 86_400_000,
    onlyCurrentProject: options?.onlyCurrentProject === true,
  };
}

async function list(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true })).filter((entry) => !entry.isSymbolicLink()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function claudeCodeFiles(home: string): Promise<string[]> {
  const root = join(home, ".claude", "projects");
  const out: string[] = [];
  for (const folder of await list(root)) {
    for (const name of await list(join(root, folder))) if (name.endsWith(".jsonl")) out.push(join(root, folder, name));
  }
  return out;
}

async function codexFiles(home: string): Promise<string[]> {
  const root = join(home, ".codex", "sessions");
  const out: string[] = [];
  // sessions/<year>/<month>/<day>/rollout-*.jsonl: exactly three levels, never a free crawl.
  for (const year of await list(root)) for (const month of await list(join(root, year))) for (const day of await list(join(root, year, month))) {
    for (const name of await list(join(root, year, month, day))) if (name.endsWith(".jsonl")) out.push(join(root, year, month, day, name));
  }
  return out;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function openCodeSessions(home: string): Promise<{ file: string; storage: string }[]> {
  const storage = join(home, ".local", "share", "opencode", "storage");
  const out: { file: string; storage: string }[] = [];
  for (const project of await list(join(storage, "session"))) {
    for (const name of await list(join(storage, "session", project))) if (name.endsWith(".json")) out.push({ file: join(storage, "session", project, name), storage });
  }
  return out;
}

async function loadOpenCode(file: string, storage: string): Promise<ImportedChat | null> {
  const info = await readJson(file);
  const id = typeof (info as { id?: unknown } | null)?.id === "string" ? (info as { id: string }).id : "";
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(id)) return null;
  const messages: OpenCodeMessage[] = [];
  for (const name of (await list(join(storage, "message", id))).slice(0, 2000)) {
    const message = await readJson(join(storage, "message", id, name)) as { id?: unknown; role?: unknown; time?: { created?: unknown } } | null;
    if (message === null || typeof message.id !== "string" || typeof message.role !== "string" || !/^[A-Za-z0-9_-]{1,96}$/.test(message.id)) continue;
    const parts: string[] = [];
    for (const part of (await list(join(storage, "part", message.id))).sort()) {
      const body = openCodePartText(await readJson(join(storage, "part", message.id, part)));
      if (body !== "") parts.push(body);
    }
    messages.push({ role: message.role, at: typeof message.time?.created === "number" ? message.time.created : 0, parts });
  }
  return buildOpenCodeSession(info, messages);
}

function entryFor(key: string, chat: ImportedChat, imported = false): ChatImportEntry {
  return { key, source: chat.source, sourceName: CHAT_IMPORT_SOURCES[chat.source], title: chat.title, folder: chat.cwd, updatedAt: chat.updatedAt, messages: chat.messages.length, ...(imported ? { imported } : {}) };
}

/** Whether this conversation is already an ADCode conversation, in its own folder or the open one. */
async function alreadyImported(chat: ImportedChat, currentRoot: string | null): Promise<boolean> {
  const id = importedSessionId(chat.source, chat.sourceId);
  if (chat.cwd !== null && await sessionExists(chat.cwd, id)) return true;
  return sessionExists(currentRoot, id);
}

/**
 * Look in the known places of the tools chosen (all three when none are named), as far back
 * and as many as chosen. Replaces what the last scan found.
 */
export async function scanChatImports(home: string, options?: ChatImportScanOptions, currentRoot: string | null = null, now = Date.now()): Promise<ChatImportScan> {
  found.clear();
  const limits = scanLimits(options, now);
  const entries: ChatImportEntry[] = [];
  let skipped = 0;
  const inScope = (chat: ImportedChat): boolean => !limits.onlyCurrentProject || (currentRoot !== null && chat.cwd !== null && sameWorkspace(chat.cwd, currentRoot));
  const take = async (source: ChatImportSource, path: string, load: Loader): Promise<void> => {
    const chat = await load().catch(() => null);
    if (chat === null || !inScope(chat)) return;
    const key = `${source}:${hash(path).slice(0, 20)}`;
    found.set(key, load);
    entries.push(entryFor(key, chat, await alreadyImported(chat, currentRoot)));
  };
  const lists = [
    ["claude-code", claudeCodeFiles, parseClaudeCodeSession],
    ["codex", codexFiles, parseCodexSession],
  ] as const;
  for (const [source, files, parse] of lists) {
    if (!limits.tools.includes(source)) continue;
    for (const file of await newest(await files(home), limits.perTool, limits.since)) {
      if (file.size > MAX_FILE_BYTES) { skipped += 1; continue; }
      await take(source, file.path, async () => parse(await readFile(file.path, "utf8"), hash(file.path).slice(0, 24)));
    }
  }
  if (limits.tools.includes("opencode")) {
    const openCode = await openCodeSessions(home);
    const order = await newest(openCode.map((item) => item.file), limits.perTool, limits.since);
    for (const file of order) {
      const storage = openCode.find((item) => item.file === file.path)?.storage;
      if (storage !== undefined) await take("opencode", file.path, () => loadOpenCode(file.path, storage));
    }
  }
  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  const places: readonly { readonly source: ChatImportTool; readonly location: string; readonly path: string }[] = [
    { source: "claude-code", location: "~/.claude/projects", path: join(home, ".claude", "projects") },
    { source: "codex", location: "~/.codex/sessions", path: join(home, ".codex", "sessions") },
    { source: "opencode", location: "~/.local/share/opencode/storage", path: join(home, ".local", "share", "opencode", "storage") },
  ];
  const locations = places.filter((place) => limits.tools.includes(place.source));
  const present = await Promise.all(locations.map((place) => stat(place.path).then((info) => info.isDirectory(), () => false)));
  const projects = await projectsOf(entries);
  const reports: ChatImportSourceReport[] = locations.map((place, index) => {
    const mine = entries.filter((entry) => entry.source === place.source);
    return { name: CHAT_IMPORT_SOURCES[place.source], location: place.location, present: present[index] === true, conversations: mine.length, projects: new Set(mine.map((entry) => entry.folder ?? "")).size };
  });
  return { entries, skipped, sources: [...new Set(entries.map((entry) => entry.sourceName))], projects, found: reports };
}

/**
 * The folders the conversations happened in, each once: which tools worked there, how much,
 * when last, and whether the folder is still on this computer (a project may have moved).
 */
export async function projectsOf(entries: readonly ChatImportEntry[]): Promise<ChatImportProject[]> {
  const byFolder = new Map<string, { folder: string; sources: Map<string, number>; conversations: number; lastUsed: number }>();
  for (const entry of entries) {
    if (entry.folder === null) continue;
    const key = process.platform === "win32" ? entry.folder.toLowerCase() : entry.folder;
    const project = byFolder.get(key) ?? { sources: new Map<string, number>(), conversations: 0, lastUsed: 0, folder: entry.folder };
    project.sources.set(entry.sourceName, (project.sources.get(entry.sourceName) ?? 0) + 1);
    project.conversations += 1;
    project.lastUsed = Math.max(project.lastUsed, entry.updatedAt);
    byFolder.set(key, project);
  }
  const projects = await Promise.all([...byFolder.values()].slice(0, 200).map(async (project) => {
    const folder = project.folder;
    const exists = await stat(folder).then((info) => info.isDirectory(), () => false);
    return {
      folder,
      name: basename(folder.replace(/[\\/]+$/, "")) || folder,
      exists,
      sources: [...project.sources].map(([name, conversations]) => ({ name, conversations })).sort((a, b) => b.conversations - a.conversations),
      conversations: project.conversations,
      lastUsed: project.lastUsed,
    };
  }));
  return projects.sort((a, b) => Number(b.exists) - Number(a.exists) || b.lastUsed - a.lastUsed);
}

/** Read a chosen export file and list what is in it. Nothing is saved yet. */
export async function readChatExport(path: string, currentRoot: string | null = null): Promise<ChatImportScan> {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_EXPORT_BYTES) throw new Error("That file is too large to import, or is not a file.");
  const chats = parseExportFile(await readJson(path));
  if (chats.length === 0) throw new Error("No conversations were found in that file. Choose a conversations.json exported from Claude or ChatGPT, or a conversation exported from ADCode as JSON.");
  loaded.clear();
  const entries = (await Promise.all(chats.map(async (chat) => {
    const key = `${chat.source}:${hash(chat.sourceId).slice(0, 20)}`;
    loaded.set(key, chat);
    return entryFor(key, chat, await alreadyImported(chat, currentRoot));
  }))).sort((a, b) => b.updatedAt - a.updatedAt);
  return { entries, skipped: 0, sources: [...new Set(entries.map((entry) => entry.sourceName))] };
}

/** Session files under a chosen folder: `.jsonl` (Claude Code, Codex) and `.json` (exports), never through a link. */
async function folderFiles(root: string): Promise<{ jsonl: string[]; json: string[] }> {
  const jsonl: string[] = [], json: string[] = [];
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > FOLDER_DEPTH || jsonl.length + json.length >= FOLDER_FILES) return;
    let items;
    try { items = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
      if (jsonl.length + json.length >= FOLDER_FILES) return;
      if (item.isSymbolicLink()) continue;
      const path = join(directory, item.name);
      if (item.isDirectory()) {
        if (item.name === "node_modules" || item.name === ".git") continue;
        await walk(path, depth + 1);
      } else if (item.isFile()) {
        if (item.name.endsWith(".jsonl")) jsonl.push(path);
        else if (item.name.endsWith(".json")) json.push(path);
      }
    }
  };
  await walk(root, 0);
  return { jsonl, json };
}

/**
 * Everything importable in a folder somebody chose: a copy of another computer's
 * `~/.claude/projects` or `~/.codex/sessions`, or session files a teammate sent. Each
 * `.jsonl` is read as Claude Code's, then Codex's; each `.json` as an export file. Only
 * this folder and the ones inside it are read, and nothing is saved until the person chooses.
 */
export async function scanChatFolder(root: string, currentRoot: string | null = null): Promise<ChatImportScan> {
  found.clear();
  loaded.clear();
  const info = await stat(root).catch(() => null);
  if (info === null || !info.isDirectory()) throw new Error("That folder could not be opened.");
  const { jsonl, json } = await folderFiles(root);
  const entries: ChatImportEntry[] = [];
  let skipped = 0;
  for (const file of await newest(jsonl, MAX_PER_SOURCE_CHOSEN)) {
    if (file.size > MAX_FILE_BYTES) { skipped += 1; continue; }
    const fallback = hash(file.path).slice(0, 24);
    const load: Loader = async () => {
      const body = await readFile(file.path, "utf8");
      return parseClaudeCodeSession(body, fallback) ?? parseCodexSession(body, fallback);
    };
    const chat = await load().catch(() => null);
    if (chat === null) continue;
    const key = `${chat.source}:${hash(file.path).slice(0, 20)}`;
    found.set(key, load);
    entries.push(entryFor(key, chat, await alreadyImported(chat, currentRoot)));
  }
  for (const file of await newest(json, 200)) {
    if (file.size > MAX_EXPORT_BYTES) { skipped += 1; continue; }
    for (const chat of parseExportFile(await readJson(file.path))) {
      const key = `${chat.source}:${hash(`${file.path}\n${chat.sourceId}`).slice(0, 20)}`;
      loaded.set(key, chat);
      entries.push(entryFor(key, chat, await alreadyImported(chat, currentRoot)));
    }
  }
  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  const projects = await projectsOf(entries);
  const report: ChatImportSourceReport = { name: "Chosen folder", location: root, present: true, conversations: entries.length, projects: new Set(entries.map((entry) => entry.folder ?? "")).size };
  return { entries, skipped, sources: [...new Set(entries.map((entry) => entry.sourceName))], projects, found: [report] };
}

/** The opening of one listed conversation, clipped: a look before importing, read only on request. */
export async function previewChatImport(key: string): Promise<ChatImportPreview | null> {
  const chat = loaded.get(key) ?? await found.get(key)?.().catch(() => null) ?? null;
  if (chat === null) return null;
  return {
    title: chat.title,
    total: chat.messages.length,
    messages: chat.messages.slice(0, PREVIEW_MESSAGES).map((message) => ({
      role: message.role === "assistant" ? "assistant" as const : "user" as const,
      text: message.text.length > PREVIEW_CHARS ? `${message.text.slice(0, PREVIEW_CHARS).trimEnd()}…` : message.text,
    })),
  };
}

/**
 * Save the chosen conversations as ADCode sessions. `own-folder` files each under the
 * project it happened in, so it is there when that folder is opened; `current` puts them
 * all in the project open now. A conversation with no folder of its own goes to the current
 * one either way.
 */
export async function importChats(keys: readonly string[], target: "own-folder" | "current", currentRoot: string | null, options: ChatImportOptions = {}): Promise<ChatImportResult> {
  let imported = 0;
  let failed = 0;
  let skipped = 0;
  const folders = new Set<string>();
  const wanted = options.lastMessages;
  const keep = typeof wanted === "number" && Number.isFinite(wanted) && wanted > 0 ? Math.max(2, Math.min(600, Math.round(wanted))) : null;
  for (const key of [...new Set(keys)].slice(0, 400)) {
    const chat = loaded.get(key) ?? await found.get(key)?.().catch(() => null) ?? null;
    if (chat === null) { failed += 1; continue; }
    const workspace = target === "own-folder" && chat.cwd !== null ? chat.cwd : currentRoot;
    const id = importedSessionId(chat.source, chat.sourceId);
    if (options.skipImported === true && await sessionExists(workspace, id)) { skipped += 1; continue; }
    const kept = keep === null || chat.messages.length <= keep ? chat : { ...chat, messages: chat.messages.slice(-keep) };
    await writeSession(workspace, importedSession(kept, id, Date.now()));
    imported += 1;
    if (workspace !== null) folders.add(workspace);
  }
  return { imported, failed, skipped, folders: [...folders].slice(0, 50), here: currentRoot !== null && folders.has(currentRoot) };
}
