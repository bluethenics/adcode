/**
 * The search view and the quick-open palette.
 *
 * Brief §4's Navigation group: fuzzy file open and global regex search. §7 budgets first
 * results at under 100ms over 50,000 files, which is why quick open debounces rather
 * than querying on every keystroke - the ranking is fast, but a round trip per character
 * is not, and the same rule as inline completion applies: nothing the user types waits
 * on anything.
 */
import type { QuickOpenHit, SearchHitView } from "../../shared/api.ts";
import { fileIcon } from "../workbench/fileIcons.ts";

const DEBOUNCE_MS = 90;

export interface SearchPanel {
  readonly element: HTMLElement;
  focus(): void;
}

export interface SearchPanelDeps {
  readonly openAt: (path: string, line: number, column: number) => void;
  /** Called after a replace-all, so open editors can be re-read from disk. */
  readonly afterReplace: () => void;
  /** Transient, non-blocking news: something happened and the panel carried on. */
  readonly notify: (message: string) => void;
  /**
   * An action that will not run, said where it cannot be missed.
   *
   * Separate from `notify` because the two are read differently: a refusal is the answer
   * to a gesture somebody just made, and the status bar erases itself after four seconds
   * whether or not anyone looked at it.
   */
  readonly refuse: (action: string, message: string) => void;
}

export function createSearchPanel(deps: SearchPanelDeps): SearchPanel {
  const element = document.createElement("div");
  element.className = "search-panel";

  const form = document.createElement("form");
  form.className = "search-form";

  const input = document.createElement("input");
  input.className = "search-input";
  input.type = "search";
  input.placeholder = "Search";
  input.setAttribute("aria-label", "Search the workspace");

  const options = document.createElement("div");
  options.className = "search-options";

  function toggle(label: string, title: string): HTMLInputElement {
    const wrapper = document.createElement("label");
    wrapper.className = "search-toggle";
    wrapper.title = title;

    const box = document.createElement("input");
    box.type = "checkbox";

    const text = document.createElement("span");
    text.textContent = label;

    wrapper.append(box, text);
    options.append(wrapper);
    return box;
  }

  const caseSensitive = toggle("Aa", "Match case");
  const wholeWord = toggle("W", "Whole word");
  const isRegex = toggle(".*", "Regular expression");

  // §4 lists "global regex search and replace" as one feature, so the replacement box
  // lives with the query rather than behind a mode switch.
  const replacement = document.createElement("input");
  replacement.className = "search-input";
  replacement.placeholder = "Replace";
  replacement.setAttribute("aria-label", "Replacement text");

  const replaceAll = document.createElement("button");
  replaceAll.className = "ghost-button search-replace-all";
  replaceAll.type = "button";
  replaceAll.textContent = "Replace all";
  replaceAll.title = "Rewrite every match in the workspace";

  const replaceRow = document.createElement("div");
  replaceRow.className = "search-replace-row";
  replaceRow.append(replacement, replaceAll);

  const include = document.createElement("input");
  include.className = "search-glob";
  include.placeholder = "files to include, e.g. *.ts";
  include.setAttribute("aria-label", "Files to include");

  const exclude = document.createElement("input");
  exclude.className = "search-glob";
  exclude.placeholder = "files to exclude";
  exclude.setAttribute("aria-label", "Files to exclude");

  form.append(input, options, replaceRow, include, exclude);

  const summary = document.createElement("p");
  summary.className = "search-summary";

  const results = document.createElement("div");
  results.className = "search-results";

  element.append(form, summary, results);

  let timer: number | undefined;
  let generation = 0;

  function render(hits: readonly SearchHitView[]): void {
    results.replaceChildren();

    const byFile = new Map<string, SearchHitView[]>();
    for (const hit of hits) {
      const existing = byFile.get(hit.path);
      if (existing === undefined) byFile.set(hit.path, [hit]);
      else existing.push(hit);
    }

    for (const [path, fileHits] of byFile) {
      const group = document.createElement("details");
      group.className = "search-group";
      group.open = byFile.size <= 12;

      const heading = document.createElement("summary");
      heading.className = "search-group-title";
      heading.append(
        fileIcon(path.split("/").pop() ?? path),
        document.createTextNode(`${path} · ${fileHits.length}`),
      );
      group.append(heading);

      for (const hit of fileHits) {
        const row = document.createElement("button");
        row.className = "search-hit";
        row.type = "button";

        const where = document.createElement("span");
        where.className = "search-hit-line";
        where.textContent = String(hit.line);

        // Built from text nodes, never innerHTML: this is file content, and a repository
        // containing a `<script>` tag is not an attack, it is Tuesday.
        const text = document.createElement("span");
        text.className = "search-hit-text";

        const before = hit.text.slice(0, hit.column - 1);
        const matched = hit.text.slice(hit.column - 1, hit.column - 1 + hit.matchLength);
        const after = hit.text.slice(hit.column - 1 + hit.matchLength);

        const mark = document.createElement("mark");
        mark.textContent = matched;
        text.append(document.createTextNode(before), mark, document.createTextNode(after));

        row.append(where, text);
        row.addEventListener("click", () => deps.openAt(hit.path, hit.line, hit.column));
        group.append(row);
      }

      results.append(group);
    }
  }

  /** The query, in the shape both search and replace take. */
  function currentQuery(): {
    pattern: string;
    isRegex: boolean;
    caseSensitive: boolean;
    wholeWord: boolean;
    include: string;
    exclude: string;
  } {
    return {
      pattern: input.value,
      isRegex: isRegex.checked,
      caseSensitive: caseSensitive.checked,
      wholeWord: wholeWord.checked,
      include: include.value.trim(),
      exclude: exclude.value.trim(),
    };
  }

  replaceAll.addEventListener("click", () => {
    const query = currentQuery();
    if (query.pattern.length === 0) {
      deps.refuse("Replace all", "Type something to search for first.");
      return;
    }

    replaceAll.disabled = true;
    summary.textContent = "Replacing…";

    void window.adcode.search
      .replace(query, replacement.value)
      .then((result) => {
        deps.notify(
          result.files === 0
            ? "Nothing to replace."
            : `Replaced ${result.replacements} in ${result.files} file${result.files === 1 ? "" : "s"}.`,
        );
        deps.afterReplace();
        run();
      })
      .catch(() => deps.notify("Replace failed."))
      .finally(() => {
        replaceAll.disabled = false;
      });
  });

  function run(): void {
    const pattern = input.value;
    const mine = ++generation;

    if (pattern.length === 0) {
      results.replaceChildren();
      summary.textContent = "";
      return;
    }

    summary.textContent = "Searching…";

    void window.adcode.search
      .run(currentQuery())
      .then((hits) => {
        // A slower earlier search must never overwrite a newer one's results.
        if (mine !== generation) return;

        summary.textContent =
          hits.length === 0
            ? "No results."
            : `${hits.length} result${hits.length === 1 ? "" : "s"}`;
        render(hits);
      })
      .catch(() => {
        if (mine === generation) summary.textContent = "Search failed.";
      });
  }

  function schedule(): void {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(run, DEBOUNCE_MS);
  }

  input.addEventListener("input", schedule);
  for (const box of [caseSensitive, wholeWord, isRegex]) box.addEventListener("change", run);
  for (const glob of [include, exclude]) glob.addEventListener("input", schedule);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run();
  });

  return {
    element,
    focus: () => input.focus(),
  };
}

/* ── Quick open (Ctrl+P) ────────────────────────────────────────────────── */

export interface QuickOpen {
  toggle(): void;
  /** Open with the box already carrying `seed`, for the command centre's handover. */
  open(seed?: string): void;
  close(): void;
  isOpen(): boolean;
}

export function createQuickOpen(deps: { openFile: (path: string) => void }): QuickOpen {
  const overlay = document.createElement("div");
  overlay.className = "quickopen";
  overlay.hidden = true;

  const box = document.createElement("div");
  box.className = "quickopen-box";

  const input = document.createElement("input");
  input.className = "quickopen-input";
  input.placeholder = "Go to file";
  input.setAttribute("aria-label", "Go to file");

  const list = document.createElement("div");
  list.className = "quickopen-list";

  box.append(input, list);
  overlay.append(box);
  document.body.append(overlay);

  let hits: QuickOpenHit[] = [];
  let selected = 0;
  let timer: number | undefined;
  let generation = 0;

  function render(): void {
    list.replaceChildren();

    hits.forEach((hit, index) => {
      const row = document.createElement("button");
      row.className = "quickopen-row";
      row.type = "button";
      row.ariaSelected = String(index === selected);
      row.append(fileIcon(hit.path.split("/").pop() ?? hit.path));

      // Highlight the matched characters, so the ranking is legible rather than magic.
      const positions = new Set(hit.positions);
      for (let i = 0; i < hit.path.length; i++) {
        const span = document.createElement("span");
        span.textContent = hit.path[i]!;
        if (positions.has(i)) span.className = "quickopen-match";
        row.append(span);
      }

      row.addEventListener("click", () => {
        deps.openFile(hit.path);
        api.close();
      });

      list.append(row);
    });
  }

  function query(): void {
    const mine = ++generation;

    void window.adcode.search.quickOpen(input.value).then((found) => {
      if (mine !== generation) return;

      hits = found;
      selected = 0;
      render();
    });
  }

  input.addEventListener("input", () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(query, 40);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selected = Math.min(selected + 1, hits.length - 1);
      render();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selected = Math.max(selected - 1, 0);
      render();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[selected];
      if (hit !== undefined) {
        deps.openFile(hit.path);
        api.close();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      api.close();
    }
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) api.close();
  });

  const api: QuickOpen = {
    toggle(): void {
      if (overlay.hidden) api.open();
      else api.close();
    },

    open(seed = ""): void {
      overlay.hidden = false;
      input.value = seed;
      hits = [];
      render();
      input.focus();
      // Caret after the seed rather than selecting it, so the next keystroke continues the
      // word the user started in the title bar instead of replacing it.
      input.setSelectionRange(seed.length, seed.length);
      query();
    },

    close(): void {
      overlay.hidden = true;
    },

    isOpen: () => !overlay.hidden,
  };

  return api;
}
