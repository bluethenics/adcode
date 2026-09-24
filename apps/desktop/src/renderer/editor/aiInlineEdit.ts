/**
 * Ctrl+E: edit the selection with AI, in place.
 *
 * One instruction, one tool-free request, and the answer lands in the buffer as an ordinary
 * undoable edit - highlighted green, with the text it replaced shown struck through above it.
 * Accept keeps it (it is then just an unsaved change like any other), Reject puts the old
 * text back, and a follow-up instruction refines the result without starting over. Nothing
 * reaches disk until the user saves, which is the same promise the agent's review makes.
 *
 * The prompt lives in a view zone, the way peek does, so it pushes code down instead of
 * covering it.
 */
import * as monaco from "monaco-editor";
import type { AiInlineEditInputView, AiInlineEditResultView } from "../../shared/api.ts";

export interface AiInlineEditDeps {
  /** Workspace-relative path of the active buffer, or null when nothing is open. */
  readonly displayPath: () => string | null;
  readonly request: (input: AiInlineEditInputView) => Promise<AiInlineEditResultView>;
  readonly cancel: () => void;
}

export interface AiInlineEdit {
  /** Open the prompt over the selection, or focus it when already open. */
  start(): void;
  isOpen(): boolean;
  dispose(): void;
}

type State = "prompt" | "working" | "review";

const CONTEXT_CHARS = 6_000;
const MAX_SELECTION_CHARS = 24_000;
const MAX_REMOVED_LINES_SHOWN = 40;
/** Monaco's TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges. */
const NEVER_GROWS = 1;

/** Keys the prompt keeps for itself instead of letting Monaco's keybindings see them. */
function isInputKey(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey)) return true;
  return ["a", "c", "v", "x", "z", "y", "arrowleft", "arrowright", "backspace", "delete", "home", "end"].includes(event.key.toLowerCase());
}

export function installAiInlineEdit(
  editor: monaco.editor.IStandaloneCodeEditor,
  deps: AiInlineEditDeps,
): AiInlineEdit {
  let state: State | null = null;
  let zoneId: string | null = null;
  let zoneSpec: monaco.editor.IViewZone | null = null;
  let tracker: string[] = [];
  let highlight: string[] = [];
  /** The text that was there before the first rewrite; Reject restores exactly this. */
  let original = "";
  /** Where the original text sat, until the first rewrite replaces it. */
  let anchor: monaco.Range | null = null;
  let generation = 0;
  let timer: number | null = null;
  const reviewKey = editor.createContextKey<boolean>("adcodeInlineEditReview", false);

  const root = document.createElement("div");
  root.className = "ai-inline-edit";
  const bar = document.createElement("div");
  bar.className = "ai-inline-edit-bar";
  const mark = document.createElement("span");
  mark.className = "ai-inline-edit-mark";
  mark.textContent = "AI";
  mark.setAttribute("aria-hidden", "true");
  const input = document.createElement("input");
  input.className = "ai-inline-edit-input";
  input.type = "text";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Describe the edit");
  const status = document.createElement("span");
  status.className = "ai-inline-edit-status";
  status.setAttribute("role", "status");
  const actions = document.createElement("span");
  actions.className = "ai-inline-edit-actions";
  const button = (label: string, title: string, run: () => void, primary = false): HTMLButtonElement => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.title = title;
    element.className = primary ? "ai-inline-edit-button is-primary" : "ai-inline-edit-button";
    // Keep the editor from treating a click on the zone as a click into the text.
    element.addEventListener("mousedown", (event) => event.stopPropagation());
    element.addEventListener("click", run);
    return element;
  };
  const generateButton = button("Generate", "Generate the edit (Enter)", () => submit(), true);
  const acceptButton = button("Accept", "Keep this edit (Ctrl+Enter)", () => accept(), true);
  const rejectButton = button("Reject", "Put the original back (Esc)", () => reject());
  const cancelButton = button("Cancel", "Stop generating (Esc)", () => close(true));
  actions.append(generateButton, acceptButton, rejectButton, cancelButton);
  bar.append(mark, input, status, actions);
  const removed = document.createElement("div");
  removed.className = "ai-inline-edit-removed";
  removed.setAttribute("aria-label", "Replaced text");
  root.append(bar, removed);
  root.addEventListener("mousedown", (event) => event.stopPropagation());

  input.addEventListener("keydown", (event) => {
    if (isInputKey(event)) event.stopPropagation();
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && state === "review") {
      event.preventDefault();
      accept();
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (state === "review") reject();
      else close(true);
    }
  });

  const lineHeight = (): number => editor.getOption(monaco.editor.EditorOption.lineHeight);

  function zoneHeight(): number {
    const removedLines = removed.hidden ? 0 : Math.min(MAX_REMOVED_LINES_SHOWN + 1, removed.childElementCount);
    return 42 + (removedLines === 0 ? 0 : removedLines * lineHeight() + 8);
  }

  function layoutZone(): void {
    if (zoneId === null || zoneSpec === null) return;
    const height = zoneHeight();
    if (zoneSpec.heightInPx === height) return;
    zoneSpec.heightInPx = height;
    editor.changeViewZones((accessor) => { if (zoneId !== null) accessor.layoutZone(zoneId); });
  }

  function placeZone(afterLineNumber: number): void {
    editor.changeViewZones((accessor) => {
      if (zoneId !== null) accessor.removeZone(zoneId);
      zoneSpec = { afterLineNumber, heightInPx: zoneHeight(), domNode: root, suppressMouseDown: false };
      zoneId = accessor.addZone(zoneSpec);
    });
  }

  function paint(next: State, message = ""): void {
    state = next;
    root.dataset["state"] = next;
    reviewKey.set(next === "review");
    input.disabled = next === "working";
    input.placeholder = next === "review"
      ? "Refine it: say what to change next, or Accept"
      : anchor !== null && !anchor.isEmpty()
        ? "Edit the selection: describe the change, then Enter"
        : "Generate code here: describe it, then Enter";
    generateButton.hidden = next !== "prompt";
    acceptButton.hidden = next !== "review";
    rejectButton.hidden = next !== "review";
    cancelButton.hidden = next !== "working";
    if (timer !== null) { window.clearInterval(timer); timer = null; }
    if (next === "working") {
      const started = Date.now();
      const tick = (): void => { status.textContent = `Editing… ${Math.floor((Date.now() - started) / 1000)}s`; };
      tick();
      timer = window.setInterval(tick, 1000);
    } else {
      status.textContent = message;
    }
    layoutZone();
  }

  /** The replaced text, shown struck through above the rewrite. */
  function showRemoved(text: string, languageId: string): void {
    removed.replaceChildren();
    if (text.length === 0) { removed.hidden = true; return; }
    removed.hidden = false;
    const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
    const shown = lines.slice(0, MAX_REMOVED_LINES_SHOWN);
    for (const line of shown) {
      const row = document.createElement("div");
      row.className = "ai-inline-edit-removed-line";
      row.textContent = line.length === 0 ? " " : line;
      removed.append(row);
    }
    if (lines.length > shown.length) {
      const more = document.createElement("div");
      more.className = "ai-inline-edit-removed-more";
      more.textContent = `… ${lines.length - shown.length} more replaced lines`;
      removed.append(more);
    }
    // Colour the rows once the tokenizer answers. Monaco's colorize HTML-escapes the
    // source before wrapping tokens, the same guarantee peek relies on.
    void monaco.editor.colorize(shown.join("\n"), languageId, { tabSize: 2 }).then((html) => {
      if (state !== "review") return;
      const holder = document.createElement("div");
      holder.innerHTML = html;
      const colored = holder.innerHTML.split(/<br\s*\/?>/i);
      removed.querySelectorAll(".ai-inline-edit-removed-line").forEach((row, index) => {
        const lineHtml = colored[index];
        if (lineHtml !== undefined && lineHtml.length > 0) row.innerHTML = lineHtml;
      });
    }).catch(() => undefined);
  }

  function trackedRange(): monaco.Range | null {
    const model = editor.getModel();
    const id = tracker[0];
    if (model === null || id === undefined) return null;
    return model.getDecorationRange(id);
  }

  function clearDecorations(): void {
    const model = editor.getModel();
    if (model !== null) {
      tracker = model.deltaDecorations(tracker, []);
      highlight = model.deltaDecorations(highlight, []);
    }
    tracker = [];
    highlight = [];
  }

  function close(cancelRequest = false): void {
    if (cancelRequest && state === "working") deps.cancel();
    generation += 1;
    if (timer !== null) { window.clearInterval(timer); timer = null; }
    clearDecorations();
    if (zoneId !== null) {
      editor.changeViewZones((accessor) => { if (zoneId !== null) accessor.removeZone(zoneId); });
    }
    zoneId = null;
    zoneSpec = null;
    state = null;
    anchor = null;
    original = "";
    removed.replaceChildren();
    reviewKey.set(false);
    editor.focus();
  }

  function accept(): void {
    if (state !== "review") return;
    close();
  }

  function reject(): void {
    const model = editor.getModel();
    const range = trackedRange();
    if (model !== null && range !== null) {
      editor.pushUndoStop();
      editor.executeEdits("adcode-inline-edit", [{ range, text: original, forceMoveMarkers: true }]);
      editor.pushUndoStop();
    }
    close();
  }

  async function submit(): Promise<void> {
    const instruction = input.value.trim();
    const model = editor.getModel();
    if (instruction.length === 0 || model === null || state === "working") return;
    const path = deps.displayPath() ?? "untitled";
    // In review, a follow-up refines the current rewrite rather than the original.
    const target = state === "review" ? trackedRange() : anchor;
    if (target === null) { close(); return; }
    const selection = model.getValueInRange(target);
    if (selection.length > MAX_SELECTION_CHARS) {
      paint(state ?? "prompt", "That selection is too large for one edit. Select less.");
      return;
    }
    const startOffset = model.getOffsetAt(target.getStartPosition());
    const endOffset = model.getOffsetAt(target.getEndPosition());
    const before = model.getValueInRange(monaco.Range.fromPositions(model.getPositionAt(Math.max(0, startOffset - CONTEXT_CHARS)), target.getStartPosition()));
    const after = model.getValueInRange(monaco.Range.fromPositions(target.getEndPosition(), model.getPositionAt(endOffset + CONTEXT_CHARS)));
    const previous = state;
    const current = ++generation;
    const version = model.getVersionId();
    paint("working");
    const result = await deps.request({
      instruction, languageId: model.getLanguageId(), path, before, selection, after,
    }).catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : "The edit failed." }));
    if (current !== generation || editor.getModel() !== model) return;
    if (!result.ok) {
      paint(previous === "review" ? "review" : "prompt", result.error);
      input.focus();
      return;
    }
    if (model.getVersionId() !== version) {
      paint(previous === "review" ? "review" : "prompt", "The file changed while the edit was generating. Try again.");
      return;
    }
    // The inverse operation's range is exactly where the new text now sits, whatever the
    // buffer's line endings did to its length.
    const capture: { range: monaco.IRange | null } = { range: null };
    editor.pushUndoStop();
    editor.executeEdits("adcode-inline-edit", [{ range: target, text: result.text, forceMoveMarkers: true }], (inverse) => {
      capture.range = inverse[0]?.range ?? null;
      return null;
    });
    editor.pushUndoStop();
    const range = capture.range === null ? monaco.Range.fromPositions(target.getStartPosition()) : monaco.Range.lift(capture.range);
    tracker = model.deltaDecorations(tracker, [{ range, options: { stickiness: NEVER_GROWS } }]);
    const lastLine = range.endColumn === 1 && range.endLineNumber > range.startLineNumber ? range.endLineNumber - 1 : range.endLineNumber;
    highlight = model.deltaDecorations(highlight, range.isEmpty() ? [] : [{
      range: new monaco.Range(range.startLineNumber, 1, lastLine, 1),
      options: { isWholeLine: true, className: "ai-inline-edit-added", linesDecorationsClassName: "ai-inline-edit-added-gutter", stickiness: NEVER_GROWS },
    }]);
    showRemoved(original, model.getLanguageId());
    input.value = "";
    placeZone(range.startLineNumber - 1);
    const added = result.text.length === 0 ? 0 : result.text.replace(/\n$/, "").split("\n").length;
    paint("review", added === 0 ? "Removed. Accept or Reject." : `${added} line${added === 1 ? "" : "s"} written. Accept or Reject.`);
    editor.revealRangeInCenterIfOutsideViewport(range);
    input.focus();
  }

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => accept(), "adcodeInlineEditReview");
  editor.addCommand(monaco.KeyCode.Escape, () => reject(), "adcodeInlineEditReview && !suggestWidgetVisible && !findWidgetVisible && !editorHasMultipleSelections");
  // A different file in this view invalidates every range held here. The rewrite stays in
  // its buffer as an ordinary unsaved change, which Ctrl+Z still undoes.
  const modelSubscription = editor.onDidChangeModel(() => {
    if (state === "working") deps.cancel();
    generation += 1;
    if (zoneId !== null) editor.changeViewZones((accessor) => { if (zoneId !== null) accessor.removeZone(zoneId); });
    zoneId = null;
    zoneSpec = null;
    state = null;
    tracker = [];
    highlight = [];
    reviewKey.set(false);
  });

  return {
    start(): void {
      const model = editor.getModel();
      if (model === null) return;
      if (state !== null) { input.focus(); input.select(); return; }
      if (editor.getOption(monaco.editor.EditorOption.readOnly)) return;
      const selection = editor.getSelection();
      if (selection === null) return;
      // Whole lines read better as a diff and give the model complete statements.
      let range: monaco.Range;
      if (selection.isEmpty()) {
        range = monaco.Range.fromPositions(selection.getPosition());
      } else {
        const endLine = selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber
          ? selection.endLineNumber - 1 : selection.endLineNumber;
        range = new monaco.Range(selection.startLineNumber, 1, endLine, model.getLineMaxColumn(endLine));
      }
      anchor = range;
      original = model.getValueInRange(range);
      removed.hidden = true;
      removed.replaceChildren();
      input.value = "";
      placeZone(range.startLineNumber - 1);
      paint("prompt", selection.isEmpty() ? "" : `${range.endLineNumber - range.startLineNumber + 1} lines selected`);
      editor.revealLineInCenterIfOutsideViewport(range.startLineNumber);
      requestAnimationFrame(() => input.focus());
    },
    isOpen: () => state !== null,
    dispose(): void {
      close(true);
      modelSubscription.dispose();
    },
  };
}
