/**
 * The definition, shown where you are reading.
 *
 * Following a function to its body is the most common thing anybody does in unfamiliar
 * code, and the usual answer - jump there - costs your place in the file you were reading.
 * Peek shows the definition inline, under the line you clicked, and leaves the cursor where
 * it was. Click the header, or Ctrl+click the symbol, to go there for real.
 *
 * Rendered with `monaco.editor.colorize` rather than a second editor instance. A nested
 * editor inside a view zone is a whole editor - its own model, its own tokenizer, its own
 * listeners - to show eleven read-only lines. `colorize` returns highlighted HTML for a
 * string and costs nothing to throw away.
 *
 * The header always says how the definition was found. A result a language server resolved
 * and a result that merely has the right name are different claims, and the second one
 * dressed as the first is the failure this whole path is designed to avoid.
 */
import type * as monaco from "monaco-editor";
import type { DefinitionAnswer, DefinitionTarget } from "./definitions.ts";

export interface Peek {
  show(answer: DefinitionAnswer, belowLine: number): Promise<void>;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export interface PeekDeps {
  readonly readFile: (path: string) => Promise<string | null>;
  readonly languageFor: (path: string) => string;
  /** Open the file properly, moving the cursor. */
  readonly openAt: (path: string, line: number, column: number) => void;
  /** Workspace-relative, for a header that is readable. */
  readonly displayPath: (path: string) => string;
}

/** Lines of context on each side of the definition. */
const CONTEXT = 5;

export function installPeek(
  editor: monaco.editor.IStandaloneCodeEditor,
  monacoApi: typeof monaco,
  deps: PeekDeps,
): Peek {
  let zoneId: string | null = null;
  let container: HTMLElement | null = null;

  function close(): void {
    if (zoneId === null) return;

    const id = zoneId;
    zoneId = null;
    container = null;
    editor.changeViewZones((accessor) => accessor.removeZone(id));
  }

  async function render(answer: DefinitionAnswer, target: DefinitionTarget): Promise<HTMLElement> {
    const root = document.createElement("div");
    root.className = "peek";

    const header = document.createElement("div");
    header.className = "peek-header";

    const title = document.createElement("button");
    title.type = "button";
    title.className = "peek-title";
    title.textContent = `${deps.displayPath(target.path)}:${String(target.line)}`;
    title.title = "Open this file here";
    title.addEventListener("click", () => {
      close();
      deps.openAt(target.path, target.line, target.column);
    });

    /*
     * The provenance badge.
     *
     * "Resolved" means a language server is certain. "Matched by name" means these are
     * declarations that share the name, which is usually the same thing and is not a
     * promise. Saying which is what makes the weaker answer safe to show at all.
     */
    const badge = document.createElement("span");
    badge.className = `peek-badge peek-badge-${answer.source}`;
    badge.textContent = answer.source === "resolved" ? "Resolved" : "Matched by name";
    badge.title =
      answer.source === "resolved"
        ? "A language server worked this out."
        : "Declarations with this name. ADCode did not resolve which one you meant.";

    const spacer = document.createElement("span");
    spacer.className = "peek-spacer";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "peek-close";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", () => close());

    header.append(title, badge, spacer, closeButton);
    root.append(header);

    // More than one candidate: chips to switch between them, which is the honest shape for
    // "three files define this name".
    if (answer.targets.length > 1) {
      const others = document.createElement("div");
      others.className = "peek-others";

      for (const [index, candidate] of answer.targets.slice(0, 8).entries()) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "peek-chip";
        chip.dataset["current"] = String(candidate === target);
        chip.textContent = `${deps.displayPath(candidate.path)}:${String(candidate.line)}`;
        chip.addEventListener("click", () => void swap(answer, index));
        others.append(chip);
      }

      root.append(others);
    }

    const body = document.createElement("div");
    body.className = "peek-body";

    const text = await deps.readFile(target.path);
    if (text === null) {
      body.textContent = "That file could not be read.";
      root.append(body);
      return root;
    }

    const lines = text.split(/\r?\n/);
    const from = Math.max(0, target.line - 1 - CONTEXT);
    const to = Math.min(lines.length, target.line + CONTEXT);
    const slice = lines.slice(from, to);

    const gutter = document.createElement("div");
    gutter.className = "peek-gutter";
    for (let offset = 0; offset < slice.length; offset += 1) {
      const number = document.createElement("div");
      number.className = "peek-line-number";
      number.dataset["target"] = String(from + offset + 1 === target.line);
      number.textContent = String(from + offset + 1);
      gutter.append(number);
    }

    const code = document.createElement("div");
    code.className = "peek-code";
    // `colorize` is async because a language's tokenizer may still be loading.
    code.innerHTML = await monacoApi.editor.colorize(
      slice.join("\n"),
      deps.languageFor(target.path),
      { tabSize: 2 },
    );

    // The definition's own line, marked, so the eye lands on it rather than on the context.
    const highlight = document.createElement("div");
    highlight.className = "peek-highlight";
    highlight.style.top = `${String((target.line - from - 1) * 18)}px`;

    body.append(gutter, code, highlight);
    root.append(body);
    return root;
  }

  async function swap(answer: DefinitionAnswer, index: number): Promise<void> {
    const target = answer.targets[index];
    if (target === undefined || container === null) return;

    const replacement = await render(answer, target);
    container.replaceChildren(...replacement.childNodes);
  }

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && zoneId !== null) {
      event.preventDefault();
      event.stopPropagation();
      close();
      editor.focus();
    }
  };

  document.addEventListener("keydown", onKeydown, true);
  // Scrolling far away from a peek leaves it stranded; a model change invalidates it
  // outright, since the line it was anchored under may no longer exist.
  const modelSubscription = editor.onDidChangeModel(() => close());

  return {
    async show(answer, belowLine) {
      close();

      const first = answer.targets[0];
      if (first === undefined) return;

      const node = await render(answer, first);
      container = node;

      editor.changeViewZones((accessor) => {
        zoneId = accessor.addZone({
          afterLineNumber: belowLine,
          // Header, optional chips, and the code window. In lines, which is the unit view
          // zones are measured in.
          heightInLines: answer.targets.length > 1 ? CONTEXT * 2 + 4 : CONTEXT * 2 + 3,
          domNode: node,
        });
      });
    },

    close,
    isOpen: () => zoneId !== null,

    dispose() {
      close();
      document.removeEventListener("keydown", onKeydown, true);
      modelSubscription.dispose();
    },
  };
}
