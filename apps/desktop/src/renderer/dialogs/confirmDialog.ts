/**
 * A centred yes/no, for actions that destroy something.
 *
 * `window.confirm` is not used. It was measured against this Electron and returns without
 * ever showing anything the user can answer, which for a delete prompt means the delete
 * always proceeds - the failure mode of a confirmation nobody sees is that it confirms.
 *
 * Resolves false on Escape, on the backdrop, and on Cancel, so every way out that is not
 * the confirm button is a no. The confirm button is never the default focus for the same
 * reason: Enter on a dialog you have not read should not be the thing that deletes a file.
 */

export interface ConfirmRequest {
  readonly title: string;
  readonly body?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Renders the confirm button in the danger colour. */
  readonly danger?: boolean;
}

export interface ConfirmDialog {
  ask(request: ConfirmRequest): Promise<boolean>;
  isOpen(): boolean;
}

export function createConfirmDialog(host: HTMLElement): ConfirmDialog {
  const dialog = document.createElement("dialog");
  dialog.className = "result-dialog confirm-dialog";

  const card = document.createElement("div");
  card.className = "result-card";

  const title = document.createElement("h2");
  title.className = "result-title";

  const body = document.createElement("p");
  body.className = "result-summary";

  const buttons = document.createElement("div");
  buttons.className = "confirm-buttons";

  const cancel = document.createElement("button");
  cancel.className = "confirm-cancel";
  cancel.type = "button";

  const confirm = document.createElement("button");
  confirm.className = "result-close";
  confirm.type = "button";

  buttons.append(cancel, confirm);
  card.append(title, body, buttons);
  dialog.append(card);
  host.append(dialog);

  let settle: ((answer: boolean) => void) | null = null;

  function finish(answer: boolean): void {
    const pending = settle;
    settle = null;
    if (dialog.open) dialog.close();
    pending?.(answer);
  }

  confirm.addEventListener("click", () => finish(true));
  cancel.addEventListener("click", () => finish(false));

  // Escape closes the dialog natively; `close` is where every route out converges, so a
  // dismissal that never reached a button still resolves the promise rather than leaking it.
  dialog.addEventListener("close", () => finish(false));
  dialog.addEventListener("click", (event) => {
    if (!card.contains(event.target as Node)) finish(false);
  });

  return {
    ask(request) {
      // An unanswered previous question resolves as a no rather than being abandoned.
      finish(false);

      title.textContent = request.title;
      body.textContent = request.body ?? "";
      body.hidden = request.body === undefined;

      confirm.textContent = request.confirmLabel ?? "OK";
      cancel.textContent = request.cancelLabel ?? "Cancel";
      dialog.dataset["danger"] = String(request.danger === true);

      dialog.showModal();
      cancel.focus();

      return new Promise<boolean>((resolve) => {
        settle = resolve;
      });
    },

    isOpen: () => dialog.open,
  };
}
