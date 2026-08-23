/**
 * Closing your tags for you.
 *
 * Type `<h1>` and `</h1>` appears with the cursor between the two. Type `</` and the tag
 * that is still open completes itself. It is the smallest feature in this editor and one of
 * the two or three most missed when it is absent, because markup is the one language where
 * forgetting a closing token raises no error - it silently swallows the rest of the page,
 * and the first sign of trouble is a layout that makes no sense.
 *
 * The decision - *should* something be inserted, and what - is `@adcode/structure`'s
 * `closingTagFor`, which is pure and tested against generics, void elements, comments and
 * half-typed attributes. This file is the Monaco plumbing, and the plumbing has two hazards
 * worth naming:
 *
 * 1. **Editing a model from inside its own change event.** Monaco is mid-notification; a
 *    synchronous edit re-enters the loop and the second listener sees a model that no longer
 *    matches the event it is being told about. The insert is deferred to a microtask, after
 *    the notification has finished.
 *
 * 2. **The deferred edit can arrive too late.** A fast typist can have moved on. The model's
 *    version id is captured before the wait and checked after it, so a stale insertion is
 *    dropped rather than dropped into the wrong place.
 */
import type * as monaco from "monaco-editor";
import { closingTagFor, completeClosingTag, supportsTagClosing } from "@adcode/structure";

export interface TagClosing {
  /** `adcode.editing.autoCloseTags`. Off is a real preference, not a bug to work around. */
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export function installTagClosing(
  editor: monaco.editor.IStandaloneCodeEditor,
  monacoApi: typeof monaco,
): TagClosing {
  let enabled = true;
  /** True while this module is the one editing, so its own insert is not reacted to. */
  let inserting = false;

  const subscription = editor.onDidChangeModelContent((event) => {
    if (!enabled || inserting) return;

    // Undo and redo replay edits that were already answered when they were first made;
    // answering them again would insert a second closing tag on every Ctrl+Z.
    if (event.isUndoing || event.isRedoing) return;

    // One change, one character. A paste, a multi-cursor edit and a find-and-replace all
    // arrive here too, and none of them are somebody typing a bracket.
    if (event.changes.length !== 1) return;

    const change = event.changes[0];
    if (change === undefined) return;
    if (change.text !== ">" && change.text !== "/") return;
    if (change.rangeLength !== 0) return;

    const model = editor.getModel();
    if (model === null) return;

    const languageId = model.getLanguageId();
    if (!supportsTagClosing(languageId)) return;

    const line = change.range.startLineNumber;
    const column = change.range.startColumn + 1;

    const before = model.getValueInRange({
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: column,
    });

    const insert =
      change.text === ">"
        ? closingTagFor(before, languageId)
        : completeClosingTag(before, languageId);

    if (insert === null) return;

    /*
     * `>` leaves the cursor where it is, between the two tags, because that is where the
     * content goes. `/` moves it past what was completed, because `</div>` is finished and
     * there is nothing to type inside it.
     */
    const cursorColumn = change.text === ">" ? column : column + insert.length;
    const version = model.getAlternativeVersionId();

    queueMicrotask(() => {
      if (model.isDisposed() || model.getAlternativeVersionId() !== version) return;

      inserting = true;
      try {
        editor.executeEdits(
          "adcode.autoCloseTag",
          [
            {
              range: new monacoApi.Range(line, column, line, column),
              text: insert,
              // The cursor must not be dragged along by the insertion - for `>` the whole
              // point is that it stays behind, between the tags.
              forceMoveMarkers: false,
            },
          ],
          [new monacoApi.Selection(line, cursorColumn, line, cursorColumn)],
        );
      } finally {
        inserting = false;
      }
    });
  });

  return {
    setEnabled(next) {
      enabled = next;
    },
    dispose() {
      subscription.dispose();
    },
  };
}
