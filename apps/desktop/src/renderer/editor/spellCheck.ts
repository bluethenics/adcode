/**
 * Spelling, for comments.
 *
 * `@adcode/spell` decides what is misspelled - and, importantly, what is merely unfamiliar
 * and therefore none of its business. This file draws the result and offers the fix.
 *
 * Two things reach the user: a wavy underline under the word, and a quick fix on it. The
 * fix matters more than the underline. A checker that reports a typo and leaves you to
 * retype the word has made work rather than saved it, and the correction is already known
 * by the time the underline is drawn - there is nothing to look up.
 *
 * Deliberately not markers. Spelling in the Problems panel would sit beside compiler
 * errors under the same badge, and a misspelt comment is not a problem with the program.
 * It is also how a checker becomes the reason somebody turns the Problems badge off.
 */
import type * as monaco from "monaco-editor";
import { misspellingsIn, type Misspelling } from "@adcode/spell";

export interface SpellCheck {
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/** Long enough to sit out a burst of typing, short enough to feel immediate on a pause. */
const RESCAN_DELAY_MS = 400;

/** Past this, the whole-file scan stops being worth doing on every pause. */
const MAX_SCAN_LENGTH = 400_000;

export function installSpellCheck(
  editor: monaco.editor.IStandaloneCodeEditor,
  monacoApi: typeof monaco,
): SpellCheck {
  // Off unless switched on. Even a checker this quiet is an opinion about someone's prose,
  // and it should be one they asked for.
  let enabled = false;
  let timer: number | null = null;

  /**
   * The last scan, kept so the quick fix does not repeat it.
   *
   * A code action is requested on a keystroke-sensitive path - the lightbulb polls as the
   * cursor moves - and rescanning the file each time to answer "is there a fix here" would
   * make cursor movement cost a full pass over the document.
   */
  let latest: readonly Misspelling[] = [];

  const decorations = editor.createDecorationsCollection();

  function render(): void {
    const model = editor.getModel();
    if (!enabled || model === null) {
      latest = [];
      decorations.clear();
      return;
    }

    const text = model.getValue();
    if (text.length > MAX_SCAN_LENGTH) {
      latest = [];
      decorations.clear();
      return;
    }

    latest = misspellingsIn(text, model.getLanguageId());

    decorations.set(
      latest.map((found) => ({
        range: new monacoApi.Range(found.line, found.startColumn, found.line, found.endColumn),
        options: {
          inlineClassName: "spell-misspelling",
          hoverMessage: { value: `Did you mean **${found.suggestion}**?` },
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

  /**
   * Registered for every language rather than the ones with comments.
   *
   * Asking `@adcode/spell` about a language it cannot find comments in returns nothing, so
   * the filtering already happens where the knowledge is. Enumerating languages here would
   * be a second list to keep in step with the first.
   */
  const codeActions = monacoApi.languages.registerCodeActionProvider("*", {
    provideCodeActions(model, range) {
      const none = { actions: [], dispose: () => undefined };
      if (!enabled || model !== editor.getModel()) return none;

      const here = latest.filter(
        (found) =>
          found.line === range.startLineNumber &&
          found.startColumn <= range.endColumn &&
          found.endColumn >= range.startColumn,
      );

      return {
        actions: here.map((found) => ({
          title: `Change "${found.word}" to "${found.suggestion}"`,
          kind: "quickfix",
          edit: {
            edits: [
              {
                resource: model.uri,
                versionId: model.getVersionId(),
                textEdit: {
                  range: new monacoApi.Range(
                    found.line,
                    found.startColumn,
                    found.line,
                    found.endColumn,
                  ),
                  text: found.suggestion,
                },
              },
            ],
          },
        })),
        dispose: () => undefined,
      };
    },
  });

  const subscriptions = [
    editor.onDidChangeModelContent(() => schedule()),
    // Immediately on a model swap: opening a file should not have a pause before it
    // settles, and there is no burst of typing to sit out.
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
      codeActions.dispose();
      decorations.clear();
    },
  };
}
