/**
 * The two questions nothing else in a project ever asks.
 *
 * *Does this rule still style anything?* and *does this class exist?* Neither has a
 * compiler behind it. A mistyped class name is silent - the element simply renders
 * unstyled, usually on a page nobody opened - and a rule left behind by a deleted component
 * is invisible forever.
 *
 * Both are computed by `@adcode/structure`, which is pure and tested, and reported through
 * the same diagnostics pipeline as everything else, so they appear in the Problems panel
 * and count towards the badge like any other finding.
 *
 * **They are hints, not errors, and both are switchable.** Matching by name cannot see a
 * CSS module, a Tailwind class, or a name assembled from a variable, so on some projects
 * one of these lists is long and wrong. The wording says what was compared, and the setting
 * turns it off.
 */
import { missingClasses, unusedSelectors } from "@adcode/structure";
import type { Diagnostic } from "@adcode/diagnostics";

export interface StyleHints {
  /** Recompute for the file that is open. Cheap to call; it does its own debouncing. */
  refresh(path: string | null, languageId: string, text: string): void;
  /**
   * Run one of the two checks now and say what it found.
   *
   * `refresh` waits 700ms for typing to stop, publishes, and tells nobody how many. That
   * is right for a hint that appears while you work and wrong for a command somebody just
   * chose from a menu: they are owed an answer, including "nothing", and they are owed it
   * without a pause that reads as the menu item having done nothing.
   *
   * The check runs whether or not its setting is on. Choosing "Find unused CSS rules" from
   * a menu is a clearer statement of intent than a switch someone set once.
   */
  check(
    which: "unused" | "missing",
    path: string | null,
    languageId: string,
    text: string,
  ): Promise<readonly Diagnostic[]>;
  setUnusedEnabled(enabled: boolean): void;
  setMissingEnabled(enabled: boolean): void;
  dispose(): void;
}

export interface StyleHintsDeps {
  /** Publish under one source name, replacing whatever was there. */
  readonly report: (diagnostics: readonly Diagnostic[]) => void;
  /** Find files by a glob, using the workspace search everything else uses. */
  readonly filesMatching: (include: string) => Promise<readonly string[]>;
  readonly readFile: (path: string) => Promise<string | null>;
  readonly displayPath: (path: string) => string;
}

const DEBOUNCE_MS = 700;

/** Past this many files, comparing everything against everything stops being free. */
const MAX_FILES = 60;

const MARKUP = new Set(["html", "xml", "handlebars", "razor", "vue", "svelte", "astro"]);
const STYLE = new Set(["css", "scss", "less"]);
/** JSX lives in these, and a `className` in one is as real as a `class` in an HTML file. */
const SCRIPT_MARKUP = new Set(["javascript", "typescript", "javascriptreact", "typescriptreact"]);

export function createStyleHints(deps: StyleHintsDeps): StyleHints {
  let unusedEnabled = true;
  let missingEnabled = true;
  let timer: number | null = null;
  /** Bumped per run so a slow read cannot publish over a newer result. */
  let generation = 0;

  async function readAll(include: string): Promise<string[]> {
    const paths = (await deps.filesMatching(include)).slice(0, MAX_FILES);
    const texts: string[] = [];

    for (const path of paths) {
      const text = await deps.readFile(path);
      if (text !== null) texts.push(text);
    }

    return texts;
  }

  async function collectUnused(
    file: string,
    text: string,
  ): Promise<Diagnostic[]> {
      const found: Diagnostic[] = [];
      const markup = await readAll("**/*.{html,htm,vue,svelte,astro,jsx,tsx,hbs}");

      for (const rule of unusedSelectors(text, markup)) {
        found.push({
          file,
          line: rule.line,
          column: 1,
          endLine: rule.line,
          endColumn: rule.selector.length + 1,
          severity: "info",
          source: "styles",
          code: "unused-selector",
          // The wording states what was compared, because that is the limit of the claim.
          message: `Nothing in this project's markup matches ${rule.selector}. Names assembled at runtime, CSS modules and utility classes are not visible to this check.`,
        });
      }

      return found;
  }

  async function collectMissing(
    file: string,
    text: string,
  ): Promise<Diagnostic[]> {
      const found: Diagnostic[] = [];
      const stylesheets = await readAll("**/*.{css,scss,less}");

      for (const missing of missingClasses(text, stylesheets)) {
        found.push({
          file,
          line: missing.line,
          column: 1,
          endLine: missing.line,
          endColumn: missing.name.length + 1,
          severity: "info",
          source: "styles",
          code: "missing-class",
          message: `No stylesheet in this project defines .${missing.name}.`,
        });
      }

      return found;
  }

  async function compute(path: string, languageId: string, text: string): Promise<void> {
    const mine = generation;
    const file = deps.displayPath(path);
    const found: Diagnostic[] = [];

    if (STYLE.has(languageId) && unusedEnabled) {
      found.push(...(await collectUnused(file, text)));
      if (mine !== generation) return;
    }

    if ((MARKUP.has(languageId) || SCRIPT_MARKUP.has(languageId)) && missingEnabled) {
      found.push(...(await collectMissing(file, text)));
      if (mine !== generation) return;
    }

    deps.report(found);
  }

  return {
    refresh(path, languageId, text): void {
      generation += 1;
      if (timer !== null) window.clearTimeout(timer);

      if (path === null || (!unusedEnabled && !missingEnabled)) {
        deps.report([]);
        return;
      }

      // Both directions read every stylesheet or every template in the project, so this
      // waits for a real pause rather than running per keystroke.
      timer = window.setTimeout(() => {
        timer = null;
        void compute(path, languageId, text);
      }, DEBOUNCE_MS);
    },

    async check(which, path, languageId, text): Promise<readonly Diagnostic[]> {
      if (path === null) return [];

      const file = deps.displayPath(path);
      const applies =
        which === "unused"
          ? STYLE.has(languageId)
          : MARKUP.has(languageId) || SCRIPT_MARKUP.has(languageId);

      // Not an error, and not silence either: the caller turns this into "open a
      // stylesheet first" rather than reporting nothing found in a file that was never
      // eligible to have anything found in it.
      if (!applies) return [];

      const found =
        which === "unused" ? await collectUnused(file, text) : await collectMissing(file, text);

      // Published as well as returned, so the rows are in the Problems panel the status
      // line is pointing at.
      deps.report(found);
      return found;
    },

    setUnusedEnabled(enabled): void {
      unusedEnabled = enabled;
      if (!enabled) deps.report([]);
    },

    setMissingEnabled(enabled): void {
      missingEnabled = enabled;
      if (!enabled) deps.report([]);
    },

    dispose(): void {
      if (timer !== null) window.clearTimeout(timer);
      generation += 1;
    },
  };
}
