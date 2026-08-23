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
import { installPathComplete } from "./pathComplete.ts";
import { installFormatting } from "./formatting.ts";
import { createDefinitions, symbolAt } from "./definitions.ts";
import { installPeek } from "./peek.ts";
import { installTreeSitterHighlight } from "./treeSitter.ts";
import { organizeImports as organiseImportBlock, organizeSupported, DEFAULT_OPTIONS } from "@adcode/format";
import type { DirEntry, SearchHitView } from "../../shared/api.ts";
import { editorOptionsFor } from "./editorOptions.ts";
import { createRemoteCursors, type RemoteCursors } from "../collab/remoteCursors.ts";
import { installTagClosing } from "./autoCloseTags.ts";
// Re-exported rather than defined here: the table decides highlighting, completions, the
// Structure view and the Run button, and it lives in a file with no Monaco import so it
// can be tested without launching a window.
export { languageForFilename } from "./languageIds.ts";
import { languageForFilename } from "./languageIds.ts";

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
      "editorLineNumber.foreground": "#a1a1a6",
      "editorLineNumber.activeForeground": "#1c1c1e",
      "editorIndentGuide.background1": "#0000000f",
      "editor.selectionBackground": "#007aff26",
      "editorCursor.foreground": "#007aff",
    },
  });

  monaco.editor.defineTheme("adcode-dark", {
    base: "vs-dark",
    inherit: true,
    rules: SEMANTIC_RULES_DARK,
    colors: {
      "editor.background": "#1e1e20",
      "editor.lineHighlightBackground": "#ffffff08",
      "editorLineNumber.foreground": "#6c6c70",
      "editorLineNumber.activeForeground": "#f5f5f7",
      "editorIndentGuide.background1": "#ffffff14",
      "editor.selectionBackground": "#0a84ff33",
      "editorCursor.foreground": "#0a84ff",
    },
  });
}

export interface EditorHost {
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
  /** Current cursor line, for "go to line" and the status bar. */
  cursorLine(): number;
  applyTheme(theme: "light" | "dark"): void;
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
  /** Apply the §4 editing settings the shell can honour today. */
  applySettings(values: Record<string, boolean | string>): void;
  onDirtyChange(listener: (path: string, dirty: boolean) => void): void;
  onCursorChange(listener: (line: number, column: number) => void): void;
  onSaveRequested(listener: () => void): void;
  focus(): void;
}

interface OpenModel {
  readonly model: monaco.editor.ITextModel;
  savedVersionId: number;
  viewState: monaco.editor.ICodeEditorViewState | null;
  readOnly: boolean;
}

/**
 * What the editor needs from the shell.
 *
 * Only path completion asks for anything: it has to know which file is open and where the
 * project starts before `./` and `../` mean anything. Passed in rather than imported so
 * this file still knows nothing about the workbench that owns it.
 */
export interface EditorHostDeps {
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

export function createEditorHost(container: HTMLElement, deps: EditorHostDeps): EditorHost {
  defineThemes();

  // Before the first model exists, so no file is ever checked under the wrong rules.
  configureLanguageDefaults();

  const editor = monaco.editor.create(container, {
    theme: "adcode-dark",
    automaticLayout: false,
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    lineHeight: 20,
    fontLigatures: true,
    minimap: { enabled: true, renderCharacters: false },
    stickyScroll: { enabled: true },
    bracketPairColorization: { enabled: true },
    guides: { indentation: true, bracketPairs: true },
    smoothScrolling: true,
    cursorSmoothCaretAnimation: "on",
    renderWhitespace: "none",
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
  registerKeywordCompletions();

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
  const tagClosing = installTagClosing(editor, monaco);

  /*
   * The rest of §4's editing group, installed the same way and for the same reason: each
   * reads the language off whatever model is current, so one subscription covers every file
   * that will ever be opened and none of them can leak.
   */
  const pairedTagRename = installPairedTagRename(editor, monaco);
  const errorLens = installErrorLens(editor, monaco);
  const todoHighlight = installTodoHighlight(editor, monaco);
  const treeSitter = installTreeSitterHighlight(monaco);

  const formatting = installFormatting(monaco, {
    lspFormatting: (path, languageId, options) =>
      window.adcode.language.formatting(path, languageId, options),
    hideSuggestions: () => editor.trigger("adcode.format", "hideSuggestWidget", null),
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

  const pathComplete = installPathComplete(monaco, {
    activeFile: deps.activeFile,
    workspaceRoot: deps.workspaceRoot,
    list: deps.list,
  });

  const models = new Map<string, OpenModel>();
  let active: string | null = null;

  const dirtyListeners: ((path: string, dirty: boolean) => void)[] = [];
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

      if (active !== null) {
        const previous = models.get(active);
        if (previous !== undefined) previous.viewState = editor.saveViewState();
      }

      editor.setModel(entry.model);
      if (entry.viewState !== null) editor.restoreViewState(entry.viewState);
      editor.updateOptions({ readOnly: entry.readOnly });
      active = path;

      container.dataset["ready"] = "true";
      editor.focus();
    },

    close(path) {
      const entry = models.get(path);
      if (entry === undefined) return;

      entry.model.dispose();
      models.delete(path);

      if (active === path) {
        active = null;
        editor.setModel(null);
        if (models.size === 0) delete container.dataset["ready"];
      }
    },

    rename(oldPath, newPath) {
      const entry = models.get(oldPath);
      if (entry === undefined || oldPath === newPath) return;

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
      monaco.editor.setTheme(theme === "dark" ? "adcode-dark" : "adcode-light");
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

    applySettings(values) {
      editor.updateOptions(editorOptionsFor(values));

      // Not a Monaco option - it is this app's own behaviour - so it is applied here rather
      // than mapped in `editorOptionsFor`, which exists to translate settings into options
      // Monaco already has.
      tagClosing.setEnabled(values["adcode.editing.autoCloseTags"] !== false);
      pairedTagRename.setEnabled(values["adcode.editing.autoRenamePairedTag"] !== false);
      todoHighlight.setEnabled(values["adcode.editing.todoHighlighting"] !== false);
      pathComplete.setEnabled(values["adcode.editing.pathAutocomplete"] !== false);
      formatting.setEnabled(values["adcode.formatting.formatter"] !== false);
      treeSitter.setEnabled(values["adcode.language.treeSitterHighlighting"] !== false);

      navigationEnabled = values["adcode.navigation.goToDefinition"] !== false;
      if (!navigationEnabled) peek.close();

      errorLens.setEnabled(values["adcode.editing.inlineErrorLens"] !== false);
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

    focus() {
      editor.focus();
    },
  };
}
