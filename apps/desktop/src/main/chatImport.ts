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
import { join } from "node:path";
import type { ChatImportEntry, ChatImportResult, ChatImportScan } from "../shared/api.ts";
import { writeSession } from "./aiSessions.ts";
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

/** Newest conversations per tool; enough to move in, few enough to scan in seconds. */
const MAX_PER_SOURCE = 150;
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

async function newest(files: readonly string[]): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const path of files) {
    try {
      const info = await stat(path);
      if (info.isFile()) out.push({ path, modified: info.mtimeMs, size: info.size });
    } catch {
      // Gone since it was listed.
    }
  }
  return out.sort((a, b) => b.modified - a.modified).slice(0, MAX_PER_SOURCE);
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

function entryFor(key: string, chat: ImportedChat): ChatImportEntry {
  return { key, source: chat.source, sourceName: CHAT_IMPORT_SOURCES[chat.source], title: chat.title, folder: chat.cwd, updatedAt: chat.updatedAt, messages: chat.messages.length };
}

/** Look in the three known places. Replaces what the last scan found. */
export async function scanChatImports(home: string): Promise<ChatImportScan> {
  found.clear();
  const entries: ChatImportEntry[] = [];
  let skipped = 0;
  const take = async (source: ChatImportSource, path: string, load: Loader): Promise<void> => {
    const chat = await load().catch(() => null);
    if (chat === null) return;
    const key = `${source}:${hash(path).slice(0, 20)}`;
    found.set(key, load);
    entries.push(entryFor(key, chat));
  };
  for (const [source, files, parse] of [
    ["claude-code", await claudeCodeFiles(home), parseClaudeCodeSession],
    ["codex", await codexFiles(home), parseCodexSession],
  ] as const) {
    for (const file of await newest(files)) {
      if (file.size > MAX_FILE_BYTES) { skipped += 1; continue; }
      await take(source, file.path, async () => parse(await readFile(file.path, "utf8"), hash(file.path).slice(0, 24)));
    }
  }
  const openCode = await openCodeSessions(home);
  const order = await newest(openCode.map((item) => item.file));
  for (const file of order) {
    const storage = openCode.find((item) => item.file === file.path)?.storage;
    if (storage !== undefined) await take("opencode", file.path, () => loadOpenCode(file.path, storage));
  }
  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  return { entries, skipped, sources: [...new Set(entries.map((entry) => entry.sourceName))] };
}

/** Read a chosen export file and list what is in it. Nothing is saved yet. */
export async function readChatExport(path: string): Promise<ChatImportScan> {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_EXPORT_BYTES) throw new Error("That file is too large to import, or is not a file.");
  const chats = parseExportFile(await readJson(path));
  if (chats.length === 0) throw new Error("No conversations were found in that file. Choose a conversations.json exported from Claude or ChatGPT, or a conversation exported from ADCode as JSON.");
  loaded.clear();
  const entries = chats.map((chat) => {
    const key = `${chat.source}:${hash(chat.sourceId).slice(0, 20)}`;
    loaded.set(key, chat);
    return entryFor(key, chat);
  }).sort((a, b) => b.updatedAt - a.updatedAt);
  return { entries, skipped: 0, sources: [...new Set(entries.map((entry) => entry.sourceName))] };
}

/**
 * Save the chosen conversations as ADCode sessions. `own-folder` files each under the
 * project it happened in, so it is there when that folder is opened; `current` puts them
 * all in the project open now. A conversation with no folder of its own goes to the current
 * one either way.
 */
export async function importChats(keys: readonly string[], target: "own-folder" | "current", currentRoot: string | null): Promise<ChatImportResult> {
  let imported = 0;
  let failed = 0;
  const folders = new Set<string>();
  for (const key of [...new Set(keys)].slice(0, 400)) {
    const chat = loaded.get(key) ?? await found.get(key)?.().catch(() => null) ?? null;
    if (chat === null) { failed += 1; continue; }
    const workspace = target === "own-folder" && chat.cwd !== null ? chat.cwd : currentRoot;
    await writeSession(workspace, importedSession(chat, importedSessionId(chat.source, chat.sourceId), Date.now()));
    imported += 1;
    if (workspace !== null) folders.add(workspace);
  }
  return { imported, failed, folders: [...folders].slice(0, 50), here: currentRoot !== null && folders.has(currentRoot) };
}
