import type { AiWorkspaceTaskView } from "../../shared/api.ts";
import { bindBackdropDismissal } from "../dialogs/backdropDismissal.ts";
import { summarizeAiWorkspaceTask } from "./aiWorkspaceViewModel.ts";

/**
 * The folder's tasks as a centered popup instead of a sidebar.
 *
 * Lists this folder's tasks newest first with their state and file counts.
 * Picking one closes the list and opens that task's popup. Backdrop, Escape
 * and Close only dismiss the list — nothing is changed or lost.
 */
export interface TasksPopupDialog {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export function createTasksPopupDialog(
  host: HTMLElement,
  actions: {
    onOpenTask: (task: AiWorkspaceTaskView) => void | Promise<void>;
  },
): TasksPopupDialog {
  const dialog = document.createElement("dialog");
  dialog.className = "result-dialog tasks-popup-dialog";

  const card = document.createElement("div");
  card.className = "result-card";

  const title = document.createElement("h2");
  title.className = "result-title";
  title.textContent = "Tasks";

  const summary = document.createElement("p");
  summary.className = "result-summary";

  const list = document.createElement("div");
  list.className = "tasks-popup-list";
  list.setAttribute("role", "list");

  const buttons = document.createElement("div");
  buttons.className = "confirm-buttons";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "result-close";
  close.textContent = "Close";

  buttons.append(close);
  card.append(title, summary, list, buttons);
  dialog.append(card);
  host.append(dialog);

  const finish = (): void => {
    if (dialog.open) dialog.close();
  };

  close.addEventListener("click", finish);
  dialog.addEventListener("close", () => undefined);
  bindBackdropDismissal(dialog, card, finish);

  function paint(tasks: readonly AiWorkspaceTaskView[], folder: string | null): void {
    summary.textContent =
      tasks.length === 0
        ? folder === null
          ? "No folder is open."
          : `No tasks in ${folder} yet. Ask ADCode to build or change something and its progress will appear here.`
        : `${tasks.length} task${tasks.length === 1 ? "" : "s"} in ${folder ?? "this folder"} — chats without file work never appear here.`;
    list.replaceChildren();
    for (const task of tasks) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "tasks-popup-row";
      row.setAttribute("role", "listitem");
      const name = document.createElement("span");
      name.className = "tasks-popup-row-name";
      name.textContent = task.prompt;
      const meta = document.createElement("span");
      meta.className = "tasks-popup-row-meta";
      meta.textContent = `${summarizeAiWorkspaceTask(task)} · ${new Date(task.updatedAt).toLocaleString()}`;
      row.append(name, meta);
      row.title = `${task.prompt}\n${summarizeAiWorkspaceTask(task)}`;
      row.addEventListener("click", () => {
        finish();
        void Promise.resolve(actions.onOpenTask(task));
      });
      list.append(row);
    }
  }

  return {
    open() {
      if (dialog.open) dialog.close();
      summary.textContent = "Loading tasks…";
      list.replaceChildren();
      dialog.showModal();
      close.focus();
      void Promise.all([
        window.adcode.aiWorkspace.list().catch(() => [] as readonly AiWorkspaceTaskView[]),
        window.adcode.workspace.current().catch(() => null),
      ]).then(([tasks, current]) => {
        if (!dialog.open) return;
        const folder =
          current !== null && typeof current === "object" && "root" in current
            ? String((current as { root: unknown }).root).split(/[\\/]/).pop() ?? null
            : null;
        paint(tasks, folder);
      });
    },
    close: finish,
    isOpen: () => dialog.open,
  };
}
