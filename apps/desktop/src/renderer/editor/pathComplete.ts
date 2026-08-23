/**
 * Completing filenames from the files that are really there.
 *
 * A mistyped import is a broken build whose error usually names something other than the
 * typo, so the minutes go on reading a message about a module resolution rather than on
 * noticing that `compnents` has no `o`. Being offered only names that exist makes the
 * mistake impossible rather than merely detectable.
 *
 * The judgement about *whether* the cursor is in a path is `pathContext.ts`, which is pure
 * and tested. This file does the listing and the Monaco plumbing.
 *
 * Directories are offered with a trailing slash and re-trigger the widget, so walking down
 * a tree is one keystroke per level.
 */
import type * as monaco from "monaco-editor";
import { pathContextAt } from "./pathContext.ts";
import type { DirEntry } from "../../shared/api.ts";

export interface PathComplete {
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export interface PathCompleteDeps {
  /** Absolute path of the file being edited, for resolving `./` and `../`. */
  readonly activeFile: () => string | null;
  readonly workspaceRoot: () => string | null;
  readonly list: (directory: string) => Promise<readonly DirEntry[]>;
}

/** Enough to choose from; more than this is a list nobody reads. */
const MAX_ITEMS = 200;

/** Never offered - they are noise in every project that has them. */
const HIDDEN = new Set([".git", "node_modules", ".next", "out", "dist", ".DS_Store"]);

const slashed = (value: string): string => value.split("\\").join("/");

/** The directory holding a file, with no trailing slash. */
function parentOf(file: string): string {
  const normalised = slashed(file);
  const cut = normalised.lastIndexOf("/");
  return cut === -1 ? normalised : normalised.slice(0, cut);
}

/**
 * Where a typed directory prefix actually points.
 *
 * `null` when it cannot be resolved without guessing - a bare package name like `react`,
 * or a `~` we have no home directory for. Offering the current folder's contents for those
 * would be confidently wrong, which is worse than offering nothing.
 */
function resolveDirectory(
  typed: string,
  activeFile: string | null,
  root: string | null,
): string | null {
  // A leading slash means the workspace, not the filesystem root: in an editor, "/src" is
  // what everybody means, and offering `C:/` would be useless.
  if (typed.startsWith("/")) {
    return root === null ? null : `${slashed(root)}${typed}`.replace(/\/+$/, "");
  }

  if (typed.startsWith("~")) return null;

  const relative = typed.startsWith("./") || typed.startsWith("../");
  if (!relative && typed !== "" && !typed.startsWith("@")) {
    // `components/Button` with no leading dot - resolved against the current file, which is
    // what a bare relative path means in most languages.
    if (activeFile === null) return null;
  }

  const base = activeFile !== null ? parentOf(activeFile) : root === null ? null : slashed(root);
  if (base === null) return null;

  const segments = `${base}/${typed}`.split("/");
  const resolved: string[] = [];

  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  // A Windows path loses its drive letter's trailing colon-slash through the split, so it
  // is rebuilt here rather than assumed.
  const joined = resolved.join("/");
  return base.startsWith("/") ? `/${joined}` : joined;
}

export function installPathComplete(
  monacoApi: typeof monaco,
  deps: PathCompleteDeps,
): PathComplete {
  let enabled = true;

  const provider: monaco.languages.CompletionItemProvider = {
    /*
     * The quotes are load-bearing, not a convenience.
     *
     * Monaco turns quick-suggestions off inside strings, which is where every path lives -
     * so without a trigger character the widget never opens on its own and this feature
     * simply does not appear. `/` then walks into a directory.
     *
     * `.` is in the list because a relative path starts with it, and measurably so: with
     * `.` removed, typing `import x from "./pack` opened no widget at all. A trigger has to
     * land on a character *after* the auto-closed quote has settled, and `.` is the first
     * one that does. The cost is that it also fires on decimals and method calls, where the
     * provider finds no path context and returns nothing.
     */
    triggerCharacters: ["/", '"', "'", "`", "."],

    async provideCompletionItems(model, position) {
      if (!enabled) return { suggestions: [] };

      const line = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const context = pathContextAt(line);
      if (context === null) return { suggestions: [] };

      const directory = resolveDirectory(
        context.directory,
        deps.activeFile(),
        deps.workspaceRoot(),
      );
      if (directory === null) return { suggestions: [] };

      let entries: readonly DirEntry[];
      try {
        entries = await deps.list(directory);
      } catch {
        // A directory that does not exist is the normal case while typing one. Silence is
        // the right answer; an error toast for every keystroke would not be.
        return { suggestions: [] };
      }

      // Only the partial name is replaced, never the directory the user already typed.
      const range = new monacoApi.Range(
        position.lineNumber,
        position.column - context.partial.length,
        position.lineNumber,
        position.column,
      );

      const suggestions = entries
        .filter((entry) => !HIDDEN.has(entry.name))
        .filter((entry) => !entry.name.startsWith(".") || context.partial.startsWith("."))
        .slice(0, MAX_ITEMS)
        .map((entry) => {
          const label = entry.isDirectory ? `${entry.name}/` : entry.name;

          const item: monaco.languages.CompletionItem = {
            label,
            kind: entry.isDirectory
              ? monacoApi.languages.CompletionItemKind.Folder
              : monacoApi.languages.CompletionItemKind.File,
            insertText: label,
            range,
            // Folders first, then alphabetical - walking down a tree is the common motion.
            sortText: `${entry.isDirectory ? "0" : "1"}${entry.name.toLowerCase()}`,
          };

          // Added rather than set to `undefined`: the project builds with
          // `exactOptionalPropertyTypes`, where an explicit undefined is not the same as
          // an absent property.
          return entry.isDirectory
            ? { ...item, command: { id: "editor.action.triggerSuggest", title: "Keep going" } }
            : item;
        });

      return { suggestions };
    },
  };

  /*
   * Registered per language rather than with a wildcard.
   *
   * Paths appear in strings in every language, so the selector has to be all of them - and
   * asking Monaco which languages it knows is the honest way to say "all of them", rather
   * than a wildcard whose meaning varies between Monaco versions.
   */
  const registrations = monacoApi.languages
    .getLanguages()
    .map((language) => monacoApi.languages.registerCompletionItemProvider(language.id, provider));

  return {
    setEnabled(next) {
      enabled = next;
    },
    dispose() {
      for (const registration of registrations) registration.dispose();
    },
  };
}
