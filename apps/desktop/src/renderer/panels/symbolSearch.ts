/**
 * Find a function, class, or variable anywhere in the project.
 *
 * You almost always remember what a thing is called and almost never remember which file it
 * is in. This is the answer to that, and it is the reason `Ctrl+T` exists in every editor
 * that has one.
 *
 * **No index.** Building and maintaining a symbol index for a whole workspace is a large
 * amount of machinery whose failure mode is being quietly out of date. Instead the query is
 * handed to the same workspace search the Search panel uses - which is fast, always current,
 * and already written - and every line that comes back is passed to `@adcode/structure`'s
 * `declarationOn` to ask "is this line a declaration, and of what?".
 *
 * That inverts the usual cost: nothing is computed until somebody asks, and what comes back
 * is derived from the files as they are on disk right now.
 */
import { declarationOn, type SymbolKind } from "@adcode/structure";
import type { SearchHitView } from "../../shared/api.ts";

export interface SymbolSearch {
  open(): void;
  close(): void;
  isOpen(): boolean;
  setEnabled(enabled: boolean): void;
}

export interface SymbolSearchDeps {
  readonly host: HTMLElement;
  readonly search: (pattern: string) => Promise<readonly SearchHitView[]>;
  readonly languageFor: (path: string) => string;
  readonly open: (relativePath: string, line: number, column: number) => void;
  readonly restoreFocus: () => void;
}

interface SymbolHit {
  readonly kind: SymbolKind;
  readonly name: string;
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

/** Long enough that the search is worth running; shorter matches everything. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 180;
const MAX_ROWS = 40;

/** A short mark per kind, so the list says what each row is without a legend. */
const KIND_MARK: Readonly<Record<string, string>> = {
  function: "ƒ",
  method: "ƒ",
  class: "C",
  interface: "I",
  type: "T",
  enum: "E",
  constant: "K",
  variable: "V",
  property: "P",
  module: "M",
  namespace: "N",
  struct: "S",
  constructor: "ƒ",
  macro: "#",
  import: "→",
  selector: "{}",
  "at-rule": "@",
  element: "<>",
  rule: "{}",
  heading: "#",
};

/**
 * Best matches first.
 *
 * An exact name beats a prefix, a prefix beats a substring, and a shorter name beats a
 * longer one containing the same text - `get` should not be buried under `getConfiguration`.
 */
function rank(name: string, query: string): number {
  const lower = name.toLowerCase();
  if (lower === query) return 0;
  if (lower.startsWith(query)) return 1;
  return 2;
}

export function createSymbolSearch(deps: SymbolSearchDeps): SymbolSearch {
  let open = false;
  let enabled = true;
  let timer: number | null = null;
  /** Bumped per query so a slow search cannot overwrite a newer one's results. */
  let generation = 0;

  const overlay = document.createElement("div");
  // `quickopen` for the shared styling, plus its own name: the file picker is also a
  // `.quickopen`, and two of them under one selector is how a test starts matching the
  // wrong element.
  overlay.className = "quickopen quickopen-symbols";
  overlay.hidden = true;

  const box = document.createElement("div");
  box.className = "quickopen-box";

  const input = document.createElement("input");
  input.className = "quickopen-input";
  input.type = "text";
  input.placeholder = "Go to symbol in project";
  input.setAttribute("aria-label", "Go to symbol in project");

  const list = document.createElement("div");
  list.className = "quickopen-list";
  list.setAttribute("role", "listbox");

  const hint = document.createElement("div");
  hint.className = "quickopen-hint";

  box.append(input, list, hint);
  overlay.append(box);
  deps.host.append(overlay);

  let results: SymbolHit[] = [];
  let selected = 0;

  function renderRows(): void {
    list.replaceChildren();

    for (const [index, hit] of results.entries()) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "quickopen-row symbol-row";
      row.dataset["selected"] = String(index === selected);
      row.setAttribute("role", "option");

      const mark = document.createElement("span");
      mark.className = "symbol-kind";
      mark.textContent = KIND_MARK[hit.kind] ?? "•";
      mark.title = hit.kind;

      const name = document.createElement("span");
      name.className = "symbol-name";
      name.textContent = hit.name;

      const where = document.createElement("span");
      where.className = "symbol-where";
      where.textContent = `${hit.path}:${String(hit.line)}`;

      row.append(mark, name, where);
      row.addEventListener("click", () => choose(index));
      list.append(row);
    }

    hint.textContent =
      results.length === 0
        ? input.value.trim().length < MIN_QUERY
          ? "Type at least two letters."
          : "Nothing declared by that name."
        : `${String(results.length)} result${results.length === 1 ? "" : "s"}`;
  }

  function choose(index: number): void {
    const hit = results[index];
    if (hit === undefined) return;

    api.close();
    deps.open(hit.path, hit.line, hit.column);
  }

  async function run(query: string): Promise<void> {
    const mine = generation;
    const needle = query.trim().toLowerCase();

    if (needle.length < MIN_QUERY) {
      results = [];
      renderRows();
      return;
    }

    let hits: readonly SearchHitView[];
    try {
      hits = await deps.search(query.trim());
    } catch {
      hits = [];
    }

    // A newer keystroke started while this was running.
    if (mine !== generation) return;

    const found: SymbolHit[] = [];
    const seen = new Set<string>();

    for (const hit of hits) {
      const declaration = declarationOn(deps.languageFor(hit.path), hit.text);
      if (declaration === null) continue;
      if (!declaration.name.toLowerCase().includes(needle)) continue;

      // The same declaration can be reported twice when a name appears twice on its line.
      const key = `${hit.path}:${String(hit.line)}:${declaration.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      found.push({
        kind: declaration.kind,
        name: declaration.name,
        path: hit.path,
        line: hit.line,
        column: hit.column,
      });
    }

    found.sort(
      (a, b) =>
        rank(a.name, needle) - rank(b.name, needle) ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name),
    );

    results = found.slice(0, MAX_ROWS);
    selected = 0;
    renderRows();
  }

  input.addEventListener("input", () => {
    generation += 1;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      void run(input.value);
    }, DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      api.close();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;

      selected =
        event.key === "ArrowDown"
          ? (selected + 1) % results.length
          : (selected - 1 + results.length) % results.length;

      renderRows();
      list.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      choose(selected);
    }
  });

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) api.close();
  });

  const api: SymbolSearch = {
    open(): void {
      if (!enabled || open) return;
      open = true;

      results = [];
      selected = 0;
      input.value = "";
      renderRows();

      overlay.hidden = false;
      input.focus();
    },

    close(): void {
      if (!open) return;
      open = false;

      generation += 1;
      overlay.hidden = true;
      deps.restoreFocus();
    },

    isOpen: () => open,

    setEnabled(next) {
      enabled = next;
      if (!next) api.close();
    },
  };

  return api;
}
