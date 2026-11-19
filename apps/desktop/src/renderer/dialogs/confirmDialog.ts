import { bindBackdropDismissal } from "./backdropDismissal.ts";

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
  /** A third button between the two, answered as "alternate" by `choose`. */
  readonly alternateLabel?: string;
}

export type ConfirmChoice = "confirm" | "alternate" | "cancel";

export interface ConfirmDialog {
  ask(request: ConfirmRequest): Promise<boolean>;
  /** The same question, with the third button when the request names one. */
  choose(request: ConfirmRequest): Promise<ConfirmChoice>;
  /** Close an open question as a no - its asker withdrew it. */
  cancel(): void;
  isOpen(): boolean;
}

let shared: ConfirmDialog | null = null;

/**
 * The app-wide themed yes/no, for code that has no dialog of its own to hand.
 *
 * Replaces `window.confirm`, which draws an unthemed system box in Electron - when it draws
 * anything at all.
 */
export function askThemed(request: ConfirmRequest): Promise<boolean> {
  shared ??= createConfirmDialog(document.body);
  return shared.ask(request);
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

  const alternate = document.createElement("button");
  alternate.className = "confirm-cancel confirm-alternate";
  alternate.type = "button";
  alternate.hidden = true;

  buttons.append(cancel, alternate, confirm);
  card.append(title, body, buttons);
  dialog.append(card);
  host.append(dialog);

  let settle: ((answer: ConfirmChoice) => void) | null = null;

  function finish(answer: ConfirmChoice): void {
    const pending = settle;
    settle = null;
    if (dialog.open) dialog.close();
    pending?.(answer);
  }

  confirm.addEventListener("click", () => finish("confirm"));
  cancel.addEventListener("click", () => finish("cancel"));
  alternate.addEventListener("click", () => finish("alternate"));

  // Escape closes the dialog natively; `close` is where every route out converges, so a
  // dismissal that never reached a button still resolves the promise rather than leaking it.
  // A queued close from the previous request must not dismiss its replacement.
  dialog.addEventListener("close", () => { if (!dialog.open) finish("cancel"); });
  bindBackdropDismissal(dialog, card, () => { finish("cancel"); });

  function choose(request: ConfirmRequest): Promise<ConfirmChoice> {
      // An unanswered previous question resolves as a no rather than being abandoned.
      finish("cancel");

      title.textContent = request.title;
      body.textContent = request.body ?? "";
      body.hidden = request.body === undefined;

      confirm.textContent = request.confirmLabel ?? "OK";
      cancel.textContent = request.cancelLabel ?? "Cancel";
      dialog.dataset["danger"] = String(request.danger === true);
      alternate.textContent = request.alternateLabel ?? "";
      alternate.hidden = request.alternateLabel === undefined;

      dialog.showModal();
      cancel.focus();

      return new Promise<ConfirmChoice>((resolve) => {
        settle = resolve;
      });
  }

  return {
    ask(request) {
      // A yes/no: any third button a caller named is left out.
      const { alternateLabel: _alternate, ...plain } = request;
      return choose(plain).then((answer) => answer === "confirm");
    },

    choose,

    cancel(): void {
      finish("cancel");
    },

    isOpen: () => dialog.open,
  };
}
