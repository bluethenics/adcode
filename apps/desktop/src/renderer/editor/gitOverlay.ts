/**
 * The git layer drawn on top of the editing surface.
 *
 * Brief §4's Git group asks for three things that live in the text rather than beside it:
 * gutter diff decorations (`on`), blame (`off` by default), and merge-conflict resolution
 * (`on`). All three are decorations and widgets over the model Monaco already has - none
 * of them re-implement editing, in keeping with §2's "Monaco is the editing surface only".
 *
 * Conflict resolution edits through `executeEdits` rather than replacing the model's text,
 * so accepting a side is one undo away like every other edit in the file.
 */
import * as monaco from "monaco-editor";
import { applyResolution, findConflicts, type ConflictBlock } from "@adcode/git/conflicts";
import type { BlameLineView, LineChangeView } from "../../shared/api.ts";

export interface GitOverlay {
  /** Draw the gutter bars for one file's changes. */
  setLineChanges(changes: readonly LineChangeView[]): void;
  /** Blame data for the open file, or null to stop showing it. */
  setBlame(lines: readonly BlameLineView[] | null): void;
  /** Re-read the model and redraw conflict decorations and buttons. */
  refreshConflicts(): void;
  /** True when the open file still has markers in it. */
  hasConflicts(): boolean;
  /** Called after the user accepts a side, so the shell can save and refresh. */
  onResolved(listener: () => void): void;
  clear(): void;
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "3 days ago" from an ISO date, or "" if it will not parse. */
function ago(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";

  const seconds = (then - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }

  return RELATIVE.format(Math.round(seconds), "second");
}

export function createGitOverlay(editor: monaco.editor.IStandaloneCodeEditor): GitOverlay {
  const diffDecorations = editor.createDecorationsCollection();
  const blameDecorations = editor.createDecorationsCollection();
  const conflictDecorations = editor.createDecorationsCollection();

  const widgets: monaco.editor.IContentWidget[] = [];
  const resolvedListeners: (() => void)[] = [];

  let blame: readonly BlameLineView[] | null = null;
  let conflicts: ConflictBlock[] = [];

  function removeWidgets(): void {
    for (const widget of widgets) editor.removeContentWidget(widget);
    widgets.length = 0;
  }

  function drawBlame(): void {
    const model = editor.getModel();
    if (blame === null || model === null) {
      blameDecorations.clear();
      return;
    }

    // Inline blame follows the cursor rather than annotating every line: a column of
    // names down the whole file is the version of this feature people turn off.
    const line = editor.getPosition()?.lineNumber ?? 1;
    const entry = blame.find((item) => item.line === line);

    if (entry === undefined) {
      blameDecorations.clear();
      return;
    }

    const when = ago(entry.date);
    const label = `${entry.author}${when === "" ? "" : `, ${when}`} · ${entry.summary}`;

    blameDecorations.set([
      {
        range: new monaco.Range(line, model.getLineMaxColumn(line), line, model.getLineMaxColumn(line)),
        options: {
          after: {
            content: `    ${label}`,
            inlineClassName: "git-blame-inline",
            cursorStops: monaco.editor.InjectedTextCursorStops.None,
          },
        },
      },
    ]);
  }

  function resolve(block: ConflictBlock, choice: "current" | "incoming" | "both"): void {
    const model = editor.getModel();
    if (model === null) return;

    // Resolve against the model's own text, not the text the widget was built from: the
    // user may have typed inside the block since, and splicing stale line numbers into a
    // changed file is how a "resolve" button eats someone's work.
    const found = findConflicts(model.getValue()).find(
      (candidate) => candidate.startLine === block.startLine,
    );
    if (found === undefined) return;

    const range = new monaco.Range(
      found.startLine,
      1,
      found.endLine,
      model.getLineMaxColumn(found.endLine),
    );

    // `applyResolution` works on whole files, so treat the block as its own little file:
    // line 1 is the `<<<<<<<` marker and the last line is `>>>>>>>`. That reuses the code
    // the conflict tests cover instead of re-deciding here what "both" means.
    const region = model.getValueInRange(range);
    const asFile: ConflictBlock = {
      ...found,
      startLine: 1,
      separatorLine: found.separatorLine - found.startLine + 1,
      endLine: found.endLine - found.startLine + 1,
    };

    editor.executeEdits("git-conflict", [
      { range, text: applyResolution(region, asFile, choice), forceMoveMarkers: true },
    ]);

    refreshConflicts();
    for (const listener of resolvedListeners) listener();
  }

  function button(label: string, title: string, run: () => void): HTMLButtonElement {
    const element = document.createElement("button");
    element.className = "conflict-action";
    element.textContent = label;
    element.title = title;
    element.addEventListener("mousedown", (event) => {
      // Monaco steals focus on mousedown inside the editor's own DOM; without this the
      // click lands on the text instead of the button.
      event.preventDefault();
      event.stopPropagation();
    });
    element.addEventListener("click", run);
    return element;
  }

  function refreshConflicts(): void {
    removeWidgets();

    const model = editor.getModel();
    if (model === null) {
      conflicts = [];
      conflictDecorations.clear();
      return;
    }

    conflicts = findConflicts(model.getValue());

    if (conflicts.length === 0) {
      conflictDecorations.clear();
      return;
    }

    conflictDecorations.set(
      conflicts.flatMap((block) => [
        {
          range: new monaco.Range(block.startLine, 1, block.separatorLine - 1, 1),
          options: { isWholeLine: true, className: "conflict-current" },
        },
        {
          range: new monaco.Range(block.separatorLine, 1, block.endLine, 1),
          options: { isWholeLine: true, className: "conflict-incoming" },
        },
      ]),
    );

    for (const block of conflicts) {
      const node = document.createElement("div");
      node.className = "conflict-toolbar";
      node.append(
        button("Accept current", `Keep ${block.currentLabel || "this side"}`, () =>
          resolve(block, "current"),
        ),
        button("Accept incoming", `Keep ${block.incomingLabel || "the other side"}`, () =>
          resolve(block, "incoming"),
        ),
        button("Accept both", "Keep both sides, current first", () => resolve(block, "both")),
      );

      const widget: monaco.editor.IContentWidget = {
        getId: () => `conflict-${block.startLine}`,
        getDomNode: () => node,
        getPosition: () => ({
          position: { lineNumber: block.startLine, column: 1 },
          preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE],
        }),
      };

      widgets.push(widget);
      editor.addContentWidget(widget);
    }
  }

  editor.onDidChangeCursorPosition(drawBlame);
  editor.onDidChangeModel(() => {
    diffDecorations.clear();
    blameDecorations.clear();
    blame = null;
    refreshConflicts();
  });

  return {
    setLineChanges(changes) {
      const model = editor.getModel();
      if (model === null) return;

      const lineCount = model.getLineCount();

      diffDecorations.set(
        changes.flatMap((change) => {
          const start = Math.min(Math.max(1, change.startLine), lineCount);
          // A deletion has no lines of its own: it is a mark between two lines, drawn on
          // the line above it, so `lineCount` of zero must not become a backwards range.
          const end = Math.min(start + Math.max(0, change.lineCount - 1), lineCount);

          return [
            {
              range: new monaco.Range(start, 1, end, 1),
              options: {
                isWholeLine: true,
                linesDecorationsClassName: `git-gutter git-gutter-${change.kind}`,
                overviewRuler: {
                  color:
                    change.kind === "added"
                      ? "#30d15899"
                      : change.kind === "deleted"
                        ? "#ff453a99"
                        : "#ff9f0a99",
                  position: monaco.editor.OverviewRulerLane.Left,
                },
              },
            },
          ];
        }),
      );
    },

    setBlame(lines) {
      blame = lines;
      drawBlame();
    },

    refreshConflicts,
    hasConflicts: () => conflicts.length > 0,
    onResolved: (listener) => resolvedListeners.push(listener),

    clear() {
      diffDecorations.clear();
      blameDecorations.clear();
      conflictDecorations.clear();
      removeWidgets();
      blame = null;
      conflicts = [];
    },
  };
}
