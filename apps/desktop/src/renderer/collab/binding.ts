/**
 * Binding a Monaco model to a Yjs replica.
 *
 * The renderer holds its own `Y.Doc` per shared file and syncs it to the authoritative copy in
 * the main process using Yjs's own update format - which is transport-agnostic, so the IPC
 * bridge is just another Yjs provider. See `main/collab/docs.ts` for why the authority sits on
 * that side.
 *
 * **The loop is the thing to get right.** A local keystroke has to reach the replica, and a
 * remote change has to reach Monaco, and neither may come back around:
 *
 *     Monaco change ──(origin: LOCAL)──▶ Y.Text ──▶ update ──▶ main ──▶ peers
 *     peers ──▶ main ──▶ update ──(origin: REMOTE)──▶ Y.Text ──▶ Monaco edit
 *
 * Two guards, because they fail differently. The Yjs **origin tag** stops a remote update being
 * sent back out as though it were typed here. The `applying` **flag** stops the Monaco edit made
 * in response to a remote change from being read back as a new local edit - Monaco fires its
 * change event synchronously during `pushEditOperations`, so without the flag every remote
 * character would be echoed to every peer, once per peer, forever.
 *
 * Remote edits go through `pushEditOperations` rather than `setValue` for the reason
 * `editorHost.replaceText` does: the change lands on the undo stack as one step, and the local
 * user's cursor, selection and folds survive it. `setValue` would move the caret to the top of
 * the file every time a collaborator typed.
 */
import * as monaco from "monaco-editor";
import * as Y from "yjs";
import { changeToOps, deltaToEdits, orderChanges } from "./deltas.ts";

/** The shared type's name. Both peers must agree or they silently edit different documents. */
const TEXT_KEY = "text";

/** Tags on Yjs transactions, so an update's provenance is never guessed. */
const LOCAL = "monaco-local";
const REMOTE = "ipc-remote";

export interface DocBinding {
  /** Apply an update that arrived from the main process. */
  applyRemote(update: Uint8Array): void;
  /** The replica's current text, for comparison against the model. */
  text(): string;
  dispose(): void;
}

export interface BindingDeps {
  readonly model: monaco.editor.ITextModel;
  /** The document's state as it exists in the main process, to start from. */
  readonly initialState: Uint8Array | null;
  /** Ship a local update onward. Called with base64. */
  readonly onLocalUpdate: (update: string) => void;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked: `String.fromCharCode(...bytes)` blows the argument limit on a large first sync,
  // which is exactly when this runs.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function bindModel(deps: BindingDeps): DocBinding {
  const doc = new Y.Doc();
  const text = doc.getText(TEXT_KEY);

  /** True while a remote change is being written into Monaco. See the loop note above. */
  let applying = false;
  let disposed = false;

  if (deps.initialState !== null) {
    Y.applyUpdate(doc, deps.initialState, REMOTE);
  }

  /*
   * Reconcile the model with the replica once, before either side is listening.
   *
   * The file is already open in Monaco - read from the user's own disk - and the session's copy
   * is the one everyone else is looking at. Where they differ, the session wins: a host's file
   * and its shared document are the same bytes, and for a guest the local model was never
   * authoritative in the first place.
   *
   * Skipped when they already match, which is the common case and avoids putting a pointless
   * entry on the undo stack.
   */
  const seeded = text.toString();
  if (deps.initialState !== null && seeded !== deps.model.getValue()) {
    applying = true;
    try {
      deps.model.pushEditOperations(
        [],
        [{ range: deps.model.getFullModelRange(), text: seeded }],
        () => null,
      );
    } finally {
      applying = false;
    }
  } else if (deps.initialState === null && deps.model.getValue().length > 0) {
    // No session state at all: this document is new to the session, so the local file seeds it.
    doc.transact(() => {
      text.insert(0, deps.model.getValue());
    }, LOCAL);
  }

  /* ── Replica to Monaco ──────────────────────────────────────────────────── */

  const observer = (event: Y.YTextEvent, transaction: Y.Transaction): void => {
    // Our own edit coming back around. Writing it into Monaco would be a no-op at best and a
    // duplicated insertion at worst.
    if (transaction.origin === LOCAL) return;

    const edits = deltaToEdits(event.delta as never);
    if (edits.length === 0) return;

    applying = true;
    try {
      deps.model.pushEditOperations(
        [],
        edits.map((edit) => ({
          // The offsets are against the document before this delta, which is the model's
          // current state - so converting them here is correct, and converting them any later
          // would not be.
          range: monaco.Range.fromPositions(
            deps.model.getPositionAt(edit.start),
            deps.model.getPositionAt(edit.end),
          ),
          text: edit.text,
        })),
        () => null,
      );
    } finally {
      // `finally`, so a throw inside Monaco cannot leave the flag stuck on - which would
      // silently stop this peer from ever sending another edit.
      applying = false;
    }
  };

  text.observe(observer);

  /* ── Monaco to replica ──────────────────────────────────────────────────── */

  const modelListener = deps.model.onDidChangeContent((event) => {
    if (applying || disposed) return;

    doc.transact(() => {
      // Descending offsets, so each operation is unaffected by the ones already applied.
      for (const change of orderChanges(event.changes)) {
        for (const op of changeToOps(change)) {
          if (op.kind === "delete") text.delete(op.index, op.length ?? 0);
          else text.insert(op.index, op.text ?? "");
        }
      }
    }, LOCAL);
  });

  /* ── Replica to the main process ────────────────────────────────────────── */

  const updateListener = (update: Uint8Array, origin: unknown): void => {
    // Only what originated here. An update tagged REMOTE came *from* the main process, and
    // sending it back would double the traffic on every keystroke in the session.
    if (origin === REMOTE || disposed) return;
    deps.onLocalUpdate(toBase64(update));
  };

  doc.on("update", updateListener);

  return {
    applyRemote(update) {
      if (disposed) return;

      try {
        Y.applyUpdate(doc, update, REMOTE);
      } catch {
        // A malformed update must not take the editor down. It has already passed the
        // protocol's base64 check; nothing proved it was a valid Yjs update.
      }
    },

    text: () => text.toString(),

    dispose() {
      disposed = true;
      text.unobserve(observer);
      doc.off("update", updateListener);
      modelListener.dispose();
      doc.destroy();
    },
  };
}
