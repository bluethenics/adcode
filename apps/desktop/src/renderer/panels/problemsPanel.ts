/**
 * The Problems view.
 *
 * Every error in the open files, worst first, rewritten into words that assume no
 * knowledge of a type system. The rewriting lives in `@adcode/diagnostics`; this file only
 * draws it.
 *
 * Two decisions are load-bearing and easy to undo by accident:
 *
 * 1. **The compiler's own message is always on the row.** It is demoted below the rewrite,
 *    never replaced by it. A translation layer is only safe to ship because the real text
 *    stays one glance away for the times the rewrite is wrong.
 * 2. **Quick fixes resolve on click, not on render.** Asking the TypeScript worker for
 *    fixes for every visible marker means a round trip per row on a surface that redraws
 *    on every keystroke. The cost of that choice is that the button cannot know in advance
 *    whether a fix exists, so a click that finds none says so plainly rather than silently
 *    doing nothing.
 */
import { badgeFor, countBySeverity, explain, groupByFile, summarise } from "@adcode/diagnostics";
import type { Diagnostic, Severity } from "@adcode/diagnostics";
import { fileIcon } from "../workbench/fileIcons.ts";
import { ICON, createIcon } from "../workbench/icons.ts";

export interface QuickFix {
  readonly title: string;
  apply(): void | Promise<void>;
}

export interface ProblemsPanelDeps {
  readonly openAt: (file: string, line: number, column: number) => void;
  /** Resolved on click. Returns an empty list when the language has nothing to offer. */
  readonly quickFixes: (diagnostic: Diagnostic) => Promise<readonly QuickFix[]>;
  /** Hands the diagnostic to the assistant. Absent providers are its problem, not ours. */
  readonly explainWithAI: (diagnostic: Diagnostic) => void;
  /**
   * `adcode.editing.plainEnglishErrors`. Off means the compiler's own wording is the
   * headline - which is what an experienced user who finds the rewrites patronising
   * wants, and the reason the raw message was never thrown away.
   */
  readonly explanationsEnabled: () => boolean;
  readonly notify: (message: string) => void;
}

export interface ProblemsPanel {
  readonly element: HTMLElement;
  render(diagnostics: readonly Diagnostic[]): void;
  focus(): void;
}

/** Sources whose language worker can produce a real code fix. Others show no Fix button. */
const FIXABLE_SOURCES = new Set(["ts"]);

const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  error: "Error",
  warning: "Warning",
  info: "Suggestion",
};

const SEVERITY_ICON: Readonly<Record<Severity, string>> = {
  error: ICON.severityError,
  warning: ICON.severityWarning,
  info: ICON.severityInfo,
};

/**
 * Render `a `b` c` as text with a code span in the middle.
 *
 * Every segment goes in through `textContent`. The strings passed here contain identifiers
 * and type names lifted straight out of the user's file, and the renderer is hostile by
 * assumption (§1) - `innerHTML` here would be a self-inflicted injection through a panel
 * whose whole job is to be read.
 */
function withCodeSpans(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();

  for (const [index, segment] of text.split("`").entries()) {
    if (segment.length === 0) continue;

    if (index % 2 === 1) {
      const code = document.createElement("code");
      code.textContent = segment;
      fragment.append(code);
    } else {
      fragment.append(document.createTextNode(segment));
    }
  }

  return fragment;
}

export function createProblemsPanel(deps: ProblemsPanelDeps): ProblemsPanel {
  const element = document.createElement("div");
  element.className = "problems-panel";

  const summary = document.createElement("p");
  summary.className = "problems-summary";

  const list = document.createElement("div");
  list.className = "problems-list";
  list.setAttribute("role", "list");

  element.append(summary, list);

  function renderEmpty(): void {
    const empty = document.createElement("div");
    empty.className = "problems-empty";

    const headline = document.createElement("p");
    headline.className = "problems-empty-headline";
    headline.textContent = "No problems in your open files.";

    // The honest footnote. Monaco only checks what is open in a tab; a workspace-wide
    // sweep needs the language server that is not built yet. A panel that implied it had
    // scanned everything would be lying, and the settings roster already sets the
    // precedent of saying so rather than hiding it.
    const note = document.createElement("p");
    note.className = "problems-empty-note";
    note.textContent = "ADCode checks each file as you open it.";

    empty.append(headline, note);
    list.append(empty);
  }

  function renderFix(actions: HTMLElement, diagnostic: Diagnostic): void {
    if (!FIXABLE_SOURCES.has(diagnostic.source)) return;

    const fix = document.createElement("button");
    fix.type = "button";
    fix.className = "problems-action";
    fix.textContent = "Fix";

    fix.addEventListener("click", (event) => {
      event.stopPropagation();
      fix.disabled = true;

      void deps
        .quickFixes(diagnostic)
        .then(async (fixes) => {
          const first = fixes[0];
          if (first === undefined) {
            deps.notify("No automatic fix for this one - the hint above is the way in.");
            return;
          }

          await first.apply();
        })
        .catch(() => deps.notify("That fix could not be applied."))
        .finally(() => {
          fix.disabled = false;
        });
    });

    actions.append(fix);
  }

  function renderRow(diagnostic: Diagnostic): HTMLElement {
    const row = document.createElement("div");
    row.className = `problems-row problems-row-${diagnostic.severity}`;
    row.setAttribute("role", "listitem");
    row.tabIndex = 0;

    const glyph = document.createElement("span");
    glyph.className = "problems-glyph";
    glyph.setAttribute("aria-label", SEVERITY_LABEL[diagnostic.severity]);
    // Stroked paths rather than the characters "✕", "!" and "i". Three glyphs with three
    // different widths and vertical extents cannot share one 16px circle without the ink
    // jumping as the severity changes; a path drawn about (8, 8) cannot.
    glyph.append(createIcon(SEVERITY_ICON[diagnostic.severity]));

    const body = document.createElement("div");
    body.className = "problems-body";

    const explanation = deps.explanationsEnabled() ? explain(diagnostic) : null;

    const headline = document.createElement("p");
    headline.className = "problems-headline";
    headline.append(withCodeSpans(explanation?.plain ?? diagnostic.message));
    body.append(headline);

    if (explanation?.hint !== undefined) {
      const hint = document.createElement("p");
      hint.className = "problems-hint";
      hint.append(withCodeSpans(`→ ${explanation.hint}`));
      body.append(hint);
    }

    // Demoted, never dropped. When there is no rewrite the raw text is already the
    // headline, so repeating it underneath would be noise.
    if (explanation !== null) {
      const raw = document.createElement("p");
      raw.className = "problems-raw";
      raw.textContent = diagnostic.message;
      body.append(raw);
    }

    const meta = document.createElement("p");
    meta.className = "problems-meta";
    meta.textContent = `Line ${diagnostic.line}`;
    body.append(meta);

    const actions = document.createElement("div");
    actions.className = "problems-actions";
    renderFix(actions, diagnostic);

    const explainButton = document.createElement("button");
    explainButton.type = "button";
    explainButton.className = "problems-action";
    explainButton.textContent = "Explain this";
    explainButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deps.explainWithAI(diagnostic);
    });
    actions.append(explainButton);

    body.append(actions);
    row.append(glyph, body);

    const go = (): void => deps.openAt(diagnostic.file, diagnostic.line, diagnostic.column);
    row.addEventListener("click", go);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        go();
      }
    });

    return row;
  }

  return {
    element,

    render(diagnostics) {
      list.replaceChildren();

      const counts = countBySeverity(diagnostics);
      summary.textContent = summarise(counts);
      summary.dataset["tone"] = badgeFor(counts)?.tone ?? "clear";

      if (diagnostics.length === 0) {
        renderEmpty();
        return;
      }

      for (const group of groupByFile(diagnostics)) {
        const section = document.createElement("section");
        section.className = "problems-group";

        const header = document.createElement("header");
        header.className = "problems-file";

        const icon = fileIcon(group.file.split("/").pop() ?? group.file);

        const name = document.createElement("span");
        name.className = "problems-file-name";
        name.textContent = group.file;

        const count = document.createElement("span");
        count.className = "problems-file-count";
        count.textContent = String(group.diagnostics.length);

        header.append(icon, name, count);
        section.append(header);

        for (const diagnostic of group.diagnostics) section.append(renderRow(diagnostic));

        list.append(section);
      }
    },

    focus() {
      const first = list.querySelector<HTMLElement>(".problems-row");
      if (first !== null) first.focus();
      else element.focus();
    },
  };
}
