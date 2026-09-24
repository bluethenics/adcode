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
import { execFile as execFileCallback } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { computeHunks, type AiFileChange, type ToolCallBlock, type ToolRunner } from "@adcode/ai";
import type { NodeMemory } from "@adcode/memory";
import { resolveSandboxPath } from "./aiSandbox.ts";
import type { PreviewStatus } from "../shared/api.ts";

const execFile = promisify(execFileCallback);

const MAX_READ_BYTES = 400_000;
const MAX_SEARCH_HITS = 60;
const MAX_GLOB_HITS = 500;
const MAX_OUTLINE_SYMBOLS = 200;
const MAX_OUTPUT_CHARS = 24_000;
const RUN_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;
const SKIP = new Set([".git", "node_modules", "dist", "out", ".next", "target", ".adcode"]);

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
  readonly openPreview?: () => Promise<PreviewStatus>;
  readonly workspace: () => Promise<AiToolWorkspace | null>;
  readonly workspaceUnavailableMessage?: () => string;
  /** Trusted still means sandbox first; only the successful turn's checkpointed apply is automatic. */
  readonly reviewPolicy?: () => "review" | "trusted";
  readonly memory: () => NodeMemory | null;
  readonly writeSandboxFile: (path: string, contents: string) => Promise<AiFileChange>;
  /** Called when the agent proposes an edit, so the renderer can show the diff. */
  readonly onProposedEdit: (edit: ProposedEdit) => void;
}

const ok = (content: string) => ({ content, isError: false });
const fail = (content: string) => ({ content, isError: true });

/** Resolve a workspace-relative path, refusing lexical and real-filesystem escapes. */
async function resolveInWorkspace(root: string | null, input: unknown): Promise<string | null> {
  if (root === null || typeof input !== "string") return null;
  try {
    return await resolveSandboxPath(root, input);
  } catch {
    return null;
  }
}

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

async function resolveDirOrRoot(root: string, input: unknown): Promise<string | null> {
  if (isRootAlias(input)) return root;
  return resolveInWorkspace(root, input);
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

export function createAiToolRunner(deps: AiToolDeps): ToolRunner {
  const unavailable = (): ReturnType<typeof fail> =>
    fail(deps.workspaceUnavailableMessage?.() ?? "No folder is open, so there is nothing to work on yet.");

  async function walk(directory: string, root: string, hits: string[]): Promise<void> {
    if (hits.length >= 2000) return;

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP.has(entry.name) || entry.isSymbolicLink()) continue;
      const full = join(directory, entry.name);

      if (entry.isDirectory()) await walk(full, root, hits);
      else hits.push(relative(root, full).split(sep).join("/"));
    }
  }

  return {
    async run(call: ToolCallBlock): Promise<{ content: string; isError: boolean }> {
      const input = call.input;

      switch (call.name) {
        case "open_preview": {
          if (!deps.openPreview) return fail("Live preview is unavailable in this agent.");
          const status = await deps.openPreview();
          return {
            content: JSON.stringify({ type: "live-preview", status, note: "This preview shows saved/applied files. Pending proposals must be applied before they appear." }),
            isError: status.error !== null,
          };
        }
        case "read_file": {
          const workspace = await deps.workspace();
          if (workspace === null) return unavailable();
          const root = workspace.sandboxRoot;
          const path = await resolveInWorkspace(root, input["path"]);
          if (path === null) return fail("That path is outside the open workspace.");

          try {
            const info = await stat(path);
            if (!info.isFile()) return fail("That path is not a file.");
            if (info.size > MAX_READ_BYTES) {
              return fail(`That file is ${info.size} bytes, too large to read in full.`);
            }

            const text = await readFile(path, "utf8");
            const lines = text.split("\n");
            const offsetRaw = input["offset"];
            const limitRaw = input["limit"];
            const offset = offsetRaw === undefined ? 1 : Math.floor(Number(offsetRaw));
            const limit = limitRaw === undefined ? lines.length : Math.floor(Number(limitRaw));
            if (!Number.isSafeInteger(offset) || offset < 1) return fail("read_file offset starts at line 1.");
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) {
              return fail("read_file limit is between 1 and 2000 lines.");
            }
            const slice = lines.slice(offset - 1, offset - 1 + limit);
            const numbered = slice
              .map((line, index) => `${String(offset + index).padStart(4)} ${line}`)
              .join("\n");
            const more = offset - 1 + slice.length < lines.length ? `\n[Showing lines ${offset}-${offset + slice.length - 1} of ${lines.length}. Pass offset ${offset + slice.length} to continue.]` : "";

            return ok(numbered + more);
          } catch (error) {
            return fail(error instanceof Error ? error.message : "could not read that file");
          }
        }

        case "list_files": {
          const workspace = await deps.workspace();
          if (workspace === null) return unavailable();
          const root = workspace.sandboxRoot;
          const target = await resolveDirOrRoot(root, input["path"]);
          if (target === null) return fail("That path is outside the open workspace.");

          try {
            if (input["recursive"] === true) {
              const hits: string[] = [];
              await walk(target, root, hits);
              const listed = hits.sort().slice(0, MAX_GLOB_HITS);
              return ok(listed.length === 0 ? "(empty)" : listed.join("\n"));
            }
            const entries = await readdir(target, { withFileTypes: true });
            const listed = entries
              .filter((entry) => !SKIP.has(entry.name))
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
          if (typeof input["pattern"] !== "string") return fail("search needs a pattern.");

          let regex: RegExp;
          try {
            regex = new RegExp(input["pattern"], "i");
          } catch {
            return fail("That pattern is not a valid regular expression.");
          }

          const base = await resolveDirOrRoot(root, input["path"]);
          if (base === null) return fail("That path is outside the open workspace.");
          let include: RegExp | null = null;
          if (input["include"] !== undefined) {
            if (typeof input["include"] !== "string") return fail("search include must be a glob.");
            include = globToRegExp(input["include"]);
            if (include === null) return fail("That include glob could not be read. Try **/*.ts.");
          }

          const files: string[] = [];
          await walk(base, root, files);

          const found: string[] = [];
          for (const relativePath of files) {
            if (found.length >= MAX_SEARCH_HITS) break;
            if (include !== null && !include.test(relativePath) && !include.test(relativePath.split("/").pop() ?? "")) continue;

            try {
              const info = await stat(join(root, relativePath));
              if (info.size > MAX_READ_BYTES) continue;

              const text = await readFile(join(root, relativePath), "utf8");
              const lines = text.split("\n");

              for (let i = 0; i < lines.length && found.length < MAX_SEARCH_HITS; i++) {
                if (regex.test(lines[i]!)) found.push(`${relativePath}:${i + 1}: ${lines[i]!.trim()}`);
              }
            } catch {
              // Binary or unreadable; skip.
            }
          }

          return ok(found.length === 0 ? "No matches." : found.join("\n"));
        }

        case "propose_edit": {
          const workspace = await deps.workspace();
          if (workspace === null) return unavailable();
          const root = workspace.sandboxRoot;
          const path = await resolveInWorkspace(root, input["path"]);
          if (path === null) return fail("That path is outside the open workspace.");
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

          const relativePath = relative(root, path).split(sep).join("/");
          const stored = await deps.writeSandboxFile(relativePath, proposed);
          const original = stored.original ?? "";
          const hunks = computeHunks(original, stored.proposed);

          deps.onProposedEdit({
            taskId: workspace.taskId,
            relativePath,
            path: join(workspace.humanRoot, ...relativePath.split("/")),
            summary: typeof input["summary"] === "string" ? input["summary"] : "Proposed change",
            original,
            proposed: stored.proposed,
            hunks,
          });

          // Written only to the sandbox. The model is told that plainly so it can read its
          // own new version on the next tool call without assuming the human file changed.
          return ok(
            `Proposed ${hunks.length} change${hunks.length === 1 ? "" : "s"} to ${relativePath}. ` +
              (deps.reviewPolicy?.() === "trusted"
                ? "It is isolated now and will be auto-applied with a rollback checkpoint after this turn succeeds."
                : "It is written only in the isolated task workspace and is waiting for human review."),
          );
        }

        case "glob_files": {
          const workspace = await deps.workspace();
          if (workspace === null) return unavailable();
          const root = workspace.sandboxRoot;
          if (typeof input["pattern"] !== "string") return fail("glob_files needs a pattern.");
          const matcher = globToRegExp(input["pattern"]);
          if (matcher === null) return fail("That glob could not be read. Try **/*.png.");
          const base = await resolveDirOrRoot(root, input["path"]);
          if (base === null) return fail("That path is outside the open workspace.");

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
          const root = workspace.sandboxRoot;
          const path = await resolveInWorkspace(root, input["path"]);
          if (path === null) return fail("That path is outside the open workspace.");
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
          const workspace = await deps.workspace();
          if (workspace === null) return unavailable();
          const root = workspace.sandboxRoot;
          if (typeof input["command"] !== "string" || input["command"].trim().length === 0) {
            return fail("run_command needs a command.");
          }
          const command = input["command"].trim();
          if (command.length > 2000) return fail("That command is too long. Keep it under 2000 characters.");
          const lowered = command.toLowerCase();
          if (BLOCKED_COMMANDS.some((blocked) => lowered.includes(blocked))) {
            return fail("That command is blocked. Ask the user to run destructive commands themselves.");
          }
          const cwd = await resolveDirOrRoot(root, input["cwd"]);
          if (cwd === null) return fail("That working directory is outside the open workspace.");
          try {
            const shell = process.platform === "win32" ? (process.env["SystemRoot"] ?? "C:\\Windows") + "\\System32\\cmd.exe" : "/bin/sh";
            const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];
            const result = await execFile(shell, args, { cwd, timeout: RUN_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 });
            const output = truncateOutput(`${result.stdout}${result.stderr}`.trim());
            return ok(output.length === 0 ? "(no output)" : `exit 0\n${output}`);
          } catch (error) {
            const failure = error as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
            if (failure.killed === true) return fail("That command timed out after 30s. Narrow it or run it in the terminal.");
            const output = truncateOutput(`${failure.stdout ?? ""}${failure.stderr ?? ""}`.trim() || failure.message || "command failed");
            return fail(output);
          }
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
            const response = await fetch(url.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
            if (!response.ok) return fail(`That URL answered ${response.status}.`);
            const text = truncateOutput(await response.text());
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
    },
  };
}
