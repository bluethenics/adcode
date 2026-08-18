/**
 * The Yjs documents, and the bridge between them and the host's disk.
 *
 * One `Y.Doc` per open file, keyed by workspace-relative path, each holding a single `Y.Text`
 * named `"text"`. Yjs is what makes two people typing on the same line converge instead of
 * overwriting each other, and it is a dependency rather than something written here for a
 * reason worth stating: concurrent text editing across three or more peers is a genuine
 * distributed-systems problem, and the failure mode of getting it slightly wrong is silent
 * corruption of the user's source code.
 *
 * **Where the authoritative copy lives.** Here, in the main process - not in the renderer. The
 * renderer holds a replica bound to Monaco and syncs to this one over IPC using Yjs's own
 * update format, which is transport-agnostic and order-independent, so the IPC bridge is just
 * another Yjs provider. Two consequences, both deliberate:
 *
 * - Local typing never waits for a round trip. Monaco applies the edit immediately and the
 *   update propagates afterwards.
 * - On save, this process already holds the text. It never has to ask the renderer what the
 *   file says, so the host's authority over its own disk does not rest on trusting a renderer -
 *   which §1 is explicit that it must not.
 *
 * Updates cross the wire as base64 because the protocol is JSON. See `protocol.ts`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Y from "yjs";
import { isInsideWorkspace } from "../pathSafety.ts";

/** The one shared type in every document. Both peers must agree on the name or they diverge. */
const TEXT_KEY = "text";

/**
 * Where an update came from, so a change is not echoed back to whoever caused it.
 *
 * Yjs tags every transaction with an origin. Without one, applying a peer's update would emit
 * an update event that gets sent straight back to that peer - which converges, because Yjs is
 * idempotent, but doubles the traffic on every keystroke and makes a loop impossible to see in
 * a log.
 */
export const ORIGIN_REMOTE = "remote";
export const ORIGIN_DISK = "disk";
export const ORIGIN_LOCAL = "local";

export interface DocUpdate {
  readonly path: string;
  readonly update: Uint8Array;
  /** One of the `ORIGIN_*` values, or `null` for a local edit with no tag. */
  readonly origin: unknown;
}

export interface DocStore {
  /**
   * The document for a path, created and seeded from disk if this is the first request.
   *
   * `null` when the path escapes the workspace or cannot be read. Never throws for a bad path:
   * the caller is handling a message from another machine and needs a value, not an exception.
   */
  open(path: string): Promise<Y.Doc | null>;
  /** Everything needed to bring a fresh peer up to date on one document. */
  stateOf(path: string): Uint8Array | null;
  /**
   * Apply an update that came from somewhere else.
   *
   * `origin` defaults to `ORIGIN_REMOTE`, which is what a guest wants: one peer, nothing to
   * distinguish. A host passes `peer:<linkId>` instead, because it has to know which peer
   * caused a change in order to leave them out of the fan-out.
   */
  applyRemote(path: string, update: Uint8Array, origin?: unknown): boolean;
  text(path: string): string | null;
  /** Write the document to the host's disk. Returns false when the path is not shareable. */
  save(path: string): Promise<boolean>;
  /** Re-seed a document from disk, for a file changed outside the session. */
  reload(path: string): Promise<boolean>;
  close(path: string): void;
  onUpdate(listener: (update: DocUpdate) => void): void;
  dispose(): void;
}

export interface DocStoreDeps {
  /** The open folder. Every path is resolved against it and checked to be inside it. */
  readonly root: string;
  /**
   * Whether this store owns the disk.
   *
   * True on the host. False on a guest, where `open` must never read a local file - a guest's
   * machine has its own unrelated folder at any given relative path, and seeding from it would
   * mean editing a file nobody in the session can see.
   */
  readonly ownsDisk: boolean;
}

/**
 * Resolve a workspace-relative path, or `null`.
 *
 * The second of the two guards on this field. `protocol.ts` already refused traversal, drive
 * letters, backslashes and NUL on the way in - but that check knows nothing about where the
 * workspace actually is, and this one knows nothing about what a well-formed message looks
 * like. Both are needed, and this is the one that would catch a path that becomes an escape
 * only after resolution, such as one crossing a symlink.
 */
function resolveInside(root: string, path: string): string | null {
  if (path.length === 0 || path.includes("\0")) return null;

  const candidate = join(root, path);
  return isInsideWorkspace(root, candidate) ? candidate : null;
}

export function createDocStore(deps: DocStoreDeps): DocStore {
  const docs = new Map<string, Y.Doc>();
  const listeners: ((update: DocUpdate) => void)[] = [];

  function emit(update: DocUpdate): void {
    for (const listener of listeners) listener(update);
  }

  function create(path: string, seed: string | null): Y.Doc {
    const doc = new Y.Doc();

    if (seed !== null && seed.length > 0) {
      // Tagged `ORIGIN_DISK` so the seeding insert is distinguishable from a user's typing.
      // A guest joining later receives the state vector, not this update, so the tag only
      // matters for anyone already connected.
      doc.transact(() => {
        doc.getText(TEXT_KEY).insert(0, seed);
      }, ORIGIN_DISK);
    }

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      emit({ path, update, origin });
    });

    docs.set(path, doc);
    return doc;
  }

  return {
    async open(path) {
      const existing = docs.get(path);
      if (existing !== undefined) return existing;

      if (!deps.ownsDisk) {
        /*
         * A guest creates the document empty and waits for `doc-state`.
         *
         * Reading the local disk here would be actively harmful rather than merely useless: the
         * guest has their own unrelated folder, so `src/main.ts` on their machine is a
         * different file, and seeding from it would mean two peers editing text that never
         * matched - with the guest's local content silently merged into the host's file.
         */
        return create(path, null);
      }

      const resolved = resolveInside(deps.root, path);
      if (resolved === null) return null;

      let seed: string;
      try {
        seed = await readFile(resolved, "utf8");
      } catch {
        // Unreadable, missing, or a directory. `null` rather than an empty document: creating
        // one would let a peer's first save write a file that never existed.
        return null;
      }

      // Re-checked after the await. Two messages for the same path can be in flight, and the
      // other one may have created the document while this read was pending - two `Y.Doc`s for
      // one path is a permanent fork.
      const raced = docs.get(path);
      if (raced !== undefined) return raced;

      return create(path, seed);
    },

    stateOf(path) {
      const doc = docs.get(path);
      return doc === undefined ? null : Y.encodeStateAsUpdate(doc);
    },

    applyRemote(path, update, origin = ORIGIN_REMOTE) {
      const doc = docs.get(path);
      if (doc === undefined) return false;

      try {
        Y.applyUpdate(doc, update, origin);
        return true;
      } catch {
        // A malformed update is a refused message, never a thrown exception into a socket
        // handler. `protocol.ts` proved the payload was base64; nothing proved it was Yjs.
        return false;
      }
    },

    text(path) {
      const doc = docs.get(path);
      return doc === undefined ? null : doc.getText(TEXT_KEY).toString();
    },

    async save(path) {
      if (!deps.ownsDisk) return false;

      const doc = docs.get(path);
      if (doc === undefined) return false;

      const resolved = resolveInside(deps.root, path);
      if (resolved === null) return false;

      await writeFile(resolved, doc.getText(TEXT_KEY).toString(), "utf8");
      return true;
    },

    async reload(path) {
      if (!deps.ownsDisk) return false;

      const doc = docs.get(path);
      const resolved = resolveInside(deps.root, path);
      if (doc === undefined || resolved === null) return false;

      let next: string;
      try {
        next = await readFile(resolved, "utf8");
      } catch {
        return false;
      }

      const text = doc.getText(TEXT_KEY);
      if (text.toString() === next) return true;

      /*
       * Replace the whole text in one transaction.
       *
       * Crude next to a diff, and correct: this runs when a file changed underneath the session
       * - a checkout, a formatter, a build step - and in that case there is no user intent to
       * preserve in the old content. One transaction rather than delete-then-insert as separate
       * steps, so no peer ever observes the document empty.
       */
      doc.transact(() => {
        text.delete(0, text.length);
        text.insert(0, next);
      }, ORIGIN_DISK);

      return true;
    },

    close(path) {
      const doc = docs.get(path);
      if (doc === undefined) return;

      doc.destroy();
      docs.delete(path);
    },

    onUpdate(listener) {
      listeners.push(listener);
    },

    dispose() {
      for (const doc of docs.values()) doc.destroy();
      docs.clear();
      listeners.length = 0;
    },
  };
}

/** Base64 for the wire. The protocol is JSON, so updates travel as text. */
export function encodeUpdate(update: Uint8Array): string {
  return Buffer.from(update).toString("base64");
}

/**
 * Decode a wire payload, or `null`.
 *
 * `protocol.ts` already proved the string is base64; this proves it decodes to bytes. Neither
 * proves it is a valid Yjs update - only `Y.applyUpdate` can, which is why `applyRemote`
 * catches.
 */
export function decodeUpdate(encoded: string): Uint8Array | null {
  try {
    return new Uint8Array(Buffer.from(encoded, "base64"));
  } catch {
    return null;
  }
}
