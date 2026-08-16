/**
 * The in-place name editor used to create and rename tree entries.
 *
 * It knows nothing about the file tree beyond how a row is shaped - the caller decides
 * where to insert it and what committing means - so creating (a new row) and renaming (a
 * row standing in for an existing one) are the same component with different callers.
 *
 * Validation is *not* duplicated here. The rules live in the main process, because the
 * renderer is hostile by assumption and a rule enforced in both places is a rule that will
 * eventually disagree with itself. This shows whatever main sends back and stays open so
 * the name can be corrected rather than retyped.
 */

export interface InlineEditOptions {
  /** Pre-filled for a rename, empty for a create. */
  readonly value?: string;
  readonly placeholder?: string;
  /** Indent, matching the tree row this stands in for. */
  readonly depth: number;
  /**
   * Commit the name. Resolve with an error message to keep the editor open and show it,
   * or with null when it worked and the editor should go away.
   */
  readonly commit: (value: string) => Promise<string | null>;
  readonly cancel: () => void;
}

export function createInlineEditor(options: InlineEditOptions): HTMLElement {
  const row = document.createElement("div");
  row.className = "tree-edit-row";
  row.style.paddingLeft = `${8 + options.depth * 10}px`;

  const input = document.createElement("input");
  input.className = "tree-edit-input";
  input.type = "text";
  input.spellcheck = false;
  input.autocapitalize = "off";
  input.setAttribute("autocomplete", "off");
  input.value = options.value ?? "";
  if (options.placeholder !== undefined) input.placeholder = options.placeholder;

  const error = document.createElement("div");
  error.className = "tree-edit-error";
  error.hidden = true;

  row.append(input, error);

  let settled = false;
  let committing = false;

  function finish(): void {
    settled = true;
    row.remove();
  }

  function abandon(): void {
    if (settled) return;
    finish();
    options.cancel();
  }

  async function submit(): Promise<void> {
    if (settled || committing) return;

    const value = input.value.trim();
    // Nothing typed is a change of mind, not an error worth a message.
    if (value.length === 0) {
      abandon();
      return;
    }

    committing = true;
    input.disabled = true;

    const message = await options.commit(value).catch((thrown: unknown) =>
      thrown instanceof Error ? thrown.message : "Could not save that name.",
    );

    committing = false;

    if (message === null) {
      finish();
      return;
    }

    input.disabled = false;
    error.textContent = message;
    error.hidden = false;
    row.dataset["invalid"] = "true";
    input.focus();
    input.select();
  }

  input.addEventListener("keydown", (event) => {
    // The tree's own key handling must not see these while a name is being typed.
    event.stopPropagation();

    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      abandon();
    }
  });

  // Clearing the error as soon as the name changes; leaving a stale complaint under a name
  // the user has already fixed reads as the editor being broken.
  input.addEventListener("input", () => {
    error.hidden = true;
    delete row.dataset["invalid"];
  });

  input.addEventListener("blur", () => {
    // Not while a commit is in flight: disabling the input to run one fires blur, and
    // abandoning there would discard the very name being saved.
    if (committing) return;
    void submit();
  });

  // Focus has to wait for the row to be in the document, which the caller does after this
  // returns. Selecting the stem puts the cursor where a rename usually wants it: on the
  // name, with the extension left alone.
  queueMicrotask(() => {
    input.focus();
    const value = input.value;
    const body = value.startsWith(".") ? value.slice(1) : value;
    const dot = body.lastIndexOf(".");
    if (dot > 0) input.setSelectionRange(0, (value.startsWith(".") ? 1 : 0) + dot);
    else input.select();
  });

  return row;
}
