/**
 * "Python isn't installed."
 *
 * The moment this dialog exists for is small and very common: somebody writes their first
 * ten lines of Python, presses the button that says Run Python, and gets
 * `'python' is not recognized as an internal or external command`. That sentence is written
 * for an operating system, not a person, and the reasonable conclusion a beginner draws
 * from it is that the editor is broken.
 *
 * So this says what is missing, what installs it *on this machine*, and offers to open the
 * page - and then still lets them run the command, because the check can be wrong. A
 * program installed into a shell profile that ADCode's PATH does not include is real, and
 * an editor that refused to run it on the strength of its own guess would be worse than one
 * that never checked.
 *
 * Four ways out, and Escape is one of them. Modelled on `confirmDialog`, including why
 * `window.confirm` is not used: it was measured against this Electron and returns without
 * showing anything a user can answer.
 */
import type { RuntimeCheckView } from "../../shared/api.ts";

/** What the user chose. `run` means "I know, go anyway". */
export type MissingRuntimeChoice = "install" | "copy" | "run" | "cancel";

export interface MissingRuntimeDialog {
  ask(runtime: RuntimeCheckView, command: string): Promise<MissingRuntimeChoice>;
  isOpen(): boolean;
}

export function createMissingRuntimeDialog(host: HTMLElement): MissingRuntimeDialog {
  const dialog = document.createElement("dialog");
  dialog.className = "result-dialog runtime-dialog";

  const card = document.createElement("div");
  card.className = "result-card";

  const title = document.createElement("h2");
  title.className = "result-title";

  const body = document.createElement("p");
  body.className = "result-summary";

  /** The command that was about to run, so the user can see what was refused. */
  const attempted = document.createElement("pre");
  attempted.className = "runtime-command";

  const installLabel = document.createElement("p");
  installLabel.className = "runtime-install-label";
  installLabel.textContent = "One line that installs it:";

  const install = document.createElement("pre");
  install.className = "runtime-command runtime-install";

  const buttons = document.createElement("div");
  buttons.className = "confirm-buttons runtime-buttons";

  const cancel = document.createElement("button");
  cancel.className = "confirm-cancel";
  cancel.type = "button";
  cancel.textContent = "Cancel";

  const anyway = document.createElement("button");
  anyway.className = "confirm-cancel";
  anyway.type = "button";
  anyway.textContent = "Run anyway";

  const copy = document.createElement("button");
  copy.className = "confirm-cancel";
  copy.type = "button";
  copy.textContent = "Copy command";

  const getIt = document.createElement("button");
  getIt.className = "result-close";
  getIt.type = "button";

  buttons.append(cancel, anyway, copy, getIt);
  card.append(title, body, attempted, installLabel, install, buttons);
  dialog.append(card);
  host.append(dialog);

  let settle: ((choice: MissingRuntimeChoice) => void) | null = null;

  function finish(choice: MissingRuntimeChoice): void {
    const pending = settle;
    settle = null;

    if (dialog.open) dialog.close();
    pending?.(choice);
  }

  cancel.addEventListener("click", () => finish("cancel"));
  anyway.addEventListener("click", () => finish("run"));
  copy.addEventListener("click", () => finish("copy"));
  getIt.addEventListener("click", () => finish("install"));

  // Escape and the backdrop both mean no, matching every other dialog in this window.
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish("cancel");
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) finish("cancel");
  });

  return {
    isOpen: () => dialog.open,

    ask(runtime, command) {
      title.textContent = `${runtime.label} is not installed`;

      body.textContent =
        `ADCode looked for ${runtime.command} and could not find it, so this file has ` +
        `nothing to run it. Installing ${runtime.label} takes a couple of minutes and only ` +
        `has to happen once.`;

      attempted.textContent = command;

      const hasHint = runtime.install !== null;
      installLabel.hidden = !hasHint;
      install.hidden = !hasHint;
      install.textContent = runtime.install ?? "";
      copy.hidden = !hasHint;

      getIt.textContent = `Get ${runtime.label}`;

      dialog.showModal();
      // Not the primary button. Enter on a dialog nobody has read should not open a browser.
      cancel.focus();

      return new Promise<MissingRuntimeChoice>((resolve) => {
        settle = resolve;
      });
    },
  };
}
