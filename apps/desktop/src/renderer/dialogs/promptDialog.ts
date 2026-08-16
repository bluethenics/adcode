/**
 * A centred text prompt, with optional suggestions.
 *
 * `window.prompt` throws outright in Electron - "prompt() is not supported." - which is
 * why the branch switcher had never worked: it called `prompt`, inside a `void`-ed async
 * function, so the rejection was swallowed and the button did nothing at all.
 *
 * Suggestions are a `datalist` rather than a `select`, because the branch case needs both
 * "pick one of these" and "type a name that does not exist yet" from one control.
 */

export interface PromptRequest {
  readonly title: string;
  readonly body?: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly confirmLabel?: string;
  /** Offered as completions; the typed value is still whatever the user leaves in. */
  readonly suggestions?: readonly string[];
}

export interface PromptDialog {
  /** Resolves with the trimmed value, or null if dismissed or left empty. */
  ask(request: PromptRequest): Promise<string | null>;
  isOpen(): boolean;
}

let listId = 0;

export function createPromptDialog(host: HTMLElement): PromptDialog {
  const dialog = document.createElement("dialog");
  dialog.className = "result-dialog prompt-dialog";

  const card = document.createElement("div");
  card.className = "result-card";

  const title = document.createElement("h2");
  title.className = "result-title";

  const body = document.createElement("p");
  body.className = "result-summary";

  const form = document.createElement("form");
  form.className = "prompt-form";
  form.method = "dialog";

  const input = document.createElement("input");
  input.className = "prompt-input";
  input.type = "text";
  input.spellcheck = false;
  input.setAttribute("autocomplete", "off");

  const list = document.createElement("datalist");
  list.id = `prompt-list-${++listId}`;
  input.setAttribute("list", list.id);

  const buttons = document.createElement("div");
  buttons.className = "confirm-buttons";

  const cancel = document.createElement("button");
  cancel.className = "confirm-cancel";
  cancel.type = "button";
  cancel.textContent = "Cancel";

  const confirm = document.createElement("button");
  confirm.className = "result-close";
  confirm.type = "submit";

  buttons.append(cancel, confirm);
  form.append(input, list, buttons);
  card.append(title, body, form);
  dialog.append(card);
  host.append(dialog);

  let settle: ((value: string | null) => void) | null = null;

  function finish(value: string | null): void {
    const pending = settle;
    settle = null;
    if (dialog.open) dialog.close();
    pending?.(value);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();
    finish(value.length === 0 ? null : value);
  });

  cancel.addEventListener("click", () => finish(null));

  // Escape closes natively; `close` is where every route out converges, so a dismissal
  // that never reached a button still resolves rather than leaking the promise.
  dialog.addEventListener("close", () => finish(null));
  dialog.addEventListener("click", (event) => {
    if (!card.contains(event.target as Node)) finish(null);
  });

  return {
    ask(request) {
      finish(null);

      title.textContent = request.title;
      body.textContent = request.body ?? "";
      body.hidden = request.body === undefined;

      input.value = request.value ?? "";
      input.placeholder = request.placeholder ?? "";
      confirm.textContent = request.confirmLabel ?? "OK";

      list.replaceChildren();
      for (const suggestion of request.suggestions ?? []) {
        const option = document.createElement("option");
        option.value = suggestion;
        list.append(option);
      }

      dialog.showModal();
      input.focus();
      input.select();

      return new Promise<string | null>((resolve) => {
        settle = resolve;
      });
    },

    isOpen: () => dialog.open,
  };
}
