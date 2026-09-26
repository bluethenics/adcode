import type {
  AiWorkspaceChangeView,
  AiWorkspaceTaskView,
  AiWorkspaceTraceView,
} from "../../shared/api.ts";
import { bindBackdropDismissal } from "../dialogs/backdropDismissal.ts";
import {
  aiWorkspaceActions,
  formatAiWorkspaceUsage,
  groupWorkspaceTraces,
  summarizeAiWorkspaceTask,
  TRACE_PREVIEW_LIMIT,
  traceTone,
} from "./aiWorkspaceViewModel.ts";

/**
 * One task as a popup inside the chat: what it asked for, which files changed,
 * and what the agent actually did — with Cancel for running work and Delete
 * for finished work that should stop cluttering the list.
 *
 * Backdrop, Escape and Close only dismiss the box. Delete asks once more
 * before anything disappears, and applied tasks keep their rollback
 * checkpoint: those offer Roll back instead of Delete.
 */
export interface TaskDetailsDialog {
  open(task: AiWorkspaceTaskView): void;
  close(): void;
  isOpen(): boolean;
}

export function createTaskDetailsDialog(
  host: HTMLElement,
  actions: {
    onCancel: (task: AiWorkspaceTaskView) => void | Promise<void>;
    onDelete: (task: AiWorkspaceTaskView) => void | Promise<void>;
    onRollback: (task: AiWorkspaceTaskView) => void | Promise<void>;
    onShowInChat: (task: AiWorkspaceTaskView) => void | Promise<void>;
  },
): TaskDetailsDialog {
  const dialog = document.createElement("dialog");
  dialog.className = "result-dialog task-details-dialog";

  const card = document.createElement("div");
  card.className = "result-card";

  const title = document.createElement("h2");
  title.className = "result-title";

  const state = document.createElement("p");
  state.className = "result-summary";

  const status = document.createElement("p");
  status.className = "settings-row-description";
  status.setAttribute("role", "status");

  const filesHeading = document.createElement("h3");
  filesHeading.className = "connect-subheading";
  filesHeading.textContent = "Files";

  const files = document.createElement("ul");
  files.className = "task-review-files";

  const activityHeading = document.createElement("h3");
  activityHeading.className = "connect-subheading";
  activityHeading.textContent = "Activity";

  const activity = document.createElement("div");
  activity.className = "task-details-activity";

  const buttons = document.createElement("div");
  buttons.className = "confirm-buttons task-review-buttons";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "confirm-cancel";
  cancel.textContent = "Cancel task";
  cancel.dataset["danger"] = "true";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "confirm-cancel";
  remove.textContent = "Delete task";
  remove.dataset["danger"] = "true";

  const rollback = document.createElement("button");
  rollback.type = "button";
  rollback.className = "confirm-cancel";
  rollback.textContent = "Roll back";

  const showInChat = document.createElement("button");
  showInChat.type = "button";
  showInChat.className = "confirm-cancel";
  showInChat.textContent = "Show in chat";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "result-close";
  close.textContent = "Close";

  buttons.append(cancel, remove, rollback, showInChat, close);
  card.append(title, state, status, filesHeading, files, activityHeading, activity, buttons);
  dialog.append(card);
  host.append(dialog);

  let current: AiWorkspaceTaskView | null = null;

  const finish = (): void => {
    if (dialog.open) dialog.close();
    current = null;
  };

  cancel.addEventListener("click", () => {
    const task = current;
    finish();
    if (task !== null) void Promise.resolve(actions.onCancel(task));
  });
  remove.addEventListener("click", () => {
    const task = current;
    if (task === null) return;
    if (!window.confirm(`Delete "${task.prompt}"? Its sandbox and history are removed for good.`)) return;
    finish();
    void Promise.resolve(actions.onDelete(task));
  });
  rollback.addEventListener("click", () => {
    const task = current;
    finish();
    if (task !== null) void Promise.resolve(actions.onRollback(task));
  });
  showInChat.addEventListener("click", () => {
    const task = current;
    finish();
    if (task !== null) void Promise.resolve(actions.onShowInChat(task));
  });
  close.addEventListener("click", finish);
  dialog.addEventListener("close", () => {
    current = null;
  });
  bindBackdropDismissal(dialog, card, finish);

  function renderActivity(events: readonly AiWorkspaceTraceView[]): void {
    activity.replaceChildren();
    const grouped = groupWorkspaceTraces(events);
    if (grouped.length === 0) {
      const empty = document.createElement("p");
      empty.className = "settings-row-description";
      empty.textContent = "No recorded commands or results for this task.";
      activity.append(empty);
      return;
    }
    const list = document.createElement("div");
    list.className = "task-details-activity-list";
    const paint = (visible: number): void => {
      list.replaceChildren();
      for (const row of grouped.slice(0, visible)) {
        const entry = document.createElement("details");
        entry.className = "context-trace";
        entry.dataset["state"] = traceTone(row.outcome);
        const label = document.createElement("summary");
        label.textContent = row.count > 1 ? `${row.summary}` : `${row.outcome} · ${row.summary}`;
        entry.append(label);
        if (row.detail.length > 0) {
          const detail = document.createElement("p");
          detail.className = "context-trace-detail";
          detail.textContent = row.detail;
          entry.append(detail);
        }
        list.append(entry);
      }
      if (visible < grouped.length) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "ghost-button";
        more.textContent = `Show all ${grouped.length} steps`;
        more.addEventListener("click", () => paint(grouped.length));
        list.append(more);
      }
    };
    paint(Math.min(TRACE_PREVIEW_LIMIT, grouped.length));
    activity.append(list);
  }

  return {
    open(task) {
      if (dialog.open) dialog.close();
      current = task;
      const legal = aiWorkspaceActions(task);
      title.textContent = task.prompt;
      state.textContent = `${summarizeAiWorkspaceTask(task)} · ${formatAiWorkspaceUsage(task)}`;
      status.textContent = "";
      const running =
        task.state === "preparing" ||
        task.state === "ready" ||
        task.state === "running" ||
        task.state === "applying" ||
        task.state === "rolling-back";
      cancel.hidden = !running;
      cancel.title = "Stop the running turn safely; the task is kept and can continue.";
      const checkpointed = task.checkpointPaths.length > 0;
      remove.hidden = running || checkpointed;
      remove.title = checkpointed
        ? "Applied tasks keep their rollback checkpoint — roll back first."
        : "Remove this task, its sandbox and its history for good.";
      rollback.hidden = !legal.rollback;
      files.replaceChildren();
      activity.replaceChildren();
      const loadingFiles = document.createElement("li");
      loadingFiles.className = "task-review-file";
      loadingFiles.textContent = "Loading files…";
      files.append(loadingFiles);
      const loadingActivity = document.createElement("p");
      loadingActivity.className = "settings-row-description";
      loadingActivity.textContent = "Loading activity…";
      activity.append(loadingActivity);
      dialog.showModal();
      close.focus();
      void Promise.all([
        window.adcode.aiWorkspace.changes(task.id).catch(() => []),
        window.adcode.aiWorkspace.traces(task.id).catch(() => []),
      ]).then(([changes, events]) => {
        if (current?.id !== task.id) return;
        files.replaceChildren();
        const list: readonly AiWorkspaceChangeView[] = changes;
        if (list.length === 0) {
          const empty = document.createElement("li");
          empty.className = "task-review-file";
          empty.textContent =
            task.changedPaths.length === 0
              ? "No file changes — this task asked or answered without editing."
              : "No file details recorded for this task.";
          files.append(empty);
        }
        for (const change of list) {
          const row = document.createElement("li");
          row.className = "task-review-file";
          const name = document.createElement("span");
          name.className = "task-review-file-name";
          name.textContent = change.path;
          const counts = document.createElement("span");
          counts.className = "task-review-file-counts";
          const added = change.hunks.reduce((n, hunk) => n + hunk.replacement.length, 0);
          const subtracted = change.hunks.reduce((n, hunk) => n + hunk.original.length, 0);
          counts.textContent = `+${added} −${subtracted} · ${change.hunks.length} hunk${change.hunks.length === 1 ? "" : "s"}`;
          row.append(name, counts);
          row.title = change.path;
          files.append(row);
        }
        renderActivity(events);
      });
    },
    close: finish,
    isOpen: () => dialog.open,
  };
}
