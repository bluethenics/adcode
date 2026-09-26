import type { AiWorkspaceChangeView, AiWorkspaceTaskView } from "../../shared/api.ts";
import { bindBackdropDismissal } from "../dialogs/backdropDismissal.ts";

/**
 * The accept-to-main-workspace box.
 *
 * A proposal lands in the isolated sandbox, invisible in the Explorer, so the
 * moment a task is ready the editor says so out loud: one modal per task with
 * the file list (+added / -removed), and buttons to accept it into the real
 * project, look closer in chat, or throw it away. Backdrop, Escape and Close
 * only dismiss the box — nothing is applied or lost.
 */
export interface TaskReviewDialog {
  open(
    task: AiWorkspaceTaskView,
    changes: readonly AiWorkspaceChangeView[],
    actions: {
      onApplyAll: () => void | Promise<void>;
      onDiscard: () => void | Promise<void>;
      onShowInChat: () => void | Promise<void>;
    },
  ): void;
  close(): void;
  isOpen(): boolean;
}

export function createTaskReviewDialog(host: HTMLElement): TaskReviewDialog {
  const dialog = document.createElement("dialog");
  dialog.className = "result-dialog task-review-dialog";

  const card = document.createElement("div");
  card.className = "result-card";

  const title = document.createElement("h2");
  title.className = "result-title";
  title.textContent = "Preview AI edits";

  const summary = document.createElement("p");
  summary.className = "result-summary";

  const files = document.createElement("ul");
  files.className = "task-review-files";

  const hint = document.createElement("p");
  hint.className = "settings-row-description";
  hint.textContent = "Nothing in your project changed yet. Applying copies the accepted edits into your real files.";

  const buttons = document.createElement("div");
  buttons.className = "confirm-buttons task-review-buttons";

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "result-close";
  apply.textContent = "Apply all to workspace";

  const showInChat = document.createElement("button");
  showInChat.type = "button";
  showInChat.className = "confirm-cancel";
  showInChat.textContent = "Show in chat";

  const discard = document.createElement("button");
  discard.type = "button";
  discard.className = "confirm-cancel";
  discard.textContent = "Discard";
  discard.dataset["danger"] = "true";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "confirm-cancel";
  close.textContent = "Close";

  buttons.append(apply, showInChat, discard, close);
  card.append(title, summary, files, hint, buttons);
  dialog.append(card);
  host.append(dialog);

  let currentActions: {
    onApplyAll: () => void | Promise<void>;
    onDiscard: () => void | Promise<void>;
    onShowInChat: () => void | Promise<void>;
  } | null = null;

  const finish = (): void => {
    if (dialog.open) dialog.close();
    currentActions = null;
  };

  apply.addEventListener("click", () => {
    apply.disabled = true;
    void Promise.resolve(currentActions?.onApplyAll()).finally(() => {
      apply.disabled = false;
    });
  });
  showInChat.addEventListener("click", () => {
    const actions = currentActions;
    finish();
    void Promise.resolve(actions?.onShowInChat());
  });
  discard.addEventListener("click", () => {
    discard.disabled = true;
    void Promise.resolve(currentActions?.onDiscard()).finally(() => {
      discard.disabled = false;
      finish();
    });
  });
  close.addEventListener("click", finish);
  dialog.addEventListener("close", () => {
    currentActions = null;
  });
  bindBackdropDismissal(dialog, card, finish);

  return {
    open(task, changes, actions) {
      if (dialog.open) dialog.close();
      currentActions = actions;
      const totalAdded = changes.reduce(
        (n, change) => n + change.hunks.reduce((m, hunk) => m + hunk.replacement.length, 0),
        0,
      );
      const totalRemoved = changes.reduce(
        (n, change) => n + change.hunks.reduce((m, hunk) => m + hunk.original.length, 0),
        0,
      );
      summary.textContent = `${task.prompt} — ${changes.length} file${changes.length === 1 ? "" : "s"} · +${totalAdded} −${totalRemoved}`;
      summary.title = task.changedPaths.join("\n");
      files.replaceChildren();
      for (const change of changes) {
        const row = document.createElement("li");
        row.className = "task-review-file";
        const name = document.createElement("span");
        name.className = "task-review-file-name";
        name.textContent = change.path;
        const counts = document.createElement("span");
        counts.className = "task-review-file-counts";
        const added = change.hunks.reduce((n, hunk) => n + hunk.replacement.length, 0);
        const removed = change.hunks.reduce((n, hunk) => n + hunk.original.length, 0);
        counts.textContent = `+${added} −${removed} · ${change.hunks.length} hunk${change.hunks.length === 1 ? "" : "s"}`;
        row.append(name, counts);
        row.title = change.path;
        files.append(row);
      }
      if (changes.length === 0) {
        const empty = document.createElement("li");
        empty.className = "task-review-file";
        empty.textContent = "No file changes recorded yet.";
        files.append(empty);
      }
      apply.hidden = changes.length === 0;
      dialog.showModal();
      close.focus();
    },
    close: finish,
    isOpen: () => dialog.open,
  };
}
