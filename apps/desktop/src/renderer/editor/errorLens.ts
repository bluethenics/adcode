/**
 * The error, at the end of the line it is about.
 *
 * Otherwise a diagnostic lives in a panel at the bottom of the window or inside a tooltip
 * you have to hover to see, and both mean looking away from the line you are fixing. The
 * squiggle tells you *that* something is wrong; this tells you *what*, without moving.
 *
 * Three rules keep it from being the noisy version of this feature that people turn off:
 *
 * 1. **One message per line.** A line with four problems shows the worst one and a count.
 *    Four stacked messages is not information, it is a wall.
 * 2. **Nothing on the line you are typing on.** Text appearing and disappearing beside a
 *    moving cursor is the single most distracting thing an editor can do. The line the
 *    cursor is on is left clear until the cursor leaves it.
 * 3. **Truncated, and dimmed.** The message sits in the margin the code is not using. If it
 *    does not fit in a reasonable width it is cut, because the panel and the hover both
 *    still have the whole thing.
 *
 * The rewrite into plain English is `@adcode/diagnostics`, the same table the Problems
 * panel uses, so the two never word the same error differently.
 */
import type * as monaco from "monaco-editor";
import { explain } from "@adcode/diagnostics";
import { toDiagnostic } from "../diagnostics/markerAdapter.ts";

export interface ErrorLens {
  setEnabled(enabled: boolean): void;
  /** `adcode.editing.plainEnglishErrors` - whether to rewrite before showing. */
  setPlainEnglish(enabled: boolean): void;
  dispose(): void;
}

/** Long enough to be a sentence, short enough to stay out of the way. */
const MAX_LENGTH = 90;

const truncate = (text: string): string =>
  text.length <= MAX_LENGTH ? text : `${text.slice(0, MAX_LENGTH - 1).trimEnd()}…`;

/** One line's worth of message, collapsed onto one line. */
const flatten = (text: string): string => text.replace(/\s+/g, " ").trim();

export function installErrorLens(
  editor: monaco.editor.IStandaloneCodeEditor,
  monacoApi: typeof monaco,
): ErrorLens {
  let enabled = true;
  let plainEnglish = true;

  const decorations = editor.createDecorationsCollection();

  function render(): void {
    const model = editor.getModel();
    if (!enabled || model === null) {
      decorations.clear();
      return;
    }

    /*
     * Errors and warnings only.
     *
     * The row is called "inline error and warning lens" and that is exactly what it should
     * be. TypeScript also emits Info and Hint markers - "declared but its value is never
     * read" for every variable you have not used yet - and putting those at the end of the
     * line means a file being written normally is covered in grey annotations about work in
     * progress. They are still in the Problems panel and still on hover.
     */
    const markers = monacoApi.editor
      .getModelMarkers({ resource: model.uri })
      .filter(
        (marker) =>
          marker.severity === monacoApi.MarkerSeverity.Error ||
          marker.severity === monacoApi.MarkerSeverity.Warning,
      );

    if (markers.length === 0) {
      decorations.clear();
      return;
    }

    const cursorLine = editor.getPosition()?.lineNumber ?? -1;
    renderedCursorLine = cursorLine;

    /*
     * Worst per line, and how many there are.
     *
     * Monaco's severity is an ascending scale with Error highest, so a plain comparison
     * picks the one worth reading. Ties keep the first, which is the leftmost on the line.
     */
    const worst = new Map<number, { marker: monaco.editor.IMarker; count: number }>();
    for (const marker of markers) {
      const line = marker.startLineNumber;
      const existing = worst.get(line);

      if (existing === undefined) worst.set(line, { marker, count: 1 });
      else {
        worst.set(line, {
          marker: marker.severity > existing.marker.severity ? marker : existing.marker,
          count: existing.count + 1,
        });
      }
    }

    const next: monaco.editor.IModelDeltaDecoration[] = [];

    for (const [line, { marker, count }] of worst) {
      if (line === cursorLine) continue;
      if (line > model.getLineCount()) continue;

      const diagnostic = toDiagnostic(marker, "");
      const rewritten = plainEnglish && diagnostic !== null ? explain(diagnostic) : null;
      const message = flatten(rewritten?.plain ?? marker.message);

      const suffix = count > 1 ? ` (+${String(count - 1)} more)` : "";
      const tone = marker.severity === monacoApi.MarkerSeverity.Error ? "error" : "warning";

      next.push({
        range: new monacoApi.Range(line, model.getLineMaxColumn(line), line, model.getLineMaxColumn(line)),
        options: {
          // `stickiness` so the note stays with its line while text above it is edited,
          // rather than being left behind on whatever line inherits the offset.
          stickiness: monacoApi.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          after: {
            content: `    ${truncate(message)}${suffix}`,
            inlineClassName: `error-lens error-lens-${tone}`,
            cursorStops: monacoApi.editor.InjectedTextCursorStops.None,
          },
          showIfCollapsed: true,
        },
      });
    }

    decorations.set(next);
  }

  /*
   * Which line was suppressed last time anything was drawn.
   *
   * Rule 2 is a per-line decision, so moving along a line changes nothing that is rendered
   * and redrawing for it would rebuild every decoration on every keystroke. Only crossing
   * into a different line matters.
   */
  let renderedCursorLine = -1;

  const subscriptions = [
    monacoApi.editor.onDidChangeMarkers(() => render()),
    editor.onDidChangeModel(() => render()),

    /*
     * Dropped the moment the text changes, and redrawn when the markers catch up.
     *
     * This decoration is *injected text* - Monaco measures it as part of the line - and a
     * lens left over an edit that changed the line's length makes the tokenizer and the
     * text disagree. Format-on-save replaces the whole document at once and produced
     * exactly that: "Token length and text length do not match!" in the console.
     *
     * Clearing on every edit also happens to be the behaviour rule 2 wants: annotations
     * stay out of the way while you are typing, and reappear once the compiler has an
     * opinion again.
     */
    editor.onDidChangeModelContent(() => decorations.clear()),
    editor.onDidChangeCursorPosition((event) => {
      if (event.position.lineNumber === renderedCursorLine) return;
      render();
    }),
  ];

  render();

  return {
    setEnabled(next) {
      enabled = next;
      render();
    },
    setPlainEnglish(next) {
      plainEnglish = next;
      render();
    },
    dispose() {
      for (const subscription of subscriptions) subscription.dispose();
      decorations.clear();
    },
  };
}
