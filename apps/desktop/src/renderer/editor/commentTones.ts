/**
 * Colouring comments by what they are for.
 *
 * A warning, an open question, and a line of commented-out code all render the same grey,
 * and they are not the same thing. `@adcode/structure`'s `commentTonesIn` decides which is
 * which - pure and tested, including the case that sinks this feature if you get it wrong,
 * where a JSDoc block's leading `*` marks every documented function in the project. This
 * file is the Monaco plumbing and owns nothing else.
 *
 * Rescanned on a timer rather than on every keystroke, for the same reason as the TODO
 * badges beside it: the scan is a pass over the file, and nobody needs a comment to change
 * colour in the same frame as the character that changed it.
 */
import type * as monaco from "monaco-editor";
import { commentTonesIn } from "@adcode/structure";

export interface CommentTones {
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/** Long enough to sit out a burst of typing, short enough to feel immediate on a pause. */
const RESCAN_DELAY_MS = 300;

/** Past this, the whole-file scan stops being worth doing on every pause. */
const MAX_SCAN_LENGTH = 400_000;

export function installCommentTones(
  editor: monaco.editor.IStandaloneCodeEditor,
  monacoApi: typeof monaco,
): CommentTones {
  // Off unless switched on: this repaints code people are already reading, and a colour
  // scheme nobody asked for is worse than no colour scheme.
  let enabled = false;
  let timer: number | null = null;

  const decorations = editor.createDecorationsCollection();

  function render(): void {
    const model = editor.getModel();
    if (!enabled || model === null) {
      decorations.clear();
      return;
    }

    const text = model.getValue();
    if (text.length > MAX_SCAN_LENGTH) {
      decorations.clear();
      return;
    }

    const toned = commentTonesIn(text, model.getLanguageId());

    decorations.set(
      toned.map((comment) => ({
        range: new monacoApi.Range(
          comment.line,
          comment.startColumn,
          comment.line,
          comment.endColumn,
        ),
        options: {
          inlineClassName: `comment-tone comment-tone-${comment.tone}`,
          stickiness: monacoApi.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })),
    );
  }

  function schedule(): void {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      render();
    }, RESCAN_DELAY_MS);
  }

  const subscriptions = [
    editor.onDidChangeModelContent(() => schedule()),
    // Immediately on a model swap: opening a file should not have a pause before its
    // comments settle, and there is no burst of typing to sit out.
    editor.onDidChangeModel(() => render()),
    editor.onDidChangeModelLanguage(() => render()),
  ];

  render();

  return {
    setEnabled(next) {
      enabled = next;
      render();
    },
    dispose() {
      if (timer !== null) window.clearTimeout(timer);
      for (const subscription of subscriptions) subscription.dispose();
      decorations.clear();
    },
  };
}
