/**
 * The composer's two typed menus: `/` for commands and `@` for files.
 *
 * Typing is faster than finding a button, and both menus appear exactly where the cursor
 * is. `/review` attaches your uncommitted diff and asks for a review; `@src/app.ts` puts
 * that file in the conversation as a chip, unsaved edits included. The trigger parsing and
 * matching below are pure and tested without a window; the popup at the bottom is the DOM.
 */

export type SlashKind = "prompt" | "action" | "diff";

export interface SlashCommand {
  readonly id: string;
  readonly hint: string;
  readonly kind: SlashKind;
  /** Text that replaces `/id` in the composer, ready for the user's own words. */
  readonly prompt?: string;
}

/**
 * Prompts are written the way a senior engineer would ask: name the outcome, the
 * verification, and what not to do. The trailing space leaves the cursor ready to type.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: "fix", hint: "Find the root cause and fix it", kind: "prompt", prompt: "Find the root cause of this problem and fix it, then run the tests or typecheck to confirm the fix: " },
  { id: "explain", hint: "Explain code in plain words", kind: "prompt", prompt: "Explain how this works, step by step and in plain words, pointing at the files and lines involved: " },
  { id: "test", hint: "Write tests and run them", kind: "prompt", prompt: "Write focused tests for this with the project's existing test setup, run them, and fix any failures: " },
  { id: "review", hint: "Review my uncommitted changes", kind: "diff", prompt: "Review the attached uncommitted changes for bugs, edge cases, security problems and missing tests. List concrete findings with file and line, most severe first, and say plainly if you find nothing. Do not change files yet." },
  { id: "commit", hint: "Write a commit message for my changes", kind: "diff", prompt: "Write a concise commit message for the attached changes: a short imperative subject line, a blank line, then the why in two or three lines. Do not change files." },
  { id: "plan", hint: "Plan first, change nothing yet", kind: "prompt", prompt: "Read the relevant code first, then write a short numbered plan for this, with the files each step touches and the risks. Do not propose edits until I say go: " },
  { id: "refactor", hint: "Clean up, same behaviour", kind: "prompt", prompt: "Refactor this for readability and simplicity without changing its behaviour, then run the tests to prove it: " },
  { id: "optimize", hint: "Find and fix what is slow", kind: "prompt", prompt: "Find the real performance bottlenecks here and fix the worst ones, explaining the expected gain of each: " },
  { id: "security", hint: "Audit for vulnerabilities", kind: "prompt", prompt: "Audit this for security vulnerabilities (injection, auth, secrets, unsafe input, path traversal). Report concrete findings with severity, file and line, then propose fixes: " },
  { id: "docs", hint: "Write or update documentation", kind: "prompt", prompt: "Write clear documentation for this in the project's existing style - a README section or doc comments - with a usage example: " },
  { id: "build", hint: "Build a feature end to end", kind: "prompt", prompt: "Build this end to end: read the code it touches, make the change, add or update tests, and run them: " },
  { id: "new", hint: "Start a new conversation", kind: "action" },
  { id: "history", hint: "Open past conversations", kind: "action" },
  { id: "model", hint: "Switch provider or model", kind: "action" },
  { id: "preview", hint: "Show the live preview here", kind: "action" },
  { id: "team", hint: "Split the task across AI roles", kind: "action" },
  { id: "schedule", hint: "Send a message later", kind: "action" },
];

export interface MenuTrigger {
  readonly kind: "slash" | "mention";
  /** Index of the `/` or `@` in the text. */
  readonly start: number;
  readonly query: string;
}

/**
 * The menu the caret is in, if any.
 *
 * `/` only counts as the very first character, so a path like `src/app` never opens it.
 * `@` counts at the start or after whitespace, so `me@example.com` never opens it.
 */
export function menuTriggerAt(text: string, caret: number): MenuTrigger | null {
  const before = text.slice(0, caret);
  const slash = /^\/([\w-]*)$/.exec(before);
  if (slash !== null) return { kind: "slash", start: 0, query: slash[1] ?? "" };
  const mention = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (mention !== null) {
    const query = mention[1] ?? "";
    return { kind: "mention", start: caret - query.length - 1, query };
  }
  return null;
}

/** Commands whose name starts with the query first, then ones that merely contain it. */
export function matchSlashCommands(query: string, commands: readonly SlashCommand[] = SLASH_COMMANDS): SlashCommand[] {
  const needle = query.toLowerCase();
  if (needle.length === 0) return [...commands];
  const starts = commands.filter((command) => command.id.startsWith(needle));
  const contains = commands.filter(
    (command) => !command.id.startsWith(needle) && (command.id.includes(needle) || command.hint.toLowerCase().includes(needle)),
  );
  return [...starts, ...contains];
}

/** Replace the trigger and its query with `insert`, returning the new text and caret. */
export function replaceTrigger(text: string, caret: number, trigger: MenuTrigger, insert: string): { text: string; caret: number } {
  const next = `${text.slice(0, trigger.start)}${insert}${text.slice(caret)}`;
  return { text: next, caret: trigger.start + insert.length };
}

/** A chip label for a slice of a file: `app.ts:12-40`, or just `app.ts` for the whole file. */
export function contextChipName(path: string, startLine?: number, endLine?: number): string {
  const name = path.split(/[\\/]/).pop() || path;
  if (startLine === undefined || endLine === undefined) return name;
  return startLine === endLine ? `${name}:${startLine}` : `${name}:${startLine}-${endLine}`;
}

/** Prompt-history recall: newest last, no consecutive duplicates, bounded. */
export function rememberPrompt(history: readonly string[], prompt: string, limit = 50): string[] {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return [...history];
  const next = history[history.length - 1] === trimmed ? [...history] : [...history, trimmed];
  return next.slice(-limit);
}

/* ── The popup ─────────────────────────────────────────────────────────── */

export interface ComposerMenuItem {
  readonly label: string;
  readonly detail: string;
  readonly run: () => void;
}

export interface ComposerMenu {
  readonly element: HTMLElement;
  show(title: string, items: readonly ComposerMenuItem[]): void;
  hide(): void;
  isOpen(): boolean;
  /** Arrow keys, Enter, Tab and Escape while open. Returns whether the key was used. */
  handleKey(event: KeyboardEvent): boolean;
}

export function createComposerMenu(): ComposerMenu {
  const element = document.createElement("div");
  element.className = "composer-menu";
  element.hidden = true;
  element.setAttribute("role", "listbox");
  element.id = `composer-menu-${Math.random().toString(36).slice(2, 8)}`;
  const heading = document.createElement("div");
  heading.className = "composer-menu-heading";
  const list = document.createElement("div");
  list.className = "composer-menu-list";
  element.append(heading, list);
  let items: readonly ComposerMenuItem[] = [];
  let active = 0;

  function paint(): void {
    list.replaceChildren();
    items.forEach((item, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "composer-menu-item";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(index === active));
      row.id = `${element.id}-${index}`;
      const label = document.createElement("span");
      label.className = "composer-menu-label";
      label.textContent = item.label;
      const detail = document.createElement("span");
      detail.className = "composer-menu-detail";
      detail.textContent = item.detail;
      row.append(label, detail);
      // Pointer-down, not click: the textarea must not lose its caret before the choice runs.
      row.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        item.run();
      });
      row.addEventListener("pointerenter", () => {
        active = index;
        for (const [other, node] of [...list.children].entries()) node.setAttribute("aria-selected", String(other === active));
      });
      list.append(row);
    });
    list.children[active]?.scrollIntoView({ block: "nearest" });
  }

  return {
    element,
    show(title, next) {
      items = next;
      active = 0;
      heading.textContent = title;
      element.hidden = items.length === 0;
      paint();
    },
    hide() {
      element.hidden = true;
      items = [];
    },
    isOpen: () => !element.hidden && items.length > 0,
    handleKey(event) {
      if (element.hidden || items.length === 0) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        active = (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        paint();
        return true;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        items[active]?.run();
        return true;
      }
      if (event.key === "Escape") {
        element.hidden = true;
        items = [];
        return true;
      }
      return false;
    },
  };
}
