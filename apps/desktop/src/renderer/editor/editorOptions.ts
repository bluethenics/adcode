/**
 * Settings rows to Monaco editor options.
 *
 * Split out of `editorHost.ts` and deliberately Monaco-free, so the mapping can be tested
 * without a window - the same reason `layoutSizes.ts` and `fileNames.ts` are separate from
 * the shell they serve. The return type is declared here rather than imported from Monaco
 * so this file has no `monaco-editor` dependency at all; it is checked structurally where
 * `updateOptions` is called.
 *
 * The mapping earns its own file because it is where a settings row quietly becomes a lie.
 * "Multi-cursor and column select" used to be wired straight to Monaco's `columnSelection`
 * and defaulted to on, so every install shipped in column-select mode and dragging the
 * mouse across a line selected a rectangular block rather than the line. Monaco's own note
 * on the option reads "Enable that the selection with the mouse and keys is doing column
 * selection. Defaults to false" - false by default because it is a mode you enter for a
 * particular edit, not a preference that rides along with something else.
 */

export interface EditorOptions {
  readonly minimap: { readonly enabled: boolean; readonly renderCharacters: boolean };
  readonly stickyScroll: { readonly enabled: boolean };
  readonly bracketPairColorization: { readonly enabled: boolean };
  readonly guides: { readonly indentation: boolean; readonly bracketPairs: boolean };
  readonly renderWhitespace: "none" | "trailing";
  readonly folding: boolean;
  readonly multiCursorModifier: "ctrlCmd" | "alt";
  readonly multiCursorLimit: number;
  readonly columnSelection: boolean;
  readonly quickSuggestions: boolean;
  readonly suggestOnTriggerCharacters: boolean;
  readonly acceptSuggestionOnEnter: "on" | "smart" | "off";
  readonly tabCompletion: "on" | "off";
  readonly wordBasedSuggestions: "off" | "currentDocument";
  readonly suggestSelection: "first";
}

/** Monaco's own default cap. Only the lower bound of one is load-bearing. */
const MANY_CURSORS = 10000;

export function editorOptionsFor(values: Record<string, boolean | string>): EditorOptions {
  // Missing reads as on: a fresh profile has no keys at all, and reading that as "off"
  // would launch the editor with no minimap, no folding, and no guides.
  const on = (id: string): boolean => values[id] !== false;

  return {
    minimap: { enabled: on("adcode.editing.minimap"), renderCharacters: false },
    stickyScroll: { enabled: on("adcode.editing.stickyScroll") },
    bracketPairColorization: { enabled: on("adcode.editing.bracketPairColorization") },
    guides: {
      indentation: on("adcode.editing.indentGuides"),
      bracketPairs: on("adcode.editing.bracketPairColorization"),
    },
    renderWhitespace: values["adcode.editing.trailingWhitespace"] === true ? "trailing" : "none",
    folding: on("adcode.editing.codeFolding"),
    multiCursorModifier: "ctrlCmd",

    // Monaco has no on/off for multi-cursor, but `multiCursorLimit` is a real cap, and a
    // cap of one is exactly "no second cursor". That is what the row always claimed to do.
    multiCursorLimit: on("adcode.editing.multiCursor") ? MANY_CURSORS : 1,

    // Its own row, and off unless asked for. Anything else and a preference nobody set
    // changes what dragging the mouse means.
    columnSelection: values["adcode.editing.columnSelection"] === true,

    /*
     * Suggestions.
     *
     * `acceptSuggestionOnEnter` is the row with a real cost, and it is worth being precise
     * about what it buys and what it takes. With the widget open, Enter takes the
     * highlighted suggestion rather than starting a new line - which is the whole point,
     * and is also the single most common reason someone turns completions off in disgust
     * after a stray Enter rewrote their line. Monaco's `"smart"` only accepts when the
     * completion would change the text, and that is the compromise VS Code ships.
     *
     * Enter was asked for explicitly, so `"on"` is the default. `"smart"` is what the row
     * degrades to when switched off rather than `"off"`, because Tab still needs to work
     * and a user who wanted "Enter should be a newline" wants that, not "no completions".
     */
    quickSuggestions: on("adcode.editing.suggestions"),
    suggestOnTriggerCharacters: on("adcode.editing.suggestions"),
    acceptSuggestionOnEnter: on("adcode.editing.acceptOnEnter") ? "on" : "smart",
    tabCompletion: on("adcode.editing.suggestions") ? "on" : "off",

    /*
     * Words from the current file only, never `allDocuments`.
     *
     * `allDocuments` scans every open model on every keystroke, and in a workspace with
     * thirty tabs open that is a per-character cost on the one code path §7 says nothing
     * may ever wait on. Words from the file being typed in are also simply better
     * suggestions - the identifier the user wants is nearly always one they just wrote.
     */
    wordBasedSuggestions: on("adcode.editing.wordSuggestions") ? "currentDocument" : "off",

    // Pre-select the first entry so Enter has something to take without an arrow press.
    suggestSelection: "first",
  };
}
