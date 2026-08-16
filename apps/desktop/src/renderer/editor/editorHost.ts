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
// Monaco 0.56's exports map is `"./*": "./esm/vs/*.js"`, so these specifiers - not the
// `esm/vs/...` paths most examples still show - are what actually resolve.
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";

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

/** §3: Monaco's surface is themed to match the workbench rather than left as default. */
function defineThemes(): void {
  monaco.editor.defineTheme("adcode-light", {
    base: "vs",
    inherit: true,
    rules: [],
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
    rules: [],
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
  text(path: string): string | null;
  markSaved(path: string): void;
  isDirty(path: string): boolean;
  layout(): void;
  applyTheme(theme: "light" | "dark"): void;
  onDirtyChange(listener: (path: string, dirty: boolean) => void): void;
  onCursorChange(listener: (line: number, column: number) => void): void;
  onSaveRequested(listener: () => void): void;
  focus(): void;
}

interface OpenModel {
  readonly model: monaco.editor.ITextModel;
  savedVersionId: number;
  viewState: monaco.editor.ICodeEditorViewState | null;
}

export function createEditorHost(container: HTMLElement): EditorHost {
  defineThemes();

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
    scrollBeyondLastLine: false,
    padding: { top: 12, bottom: 12 },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    folding: true,
    multiCursorModifier: "ctrlCmd",
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
    open(path, text, languageId) {
      if (models.has(path)) return;

      const model = monaco.editor.createModel(text, languageId, monaco.Uri.file(path));
      const entry: OpenModel = {
        model,
        savedVersionId: model.getAlternativeVersionId(),
        viewState: null,
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

    layout() {
      editor.layout();
    },

    applyTheme(theme) {
      monaco.editor.setTheme(theme === "dark" ? "adcode-dark" : "adcode-light");
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

/** Filename to Monaco language id. Extension-only, like the ad tagger. */
export function languageForFilename(filename: string): string {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot === -1 ? "" : lower.slice(dot);

  const byExtension: Readonly<Record<string, string>> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".mts": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".json": "json",
    ".css": "css",
    ".scss": "scss",
    ".less": "less",
    ".html": "html",
    ".htm": "html",
    ".md": "markdown",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".sh": "shell",
    ".ps1": "powershell",
    ".sql": "sql",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".xml": "xml",
    ".toml": "ini",
  };

  return byExtension[ext] ?? "plaintext";
}
