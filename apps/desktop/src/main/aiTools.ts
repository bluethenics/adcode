/**
 * The tool runner: where the agent's tool calls meet the actual machine.
 *
 * Two rules shape this file.
 *
 * §5.3: "Nothing is ever written to disk unseen." `propose_edit` writes only into an
 * isolated task sandbox. It computes a diff and hands it to the renderer; the human file
 * changes only through the checkpointed apply service after review.
 *
 * §1: the renderer is hostile, and so, for this purpose, is model output. Every path a
 * tool touches goes through the same `isInsideWorkspace` confinement as an IPC call -
 * a model that has read a prompt-injected instruction is exactly the attacker that check
 * exists for.
 */
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { computeHunks, type AiFileChange, type ImageMediaType, type ToolCallBlock, type ToolRunner, type ToolRunResult } from "@adcode/ai";
import type { NodeMemory } from "@adcode/memory";
import { loadDirectoryFilter, type DirectoryFilter } from "@adcode/search";
import { resolveSandboxPath } from "./aiSandbox.ts";
import { clipOutput, createCommandRunner, looksLikeServer, timeoutFrom, MAX_TIMEOUT_SECONDS, type CommandReading, type CommandRunner } from "./aiCommands.ts";
import { parseViewPageInput, type ViewPageRequest } from "./agentBrowserModel.ts";
import { htmlToText, looksLikeHtml } from "./htmlText.ts";
import type { PreviewStatus } from "../shared/api.ts";

/** Read in full by default; larger files page 2,000 lines at a time. */
const MAX_READ_BYTES = 400_000;
/** The largest file read_file pages through, search scans, or delete and move keep for Undo. */
const MAX_PAGED_BYTES = 20_000_000;
const MAX_UNDO_BYTES = 10_000_000;
/** Anthropic's per-image cap is 5 MB of base64, which this leaves room under. */
const MAX_IMAGE_BYTES = 3_500_000;
const MAX_LINE_CHARS = 2_000;
const DEFAULT_SEARCH_HITS = 80;
const MAX_SEARCH_HITS = 300;
const MAX_GLOB_HITS = 500;
const MAX_OUTLINE_SYMBOLS = 200;
const MAX_OUTPUT_CHARS = 24_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_MOVED_FILES = 500;

const IMAGE_TYPES: Readonly<Record<string, ImageMediaType>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** A file is text when its start has no NUL byte - git's own test, and right in practice. */
function isText(bytes: Buffer): boolean {
  return !bytes.subarray(0, 8_000).includes(0);
}

export interface PlanStep {
  readonly step: string;
  readonly status: "pending" | "in_progress" | "done";
}

/** `update_plan` input as steps, or what is wrong with it. */
export function parsePlan(input: Record<string, unknown>): PlanStep[] | string {
  const steps = input["steps"];
  if (!Array.isArray(steps) || steps.length === 0) return 'update_plan needs steps: [{"step": "Add the header", "status": "in_progress"}, ...].';
  if (steps.length > 12) return "Keep the plan to 12 steps or fewer; group small ones.";
  const parsed: PlanStep[] = [];
  for (const [index, raw] of steps.entries()) {
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const step = typeof record["step"] === "string" ? record["step"].trim() : "";
    const status = record["status"];
    if (step.length === 0 || step.length > 200) return `Step ${index + 1} needs a short description (1-200 characters).`;
    if (status !== "pending" && status !== "in_progress" && status !== "done") return `Step ${index + 1}'s status must be pending, in_progress or done.`;
    parsed.push({ step, status });
  }
  if (parsed.filter((step) => step.status === "in_progress").length > 1) return "Only one step can be in_progress at a time.";
  return parsed;
}

/** Commands that are never worth the risk, whatever the workspace. */
const BLOCKED_COMMANDS = [
  "rm -rf /",
  "rm -rf ~",
  "rm -rf c:",
  "format c:",
  "mkfs",
  "shutdown",
  "reboot",
  ":(){:|:&};",
  "del /f /s /q c:",
];

export interface ProposedEdit {
  readonly taskId: string;
  readonly relativePath: string;
  readonly path: string;
  readonly summary: string;
  readonly original: string;
  readonly proposed: string;
  readonly hunks: ReturnType<typeof computeHunks>;
}

export interface AiToolWorkspace {
  readonly taskId: string;
  readonly sandboxRoot: string;
  readonly humanRoot: string;
}

export interface AiToolDeps {
  /** Start or reuse the live preview and resolve `path` on it. */
  readonly openPreview?: (path: string | null) => Promise<{ readonly status: PreviewStatus; readonly page: string | null }>;
  /** Load a page in the agent's browser and report it. Unset where there is no browser. */
  readonly viewPage?: (request: ViewPageRequest, signal: AbortSignal) => Promise<ToolRunResult>;
  /**
   * Where background commands live, so they outlive one tool call. Unset for agents that
   * work in an isolated copy: their commands run in the foreground only.
   */
  readonly backgroundCommands?: CommandRunner;
  /** Keep a deletion or move for the turn's Undo; `after` null is a deletion. */
  readonly recordUndo?: (path: string, before: string | null, after: string | null, encoding: "utf8" | "base64") => void;
  /** Files appeared, moved or went away, so the Explorer can refresh. */
  readonly onFilesChanged?: (paths: readonly string[]) => void;
  /** File reads resolve here without creating anything. */
  readonly workspace: () => Promise<AiToolWorkspace | null>;
  /**
   * File edits and commands resolve here, starting the isolated task on first
   * use. Falls back to `workspace` when unset (tests); the app always sets it,
   * so a plain question stays chat while the first edit creates the task.
   */
  readonly writeWorkspace?: () => Promise<AiToolWorkspace | null>;
  /**
   * When true, edits apply straight to the project and the result says so. A function is
   * read on every edit, so switching approval mode mid-conversation takes effect at once.
   * Team lanes leave this unset: their sandbox message stays accurate.
   */
  readonly directWrites?: boolean | (() => boolean);
  /** Fired after a command finishes, so the Explorer can refresh. */
  readonly onCommandFinished?: () => void;
  readonly workspaceUnavailableMessage?: () => string;
  /** Trusted still means sandbox first; only the successful turn's checkpointed apply is automatic. */
  readonly reviewPolicy?: () => "review" | "trusted";
  readonly memory: () => NodeMemory | null;
  readonly writeSandboxFile: (path: string, contents: string) => Promise<AiFileChange>;
  /** Called when the agent proposes an edit, so the renderer can show the diff. */
  readonly onProposedEdit: (edit: ProposedEdit) => void;
}

const ok = (content: string): ToolRunResult => ({ content, isError: false });
const fail = (content: string): ToolRunResult => ({ content, isError: true });

/** Normalize model path spellings before the strict sandbox containment check. */
async function resolveInWorkspace(workspace: AiToolWorkspace, input: unknown): Promise<string | null> {
  if (typeof input !== "string" || input.includes("\u0000")) return null;
  const parts = input.replaceAll("\\", "/").split("/");
  // Never normalize traversal away, even when it would end up inside the project.
  if (parts.includes("..")) return null;
  let portable = input;
  if (isAbsolute(input)) {
    // The model sees the human root in its context. Map paths under that root into
    // the active sandbox, so review mode cannot accidentally write the live file.
    portable = relative(workspace.humanRoot, input);
    if (isAbsolute(portable) || portable === ".." || portable.startsWith(`..${sep}`)) return null;
  } else if (/^[A-Za-z]:/.test(input)) {
    // A drive-relative Windows path (C:foo) must not use a drive's implicit cwd.
    return null;
  }
  portable = portable.replaceAll("\\", "/").split("/").filter((part) => part !== "." && part !== "").join("/");
  try {
    return await resolveSandboxPath(workspace.sandboxRoot, portable);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") throw new Error("Workspace path lookup failed (ENOENT): the project folder or a linked folder is missing. Reopen the project before retrying.");
    if (code === "EACCES" || code === "EPERM") throw new Error(`Workspace path lookup failed (${code}): the operating system denied access. Check the project folder's access permissions before retrying.`);
    if (typeof code === "string" && /^[A-Z_]+$/.test(code)) throw new Error(`Workspace path lookup failed (${code}). Check that the project folder is accessible before retrying.`);
    return null;
  }
}

const INVALID_WORKSPACE_PATH =
  'Could not resolve that path inside the open workspace. Use a workspace-relative path such as "src/main.ts", without a drive letter, leading slash, or "..". Call list_files with no path to inspect the workspace, then retry with a corrected path. Links pointing outside the workspace are not allowed.';

/**
 * The root-path fix: models ask for the workspace root as "", ".", "./", or "/"
 * far more often than as an omitted field. Treat every spelling as the root
 * instead of failing with "outside the open workspace".
 */
function isRootAlias(input: unknown): boolean {
  if (input === undefined || input === null) return true;
  if (typeof input !== "string") return false;
  const trimmed = input.trim().replaceAll("\\", "/");
  return trimmed === "" || trimmed === "." || trimmed === "./" || trimmed === "/";
}

async function resolveDirOrRoot(workspace: AiToolWorkspace, input: unknown): Promise<string | null> {
  if (isRootAlias(input)) return workspace.sandboxRoot;
  return resolveInWorkspace(workspace, input);
}

const truncateOutput = (text: string): string =>
  text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n[Truncated at 24,000 characters. Narrow the query for more detail.]`
    : text;

/**
 * A small glob (`*`, `**`, `?`, `{a,b}`) over workspace-relative posix paths.
 * Enough for `**\/*.{png,jpg,svg}` without a dependency.
 */
function globToRegExp(glob: string): RegExp | null {
  let source = "";
  let i = 0;
  const pattern = glob.replaceAll("\\", "/").trim();
  if (pattern.length === 0 || pattern.length > 512) return null;
  while (i < pattern.length) {
    const char = pattern[i]!;
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        const after = pattern[i + 2];
        if (after === "/") {
          source += "(?:.*/)?";
          i += 3;
        } else {
          source += ".*";
          i += 2;
        }
      } else {
        source += "[^/]*";
        i += 1;
      }
    } else if (char === "?") {
      source += "[^/]";
      i += 1;
    } else if (char === "{") {
      const end = pattern.indexOf("}", i);
      if (end === -1) return null;
      const group = pattern
        .slice(i + 1, end)
        .split(",")
        .map((part) => part.trim().replace(/[.+^${}()|[\]\\]/g, "\\$&"))
        .join("|");
      source += `(?:${group})`;
      i = end + 1;
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  try {
    return new RegExp(`^(?:${source})$`, "i");
  } catch {
    return null;
  }
}

const OUTLINE_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/^\s*(?:export\s+)?(?:async\s+)?function\s+([\w$]+)/, "function"],
  [/^\s*(?:export\s+)?(?:abstract\s+)?class\s+([\w$]+)/, "class"],
  [/^\s*(?:export\s+)?interface\s+([\w$]+)/, "interface"],
  [/^\s*(?:export\s+)?type\s+([\w$]+)\s*=/, "type"],
  [/^\s*(?:export\s+)?enum\s+([\w$]+)/, "enum"],
  [/^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/, "function"],
  [/^\s*def\s+(\w+)\s*\(/, "function"],
  [/^\s*class\s+(\w+)/, "class"],
  [/^(#{1,6})\s+(.+?)\s*$/, "heading"],
];

function outlineOf(text: string): string[] {
  const found: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length && found.length < MAX_OUTLINE_SYMBOLS; i++) {
    const line = lines[i]!;
    for (const [pattern, kind] of OUTLINE_PATTERNS) {
      const match = pattern.exec(line);
      if (match === null) continue;
      const name = (match[1] ?? "").trim().slice(0, 120);
      if (name.length === 0) continue;
      found.push(`${i + 1}: ${kind} ${name}`);
      break;
    }
  }
  return found;
}

interface Replacement {
  readonly oldString: string;
  readonly newString: string;
  readonly replaceAll: boolean;
}

/** Read `edit_file` input as a list of replacements, or explain what is wrong with it. */
function replacementsOf(input: Record<string, unknown>): Replacement[] | string {
  const one = (value: Record<string, unknown>, where: string): Replacement | string => {
    const oldString = value["old_string"];
    const newString = value["new_string"];
    if (typeof oldString !== "string" || typeof newString !== "string") {
      return `${where} needs old_string and new_string as text.`;
    }
    if (oldString === newString) return `${where} has identical old_string and new_string; nothing would change.`;
    return { oldString, newString, replaceAll: value["replace_all"] === true };
  };
  if (Array.isArray(input["edits"]) && input["edits"].length > 0) {
    if (input["edits"].length > 50) return "edit_file takes at most 50 edits per call.";
    const list: Replacement[] = [];
    for (const [index, value] of input["edits"].entries()) {
      if (typeof value !== "object" || value === null) return `Edit ${index + 1} is not an object.`;
      const parsed = one(value as Record<string, unknown>, `Edit ${index + 1}`);
      if (typeof parsed === "string") return parsed;
      list.push(parsed);
    }
    return list;
  }
  const single = one(input, "edit_file");
  return typeof single === "string" ? single : [single];
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

/** The line a near-miss probably meant, so a failed match comes back with somewhere to look. */
function closestLine(text: string, needle: string): number | null {
  const probe = needle.split("\n").map((line) => line.trim()).find((line) => line.length >= 3);
  if (probe === undefined) return null;
  const index = text.split("\n").findIndex((line) => line.includes(probe));
  return index === -1 ? null : index + 1;
}

const leadingSpace = (line: string): string => /^[ \t]*/.exec(line)?.[0] ?? "";

/**
 * Find `oldString` line by line, ignoring each line's indentation and trailing spaces.
 *
 * The commonest way a model's edit misses is whitespace: two spaces where the file has four,
 * a tab where it has spaces, a trailing space read_file never showed. The words are right,
 * and failing the edit sends the model back to re-read and retry. When exactly one block of
 * the file matches line by line, that block is the one it meant. The replacement is
 * re-indented by the same difference, so the new lines sit where the old ones did instead of
 * carrying the model's wrong indentation into the file.
 *
 * Returns null unless the match is unique: guessing between two places would edit the wrong
 * one silently, which is worse than failing.
 */
export function looseReplace(text: string, oldString: string, newString: string): { text: string; line: number } | null {
  const fileLines = text.split("\n");
  const wanted = oldString.split("\n");
  while (wanted.length > 1 && wanted[wanted.length - 1]!.trim() === "") wanted.pop();
  while (wanted.length > 1 && wanted[0]!.trim() === "") wanted.shift();
  if (wanted.every((line) => line.trim() === "")) return null;
  const key = (line: string): string => line.trim();
  const matches: number[] = [];
  for (let start = 0; start + wanted.length <= fileLines.length; start++) {
    if (wanted.every((line, offset) => key(fileLines[start + offset]!) === key(line))) {
      matches.push(start);
      if (matches.length > 1) return null;
    }
  }
  const start = matches[0];
  if (start === undefined) return null;

  const firstWanted = wanted.findIndex((line) => line.trim() !== "");
  const theirs = leadingSpace(wanted[firstWanted]!);
  const ours = leadingSpace(fileLines[start + firstWanted]!);
  const replacement = newString.split("\n").map((line) => {
    if (line.trim() === "") return line.trimEnd();
    return line.startsWith(theirs) ? `${ours}${line.slice(theirs.length)}` : line;
  });
  fileLines.splice(start, wanted.length, ...replacement);
  return { text: fileLines.join("\n"), line: start + 1 };
}

/**
 * Apply replacements to a file's text, in order, all or nothing.
 *
 * Line endings are normalised first. read_file shows a CRLF file's lines without their
 * carriage returns, so a model copying text out of it sends bare newlines - and on Windows,
 * where most checked-out files are CRLF, an exact matcher would miss nearly every edit.
 */
export function applyReplacements(
  original: string,
  replacements: readonly Replacement[],
  relativePath: string,
): { ok: true; text: string; notes: string[] } | { ok: false; message: string } {
  const crlf = original.includes("\r\n");
  let text = crlf ? original.replaceAll("\r\n", "\n") : original;
  const notes: string[] = [];
  for (const [index, replacement] of replacements.entries()) {
    const label = replacements.length === 1 ? "old_string" : `Edit ${index + 1}'s old_string`;
    const oldString = replacement.oldString.replaceAll("\r\n", "\n");
    const newString = replacement.newString.replaceAll("\r\n", "\n");
    if (oldString.length === 0) {
      if (text.length > 0) return { ok: false, message: `${label} is empty, but ${relativePath} already has contents. Quote the text to replace, or use propose_edit to rewrite the file.` };
      text = newString;
      continue;
    }
    const count = countOccurrences(text, oldString);
    if (count === 0 && !replacement.replaceAll) {
      const loose = looseReplace(text, oldString, newString);
      if (loose !== null) {
        text = loose.text;
        notes.push(`${label} matched at line ${loose.line} once indentation and trailing spaces were ignored`);
        continue;
      }
    }
    if (count === 0) {
      const near = closestLine(text, oldString);
      return {
        ok: false,
        message: `${label} was not found in ${relativePath}. Copy it exactly from read_file output, without line numbers${near === null ? "" : ` - the closest match starts near line ${near}`}. Nothing was changed.`,
      };
    }
    if (count > 1 && !replacement.replaceAll) {
      return {
        ok: false,
        message: `${label} matches ${count} places in ${relativePath}. Add surrounding lines to make it unique, or pass replace_all: true. Nothing was changed.`,
      };
    }
    text = replacement.replaceAll ? text.split(oldString).join(newString) : text.replace(oldString, () => newString);
  }
  return { ok: true, text: crlf ? text.replaceAll("\n", "\r\n") : text, notes };
}

/** Grep-style lines: the match with `:`, its context with `-`, and `--` between groups. */
function searchLines(relativePath: string, lines: readonly string[], hits: readonly number[], context: number): string[] {
  const out: string[] = [];
  let last = -1;
  for (const hit of hits) {
    const from = Math.max(0, hit - context);
    const to = Math.min(lines.length - 1, hit + context);
    if (context > 0 && last !== -1 && from > last + 1) out.push("--");
    for (let index = Math.max(from, last + 1); index <= to; index++) {
      const text = lines[index]!.trim();
      const shown = text.length > 300 ? `${text.slice(0, 300)}…` : text;
      out.push(`${relativePath}${index === hit ? ":" : "-"}${index + 1}${index === hit ? ":" : "-"} ${shown}`);
    }
    last = to;
  }
  return out;
}

/** A background command's reading, as the model sees it. */
function describeReading(reading: CommandReading): string {
  const state = reading.running ? "still running" : `exited with code ${reading.exitCode ?? "unknown"}`;
  const url = reading.url === null ? "" : ` It printed the address ${reading.url} - view_page {"url": "${reading.url}"} looks at it.`;
  const output = reading.output.trim().length === 0 ? "(no new output)" : clipOutput(reading.output.trim());
  return `${reading.id} (${reading.command}) is ${state}.${url}\n${output}`;
}

export function createAiToolRunner(deps: AiToolDeps): ToolRunner {
  const unavailable = (): ReturnType<typeof fail> =>
    fail(deps.workspaceUnavailableMessage?.() ?? "No folder is open, so there is nothing to work on yet.");
  /** Edits and commands start the isolated task; reads never do. */
  const writeWorkspace = deps.writeWorkspace ?? deps.workspace;
  /** Foreground commands need no registry that outlives the call; background ones do. */
  const commands = deps.backgroundCommands ?? createCommandRunner();
  const direct = (): boolean => deps.directWrites === true || (typeof deps.directWrites === "function" && deps.directWrites());
  const relativeTo = (workspace: AiToolWorkspace, path: string): string => relative(workspace.sandboxRoot, path).split(sep).join("/");

  /** Stage a whole-file proposal in the sandbox and hand its diff to the renderer. */
  async function stageProposal(
    workspace: AiToolWorkspace,
    path: string,
    proposed: string,
    summary: unknown,
    notes: readonly string[] = [],
  ): Promise<ToolRunResult> {
    const relativePath = relative(workspace.sandboxRoot, path).split(sep).join("/");
    const stored = await deps.writeSandboxFile(relativePath, proposed);
    const noted = notes.length === 0 ? "" : ` Note: ${notes.join("; ")} - read the file if the result matters.`;
    const original = stored.original ?? "";
    const hunks = computeHunks(original, stored.proposed);

    deps.onProposedEdit({
      taskId: workspace.taskId,
      relativePath,
      path: join(workspace.humanRoot, ...relativePath.split("/")),
      summary: typeof summary === "string" ? summary : "Proposed change",
      original,
      proposed: stored.proposed,
      hunks,
    });

    if (direct()) {
      return ok(
        `Updated ${relativePath} in your project (+${hunks.reduce((n, hunk) => n + hunk.replacement.length, 0)} −${hunks.reduce((n, hunk) => n + hunk.original.length, 0)}).${noted}`,
      );
    }
    // Written only to the sandbox. The model is told that plainly so it can read its own new version on the next tool call without assuming the human file changed.
    return ok(
      `Proposed ${hunks.length} change${hunks.length === 1 ? "" : "s"} to ${relativePath}. ` +
        (deps.reviewPolicy?.() === "trusted"
          ? "It is isolated now and will be auto-applied with a rollback checkpoint after this turn succeeds."
          : "It is staged in an isolated copy of the project and waits for the user to review and apply it.") +
        noted,
    );
  }

  /** Every file under a path, for keeping a moved folder's contents in the turn's Undo. */
  async function filesUnder(path: string): Promise<string[]> {
    const info = await stat(path);
    if (!info.isDirectory()) return [""];
    const found: string[] = [];
    async function visit(directory: string, prefix: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) await visit(join(directory, entry.name), name);
        else found.push(name);
        if (found.length > MAX_MOVED_FILES) return;
      }
    }
    await visit(path, "");
    return found;
  }

  /** A file's bytes as Undo keeps them: text as text, anything else as base64. */
  async function undoCopy(path: string): Promise<{ data: string; encoding: "utf8" | "base64" } | null> {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_UNDO_BYTES) return null;
    const bytes = await readFile(path);
    return isText(bytes) ? { data: bytes.toString("utf8"), encoding: "utf8" } : { data: bytes.toString("base64"), encoding: "base64" };
  }

  const reviewModeMove =
    "Moving and deleting files works when AI edits apply automatically (Settings, AI edit approval). In review mode, finish the rest of the change and say which files to move or delete - the user can do it from the Explorer.";

  /** Whether a directory entry is left out of a listing. */
  function skipsEntry(entry: Dirent, path: string, skip: DirectoryFilter): boolean {
    // A linked-worktree sandbox has a `.git` *file*; it is git's pointer, not project content.
    if (entry.name === ".git" || entry.isSymbolicLink()) return true;
    return entry.isDirectory() && skip(path);
  }

  /** Every file under `directory`, skipping the directories the editor's own search skips. */
  async function walk(directory: string, root: string, hits: string[]): Promise<void> {
    const skip = await loadDirectoryFilter(root);

    async function visit(current: string): Promise<void> {
      if (hits.length >= 2000) return;

      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const full = join(current, entry.name);
        const path = relative(root, full).split(sep).join("/");
        if (skipsEntry(entry, path, skip)) continue;

        if (entry.isDirectory()) await visit(full);
        else hits.push(path);
      }
    }

    await visit(directory);
  }

  async function run(call: ToolCallBlock, signal: AbortSignal): Promise<ToolRunResult> {
      const input = call.input;
      if (["read_file", "propose_edit", "edit_file", "get_outline", "delete_file"].includes(call.name) &&
          (typeof input["path"] !== "string" || input["path"].trim().length === 0)) {
        return fail(`${call.name} requires a non-empty "path" string, such as "src/main.ts". No file was accessed. Retry with valid JSON arguments matching the tool schema.`);
      }

      switch (call.name) {
        case "open_preview": {
          if (!deps.openPreview) return fail("Live preview is unavailable in this agent.");
          if (input["path"] !== undefined && typeof input["path"] !== "string") return fail("open_preview path must be text, such as about.html.");
          const path = typeof input["path"] === "string" && input["path"].trim().length > 0 ? input["path"].trim() : null;
          const { status, page } = await deps.openPreview(path);
          return {
            content: JSON.stringify({
              type: "live-preview",
              status,
              page,
              note: page === null
                ? "The preview has no address yet. Its output says why; fix that, or start the server with run_command background: true."
                : direct()
                  ? "Shown to the user in the conversation. It serves the files on disk, so your edits are already in it. To check what the page shows, use view_page."
                  : "Shown to the user in the conversation. It serves the applied project, so staged changes appear once the user applies them.",
            }),
            isError: status.error !== null || page === null,
          };
        }

        case "view_page": {
          if (!deps.viewPage) return fail("This agent has no browser. Describe what to check, or run the project's tests.");
          const request = parseViewPageInput(input);
          if (typeof request === "string") return fail(request);
          return deps.viewPage(request, signal);
        }

        case "update_plan": {
          const steps = parsePlan(input);
          if (typeof steps === "string") return fail(steps);
          const done = steps.filter((step) => step.status === "done").length;
          const current = steps.find((step) => step.status === "in_progress");
          return ok(`Plan shown to the user: ${done} of ${steps.length} done${current === undefined ? "" : `, now: ${current.step}`}.`);
        }

        case "read_file": {
          const workspace = await deps.workspace();
          if (workspace === null) return unavailable();
          const path = await resolveInWorkspace(workspace, input["path"]);
          if (path === null) return fail(INVALID_WORKSPACE_PATH);

          try {
            const info = await stat(path);
            if (!info.isFile()) return fail("That path is a folder, not a file. Use list_files to see what is in it.");
            const imageType = IMAGE_TYPES[extname(path).toLowerCase()];
            if (imageType !== undefined) {
              if (info.size > MAX_IMAGE_BYTES) return fail(`That image is ${info.size.toLocaleString("en-US")} bytes, too large to look at (the limit is ${MAX_IMAGE_BYTES.toLocaleString("en-US")}).`);
              return {
                content: `${relativeTo(workspace, path)}: ${imageType.slice(6).toUpperCase()} image, ${info.size.toLocaleString("en-US")} bytes. The picture is attached.`,
                isError: false,
                images: [{ type: "image", mediaType: imageType, data: (await readFile(path)).toString("base64") }],
              };
            }
            if (info.size > MAX_PAGED_BYTES) {
              return fail(`That file is ${info.size.toLocaleString("en-US")} bytes, too large to read. Use search to find the part you need.`);
            }

            const bytes = await readFile(path);
            if (!isText(bytes)) return fail(`${relativeTo(workspace, path)} is a binary file (${info.size.toLocaleString("en-US")} bytes), not text.`);
            const lines = bytes.toString("utf8").split("\n");
            const offsetRaw = input["offset"];
            const limitRaw = input["limit"];
            const offset = offsetRaw === undefined ? 1 : Math.floor(Number(offsetRaw));
            // A large file pages by default rather than failing: the first 2,000 lines say what it is.
            const limit = limitRaw === undefined ? (info.size > MAX_READ_BYTES ? 2000 : lines.length) : Math.floor(Number(limitRaw));
            if (!Number.isSafeInteger(offset) || offset < 1) return fail("read_file offset starts at line 1.");
            if (offset > lines.length) return fail(`${relativeTo(workspace, path)} has ${lines.length} lines, so offset ${offset} is past its end.`);
            if (!Number.isSafeInteger(limit) || limit < 1 || (limitRaw !== undefined && limit > 2000)) {
              return fail("read_file limit is between 1 and 2000 lines.");
            }
            const slice = lines.slice(offset - 1, offset - 1 + limit);
            let clipped = 0;
            const numbered = slice
              .map((line, index) => {
                // A minified bundle is one enormous line; show its start, not all of it.
                if (line.length <= MAX_LINE_CHARS) return `${String(offset + index).padStart(4)} ${line}`;
                clipped += 1;
                return `${String(offset + index).padStart(4)} ${line.slice(0, MAX_LINE_CHARS)}… [${(line.length - MAX_LINE_CHARS).toLocaleString("en-US")} more characters on this line]`;
              })
              .join("\n");
            const more = offset - 1 + slice.length < lines.length ? `\n[Showing lines ${offset}-${offset + slice.length - 1} of ${lines.length}. Pass offset ${offset + slice.length} to continue.]` : "";
            const long = clipped === 0 ? "" : `\n[${clipped} very long line${clipped === 1 ? " was" : "s were"} shortened.]`;

            return ok(numbered + more + long);
          } catch (error) {
            return fail(error instanceof Error ? error.message : "could not read that file");
          }
        }

        case "list_files": {
          const workspace = await deps.workspace();
          if (workspace === null) return unavailable();
          const root = workspace.sandboxRoot;
          const target = await resolveDirOrRoot(workspace, input["path"]);
          if (target === null) return fail(INVALID_WORKSPACE_PATH);

          try {
            if (input["recursive"] === true) {
              const hits: string[] = [];
              await walk(target, root, hits);
              const listed = hits.sort().slice(0, MAX_GLOB_HITS);
              return ok(listed.length === 0 ? "(empty)" : listed.join("\n"));
            }
            const entries = await readdir(target, { withFileTypes: true });
            const skip = await loadDirectoryFilter(root);
            const listed = entries
              .filter((entry) => !skipsEntry(entry, relative(root, join(target, entry.name)).split(sep).join("/"), skip))
              .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
              .sort();

            return ok(listed.length === 0 ? "(empty)" : listed.join("\n"));
          } catch (error) {
            return fail(error instanceof Error ? error.message : "could not list that folder");
          }
        }

        case "search": {
          const workspace = await deps.workspace();
          if (workspace === null) return unavailable();
          const root = workspace.sandboxRoot;
          if (typeof input["pattern"] !== "string" || input["pattern"].length === 0) return fail("search needs a pattern.");
          const literal = input["literal"] === true;
          const source = literal ? input["pattern"].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : input["pattern"];

          let regex: RegExp;
          try {
            regex = new RegExp(source, input["case_sensitive"] === true ? "" : "i");
          } catch {
            return fail("That pattern is not a valid regular expression. Pass literal: true to search for it as plain text.");
          }
          const context = input["context"] === undefined ? 0 : Number(input["context"]);
          if (!Number.isInteger(context) || context < 0 || context > 5) return fail("search context is 0 to 5 lines.");
          const limit = input["max_results"] === undefined ? DEFAULT_SEARCH_HITS : Number(input["max_results"]);
          if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_HITS) return fail(`search max_results is 1 to ${MAX_SEARCH_HITS}.`);
          const filesOnly = input["files_only"] === true;

          const base = await resolveDirOrRoot(workspace, input["path"]);
          if (base === null) return fail(INVALID_WORKSPACE_PATH);
          let include: RegExp | null = null;
          if (input["include"] !== undefined) {
            if (typeof input["include"] !== "string") return fail("search include must be a glob.");
            include = globToRegExp(input["include"]);
            if (include === null) return fail("That include glob could not be read. Try **/*.ts.");
          }

          const files: string[] = [];
          await walk(base, root, files);
          const candidates = files
            .sort()
            .filter((relativePath) => include === null || include.test(relativePath) || include.test(relativePath.split("/").pop() ?? ""));

          /** The matching line numbers of one file; null for a file that is not text. */
          async function scan(relativePath: string): Promise<{ lines: string[]; hits: number[] } | null> {
            try {
              const info = await stat(join(root, relativePath));
              if (info.size > MAX_READ_BYTES * 5) return null;
              const bytes = await readFile(join(root, relativePath));
              if (!isText(bytes)) return null;
              const lines = bytes.toString("utf8").split("\n");
              const hits: number[] = [];
              for (let i = 0; i < lines.length; i++) if (regex.test(lines[i]!)) hits.push(i);
              return hits.length === 0 ? null : { lines, hits };
            } catch {
              return null;
            }
          }

          const found: string[] = [];
          let matchCount = 0;
          let fileCount = 0;
          let truncated = false;
          // Read sixteen files at a time, report in path order.
          for (let start = 0; start < candidates.length && !truncated; start += 16) {
            const batch = candidates.slice(start, start + 16);
            const scanned = await Promise.all(batch.map(scan));
            for (const [index, result] of scanned.entries()) {
              if (result === null) continue;
              const relativePath = batch[index]!;
              fileCount += 1;
              if (filesOnly) {
                found.push(`${relativePath} (${result.hits.length} match${result.hits.length === 1 ? "" : "es"})`);
                if (found.length >= limit) truncated = true;
              } else {
                const room = limit - matchCount;
                const hits = result.hits.slice(0, room);
                matchCount += hits.length;
                found.push(...searchLines(relativePath, result.lines, hits, context));
                if (result.hits.length > room || matchCount >= limit) truncated = true;
              }
              if (truncated) break;
            }
          }

          if (found.length === 0) {
            // A pattern with ( or . in it is the commonest reason a search for code finds nothing.
            const special = !literal && /[.*+?^${}()|[\]\\]/.test(input["pattern"]);
            return ok(`No matches.${special ? " The pattern is a regular expression - pass literal: true to search for it as plain text." : ""}`);
          }
          const more = truncated
            ? `\n[Stopped at ${limit} ${filesOnly ? "files" : "matches"} (${fileCount} file${fileCount === 1 ? "" : "s"} so far). Narrow path or include, or raise max_results (up to ${MAX_SEARCH_HITS}).]`
            : "";
          return ok(truncateOutput(found.join("\n")) + more);
        }

        case "propose_edit": {
          const workspace = await writeWorkspace();
          if (workspace === null) return unavailable();
          const path = await resolveInWorkspace(workspace, input["path"]);
          if (path === null) return fail(INVALID_WORKSPACE_PATH);
          if (typeof input["contents"] !== "string") return fail("propose_edit needs contents.");

          let current = "";
          try {
            current = await readFile(path, "utf8");
          } catch {
            // A new file. An empty original makes the whole proposal one insertion hunk.
          }

          const proposed = input["contents"];
          if (current === proposed) {
            return ok("That file already has those contents; nothing to change.");
          }

          return stageProposal(workspace, path, proposed, input["summary"]);
        }

        case "edit_file": {
          const workspace = await writeWorkspace();
          if (workspace === null) return unavailable();
          const path = await resolveInWorkspace(workspace, input["path"]);
          if (path === null) return fail(INVALID_WORKSPACE_PATH);
          const replacements = replacementsOf(input);
          if (typeof replacements === "string") return fail(replacements);
          const relativePath = relative(workspace.sandboxRoot, path).split(sep).join("/");

          let current = "";
          let exists = true;
          try {
            const info = await stat(path);
            if (!info.isFile()) return fail("That path is not a file.");
            if (info.size > MAX_READ_BYTES) return fail(`That file is ${info.size} bytes, too large to edit here.`);
            current = await readFile(path, "utf8");
          } catch {
            exists = false;
          }
          if (!exists && replacements.some((replacement) => replacement.oldString.length > 0)) {
            return fail(`${relativePath} does not exist yet. Create it with an empty old_string, or with propose_edit.`);
          }

          const applied = applyReplacements(current, replacements, relativePath);
          if (!applied.ok) return fail(applied.message);
          if (applied.text === current) return ok("Those replacements leave the file unchanged; nothing to propose.");
          return stageProposal(workspace, path, applied.text, input["summary"], applied.notes);
        }

        case "glob_files": {
          const workspace = await deps.workspace();
          if (workspace === null) return unavailable();
          const root = workspace.sandboxRoot;
          if (typeof input["pattern"] !== "string") return fail("glob_files needs a pattern.");
          const matcher = globToRegExp(input["pattern"]);
          if (matcher === null) return fail("That glob could not be read. Try **/*.png.");
          const base = await resolveDirOrRoot(workspace, input["path"]);
          if (base === null) return fail(INVALID_WORKSPACE_PATH);

          const files: string[] = [];
          await walk(base, root, files);
          const matched = files
            .filter((relativePath) => matcher.test(relativePath) || matcher.test(relativePath.split("/").pop() ?? ""))
            .sort()
            .slice(0, MAX_GLOB_HITS);
          return ok(matched.length === 0 ? "No files match that pattern." : matched.join("\n"));
        }

        case "get_outline": {
          const workspace = await deps.workspace();
          if (workspace === null) return unavailable();
          const path = await resolveInWorkspace(workspace, input["path"]);
          if (path === null) return fail(INVALID_WORKSPACE_PATH);
          try {
            const info = await stat(path);
            if (!info.isFile()) return fail("That path is not a file.");
            if (info.size > MAX_READ_BYTES) return fail(`That file is ${info.size} bytes, too large to outline.`);
            const text = await readFile(path, "utf8");
            const symbols = outlineOf(text);
            return ok(symbols.length === 0 ? "No symbols found in that file." : symbols.join("\n"));
          } catch (error) {
            return fail(error instanceof Error ? error.message : "could not outline that file");
          }
        }

        case "run_command": {
          const workspace = await writeWorkspace();
          if (workspace === null) return unavailable();
          if (typeof input["command"] !== "string" || input["command"].trim().length === 0) {
            return fail("run_command needs a command.");
          }
          const command = input["command"].trim();
          if (command.length > 2000) return fail("That command is too long. Keep it under 2000 characters.");
          const lowered = command.toLowerCase();
          if (BLOCKED_COMMANDS.some((blocked) => lowered.includes(blocked))) {
            return fail("That command is blocked. Ask the user to run destructive commands themselves.");
          }
          const cwd = await resolveDirOrRoot(workspace, input["cwd"]);
          if (cwd === null) return fail(INVALID_WORKSPACE_PATH);

          // A server asked for in the foreground could only end by timing out; start it in the
          // background instead, unless the model said background: false outright.
          const automatic = input["background"] === undefined && deps.backgroundCommands !== undefined && looksLikeServer(command);
          if (input["background"] === true || automatic) {
            if (deps.backgroundCommands === undefined) {
              return fail("This agent cannot leave commands running. Run it in the foreground with a timeout_seconds, or skip starting a server.");
            }
            const started = deps.backgroundCommands.startBackground(command, cwd);
            if (typeof started === "string") return fail(started);
            // Most servers say where they are, or why they failed, within a few seconds.
            const first = await deps.backgroundCommands.read(started.id, 4_000, signal);
            deps.onCommandFinished?.();
            const why = automatic ? " (it looks like a server, which never exits, so it was not run in the foreground)" : "";
            if (first === null) return ok(`Started ${started.id} in the background${why}.`);
            return {
              content: `Started ${first.id} in the background${why}. ${describeReading(first)}\nRead more with command_output {"id": "${first.id}", "wait_seconds": 5}; end it with stop_command.`,
              isError: !first.running && first.exitCode !== 0,
            };
          }

          const timeoutMs = timeoutFrom(input["timeout_seconds"]);
          if (timeoutMs === null) return fail(`timeout_seconds is 1 to ${MAX_TIMEOUT_SECONDS}.`);
          const outcome = await commands.runForeground(command, cwd, timeoutMs, signal);
          deps.onCommandFinished?.();
          const output = clipOutput(outcome.output) || "(no output)";
          if (outcome.cancelled) return fail(`Stopped before it finished.\n${output}`);
          if (outcome.timedOut) {
            return fail(
              `Timed out after ${timeoutMs / 1000}s and was stopped, with everything it started. ` +
                `If it is a server or watcher, start it with background: true; otherwise pass a longer timeout_seconds (up to ${MAX_TIMEOUT_SECONDS}).\n${output}`,
            );
          }
          return outcome.exitCode === 0 ? ok(`exit 0\n${output}`) : fail(`exit ${outcome.exitCode ?? "unknown"}\n${output}`);
        }

        case "command_output": {
          if (deps.backgroundCommands === undefined) return fail("This agent has no background commands.");
          if (input["id"] === undefined || input["id"] === "") {
            const all = deps.backgroundCommands.list();
            if (all.length === 0) return ok("No background commands have been started.");
            return ok(all.map((item) => `${item.id}: ${item.command} - ${item.running ? "running" : `exited ${item.exitCode ?? "?"}`}${item.url === null ? "" : `, at ${item.url}`}`).join("\n"));
          }
          if (typeof input["id"] !== "string") return fail("command_output id is text, such as cmd-1.");
          const wait = input["wait_seconds"] === undefined ? 0 : Number(input["wait_seconds"]);
          if (!Number.isFinite(wait) || wait < 0 || wait > 60) return fail("wait_seconds is 0 to 60.");
          const reading = await deps.backgroundCommands.read(input["id"], wait * 1000, signal);
          if (reading === null) return fail(`No background command ${JSON.stringify(input["id"])}. Call command_output with no id to list them.`);
          return ok(describeReading(reading));
        }

        case "stop_command": {
          if (deps.backgroundCommands === undefined) return fail("This agent has no background commands.");
          if (typeof input["id"] !== "string") return fail("stop_command needs the id run_command returned, such as cmd-1.");
          const reading = await deps.backgroundCommands.stop(input["id"]);
          if (reading === null) return fail(`No background command ${JSON.stringify(input["id"])}.`);
          deps.onCommandFinished?.();
          return ok(`Stopped. ${describeReading(reading)}`);
        }

        case "delete_file": {
          const workspace = await writeWorkspace();
          if (workspace === null) return unavailable();
          if (!direct()) return fail(reviewModeMove);
          const path = await resolveInWorkspace(workspace, input["path"]);
          if (path === null) return fail(INVALID_WORKSPACE_PATH);
          const relativePath = relativeTo(workspace, path);
          if (relativePath === "" || relativePath === ".") return fail("That is the workspace itself; delete files inside it one at a time.");
          let info;
          try {
            info = await stat(path);
          } catch {
            return fail(`${relativePath} does not exist. Nothing was deleted.`);
          }
          if (info.isDirectory()) {
            const inside = await readdir(path);
            if (inside.length > 0) {
              return fail(`${relativePath} is a folder with ${inside.length} item${inside.length === 1 ? "" : "s"} in it. Delete or move its files first (each is undoable), then the empty folder.`);
            }
            await rmdir(path);
            deps.onFilesChanged?.([relativePath]);
            return ok(`Deleted the empty folder ${relativePath}.`);
          }
          const copy = await undoCopy(path);
          if (copy === null) return fail(`${relativePath} is larger than ${MAX_UNDO_BYTES / 1_000_000} MB, too large to keep a copy for Undo. Ask the user to delete it themselves.`);
          deps.recordUndo?.(relativePath, copy.data, null, copy.encoding);
          await rm(path);
          deps.onFilesChanged?.([relativePath]);
          return ok(`Deleted ${relativePath}${deps.recordUndo === undefined ? "." : " - the turn's Undo brings it back."}`);
        }

        case "move_file": {
          const workspace = await writeWorkspace();
          if (workspace === null) return unavailable();
          if (!direct()) return fail(reviewModeMove);
          if (typeof input["from"] !== "string" || input["from"].trim() === "" || typeof input["to"] !== "string" || input["to"].trim() === "") {
            return fail('move_file needs "from" and "to", such as {"from": "logo.png", "to": "assets/logo.png"}.');
          }
          const from = await resolveInWorkspace(workspace, input["from"]);
          const to = await resolveInWorkspace(workspace, input["to"]);
          if (from === null || to === null) return fail(INVALID_WORKSPACE_PATH);
          const fromPath = relativeTo(workspace, from);
          const toPath = relativeTo(workspace, to);
          if (fromPath === "" || toPath === "") return fail("The workspace itself cannot be moved.");
          if (from === to) return ok(`${fromPath} is already there; nothing to move.`);
          if (`${toPath}/`.startsWith(`${fromPath}/`)) return fail(`${toPath} is inside ${fromPath}; a folder cannot move into itself.`);
          let names: string[];
          try {
            names = await filesUnder(from);
          } catch {
            return fail(`${fromPath} does not exist. Nothing was moved.`);
          }
          if (names.length > MAX_MOVED_FILES) return fail(`${fromPath} holds more than ${MAX_MOVED_FILES} files, too many to move with Undo. Ask the user to move it themselves.`);
          const folder = !(names.length === 1 && names[0] === "");
          let replaced: { data: string; encoding: "utf8" | "base64" } | null = null;
          try {
            const existing = await stat(to);
            if (input["overwrite"] !== true) return fail(`${toPath} already exists. Pass overwrite: true to replace it, or choose another name.`);
            if (existing.isDirectory() || folder) return fail(`${toPath} already exists and overwrite only replaces a file with a file.`);
            replaced = await undoCopy(to);
            if (replaced === null) return fail(`${toPath} is too large to keep a copy of for Undo, so it was not replaced.`);
          } catch (error) {
            if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw error;
          }
          // Copies for Undo first: once the move is done, the old bytes are only at the new path.
          const kept: { name: string; copy: { data: string; encoding: "utf8" | "base64" } }[] = [];
          for (const name of names) {
            const copy = await undoCopy(name === "" ? from : join(from, ...name.split("/")));
            if (copy === null) return fail(`${name === "" ? fromPath : `${fromPath}/${name}`} is too large to keep a copy of for Undo. Ask the user to move it themselves.`);
            kept.push({ name, copy });
          }
          await mkdir(dirname(to), { recursive: true });
          if (replaced !== null) await rm(to);
          await rename(from, to);
          for (const { name, copy } of kept) {
            const oldPath = name === "" ? fromPath : `${fromPath}/${name}`;
            const newPath = name === "" ? toPath : `${toPath}/${name}`;
            deps.recordUndo?.(oldPath, copy.data, null, copy.encoding);
            if (name === "" && replaced !== null && replaced.encoding !== copy.encoding) {
              // One path, one encoding: keep both versions as bytes.
              const bytes = (kept: { data: string; encoding: "utf8" | "base64" }): string => Buffer.from(kept.data, kept.encoding).toString("base64");
              deps.recordUndo?.(newPath, bytes(replaced), bytes(copy), "base64");
            } else {
              deps.recordUndo?.(newPath, name === "" && replaced !== null ? replaced.data : null, copy.data, copy.encoding);
            }
          }
          deps.onFilesChanged?.([fromPath, toPath]);
          const what = folder ? `the folder ${fromPath} (${names.length} file${names.length === 1 ? "" : "s"})` : fromPath;
          return ok(`Moved ${what} to ${toPath}${replaced === null ? "" : ", replacing the file that was there"}. Update anything that refers to the old path${deps.recordUndo === undefined ? "." : "; the turn's Undo moves it back."}`);
        }

        case "fetch_url": {
          if (typeof input["url"] !== "string") return fail("fetch_url needs a URL.");
          let url: URL;
          try {
            url = new URL(input["url"].trim());
          } catch {
            return fail("That is not a valid URL.");
          }
          const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
          if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback.has(url.hostname))) {
            return fail("fetch_url needs an https URL (local servers may use http).");
          }
          if (url.username || url.password) return fail("fetch_url refuses URLs with credentials.");
          try {
            const response = await fetch(url.toString(), {
              signal: AbortSignal.any([AbortSignal.timeout(FETCH_TIMEOUT_MS), signal]),
              headers: { "user-agent": "Mozilla/5.0 (compatible; ADCode assistant)", accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8" },
            });
            const body = await response.text();
            const readable = input["raw"] !== true && looksLikeHtml(response.headers.get("content-type"), body) ? htmlToText(body, response.url || url.toString()) : body;
            const text = truncateOutput(readable);
            if (!response.ok) return fail(`That URL answered ${response.status}.${text.trim().length === 0 ? "" : `\n${text.slice(0, 2_000)}`}`);
            return ok(text.length === 0 ? "(empty response)" : text);
          } catch (error) {
            return fail(error instanceof Error ? error.message : "could not fetch that URL");
          }
        }

        case "project_context": {
          const memory = deps.memory();
          if (memory === null) return fail("Project memory is unavailable.");
          return ok(await memory.store.projectContext());
        }

        case "memory_search": {
          const memory = deps.memory();
          if (memory === null) return fail("Project memory is unavailable.");
          if (typeof input["query"] !== "string") return fail("memory_search needs a query.");

          await memory.reindex();
          const hits = memory.index.search(
            input["query"],
            typeof input["kind"] === "string"
              ? (input["kind"] as Parameters<typeof memory.index.search>[1])
              : undefined,
          );

          if (hits.length === 0) return ok("No memories match that.");
          return ok(hits.map((hit) => `- ${hit.name} (${hit.type}): ${hit.description}`).join("\n"));
        }

        case "memory_write": {
          const memory = deps.memory();
          if (memory === null) return fail("Project memory is unavailable.");

          const written = await memory.store.write({
            name: String(input["name"] ?? ""),
            description: String(input["description"] ?? ""),
            type: (input["type"] as "decision" | "convention" | "preference") ?? "decision",
            body: String(input["body"] ?? ""),
            agent: "adcode-chat",
          });

          if (written === null) {
            return fail("Could not write that memory. Names must be lowercase letters, digits, and hyphens.");
          }

          await memory.reindex();
          return ok(`Recorded ${written.name}.`);
        }

        default:
          return fail(`No tool named ${JSON.stringify(call.name)}.`);
      }
  }

  return {
    async run(call, signal) {
      try {
        return await run(call, signal);
      } catch (error) {
        return fail(error instanceof Error ? error.message : "The tool could not finish.");
      }
    },
  };
}

