/**
 * Where is this defined?
 *
 * Two ways to answer, and the difference between them is the whole point:
 *
 * - A **language server** resolves it. It has parsed the project and knows which `handle`
 *   this is. The answer is right.
 * - **Searching by name** finds every declaration with that name. Usually that is the same
 *   answer, and sometimes it is three files that each define `handle` and cannot tell you
 *   which one you meant.
 *
 * Both are useful; passing the second off as the first is not. So every result carries how
 * it was found, and the UI prints it. `relations.ts` states the rule this follows: "a tool
 * that quietly implies it resolved something it guessed at is worse than one that shows its
 * working."
 *
 * The fallback runs in all 46 languages `@adcode/structure` can read, on a machine with no
 * language server installed - which is most machines, and the case an editor that bundles
 * nothing has to be good at.
 */
import type * as monaco from "monaco-editor";
import { classifyReference, referenceGlobFor, referencePattern } from "@adcode/structure";
import type { LanguageLocation, SearchHitView } from "../../shared/api.ts";

export interface DefinitionTarget {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  /** Trimmed source of the line, for a result list that is worth reading. */
  readonly preview: string;
}

export interface DefinitionAnswer {
  readonly name: string;
  /**
   * How this was found.
   *
   * `resolved` - a language server worked it out. `matched` - these are declarations with
   * the right name, which is a weaker claim and is displayed as one.
   */
  readonly source: "resolved" | "matched";
  readonly targets: readonly DefinitionTarget[];
}

export interface DefinitionDeps {
  readonly lspDefinition: (
    path: string,
    languageId: string,
    line: number,
    column: number,
  ) => Promise<LanguageLocation[] | null>;
  readonly search: (pattern: string, include: string) => Promise<readonly SearchHitView[]>;
  /** Absolute path for a workspace-relative one, since search returns relative paths. */
  readonly absolute: (relativePath: string) => string;
}

/** More than this and the list has stopped being an answer. */
const MAX_TARGETS = 50;

/** The identifier under the cursor, or null. */
export function symbolAt(
  model: monaco.editor.ITextModel,
  position: monaco.IPosition,
): string | null {
  const word = model.getWordAtPosition(position);
  if (word === null) return null;

  // A number is not a symbol, and `getWordAtPosition` happily returns one.
  if (/^[0-9]/.test(word.word)) return null;
  return word.word;
}

export function createDefinitions(deps: DefinitionDeps) {
  return {
    /**
     * Resolve the symbol at a position.
     *
     * `null` when there is no symbol there, or when neither route found anything - which is
     * a real outcome for a local variable in a language with no server.
     */
    async at(
      model: monaco.editor.ITextModel,
      position: monaco.IPosition,
      path: string,
    ): Promise<DefinitionAnswer | null> {
      const name = symbolAt(model, position);
      if (name === null) return null;

      const languageId = model.getLanguageId();

      let fromServer: LanguageLocation[] | null = null;
      try {
        fromServer = await deps.lspDefinition(path, languageId, position.lineNumber, position.column);
      } catch {
        fromServer = null;
      }

      if (fromServer !== null && fromServer.length > 0) {
        return {
          name,
          source: "resolved",
          targets: fromServer.slice(0, MAX_TARGETS).map((location) => ({
            path: location.path,
            line: location.line,
            column: location.column,
            preview: "",
          })),
        };
      }

      let hits: readonly SearchHitView[];
      try {
        hits = await deps.search(referencePattern(name), referenceGlobFor(languageId));
      } catch {
        return null;
      }

      /*
       * Only the declarations.
       *
       * Every mention of the name comes back from the search - the calls, the imports, the
       * word inside a comment. `classifyReference` is what separates "this is where it is
       * made" from "this is somewhere it is used", and without it this list is forty rows
       * of noise and the feature is worse than nothing.
       */
      const targets = hits
        .filter((hit) => classifyReference(name, languageId, hit.text, hit.column) === "definition")
        .slice(0, MAX_TARGETS)
        .map((hit) => ({
          path: deps.absolute(hit.path),
          line: hit.line,
          column: hit.column,
          preview: hit.text.trim(),
        }));

      if (targets.length === 0) return null;
      return { name, source: "matched", targets };
    },
  };
}

export type Definitions = ReturnType<typeof createDefinitions>;
