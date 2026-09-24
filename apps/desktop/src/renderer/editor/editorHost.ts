/**
 * Monaco host.
 *
 * Brief §2: "Monaco is the editing surface only. It is not the workbench." Nothing here
 * reaches for `monaco-editor`'s standalone services beyond text editing - they are built
 * for embedding a code box in a web page and the seams show immediately.
 *
 * Workers are imported through Vite's `?worker` so they are bundled and served from our
 * own origin. That is what lets the CSP stay strict: no `unsafe-eval`, no AMD loader, no
 * cross-origin worker shim.
 */
import * as monaco from "monaco-editor";
import { registerKeywordCompletions } from "./completions/register.ts";
import { configureLanguageDefaults } from "./languageDefaults.ts";
// Monaco 0.56's exports map is `"./*": "./esm/vs/*.js"`, so these specifiers - not the
// `esm/vs/...` paths most examples still show - are what actually resolve.
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { createGitOverlay, type GitOverlay } from "./gitOverlay.ts";
import { installPairedTagRename } from "./pairedTagRename.ts";
import { installErrorLens } from "./errorLens.ts";
import { installTodoHighlight } from "./todoHighlight.ts";
import { installCommentTones } from "./commentTones.ts";
import { installSpellCheck } from "./spellCheck.ts";
import { installPathComplete } from "./pathComplete.ts";
import { installFormatting } from "./formatting.ts";
import { createDefinitions, symbolAt } from "./definitions.ts";
import { installPeek } from "./peek.ts";
import { installTreeSitterHighlight } from "./treeSitter.ts";
import { organizeImports as organiseImportBlock, organizeSupported, DEFAULT_OPTIONS } from "@adcode/format";
import type { BreakpointView, DirEntry, SearchHitView, ThemeChoice } from "../../shared/api.ts";
import { editorOptionsFor } from "./editorOptions.ts";
import { createRemoteCursors, type RemoteCursors } from "../collab/remoteCursors.ts";
import { installTagClosing } from "./autoCloseTags.ts";
import { installAiInlineCompletion } from "./aiInlineCompletion.ts";
import { allowsAiCompletionForPath } from "./inlineCompletionContext.ts";
// Re-exported rather than defined here: the table decides highlighting, completions, the
// Structure view and the Run button, and it lives in a file with no Monaco import so it
// can be tested without launching a window.
export { languageForFilename } from "./languageIds.ts";
import { languageForFilename } from "./languageIds.ts";
import { markdownCodeReference } from "./codeReferences.ts";

declare global {
  // eslint-disable-next-line no-var
  var MonacoEnvironment: monaco.Environment | undefined;
}

globalThis.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string): Worker {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

/**
 * Colours for the semantic tokens tree-sitter produces.
 *
 * Without these the parse tree changes nothing on screen. Monaco asks the provider, gets
 * tokens, finds no rule for their types, and paints exactly what its own tokenizer already
 * painted - so the feature appears to do nothing while working perfectly.
 *
 * The values follow each base theme's existing palette rather than introducing a second
 * one, because the point of parsing is to be *right* more often, not to look different.
 */
const SEMANTIC_RULES_DARK = [
  { token: "keyword", foreground: "569cd6" },
  { token: "type", foreground: "4ec9b0" },
  { token: "class", foreground: "4ec9b0" },
  { token: "interface", foreground: "4ec9b0" },
  { token: "struct", foreground: "4ec9b0" },
  { token: "enum", foreground: "4ec9b0" },
  { token: "typeParameter", foreground: "4ec9b0" },
  { token: "function", foreground: "dcdcaa" },
  { token: "method", foreground: "dcdcaa" },
  { token: "macro", foreground: "dcdcaa" },
  { token: "property", foreground: "9cdcfe" },
  { token: "parameter", foreground: "9cdcfe" },
  { token: "variable", foreground: "9cdcfe" },
  { token: "string", foreground: "ce9178" },
  { token: "number", foreground: "b5cea8" },
  { token: "regexp", foreground: "d16969" },
  { token: "comment", foreground: "6a9955" },
  { token: "namespace", foreground: "4ec9b0" },
  { token: "decorator", foreground: "dcdcaa" },
];

const SEMANTIC_RULES_LIGHT = [
  { token: "keyword", foreground: "0000ff" },
  { token: "type", foreground: "267f99" },
  { token: "class", foreground: "267f99" },
  { token: "interface", foreground: "267f99" },
  { token: "struct", foreground: "267f99" },
  { token: "enum", foreground: "267f99" },
  { token: "typeParameter", foreground: "267f99" },
  { token: "function", foreground: "795e26" },
  { token: "method", foreground: "795e26" },
  { token: "macro", foreground: "795e26" },
  { token: "property", foreground: "001080" },
  { token: "parameter", foreground: "001080" },
  { token: "variable", foreground: "001080" },
  { token: "string", foreground: "a31515" },
  { token: "number", foreground: "098658" },
  { token: "regexp", foreground: "811f3f" },
  { token: "comment", foreground: "008000" },
  { token: "namespace", foreground: "267f99" },
  { token: "decorator", foreground: "795e26" },
];

/** §3: Monaco's surface is themed to match the workbench rather than left as default. */
function defineThemes(): void {
  monaco.editor.defineTheme("adcode-light", {
    base: "vs",
    inherit: true,
    // Semantic highlighting is switched on by the editor's own
    // `semanticHighlighting.enabled` option rather than here: the theme flag exists at
    // runtime but is absent from this Monaco version's `IStandaloneThemeData`, and the
    // editor option is the typed way to say the same thing.
    rules: SEMANTIC_RULES_LIGHT,
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#00000008",
      "editorLineNumber.foreground": "#a3a09a",
      "editorLineNumber.activeForeground": "#1d1c1a",
      "editorIndentGuide.background1": "#0000000f",
      "editor.selectionBackground": "#26241f26",
      "editorCursor.foreground": "#26241f",
      // The suggest widget is Monaco's surface, so without these it wears vs defaults
      // that match no theme in this app - a grey box with an invisible selection.
      "editorSuggestWidget.background": "#ffffff",
      "editorSuggestWidget.border": "#0000001a",
      "editorSuggestWidget.foreground": "#1d1c1a",
      "editorSuggestWidget.selectedBackground": "#26241f14",
      "editorSuggestWidget.selectedForeground": "#1d1c1a",
      "editorSuggestWidget.highlightForeground": "#005ec4",
      "editorSuggestWidget.focusHighlightForeground": "#005ec4",
      "editorSuggestWidgetStatus.foreground": "#6f6c66",
    },
  });

  monaco.editor.defineTheme("adcode-dark", {
    base: "vs-dark",
    inherit: true,
    rules: SEMANTIC_RULES_DARK,
    colors: {
      "editor.background": "#151515",
      "editor.lineHighlightBackground": "#ffffff08",
      "editorLineNumber.foreground": "#5f5d58",
      "editorLineNumber.activeForeground": "#ebe8e1",
      "editorIndentGuide.background1": "#ffffff14",
      "editor.selectionBackground": "#ece9e233",
      "editorCursor.foreground": "#ece9e2",
      // Same widget, dark ground: the panel surface with a neutral selection,
      // kept in step with the workbench palette in tokens.css.
      "editorSuggestWidget.background": "#1c1b19",
      "editorSuggestWidget.border": "#2d2b28",
      "editorSuggestWidget.foreground": "#ebe8e1",
      "editorSuggestWidget.selectedBackground": "#ece9e226",
      "editorSuggestWidget.selectedForeground": "#ebe8e1",
      "editorSuggestWidget.highlightForeground": "#6ea8fe",
      "editorSuggestWidget.focusHighlightForeground": "#8ab4ff",
      "editorSuggestWidgetStatus.foreground": "#8f8c85",
    },
  });

  /*
   * Midnight shares Dark's syntax rules and changes only the surface.
   *
   * Re-tuning the token colours for a slightly darker ground would fork the one thing in
   * this file that has actually been tuned, and leave two sets of syntax colours to keep
   * in step. What changes is the chrome: a true-black canvas, a white caret and a
   * greyscale selection, because this theme has no blue in it.
   */
  monaco.editor.defineTheme("adcode-midnight", {
    base: "vs-dark",
    inherit: true,
    rules: SEMANTIC_RULES_DARK,
    colors: {
      "editor.background": "#08090b",
      "editor.lineHighlightBackground": "#ffffff0a",
      "editorLineNumber.foreground": "#6b7577",
      "editorLineNumber.activeForeground": "#f1f3f3",
      "editorIndentGuide.background1": "#ffffff12",
      "editor.selectionBackground": "#ffffff26",
      "editorCursor.foreground": "#f1f3f3",
      // Midnight has no blue: a greyscale selection, like the rest of the theme.
      "editorSuggestWidget.background": "#131719",
      "editorSuggestWidget.border": "#ffffff1c",
      "editorSuggestWidget.foreground": "#f1f3f3",
      "editorSuggestWidget.selectedBackground": "#ffffff24",
      "editorSuggestWidget.selectedForeground": "#f1f3f3",
      "editorSuggestWidget.highlightForeground": "#6ea8fe",
      "editorSuggestWidget.focusHighlightForeground": "#8ab4ff",
      "editorSuggestWidgetStatus.foreground": "#9aa4a6",
    },
  });
}

export interface EditorHost {
  /** Detach a view without closing or disposing its buffer. */
  deactivate(): void;
  onFocus(listener: () => void): void;
  open(path: string, text: string, languageId: string): void;
  activate(path: string): void;
  close(path: string): void;
  /**
   * Follow a renamed file, keeping its text, cursor, dirty state and read-only flag.
   *
   * A buffer left under the old path saves to a name that no longer exists, recreating it
   * and forking the file in two.
   */
  rename(oldPath: string, newPath: string): void;
  text(path: string): string | null;
  markSaved(path: string): void;
  isDirty(path: string): boolean;
  /** Historical revisions open read-only; the working copy never does. */
  setReadOnly(path: string, readOnly: boolean): void;
  isReadOnly(path: string): boolean;
  /**
   * Replace a buffer's contents, keeping the tab open.
   *
   * `keepDirty` is for recovered work: the text did not come from disk, so marking it
   * saved would be a lie that costs the user the thing they just recovered.
   */
  replaceText(path: string, text: string, options?: { keepDirty?: boolean }): void;
  layout(): void;
  /** Scroll to a one-based line and put the cursor on it. */
  revealLine(line: number): void;
  /**
   * Scroll to a one-based line and column, and put the cursor exactly there.
   *
   * The Problems panel needs the column rather than the line: a row that says "you're
   * putting text where a number belongs" and then lands the cursor at the start of a
   * ninety-character line has made the reader do the search anyway.
   */
  revealPosition(line: number, column: number): void;
  /** Gutter diff marks, inline blame, and merge-conflict resolution (§4's Git group). */
  readonly git: GitOverlay;
  /**
   * Other participants' carets and selections, drawn as decorations.
   *
   * Owned here for the same reason the git overlay is: both need the editor instance, and §2
   * says the workbench composes Monaco rather than reaching into it from everywhere.
   */
  readonly remoteCursors: RemoteCursors;
  /**
   * The Monaco model behind a path, or `null`.
   *
   * Exposed for the collaboration binding, which has to attach a Yjs replica to the same model
   * the user is typing into. Deliberately the only hole in this interface: everything else here
   * takes a path and does the work, and a caller reaching for a model to edit it directly would
   * bypass the dirty tracking and the read-only flag this file maintains.
   */
  modelFor(path: string): monaco.editor.ITextModel | null;
  /** Trigger a Monaco action by id - how the menu reaches the editing commands. */
  runAction(actionId: string): void;
  /** Toggle word wrap, which is an option rather than an action. */
  toggleWordWrap(): void;
  /** Ask the selected model for ghost text now; automatic requests use the same provider. */
  triggerInlineCompletion(): void;
  /** Current cursor line, for "go to line" and the status bar. */
  cursorLine(): number;
  applyTheme(theme: ThemeChoice): void;
  /**
   * Format one buffer, resolving once the text has settled.
   *
   * Returns whether anything changed. Save uses this rather than Monaco's own action,
   * because that action is fire-and-forget and the write would race it.
   */
  formatDocument(path: string): Promise<boolean>;
  /** Sort and prune the import block. Returns whether anything changed. */
  organizeImports(path: string): boolean;
  /**
   * Show the definition of the symbol under the cursor, inline.
   *
   * Peek rather than jump, because following a symbol is a reading move and losing your
   * place in the file you were reading is what makes it expensive.
   */
  peekDefinition(): Promise<void>;
  /** Go to the definition properly, moving the cursor and opening the file if needed. */
  goToDefinition(): Promise<void>;
  /** Draw the breakpoints for whichever file is open. */
  setBreakpoints(all: readonly BreakpointView[]): void;
  /**
   * Mark the line a paused program is stopped on, or clear it with `null`.
   *
   * A whole-line highlight rather than a gutter mark: when a program stops, the one thing
   * the reader needs is where, and a 12-pixel arrow in the margin is not it.
   */
  setPausedLine(path: string | null, line: number | null): void;
  /** Called when the user clicks the gutter to add or remove a breakpoint. */
  onBreakpointToggle(listener: (path: string, line: number) => void): void;
  /** Apply the §4 editing settings the shell can honour today. */
  applySettings(values: Record<string, boolean | string>): void;
  onDirtyChange(listener: (path: string, dirty: boolean) => void): void;
  onCursorChange(listener: (line: number, column: number) => void): void;
  onSaveRequested(listener: () => void): void;
  /**
   * How many characters a person just typed or pasted, and into which file.
   *
   * Deliberately not "the buffer changed". A content-change event fires for the
   * formatter, for a git conflict resolution, for a collaborator's keystroke arriving
   * over the wire, and for an agent hunk being applied - counting those as something the
   * user wrote would make the dashboard's manual-versus-agent split a lie. This fires
   * only for keyboard input and paste.
   *
   * Returns its own unsubscribe, unlike the two above: this listener outlives nothing
   * and has to be able to stop.
   */
  onHumanInput(listener: (chars: number, path: string | null) => void): () => void;
  focus(): void;
}

interface OpenModel {
  readonly model: monaco.editor.ITextModel;
  savedVersionId: number;
  viewState: monaco.editor.ICodeEditorViewState | null;
  readOnly: boolean;
}

interface EditorBufferStore {
  readonly models: Map<string, OpenModel>;
  readonly dirtyListeners: ((path: string, dirty: boolean) => void)[];
  formatting?: ReturnType<typeof installFormatting>;
  treeSitter?: ReturnType<typeof installTreeSitterHighlight>;
  pathComplete?: ReturnType<typeof installPathComplete>;
  focusedEditor?: monaco.editor.IStandaloneCodeEditor;
}

/** Two views share models, dirty versions and global language providers. */
export function createEditorPair(
  containers: readonly [HTMLElement, HTMLElement], deps: EditorHostDeps,
): readonly [EditorHost, EditorHost] {
  const store: EditorBufferStore = { models: new Map(), dirtyListeners: [] };
  return [createEditorHost(containers[0], deps, store), createEditorHost(containers[1], deps, store)];
}

/**
 * What the editor needs from the shell.
 *
 * Only path completion asks for anything: it has to know which file is open and where the
 * project starts before `./` and `../` mean anything. Passed in rather than imported so
 * this file still knows nothing about the workbench that owns it.
 */
export interface EditorHostDeps {
  readonly askAssistant?: (prompt: string) => void;
  readonly activeFile: () => string | null;
  readonly workspaceRoot: () => string | null;
  readonly list: (directory: string) => Promise<readonly DirEntry[]>;
  /** Read a file the user has not opened, for the peek preview. */
  readonly readFile: (path: string) => Promise<string | null>;
  /** Workspace-relative, for headers that are readable. */
  readonly displayPath: (path: string) => string;
  readonly languageFor: (path: string) => string;
  /** Open a file and put the cursor somewhere in it. */
  readonly openAt: (path: string, line: number, column: number) => void;
  readonly search: (pattern: string, include: string) => Promise<readonly SearchHitView[]>;
  /** Search returns workspace-relative paths; peek needs absolute ones. */
  readonly absolute: (relativePath: string) => string;
}

export function createEditorHost(
  container: HTMLElement, deps: EditorHostDeps,
  store: EditorBufferStore = { models: new Map(), dirtyListeners: [] },
): EditorHost {
  defineThemes();

  // Before the first model exists, so no file is ever checked under the wrong rules.
  configureLanguageDefaults();

  const editor = monaco.editor.create(container, {
    theme: "adcode-dark",
    // Use Monaco's established textarea input path. Electron's experimental
    // EditContext can route typing to the first view after focusing a split editor.
    editContext: false,
    automaticLayout: false,
    /*
     * The literal stack behind `var(--font-mono)`, not the variable itself.
     *
     * The variable resolves fine wherever the browser paints text, but Monaco also
     * hands this string to canvas measurement (`ctx.font = ...`), and canvas has no
     * idea what a custom property is - the declaration is invalid, measurement falls
     * back to the default font, and every metric derived from it (cursor placement,
     * wrapping, the suggest widget's font) is computed for a font that is not on
     * screen. Keep this list in step with `--font-mono` in tokens.css.
     */
    fontFamily: `"SF Mono", "JetBrains Mono", "Cascadia Code", ui-monospace, Consolas, monospace`,
    fontSize: 13,
    lineHeight: 20,
    fontLigatures: true,
    minimap: { enabled: false, renderCharacters: false },
    stickyScroll: { enabled: false },
    bracketPairColorization: { enabled: true },
    guides: { indentation: true, bracketPairs: true },
    smoothScrolling: true,
    cursorSmoothCaretAnimation: "on",
    renderWhitespace: "none",
    // The margin breakpoints are drawn in. Off by default in Monaco.
    glyphMargin: true,
    // Semantic tokens are the layer tree-sitter paints through, and Monaco does not ask for
    // them unless told to.
    "semanticHighlighting.enabled": true,
    scrollBeyondLastLine: false,
    padding: { top: 12, bottom: 12 },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    folding: true,
    multiCursorModifier: "ctrlCmd",

    /*
     * Suggestions, on by default and accepted with Enter.
     *
     * These are create-time defaults; `applySettings` re-applies the same values from the
     * settings rows once they have been read. Both paths run through `editorOptionsFor`
     * except for the two that are not settings at all - `snippetSuggestions` and the
     * widget's own preview - which have no row and no reason to gain one.
     */
    quickSuggestions: true,
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: "on",
    tabCompletion: "on",
    wordBasedSuggestions: "currentDocument",
    suggestSelection: "first",
    snippetSuggestions: "inline",
    /*
     * Pinned to the editor's own metrics rather than left to Monaco's fallback chain.
     *
     * Both default to 0, which means "use the editor font size / line height" - the
     * same numbers, until a font-info mismatch makes them different things. The widget
     * lays its rows out from these in JS while the row content paints from CSS, so any
     * disagreement between the two is rows overlapping or gapping. Stating them keeps
     * one source of truth on each side.
     */
    suggestFontSize: 13,
    suggestLineHeight: 20,
    suggest: {
      showWords: true,
      showSnippets: true,
      // The detail line is where the plain-English description of a keyword lives, and it
      // is the reason these suggestions are worth more to a learner than a list of words.
      showStatusBar: true,
    },
  });

  // Python, Rust, Go and the rest have no language worker, so the suggest widget has
  // nothing to offer them but words already in the file. This is the honest middle.
  if (store.formatting === undefined) registerKeywordCompletions();

  editor.onDidFocusEditorWidget(() => { store.focusedEditor = editor; });

  const git = createGitOverlay(editor);
  const remoteCursors = createRemoteCursors(editor);

  /*
   * Installed once, on the editor rather than per model.
   *
   * It reads the language off whatever model is current, so one subscription covers every
   * file that will ever be opened - and, more to the point, it cannot leak: a per-model
   * listener would need disposing in `close`, and the one that gets forgotten is the one
   * that fires twice.
   */
  const tagClosing = installTagClosing(editor, monaco, () => store.focusedEditor === editor);

  /*
   * The rest of §4's editing group, installed the same way and for the same reason: each
   * reads the language off whatever model is current, so one subscription covers every file
   * that will ever be opened and none of them can leak.
   */
  const pairedTagRename = installPairedTagRename(editor, monaco, () => store.focusedEditor === editor);
  const errorLens = installErrorLens(editor, monaco);
  const todoHighlight = installTodoHighlight(editor, monaco);
  const commentTones = installCommentTones(editor, monaco);
  const spellCheck = installSpellCheck(editor, monaco);
  const treeSitter = store.treeSitter ??= installTreeSitterHighlight(monaco);

  const formatting = store.formatting ??= installFormatting(monaco, {
    lspFormatting: (path, languageId, options) =>
      window.adcode.language.formatting(path, languageId, options),
    hideSuggestions: () => store.focusedEditor?.trigger("adcode.format", "hideSuggestWidget", null),
  });

  /* ── Breakpoints and the paused line ─────────────────────────────────── */

  const breakpointDecorations = editor.createDecorationsCollection();
  const pausedDecorations = editor.createDecorationsCollection();

  let breakpointsByFile: readonly BreakpointView[] = [];
  const breakpointListeners: ((path: string, line: number) => void)[] = [];

  function drawBreakpoints(): void {
    const path = active;
    if (path === null) {
      breakpointDecorations.clear();
      return;
    }

    const model = editor.getModel();
    const lines = breakpointsByFile.filter((point) => point.path === path);

    breakpointDecorations.set(
      lines
        .filter((point) => model === null || point.line <= model.getLineCount())
        .map((point) => ({
          range: new monaco.Range(point.line, 1, point.line, 1),
          options: {
            glyphMarginClassName: "breakpoint-glyph",
            glyphMarginHoverMessage: { value: "Breakpoint" },
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        })),
    );
  }

  editor.onMouseDown((event) => {
    if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;

    const line = event.target.position?.lineNumber;
    const path = active;
    if (line === undefined || path === null) return;

    editor.setPosition({ lineNumber: line, column: 1 });
    editor.revealLineInCenterIfOutsideViewport(line);
    editor.focus();
    for (const listener of breakpointListeners) listener(path, line);
  });

  let breakpointHoverElement: HTMLElement | null = null;
  editor.onMouseMove((event) => {
    breakpointHoverElement?.removeAttribute("title");
    breakpointHoverElement = null;
    if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;

    const line = event.target.position?.lineNumber;
    const path = active;
    const target = event.target.element;
    if (line === undefined || path === null || target === null) return;

    const exists = breakpointsByFile.some(
      (point) => point.path === path && point.line === line,
    );
    target.title = exists
      ? `Remove breakpoint at line ${String(line)}`
      : `Add breakpoint at line ${String(line)}`;
    breakpointHoverElement = target;
  });
  editor.onMouseLeave(() => {
    breakpointHoverElement?.removeAttribute("title");
    breakpointHoverElement = null;
  });

  const definitions = createDefinitions({
    lspDefinition: (path, languageId, line, column) =>
      window.adcode.language.definition(path, languageId, line, column),
    search: deps.search,
    absolute: deps.absolute,
  });

  const peek = installPeek(editor, monaco, {
    readFile: deps.readFile,
    languageFor: deps.languageFor,
    openAt: deps.openAt,
    displayPath: deps.displayPath,
  });

  /** Whether go-to-definition is switched on at all. */
  let navigationEnabled = true;

  /**
   * The answer for wherever the cursor is, or null.
   *
   * Shared by peek and go-to so the two can never disagree about what the cursor is on.
   */
  async function definitionHere() {
    if (!navigationEnabled) return null;

    const model = editor.getModel();
    const position = editor.getPosition();
    const path = active;
    if (model === null || position === null || path === null) return null;
    if (symbolAt(model, position) === null) return null;

    return definitions.at(model, position, path);
  }

  /*
   * Alt+click peeks; Ctrl+click goes.
   *
   * Deliberately not a plain click. A click in a code editor places the cursor, and a
   * definition opening under every click would make the editor unusable - so the gesture
   * that reads is the one that is held.
   */
  async function showPeek(): Promise<void> {
    const answer = await definitionHere();
    const position = editor.getPosition();
    if (answer === null || position === null) return;

    await peek.show(answer, position.lineNumber);
  }

  async function jumpToDefinition(): Promise<void> {
    const answer = await definitionHere();
    const first = answer?.targets[0];
    if (first === undefined) return;

    peek.close();
    deps.openAt(first.path, first.line, first.column);
  }

  editor.onMouseDown((event) => {
    if (!navigationEnabled) return;
    if (event.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) return;

    const browserEvent = event.event.browserEvent;
    if (browserEvent.altKey) void showPeek();
    else if (browserEvent.ctrlKey || browserEvent.metaKey) void jumpToDefinition();
  });

  const pathComplete = store.pathComplete ??= installPathComplete(monaco, {
    activeFile: deps.activeFile,
    workspaceRoot: deps.workspaceRoot,
    list: deps.list,
  });

  const models = store.models;
  const viewStates = new Map<string, monaco.editor.ICodeEditorViewState>();
  let active: string | null = null;
  if (deps.askAssistant) {
    for (const [id, label, request] of [
      ["askSelection", "Ask ADCode about Selection or File", "Help me understand or change this code:"],
      ["explainSelection", "ADCode: Explain This Code", "Explain this code, including its purpose and important dependencies:"],
      ["refactorSelection", "ADCode: Refactor This Code", "Suggest a focused refactor of this code. Preserve its behavior and explain the changes:"],
      ["testSelection", "ADCode: Write Tests", "Inspect the project's test setup and write meaningful tests for this code:"],
      ["reviewSelection", "ADCode: Find Issues", "Review this code for concrete bugs and edge cases. Explain any findings before making changes:"],
    ] as const) editor.addAction({
      id: `adcode.${id}`, label, contextMenuGroupId: "8_adcode", contextMenuOrder: 1,
      run: () => {
        const model = editor.getModel();
        const selection = editor.getSelection();
        if (!active || !model) return;
        const selected = selection && !selection.isEmpty() ? model.getValueInRange(selection) : "";
        const source = selected || model.getValue();
        const location = selected ? `:${selection!.startLineNumber}` : "";
        deps.askAssistant?.(`${request}\n\nFile: ${deps.displayPath(active)}${location}\nCurrent editor ${selected ? "selection" : "buffer"}${source.length > 32000 ? " (excerpt)" : ""}:\n\n${source.slice(0, 32000)}`);
      },
    });
  }
  editor.addAction({
    id: "adcode.copyMarkdownCodeLink",
    label: "Copy Markdown Link to Line",
    contextMenuGroupId: "9_cutcopypaste",
    contextMenuOrder: 4,
    precondition: "editorTextFocus",
    run: async () => {
      if (active === null) return;
      const selection = editor.getSelection();
      if (!selection) return;
      const endLine = selection.endLineNumber > selection.startLineNumber && selection.endColumn === 1
        ? selection.endLineNumber - 1 : selection.endLineNumber;
      await window.adcode.clipboard.writeText(markdownCodeReference(
        deps.displayPath(active), selection.startLineNumber, endLine,
      ));
    },
  });
  const aiInlineCompletion = installAiInlineCompletion(editor, (model) => {
    if (store.focusedEditor !== editor) return false;
    if (active === null) return false;
    const entry = models.get(active);
    return entry?.model === model && !entry.readOnly && allowsAiCompletionForPath(active);
  });

  const dirtyListeners = store.dirtyListeners;
  const cursorListeners: ((line: number, column: number) => void)[] = [];
  const saveListeners: (() => void)[] = [];

  editor.onDidChangeCursorPosition((event) => {
    for (const listener of cursorListeners) {
      listener(event.position.lineNumber, event.position.column);
    }
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    for (const listener of saveListeners) listener();
  });

  function notifyDirty(path: string): void {
    const entry = models.get(path);
    if (entry === undefined) return;

    const dirty = entry.model.getAlternativeVersionId() !== entry.savedVersionId;
    for (const listener of dirtyListeners) listener(path, dirty);
  }

  return {
    git,
    remoteCursors,

    onFocus(listener) { editor.onDidFocusEditorWidget(listener); },

    deactivate() {
      if (active !== null) {
        const state = editor.saveViewState();
        if (state !== null) viewStates.set(active, state);
      }
      active = null;
      editor.setModel(null);
      delete container.dataset["ready"];
    },

    modelFor(path) {
      return models.get(path)?.model ?? null;
    },

    open(path, text, languageId) {
      if (models.has(path)) return;

      const model = monaco.editor.createModel(text, languageId, monaco.Uri.file(path));
      const entry: OpenModel = {
        model,
        savedVersionId: model.getAlternativeVersionId(),
        viewState: null,
        readOnly: false,
      };
      models.set(path, entry);

      model.onDidChangeContent(() => notifyDirty(path));
    },

    activate(path) {
      const entry = models.get(path);
      if (entry === undefined) return;
      if (active === path && editor.getModel() === entry.model) {
        editor.focus();
        return;
      }

      if (active !== null) {
        const previous = models.get(active);
        if (previous !== undefined) {
          const state = editor.saveViewState();
          if (state !== null) viewStates.set(active, state);
        }
      }

      editor.setModel(entry.model);
      const state = viewStates.get(path) ?? entry.viewState;
      if (state !== null && state !== undefined) editor.restoreViewState(state);
      editor.updateOptions({ readOnly: entry.readOnly });
      active = path;

      // The gutter belongs to the file, so switching tabs has to redraw it - otherwise the
      // marks of the file you just left stay on the one you moved to.
      drawBreakpoints();

      container.dataset["ready"] = "true";
      editor.focus();
    },

    close(path) {
      const entry = models.get(path);
      if (active === path) {
        active = null;
        editor.setModel(null);
        delete container.dataset["ready"];
      }
      viewStates.delete(path);
      entry?.model.dispose();
      models.delete(path);
    },

    rename(oldPath, newPath) {
      const localState = viewStates.get(oldPath);
      if (localState !== undefined) {
        viewStates.set(newPath, localState);
        viewStates.delete(oldPath);
      }
      const entry = models.get(oldPath);
      if (oldPath === newPath) return;
      if (entry === undefined) {
        if (active === oldPath) {
          const renamed = models.get(newPath);
          if (renamed !== undefined) {
            editor.setModel(renamed.model);
            active = newPath;
            if (localState !== undefined) editor.restoreViewState(localState);
          }
        }
        return;
      }

      /*
       * A rename is a new model, not a re-keyed map entry.
       *
       * A Monaco model's URI is fixed when it is created, and the URI is what selects the
       * language - so re-keying would leave a file renamed from `.txt` to `.ts` still
       * highlighted as plain text, and would leave the change listener below reporting
       * dirtiness against a path that no longer exists.
       */
      const wasDirty = entry.model.getAlternativeVersionId() !== entry.savedVersionId;
      const isActive = active === oldPath;
      const viewState = isActive ? editor.saveViewState() : entry.viewState;

      const model = monaco.editor.createModel(
        entry.model.getValue(),
        languageForFilename(newPath.split(/[\\/]/).at(-1) ?? newPath),
        monaco.Uri.file(newPath),
      );

      const next: OpenModel = {
        model,
        // A fresh model starts at its own first version. Matching it means "saved";
        // deliberately not matching it is what carries an unsaved edit across the rename.
        savedVersionId: wasDirty ? -1 : model.getAlternativeVersionId(),
        viewState,
        readOnly: entry.readOnly,
      };

      models.delete(oldPath);
      models.set(newPath, next);
      model.onDidChangeContent(() => notifyDirty(newPath));

      if (isActive) {
        editor.setModel(model);
        if (viewState !== null) editor.restoreViewState(viewState);
        editor.updateOptions({ readOnly: next.readOnly });
        active = newPath;
      }

      entry.model.dispose();
      notifyDirty(newPath);
    },

    text(path) {
      return models.get(path)?.model.getValue() ?? null;
    },

    markSaved(path) {
      const entry = models.get(path);
      if (entry === undefined) return;

      entry.savedVersionId = entry.model.getAlternativeVersionId();
      notifyDirty(path);
    },

    isDirty(path) {
      const entry = models.get(path);
      if (entry === undefined) return false;
      return entry.model.getAlternativeVersionId() !== entry.savedVersionId;
    },

    replaceText(path, text, options) {
      const entry = models.get(path);
      if (entry === undefined || entry.model.getValue() === text) return;

      // Through the edit stack rather than `setValue`, so the change is undoable and the
      // cursor and folds survive - the same reason conflict resolution edits this way.
      entry.model.pushEditOperations(
        [],
        [{ range: entry.model.getFullModelRange(), text }],
        () => null,
      );

      if (options?.keepDirty !== true) entry.savedVersionId = entry.model.getAlternativeVersionId();
      notifyDirty(path);
    },

    setReadOnly(path, readOnly) {
      const entry = models.get(path);
      if (entry === undefined) return;

      entry.readOnly = readOnly;
      if (active === path) editor.updateOptions({ readOnly });
    },

    isReadOnly(path) {
      return models.get(path)?.readOnly === true;
    },

    layout() {
      editor.layout();
    },

    runAction(actionId) {
      // Monaco owns multi-cursor, selection growth, and comment toggling; §2 says use it
      // rather than rebuild it, so the menu triggers the real action by id.
      editor.focus();

      const action = editor.getAction(actionId);
      if (action !== null) {
        void action.run();
        return;
      }

      // Some commands are keybinding-only and have no registered action.
      editor.trigger("menu", actionId, undefined);
    },

    toggleWordWrap() {
      const current = editor.getOption(monaco.editor.EditorOption.wordWrap);
      editor.updateOptions({ wordWrap: current === "on" ? "off" : "on" });
    },

    triggerInlineCompletion() {
      aiInlineCompletion.trigger();
    },

    cursorLine: () => editor.getPosition()?.lineNumber ?? 1,

    revealLine(line) {
      const target = Math.max(1, Math.floor(line));
      editor.revealLineInCenter(target);
      editor.setPosition({ lineNumber: target, column: 1 });
      editor.focus();
    },

    revealPosition(line, column) {
      const targetLine = Math.max(1, Math.floor(line));
      const targetColumn = Math.max(1, Math.floor(column));

      editor.revealPositionInCenter({ lineNumber: targetLine, column: targetColumn });
      editor.setPosition({ lineNumber: targetLine, column: targetColumn });
      editor.focus();
    },

    applyTheme(theme) {
      monaco.editor.setTheme(`adcode-${theme}`);
    },

    async formatDocument(path) {
      const entry = models.get(path);
      if (entry === undefined || entry.readOnly) return false;
      return formatting.formatModel(entry.model);
    },

    organizeImports(path) {
      const entry = models.get(path);
      if (entry === undefined || entry.readOnly) return false;

      const languageId = entry.model.getLanguageId();
      if (!organizeSupported(languageId)) return false;

      const original = entry.model.getValue();
      const organised = organiseImportBlock(original, {
        ...DEFAULT_OPTIONS,
        lineEnding: entry.model.getEOL() === "\r\n" ? "\r\n" : "\n",
      });
      if (organised === original) return false;

      entry.model.pushEditOperations(
        [],
        [{ range: entry.model.getFullModelRange(), text: organised }],
        () => null,
      );
      return true;
    },

    peekDefinition: showPeek,
    goToDefinition: jumpToDefinition,

    setBreakpoints(all) {
      breakpointsByFile = all;
      drawBreakpoints();
    },

    setPausedLine(path, line) {
      if (path === null || line === null || active === null || path !== active) {
        pausedDecorations.clear();
        return;
      }

      pausedDecorations.set([
        {
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: "debug-paused-line",
            glyphMarginClassName: "debug-paused-glyph",
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        },
      ]);

      editor.revealLineInCenterIfOutsideViewport(line);
    },

    onBreakpointToggle(listener) {
      breakpointListeners.push(listener);
    },

    applySettings(values) {
      editor.updateOptions(editorOptionsFor(values));

      // Not a Monaco option - it is this app's own behaviour - so it is applied here rather
      // than mapped in `editorOptionsFor`, which exists to translate settings into options
      // Monaco already has.
      tagClosing.setEnabled(values["adcode.editing.autoCloseTags"] !== false);
      pairedTagRename.setEnabled(values["adcode.editing.autoRenamePairedTag"] !== false);
      todoHighlight.setEnabled(values["adcode.editing.todoHighlighting"] !== false);
      // Opt-in, so the default is off rather than "anything but false".
      commentTones.setEnabled(values["adcode.editing.commentTones"] === true);
      spellCheck.setEnabled(values["adcode.editing.spellCheck"] === true);
      pathComplete.setEnabled(values["adcode.editing.pathAutocomplete"] !== false);
      aiInlineCompletion.setEnabled(values["adcode.ai.inlineCompletion"] === true);
      formatting.setEnabled(values["adcode.formatting.formatter"] !== false);
      treeSitter.setEnabled(values["adcode.language.treeSitterHighlighting"] !== false);

      navigationEnabled = values["adcode.navigation.goToDefinition"] !== false;
      if (!navigationEnabled) peek.close();

      errorLens.setEnabled(values["adcode.editing.inlineErrorLens"] === true);
      // The lens shows the same rewritten wording the Problems panel does, so it follows
      // the same switch - one setting, one vocabulary, everywhere an error is worded.
      errorLens.setPlainEnglish(values["adcode.editing.plainEnglishErrors"] !== false);

      // Reflected onto the host element because nothing else in the window says the editor
      // is in column-select mode, and in that mode dragging the mouse behaves completely
      // differently. Read back out of Monaco rather than from `values`, so it describes
      // the editor as it actually is rather than what it was asked for.
      container.dataset["columnSelection"] = String(
        editor.getOption(monaco.editor.EditorOption.columnSelection),
      );
    },

    onDirtyChange(listener) {
      dirtyListeners.push(listener);
    },

    onCursorChange(listener) {
      cursorListeners.push(listener);
    },

    onSaveRequested(listener) {
      saveListeners.push(listener);
    },

    onHumanInput(listener) {
      /*
       * `onDidType` exists on the standalone editor and is missing from its public
       * typings. It is the one event that means "a person pressed a key here" - the
       * widget fires it only when the type came from `source === 'keyboard'` - so it is
       * reached structurally and feature-detected. If a future Monaco drops it, typing
       * stops being counted and nothing else changes: §9's rule is that the worst
       * outcome of a broken reporting path is a feature that quietly does nothing.
       */
      const typing = (editor as unknown as {
        onDidType?: (handler: (text: string) => void) => monaco.IDisposable;
      }).onDidType;

      const typed =
        typeof typing === "function"
          ? typing.call(editor, (text: string) => listener(text.length, deps.activeFile()))
          : null;

      const pasted = editor.onDidPaste((event) => {
        // The pasted text is never read, only measured: the model reports the length of
        // the range the paste now occupies, so the content does not pass through here.
        const model = editor.getModel();
        const chars = model === null ? 0 : model.getValueLengthInRange(event.range);
        if (chars > 0) listener(chars, deps.activeFile());
      });

      return () => {
        typed?.dispose();
        pasted.dispose();
      };
    },

    focus() {
      editor.focus();
    },
  };
}
