/**
 * Undo for edits the assistant applied directly.
 *
 * With "Apply automatically" the assistant writes the project as it works - the way a
 * teammate at the keyboard would - so the safety net moves from "review before" to "undo
 * after". Every turn that edits files leaves one checkpoint: each file's content before the
 * turn first touched it, and what the turn left there. Undo puts the "before" back (or
 * deletes a file the turn created).
 *
 * It refuses, file by file, when a file no longer holds what the turn wrote - the user has
 * edited it since - unless told to go ahead anyway. Silently throwing away a person's own
 * later work is the one thing an undo button must never do.
 *
 * Deletions and moves made with the file tools are recorded too: a deleted file's "after" is
 * null, and a moved one is a deletion at its old path plus a creation at its new one. Binary
 * files - an image the assistant moved into assets/ - are kept as base64, so Undo puts them
 * back byte for byte.
 *
 * Limits, stated rather than hidden: only edits made through the file tools are recorded.
 * What a command the assistant ran did to the disk (an npm install, a build) is not.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface CheckpointFile {
  readonly path: string;
  /** Null when the turn created the file. */
  readonly before: string | null;
  /** Null when the turn deleted the file, or moved it away. */
  readonly after: string | null;
  /** How `before` and `after` hold the bytes: text when absent, as every older checkpoint is. */
  readonly encoding?: "utf8" | "base64";
}

export interface EditCheckpoint {
  readonly id: string;
  readonly root: string;
  readonly createdAt: number;
  readonly files: readonly CheckpointFile[];
  readonly undone: boolean;
}

export interface UndoResult {
  readonly ok: boolean;
  readonly restored: readonly string[];
  /** Files changed since the turn wrote them; nothing was touched when this is non-empty. */
  readonly conflicts: readonly string[];
  readonly message: string;
}

/** What undo would do, given the files as they are now (null = the file is gone). */
export function planUndo(
  checkpoint: Pick<EditCheckpoint, "files">,
  current: ReadonlyMap<string, string | null>,
): { readonly conflicts: string[]; readonly restore: CheckpointFile[] } {
  const conflicts = checkpoint.files
    .filter((file) => (current.get(file.path) ?? null) !== file.after)
    .map((file) => file.path);
  return { conflicts, restore: [...checkpoint.files] };
}

const CHECKPOINT_ID = /^cp-[a-z0-9-]{8,64}$/;

export interface CheckpointStore {
  /** Start recording a turn in this project. */
  begin(root: string): void;
  /** One write by the assistant; a null `after` is a deletion. The first write of a path keeps its "before". */
  record(path: string, before: string | null, after: string | null, encoding?: "utf8" | "base64"): void;
  /** End the turn; the saved checkpoint, or null when nothing was written. */
  finish(): Promise<EditCheckpoint | null>;
  undo(id: string, root: string, force: boolean): Promise<UndoResult>;
}

export function createCheckpointStore(deps: {
  readonly directory: () => string;
  /** Resolve a workspace-relative path, refusing anything outside the project. */
  readonly resolve: (root: string, path: string) => Promise<string>;
  /** Checkpoints kept on disk; older ones are removed. */
  readonly keep?: number;
  readonly now?: () => number;
}): CheckpointStore {
  type Entry = { before: string | null; after: string | null; encoding: "utf8" | "base64" };
  let turn: { root: string; files: Map<string, Entry> } | null = null;
  const file = (id: string): string => join(deps.directory(), `${id}.json`);

  async function readCurrent(root: string, path: string, encoding: "utf8" | "base64" = "utf8"): Promise<string | null> {
    try {
      return (await readFile(await deps.resolve(root, path))).toString(encoding);
    } catch {
      return null;
    }
  }

  async function prune(): Promise<void> {
    const keep = deps.keep ?? 30;
    const names = (await readdir(deps.directory()).catch(() => [] as string[])).filter((name) => name.endsWith(".json"));
    if (names.length <= keep) return;
    const dated = await Promise.all(names.map(async (name) => {
      try {
        const parsed = JSON.parse(await readFile(join(deps.directory(), name), "utf8")) as { createdAt?: number };
        return { name, at: typeof parsed.createdAt === "number" ? parsed.createdAt : 0 };
      } catch {
        return { name, at: 0 };
      }
    }));
    dated.sort((a, b) => a.at - b.at);
    for (const { name } of dated.slice(0, dated.length - keep)) await rm(join(deps.directory(), name), { force: true });
  }

  async function save(checkpoint: EditCheckpoint): Promise<void> {
    await mkdir(deps.directory(), { recursive: true });
    const target = file(checkpoint.id);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, JSON.stringify(checkpoint), "utf8");
    await rename(temporary, target);
  }

  async function load(id: string): Promise<EditCheckpoint | null> {
    if (!CHECKPOINT_ID.test(id)) return null;
    try {
      const parsed = JSON.parse(await readFile(file(id), "utf8")) as EditCheckpoint;
      return parsed.id === id && Array.isArray(parsed.files) ? parsed : null;
    } catch {
      return null;
    }
  }

  return {
    begin(root): void {
      turn = { root, files: new Map() };
    },

    record(path, before, after, encoding = "utf8"): void {
      if (turn === null) return;
      const existing = turn.files.get(path);
      // A path keeps the encoding it was first recorded in, so its "before" stays readable.
      turn.files.set(path, existing === undefined ? { before, after, encoding } : { ...existing, after });
    },

    async finish(): Promise<EditCheckpoint | null> {
      const finished = turn;
      turn = null;
      if (finished === null || finished.files.size === 0) return null;
      const checkpoint: EditCheckpoint = {
        id: `cp-${randomUUID()}`,
        root: finished.root,
        createdAt: (deps.now ?? Date.now)(),
        // A file the turn created and then put back to nothing changed nothing.
        files: [...finished.files]
          .filter(([, entry]) => entry.before !== entry.after)
          .map(([path, { encoding, ...entry }]) => ({ path, ...entry, ...(encoding === "base64" ? { encoding } : {}) })),
        undone: false,
      };
      if (checkpoint.files.length === 0) return null;
      await save(checkpoint);
      await prune().catch(() => undefined);
      return checkpoint;
    },

    async undo(id, root, force): Promise<UndoResult> {
      const checkpoint = await load(id);
      if (checkpoint === null) return { ok: false, restored: [], conflicts: [], message: "That change can no longer be undone - its checkpoint is gone." };
      if (checkpoint.undone) return { ok: false, restored: [], conflicts: [], message: "Already undone." };
      if (checkpoint.root.replace(/\\/g, "/").toLowerCase() !== root.replace(/\\/g, "/").toLowerCase()) {
        return { ok: false, restored: [], conflicts: [], message: "Open the project this change was made in to undo it." };
      }
      const current = new Map<string, string | null>();
      for (const entry of checkpoint.files) current.set(entry.path, await readCurrent(root, entry.path, entry.encoding));
      const plan = planUndo(checkpoint, current);
      if (plan.conflicts.length > 0 && !force) {
        return {
          ok: false,
          restored: [],
          conflicts: plan.conflicts,
          message: `${plan.conflicts.length === 1 ? "1 file was" : `${plan.conflicts.length} files were`} changed after the assistant edited ${plan.conflicts.length === 1 ? "it" : "them"}. Undo anyway to put back the version from before the assistant's turn.`,
        };
      }
      const restored: string[] = [];
      for (const entry of plan.restore) {
        const target = await deps.resolve(root, entry.path);
        if (entry.before === null) {
          await rm(target, { force: true });
        } else {
          await mkdir(dirname(target), { recursive: true });
          const temporary = `${target}.adcode-undo-${randomUUID()}.tmp`;
          await writeFile(temporary, Buffer.from(entry.before, entry.encoding ?? "utf8"));
          await rename(temporary, target);
        }
        restored.push(entry.path);
      }
      await save({ ...checkpoint, undone: true });
      return { ok: true, restored, conflicts: [], message: `Undone - ${restored.length === 1 ? "1 file" : `${restored.length} files`} put back.` };
    },
  };
}
