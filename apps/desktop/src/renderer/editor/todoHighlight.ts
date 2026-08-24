/**
 * Making the notes you left yourself findable.
 *
 * `TODO`, `FIXME`, `HACK`, `XXX` and `NOTE` get a badge where they sit, so the comment you
 * meant to come back to is visible from across the file rather than only when you happen to
 * read that line again.
 *
 * The judgement - is this column inside a comment, or is it the word appearing in code - is
 * `@adcode/structure`'s `todoMarksIn`, which is pure and tested. This file is the Monaco
 * plumbing and owns nothing else.
 *
 * Rescanned on a timer rather than on every keystroke. The scan is a pass over the file, so
 * on a long one it is not free, and nobody needs a note to light up in the same frame as
 * the letter that completed it.
 */
import type * as monaco from "monaco-editor";
import { todoMarksIn } from "@adcode/structure";

export interface TodoHighlight {
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/** Long enough to sit out a burst of typing, short enough to feel immediate on a pause. */
const RESCAN_DELAY_MS = 300;

/** Past this, the whole-file scan stops being worth doing on every pause. */
const MAX_SCAN_LENGTH = 400_000;

export function installTodoHighlight(
  editor: monaco.editor.IStandaloneCodeEditor,
  monacoApi: typeof monaco,
): TodoHighlight {
  let enabled = true;
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

    const marks = todoMarksIn(text, model.getLanguageId());

    decorations.set(
      marks.map((mark) => ({
        range: new monacoApi.Range(mark.line, mark.startColumn, mark.line, mark.endColumn),
        options: {
          inlineClassName: `todo-mark todo-mark-${mark.keyword.toLowerCase()}`,
          // So a note is findable by the shape of the file, not only by reading it.
          overviewRuler: {
            color: "rgba(255, 149, 0, 0.7)",
            position: monacoApi.editor.OverviewRulerLane.Right,
          },
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
    // Immediately on a model swap: opening a file should not have a pause before its notes
    // appear, and there is no burst of typing to sit out.
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
