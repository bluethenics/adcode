/**
 * The shell and parts every form dialog on the Agents and Tools pages share.
 *
 * Native modal <dialog>: top layer, Escape closes, a click on the backdrop dismisses (never a
 * text-selection drag that ends outside), and every way out settles the caller exactly once.
 *
 * Settling happens when the dialog finishes, not on its `close` event: Chromium delivers
 * `close` on the next animation frame, which a hidden or occluded window may not draw for a
 * long time. Escape still settles, through `cancel`, which arrives synchronously.
 */
import { bindBackdropDismissal } from "./backdropDismissal.ts";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(label: string, className: string, run: () => void): HTMLButtonElement {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", run);
  return node;
}

export function field(labelText: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  const label = el("label", "form-field");
  label.append(el("span", "form-field-label", labelText), control);
  if (hint !== undefined) label.append(el("small", "form-field-hint", hint));
  return label;
}

let nextId = 0;

export interface FormModal {
  readonly dialog: HTMLDialogElement;
  readonly card: HTMLElement;
  readonly title: HTMLElement;
  /** Close it and settle. Safe to call more than once. */
  finish(): void;
}

export function openFormModal(className: string, titleText: string, settle: () => void): FormModal {
  const dialog = el("dialog", `result-dialog form-dialog ${className}`);
  const card = el("div", "result-card form-dialog-card");
  const title = el("h2", "result-title", titleText);
  title.id = `form-dialog-title-${++nextId}`;
  dialog.setAttribute("aria-labelledby", title.id);
  card.append(title);
  dialog.append(card);
  document.body.append(dialog);
  let settled = false;
  const done = (): void => {
    if (settled) return;
    settled = true;
    settle();
  };
  const finish = (): void => {
    done();
    if (dialog.open) dialog.close();
    dialog.remove();
  };
  dialog.addEventListener("cancel", () => done());
  dialog.addEventListener("close", () => { done(); dialog.remove(); });
  bindBackdropDismissal(dialog, card, finish);
  return { dialog, card, title, finish };
}
