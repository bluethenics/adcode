/** Dismiss only gestures that start and end outside the card, never text-selection drags. */
export function bindBackdropDismissal(
  dialog: HTMLDialogElement,
  card: HTMLElement,
  dismiss: () => void,
): void {
  let pressedOutside = false;
  dialog.addEventListener("pointerdown", (event) => {
    pressedOutside = event.button === 0 && !event.composedPath().includes(card);
  }, true);
  dialog.addEventListener("pointercancel", () => { pressedOutside = false; });
  dialog.addEventListener("close", () => { pressedOutside = false; });
  dialog.addEventListener("click", (event) => {
    const shouldDismiss = pressedOutside && !event.composedPath().includes(card);
    pressedOutside = false;
    if (shouldDismiss) dismiss();
  });
}
