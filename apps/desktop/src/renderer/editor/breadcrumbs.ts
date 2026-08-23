/**
 * The trail above the editor: where this file is, and what you are inside.
 *
 * Two questions, answered in one line. The folders answer "where am I in the project"; the
 * symbol trail answers "which function is this", which is the one you cannot get from the
 * tab title and cannot get from scrolling.
 *
 * The symbol part is `@adcode/structure`'s outline, the same reading the Structure popup
 * uses - so the two never disagree about what a file contains. Recomputed on a timer rather
 * than on every keystroke: it is a pass over the file, and nothing here needs to be right
 * within the same frame as the character that changed it.
 */
import { nodeAtLine, outlineOf, outlineSupported, type OutlineNode } from "@adcode/structure";

export interface Breadcrumbs {
  readonly element: HTMLElement;
  setEnabled(enabled: boolean): void;
  /** The file changed, or a different one was opened. */
  update(path: string | null, languageId: string, text: string, line: number): void;
  dispose(): void;
}

export interface BreadcrumbsDeps {
  /** Workspace-relative path, or the absolute one when there is no workspace. */
  readonly displayPath: (path: string) => string;
  /** Reveal a folder in the explorer. */
  readonly revealFolder: (relativeDirectory: string) => void;
  /** Open the file's structure, focused on a symbol. */
  readonly showStructure: () => void;
  /** Move the cursor to a line, for clicking a symbol in the trail. */
  readonly goToLine: (line: number) => void;
}

const RECOMPUTE_DELAY_MS = 250;

/** The chain of symbols containing a line, outermost first. */
function trailTo(nodes: readonly OutlineNode[], line: number): OutlineNode[] {
  const deepest = nodeAtLine(nodes, line);
  if (deepest === null) return [];

  const trail: OutlineNode[] = [];

  // Walk down from the roots, taking whichever child still contains the line. Cheaper than
  // searching for parents, and it produces the chain already in reading order.
  let level: readonly OutlineNode[] = nodes;
  for (;;) {
    const next = level.find((node) => line >= node.line && line <= node.endLine);
    if (next === undefined) break;
    trail.push(next);
    level = next.children;
  }

  return trail;
}

export function createBreadcrumbs(deps: BreadcrumbsDeps): Breadcrumbs {
  const element = document.createElement("nav");
  element.className = "breadcrumbs";
  element.setAttribute("aria-label", "Breadcrumbs");
  /*
   * Collapsed rather than hidden, always.
   *
   * `.main` is a grid whose rows are positional, and a `hidden` element is `display: none`
   * and drops out of the grid - which hands the editor an `auto` row and collapses it to
   * nothing. Zero height keeps the row.
   */
  element.dataset["empty"] = "true";

  let enabled = true;
  let timer: number | null = null;

  /** The last thing rendered, so an unchanged trail does not rebuild the DOM. */
  let signature = "";

  function crumb(label: string, title: string, onClick: () => void): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "breadcrumb";
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", onClick);
    return button;
  }

  function separator(): HTMLElement {
    const span = document.createElement("span");
    span.className = "breadcrumb-separator";
    span.setAttribute("aria-hidden", "true");
    span.textContent = "›";
    return span;
  }

  function render(path: string | null, languageId: string, text: string, line: number): void {
    if (!enabled || path === null) {
      element.replaceChildren();
      element.dataset["empty"] = "true";
      signature = "";
      return;
    }

    const relative = deps.displayPath(path);
    const segments = relative.split(/[\\/]/).filter((part) => part.length > 0);

    const trail = outlineSupported(languageId) ? trailTo(outlineOf(languageId, text), line) : [];

    const next = `${relative}|${trail.map((node) => `${node.name}@${String(node.line)}`).join(">")}`;
    if (next === signature) return;
    signature = next;

    element.replaceChildren();
    delete element.dataset["empty"];

    for (const [index, segment] of segments.entries()) {
      if (index > 0) element.append(separator());

      const isFile = index === segments.length - 1;
      const directory = segments.slice(0, index + 1).join("/");

      element.append(
        crumb(
          segment,
          isFile ? "Show this file's structure" : `Reveal ${directory}`,
          isFile ? deps.showStructure : () => deps.revealFolder(directory),
        ),
      );
    }

    for (const node of trail) {
      element.append(separator());
      element.append(
        crumb(node.name, `Go to line ${String(node.line)}`, () => deps.goToLine(node.line)),
      );
    }
  }

  return {
    element,

    setEnabled(next) {
      enabled = next;
      if (!next) {
        element.replaceChildren();
        element.dataset["empty"] = "true";
        signature = "";
      }
    },

    update(path, languageId, text, line) {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        render(path, languageId, text, line);
      }, RECOMPUTE_DELAY_MS);
    },

    dispose() {
      if (timer !== null) window.clearTimeout(timer);
    },
  };
}
