/**
 * The arithmetic between a Yjs text delta and a Monaco edit. Pure, and tested as such.
 *
 * This exists as its own file for the reason `packages/lsp` holds the framing and the
 * position conversion: the parts of an integration that actually break are the index
 * conversions, and they only ever get tested when they can be called without an editor.
 *
 * Two coordinate systems meet here and they agree about nothing:
 *
 * - **Yjs** addresses text as a flat sequence of UTF-16 code units from the start of the
 *   document. A delta is a run of `retain` / `insert` / `delete` operations applied in order,
 *   each moving an implicit cursor.
 * - **Monaco** addresses text as one-based line and column pairs, and takes edits as ranges.
 *
 * The conversion has to happen against the document as it was *before* the edit, and it has to
 * process operations in order while accounting for the ones already applied - which is the part
 * that is easy to get subtly wrong and impossible to notice until two people type at once.
 */

/** One operation from a Yjs text delta, in the shape `Y.Text`'s observer produces. */
export interface TextDelta {
  readonly retain?: number;
  readonly insert?: string;
  readonly delete?: number;
}

/**
 * An edit expressed in flat offsets.
 *
 * Deliberately not Monaco ranges: converting an offset to a line and column needs the model,
 * and keeping that dependency out is what makes this file testable. The caller does the last
 * step with `model.getPositionAt`.
 */
export interface OffsetEdit {
  readonly start: number;
  /** Equal to `start` for a pure insertion. */
  readonly end: number;
  readonly text: string;
}

/**
 * Turn a Yjs delta into a list of offset edits.
 *
 * The returned edits are expressed against the **original** document, not against each other,
 * so a caller may apply them in one batch. That is what Monaco's `pushEditOperations` wants,
 * and it is also the only version that survives being applied in a single undo step.
 *
 * The cursor walks the original document: `retain` advances it, `delete` consumes from it, and
 * `insert` produces an edit without advancing it - because inserted text is not part of the
 * document these offsets refer to. Getting that last case wrong shifts every subsequent edit in
 * the delta by the length of the insertion, which shows up as text landing a few characters off
 * whenever two people edit the same line - the exact case this whole feature exists for.
 */
export function deltaToEdits(delta: readonly TextDelta[]): readonly OffsetEdit[] {
  const edits: OffsetEdit[] = [];
  let cursor = 0;

  for (const op of delta) {
    if (typeof op.retain === "number") {
      cursor += op.retain;
      continue;
    }

    if (typeof op.insert === "string") {
      edits.push({ start: cursor, end: cursor, text: op.insert });
      continue;
    }

    if (typeof op.delete === "number") {
      edits.push({ start: cursor, end: cursor + op.delete, text: "" });
      cursor += op.delete;
      continue;
    }
  }

  return edits;
}

/**
 * Turn a Monaco content change into the pair of Yjs operations that reproduce it.
 *
 * Monaco reports a change as "this range became this text", which is a delete and an insert in
 * one. Yjs needs them separately and in that order - inserting first would place the new text
 * inside the range about to be deleted.
 *
 * A zero-length deletion and an empty insertion are both skipped rather than issued as no-ops,
 * because an empty `Y.Text` operation still produces an update, and an update that changes
 * nothing is a message sent to every peer for no reason on a path that runs per keystroke.
 */
export interface YjsTextOp {
  readonly kind: "delete" | "insert";
  readonly index: number;
  /** Present for `delete`. */
  readonly length?: number;
  /** Present for `insert`. */
  readonly text?: string;
}

export function changeToOps(change: {
  readonly rangeOffset: number;
  readonly rangeLength: number;
  readonly text: string;
}): readonly YjsTextOp[] {
  const ops: YjsTextOp[] = [];

  if (change.rangeLength > 0) {
    ops.push({ kind: "delete", index: change.rangeOffset, length: change.rangeLength });
  }

  if (change.text.length > 0) {
    ops.push({ kind: "insert", index: change.rangeOffset, text: change.text });
  }

  return ops;
}

/**
 * Order several Monaco changes so they can be applied one after another.
 *
 * Monaco reports the changes in a single edit **in descending order of offset**, which is what
 * lets a consumer apply them without recomputing offsets - each edit is entirely after the
 * ranges of the ones already applied. Yjs operations mutate the document as they go, so that
 * same descending order is what has to be preserved.
 *
 * Sorted defensively rather than trusted. The ordering is documented Monaco behaviour, but a
 * multi-cursor edit arriving in the other order would corrupt text in a way no test here would
 * catch, and sorting a list of at most a few dozen changes costs nothing.
 */
export function orderChanges<T extends { readonly rangeOffset: number }>(
  changes: readonly T[],
): readonly T[] {
  return [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
}
