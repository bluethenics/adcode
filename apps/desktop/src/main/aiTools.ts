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
import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { computeHunks, type AiFileChange, type ToolCallBlock, type ToolRunner } from "@adcode/ai";
import type { NodeMemory } from "@adcode/memory";
import { isInsideWorkspace } from "./pathSafety.ts";

const MAX_READ_BYTES = 400_000;
const MAX_SEARCH_HITS = 60;
const SKIP = new Set([".git", "node_modules", "dist", "out", ".next", "target", ".adcode"]);

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
  readonly workspace: () => Promise<AiToolWorkspace | null>;
  readonly workspaceUnavailableMessage?: () => string;
  readonly memory: () => NodeMemory | null;
  readonly writeSandboxFile: (path: string, contents: string) => Promise<AiFileChange>;
  /** Called when the agent proposes an edit, so the renderer can show the diff. */
  readonly onProposedEdit: (edit: ProposedEdit) => void;
}

const ok = (content: string) => ({ content, isError: false });
const fail = (content: string) => ({ content, isError: true });

/** Resolve a workspace-relative path, refusing anything that escapes the workspace. */
function resolveInWorkspace(root: string | null, input: unknown): string | null {
  if (root === null || typeof input !== "string") return null;
  if (isAbsolute(input)) return null;

  const candidate = join(root, input);
  return isInsideWorkspace(root, candidate) ? candidate : null;
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
      if (SKIP.has(entry.name)) continue;
      const full = join(directory, entry.name);

      if (entry.isDirectory()) await walk(full, root, hits);
      else hits.push(relative(root, full).split(sep).join("/"));
    }
  }

  return {
    async run(call: ToolCallBlock): Promise<{ content: string; isError: boolean }> {
      const input = call.input;

      switch (call.name) {
        case "read_file": {
          const workspace = await deps.workspace();
          if (workspace === null) return unavailable();
          const root = workspace.sandboxRoot;
          const path = resolveInWorkspace(root, input["path"]);
          if (path === null) return fail("That path is outside the open workspace.");

          try {
            const info = await stat(path);
            if (!info.isFile()) return fail("That path is not a file.");
            if (info.size > MAX_READ_BYTES) {
              return fail(`That file is ${info.size} bytes, too large to read in full.`);
            }

            const text = await readFile(path, "utf8");
            const numbered = text
              .split("\n")
              .map((line, index) => `${String(index + 1).padStart(4)} ${line}`)
              .join("\n");

            return ok(numbered);
          } catch (error) {
            return fail(error instanceof Error ? error.message : "could not read that file");
          }
        }

        case "list_files": {
          const workspace = await deps.workspace();
          if (workspace === null) return unavailable();
          const root = workspace.sandboxRoot;
          const target = input["path"] === undefined ? root : resolveInWorkspace(root, input["path"]);
          if (target === null) return fail("That path is outside the open workspace.");

          try {
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

          const base = input["path"] === undefined ? root : resolveInWorkspace(root, input["path"]);
          if (base === null) return fail("That path is outside the open workspace.");

          const files: string[] = [];
          await walk(base, root, files);

          const found: string[] = [];
          for (const relativePath of files) {
            if (found.length >= MAX_SEARCH_HITS) break;

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
          const path = resolveInWorkspace(root, input["path"]);
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
              "It is written only in the isolated task workspace and is waiting for human review.",
          );
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
