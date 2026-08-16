/**
 * The centred result dialog.
 *
 * Git's heavyweight actions - push, pull, fetch, commit - used to answer in the status
 * bar: an 11px span in the far corner that erased itself after four seconds. The action
 * had reported, and nobody had read it, which is the same thing as not reporting.
 *
 * Failures were worse than quiet. The old call site had a `.then` and no `.catch`, so a
 * rejected push skipped the reporting branch entirely and left an unhandled rejection
 * where the error message should have been.
 *
 * So: results land in the middle of the window, success and failure alike, and carry the
 * detail git actually returned rather than a generic word. A native `<dialog>` is used
 * because `showModal()` brings the focus trap, the Escape handling, the inert backdrop
 * and the top-layer stacking with it - all of which are easy to reimplement badly.
 */

export interface GitResult {
  /** What was attempted, in the user's words: "Push", "Pull", "Commit". */
  readonly action: string;
  readonly ok: boolean;
  /** Git's own message. Shown verbatim - it is the useful part. */
  readonly message: string;
  /** Context git does not know about: the branch, the remote, the commit count. */
  readonly details?: ReadonlyArray<readonly [label: string, value: string]>;
}

export interface ResultDialog {
  show(result: GitResult): void;
  close(): void;
  isOpen(): boolean;
}

export function createResultDialog(host: HTMLElement): ResultDialog {
  const dialog = document.createElement("dialog");
  dialog.className = "result-dialog";

  const card = document.createElement("div");
  card.className = "result-card";

  const badge = document.createElement("div");
  badge.className = "result-badge";

  const title = document.createElement("h2");
  title.className = "result-title";

  const summary = document.createElement("p");
  summary.className = "result-summary";

  const detailList = document.createElement("dl");
  detailList.className = "result-details";

  const output = document.createElement("pre");
  output.className = "result-output";

  const close = document.createElement("button");
  close.className = "result-close";
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => dialog.close());

  card.append(badge, title, summary, detailList, output, close);
  dialog.append(card);
  host.append(dialog);

  // Clicking the backdrop closes. The dialog element's own box covers the whole viewport,
  // so the card is what has to be tested against rather than the dialog.
  dialog.addEventListener("click", (event) => {
    if (!card.contains(event.target as Node)) dialog.close();
  });

  return {
    show(result) {
      dialog.dataset["ok"] = String(result.ok);
      badge.textContent = result.ok ? "✓" : "!";
      badge.setAttribute("aria-hidden", "true");

      title.textContent = result.ok ? `${result.action} succeeded` : `${result.action} failed`;

      // Git says nothing at all on a clean no-op push; a blank card would read as a bug.
      summary.textContent = result.ok
        ? "The command completed."
        : "The command did not complete. Nothing in the repository was changed by the failure.";

      detailList.replaceChildren();
      for (const [label, value] of result.details ?? []) {
        const term = document.createElement("dt");
        term.textContent = label;
        const description = document.createElement("dd");
        description.textContent = value;
        detailList.append(term, description);
      }
      detailList.hidden = detailList.childElementCount === 0;

      const text = result.message.trim();
      output.textContent = text;
      output.hidden = text.length === 0;

      if (!dialog.open) dialog.showModal();
      close.focus();
    },

    close: () => dialog.close(),
    isOpen: () => dialog.open,
  };
}
