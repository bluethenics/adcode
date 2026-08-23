/**
 * Renaming a tag renames its partner.
 *
 * Change `<section>` to `<article>` and the `</section>` below follows, keystroke for
 * keystroke, in the same undo step.
 *
 * **The awkward part is that the pair stops matching the moment you start typing.** As soon
 * as the opening tag reads `<sectiona`, searching for its partner by name finds nothing -
 * the closing tag still says `section`. So the pair cannot be recomputed from the text
 * after each keystroke; it has to be remembered from *before* the edit and then carried
 * along.
 *
 * That is what `linked` is. It is established when the cursor lands inside a tag name, and
 * from then on every edit inside that name is mirrored and the remembered spans are moved
 * to match. Anything unexpected - a multi-cursor edit, a paste, an undo, a name that stops
 * being a name - drops the link rather than guessing, and the next cursor move establishes
 * a fresh one.
 */
import type * as monaco from "monaco-editor";
import { pairedTagAt, supportsTagClosing, type TagNameSpan } from "@adcode/structure";

export interface PairedTagRename {
  /** `adcode.editing.autoRenamePairedTag`. */
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

interface Link {
  self: TagNameSpan;
  partner: TagNameSpan;
}

/** A tag name, once it is finished. Anything else means the edit is no longer a rename. */
const IS_NAME = /^[A-Za-z][A-Za-z0-9\-.:_]*$/;

const shifted = (span: TagNameSpan, delta: number): TagNameSpan => ({
  line: span.line,
  startColumn: span.startColumn + delta,
  endColumn: span.endColumn + delta,
});

export function installPairedTagRename(
  editor: monaco.editor.IStandaloneCodeEditor,
  monacoApi: typeof monaco,
): PairedTagRename {
  let enabled = true;
  let editing = false;
  let link: Link | null = null;

  /** Work out which pair the cursor is sitting in, if any. */
  function relink(): void {
    if (!enabled) {
      link = null;
      return;
    }

    const model = editor.getModel();
    const position = editor.getPosition();
    if (model === null || position === null) {
      link = null;
      return;
    }

    if (!supportsTagClosing(model.getLanguageId())) {
      link = null;
      return;
    }

    const found = pairedTagAt(model.getValue(), position.lineNumber, position.column);
    link = found === null ? null : { self: found.self, partner: found.partner };
  }

  const cursorSubscription = editor.onDidChangeCursorPosition(() => relink());
  const modelSubscription = editor.onDidChangeModel(() => relink());

  const contentSubscription = editor.onDidChangeModelContent((event) => {
    if (!enabled || editing) return;

    if (event.isUndoing || event.isRedoing) {
      // Undo replays the mirrored edit too - it was part of the same operation. Re-mirroring
      // it would double the change.
      link = null;
      return;
    }

    const current = link;
    if (current === null) return;

    if (event.changes.length !== 1) {
      link = null;
      return;
    }

    const change = event.changes[0];
    if (change === undefined) {
      link = null;
      return;
    }

    const model = editor.getModel();
    if (model === null) {
      link = null;
      return;
    }

    // The edit has to be inside the name being renamed. `endColumn` is inclusive here on
    // purpose: typing at the very end of `div` is the ordinary way to extend it.
    const onNameLine = change.range.startLineNumber === current.self.line;
    const inName =
      change.range.startColumn >= current.self.startColumn &&
      change.range.endColumn <= current.self.endColumn;

    if (!onNameLine || !inName) {
      link = null;
      return;
    }

    const delta = change.text.length - change.rangeLength;
    const selfEnd = current.self.endColumn + delta;
    if (selfEnd <= current.self.startColumn) {
      // The whole name is gone. There is nothing left to mirror, and mirroring emptiness
      // would delete the partner's name too.
      link = null;
      return;
    }

    const name = model.getValueInRange({
      startLineNumber: current.self.line,
      startColumn: current.self.startColumn,
      endLineNumber: current.self.line,
      endColumn: selfEnd,
    });

    if (!IS_NAME.test(name)) {
      // A space, a bracket, a newline - the edit has stopped being a rename.
      link = null;
      return;
    }

    /*
     * The partner moves too, when it shares a line and sits to the right.
     *
     * `<b>x</b>` is one line, so typing into the opening name pushes the closing one along.
     * Recomputing the partner from the text instead would find nothing, which is the whole
     * reason this link is carried rather than derived.
     */
    const partnerShifts =
      current.partner.line === current.self.line &&
      current.partner.startColumn > current.self.startColumn;
    const partner = partnerShifts ? shifted(current.partner, delta) : current.partner;

    const version = model.getAlternativeVersionId();

    queueMicrotask(() => {
      if (model.isDisposed() || model.getAlternativeVersionId() !== version) return;

      editing = true;
      try {
        editor.executeEdits("adcode.renamePairedTag", [
          {
            range: new monacoApi.Range(
              partner.line,
              partner.startColumn,
              partner.line,
              partner.endColumn,
            ),
            text: name,
            forceMoveMarkers: false,
          },
        ]);
      } finally {
        editing = false;
      }

      link = {
        self: { line: current.self.line, startColumn: current.self.startColumn, endColumn: selfEnd },
        partner: {
          line: partner.line,
          startColumn: partner.startColumn,
          endColumn: partner.startColumn + name.length,
        },
      };
    });
  });

  return {
    setEnabled(next) {
      enabled = next;
      if (!next) link = null;
      else relink();
    },
    dispose() {
      cursorSubscription.dispose();
      modelSubscription.dispose();
      contentSubscription.dispose();
    },
  };
}
