import type { AiWorkspaceTaskView } from "../../shared/api.ts";
import { groupWorkspaceTraces, TRACE_PREVIEW_LIMIT } from "../ai/aiWorkspaceViewModel.ts";
import { createHelpPopover } from "../help/helpPopover.ts";
import { fileIcon } from "./fileIcons.ts";

export type ContextTab = "project" | "changes" | "tasks";
interface ContextDeps {
  readonly root: () => string | null;
  readonly activeFile: () => string | null;
  readonly openFile: (path: string) => void;
  readonly reviewGit: (path?: string) => void;
  readonly reviewTask: (task: AiWorkspaceTaskView) => void;
  readonly ask: (prompt: string) => void;
  readonly run: (command: string) => void;
}

/** A read-through view over existing workspace services, with no second task store. */
export function createProjectContext(deps: ContextDeps) {
  const element = document.createElement("section");
  element.className = "project-context";
  element.setAttribute("aria-label", "Workspace context");
  const header = document.createElement("div");
  header.className = "context-tabs";
  header.setAttribute("role", "tablist");
  header.setAttribute("aria-label", "Workspace context");
  const content = document.createElement("div");
  content.className = "context-content";
  content.id = "workspace-context-content";
  content.setAttribute("role", "tabpanel");
  const help = createHelpPopover(document.body);
  let selected: ContextTab = "project";
  let generation = 0;
  let lastSignature = "";
  let visible = false;
  let refreshTimer: number | undefined;
  const tabs = new Map<ContextTab, HTMLButtonElement>();
  for (const id of ["project", "changes", "tasks"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = id[0]!.toUpperCase() + id.slice(1);
    button.id = `context-tab-${id}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", content.id);
    button.addEventListener("click", () => show(id));
    button.addEventListener("keydown", event => {
      const ids = [...tabs.keys()];
      const index = ids.indexOf(id);
      const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : -1;
      if (next < 0) return;
      event.preventDefault();
      show(ids[next]!);
      tabs.get(ids[next]!)?.focus();
    });
    tabs.set(id, button);
    header.append(button);
  }
  element.append(header, content);

  function paragraph(text: string, parent: HTMLElement, className = "context-caption"): HTMLElement {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = text;
    parent.append(p);
    return p;
  }
  function action(label: string, run: () => void, parent: HTMLElement, detail?: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "context-action";
    const name = document.createElement("span");
    name.textContent = label;
    button.append(name);
    if (detail) {
      const small = document.createElement("small");
      small.textContent = detail;
      button.append(small);
    }
    button.addEventListener("click", () => run());
    parent.append(button);
    return button;
  }
  function section(title: string, parent: HTMLElement): HTMLElement {
    const section = document.createElement("section");
    section.className = "context-section";
    const h = document.createElement("h3");
    h.textContent = title;
    section.append(h);
    parent.append(section);
    return section;
  }
  function explain(parent: HTMLElement, title: string, plain: string, why: string): void {
    const button = action("?", () => help.show(button, {
      id: `context.${selected}`, title, plain, why, how: "", group: "workbench", settingIds: [], related: [],
    }), parent);
    button.className = "context-help";
    button.setAttribute("aria-label", `About ${title.toLowerCase()}`);
  }
  async function refresh(): Promise<void> {
    if (!visible) return;
    const request = ++generation;
    const root = deps.root();
    const view = selected;
    let signature = `${root}:${view}`;
    const fragment = document.createElement("div");
    const current = (): boolean => request === generation && root === deps.root() && view === selected;
    try {
      if (!root) {
        paragraph("A workspace for your next idea", fragment, "context-title");
        paragraph("Open a project folder. Your files, conversations, changes and tasks will stay together here.", fragment);
        action("Open a project", () => deps.run("workspace.open"), fragment);
      } else if (view === "project") {
        const [entries, ai, git, tasks] = await Promise.all([window.adcode.workspace.list(root), window.adcode.ai.status(), window.adcode.git.status(), window.adcode.aiWorkspace.list()]);
        signature += JSON.stringify([entries, ai.ready, ai.activeModel, git, tasks, deps.activeFile()]);
        if (current() && signature === lastSignature) return;
        const overview = document.createElement("div");
        overview.className = "context-project-overview";
        paragraph(root.split(/[\\/]/).pop() || root, overview, "context-title");
        const location = paragraph(root, overview, "context-path");
        location.title = root;
        if (git.isRepo) action(git.branch ?? "Detached HEAD", () => deps.reviewGit(), overview, git.hasConflicts ? "Conflicts need attention" : "Connected Git repository");
        fragment.append(overview);
        const metrics = document.createElement("div");
        metrics.className = "context-metrics";
        for (const [count, label] of [[entries.filter(e => !e.isDirectory).length, "files"], [entries.filter(e => e.isDirectory).length, "folders"], [tasks.length, "tasks"]] as const) {
          const metric = document.createElement("div");
          metric.className = "context-metric";
          const value = document.createElement("strong");
          value.textContent = String(count);
          const name = document.createElement("span");
          name.textContent = label;
          metric.append(value, name);
          metrics.append(metric);
        }
        fragment.append(metrics);
        paragraph("File and folder counts at project root", fragment);
        const latest = [...tasks].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (latest) {
          const task = section("Latest task", fragment);
          action(latest.prompt, () => deps.reviewTask(latest), task);
          const status = paragraph(`${latest.state.replaceAll("-", " ")} · ${latest.changedPaths.length} files`, task, "context-task-status");
          status.dataset["ready"] = String(["applied", "completed"].includes(latest.state));
          action("View all tasks", () => show("tasks"), task);
        }
        if (git.entries.length || latest?.changedPaths.length) {
          const changes = section("Recent changes", fragment);
          if (latest && latest.changedPaths.length && !["applied", "discarded", "rolled-back"].includes(latest.state)) {
            for (const path of latest.changedPaths.slice(0, 3)) action(path, () => deps.reviewTask(latest), changes, "AI proposal · Review changes");
          } else for (const entry of git.entries.slice(0, 3)) action(entry.path, () => deps.reviewGit(entry.path), changes, "Working-tree change");
          action("View all changes", () => show("changes"), changes);
        }
        const active = deps.activeFile();
        if (active && !active.startsWith("adcode-")) {
          const file = section("Working file", fragment);
          action(active.split(/[\\/]/).pop() || active, () => deps.openFile(active), file, "Open in Code");
          action("Ask about this file", () => deps.ask(`Explain this file and suggest useful improvements: ${active.slice(root.length).replace(/^[\\/]/, "")}`), file);
        }
        const assistant = section("Project assistant", fragment);
        const readiness = paragraph(ai.ready ? `${ai.activeModel} · Ready` : "Connect a model to start working with AI.", assistant, "context-task-status");
        readiness.dataset["ready"] = String(ai.ready);
        explain(assistant, "AI context", "Vibe and Code use the same conversation and project folder.", "The assistant can inspect project files and propose edits. Available tools and approval settings determine which commands it can run.");
        action(ai.ready ? "Models & connections" : "Connect an AI provider", () => deps.run("ai.connect"), assistant);
        const work = section("Build & check", fragment);
        action("Open preview", () => deps.run("workspace.preview"), work, "See the running application");
        action("Terminal", () => deps.run("terminal.toggle"), work, "Run project commands");
        action("Problems", () => deps.run("view.problems"), work, "Go to diagnostics and fixes");
        const earn = section("Build. Earn. Keep creating.", fragment);
        paragraph("Track earnings from verified sponsored views in your real ledger.", earn);
        action("Open earnings", () => document.getElementById("open-earnings")?.click(), earn, "Balance, activity and payout details");
      } else if (view === "changes") {
        const [git, tasks] = await Promise.all([window.adcode.git.status(), window.adcode.aiWorkspace.list()]);
        signature += JSON.stringify([git, tasks]);
        if (current() && signature === lastSignature) return;
        const pending = tasks.filter(task => task.changedPaths.length > 0 && ["review", "paused", "ready", "conflict", "failed"].includes(task.state));
        const aiSection = section("AI proposals", fragment);
        explain(aiSection, "Review changes", "AI proposals and working-tree changes are different stages of your work.", "Review proposed hunks before applying them, then use Source Control to stage and commit your project changes.");
        if (!pending.length) paragraph("No pending proposals. New AI changes will appear here for review.", aiSection);
        for (const task of pending) action(task.prompt, () => deps.reviewTask(task), aiSection, `${task.changedPaths.length} files · ${task.state.replaceAll("-", " ")}`);
        const working = section(git.isRepo ? `${git.entries.length} working-tree changes` : "Source control", fragment);
        if (!git.isRepo) {
          paragraph("Use Source Control to create or connect a Git repository.", working);
          action("Open Source Control", deps.reviewGit, working);
        } else {
          // Cursor-style header: totals, branch, and one Commit & Push.
          const head = document.createElement("div");
          head.className = "context-changes-head";
          const totals = document.createElement("p");
          totals.className = "context-change-totals";
          const added = git.entries.reduce((n, entry) => n + (entry.added ?? 0), 0);
          const removed = git.entries.reduce((n, entry) => n + (entry.removed ?? 0), 0);
          const scope = document.createElement("span");
          scope.textContent = git.entries.length === 0 ? "Nothing uncommitted" : "Uncommitted";
          totals.append(scope);
          if (git.entries.length > 0) {
            const plus = document.createElement("span");
            plus.className = "context-change-added";
            plus.textContent = `+${added}`;
            const minus = document.createElement("span");
            minus.className = "context-change-removed";
            minus.textContent = `−${removed}`;
            totals.append(document.createTextNode(" "), plus, document.createTextNode(" "), minus);
          }
          const branch = document.createElement("button");
          branch.type = "button";
          branch.className = "context-branch";
          branch.textContent = git.branch ?? "Detached HEAD";
          branch.title = git.hasConflicts ? "Conflicts need attention — open Source Control" : "Open Source Control";
          branch.addEventListener("click", () => deps.reviewGit());
          head.append(totals, branch);
          working.append(head);
          if (git.hasConflicts) {
            paragraph("Conflicts need attention. Resolve them in Source Control before committing.", working);
          }
          if (!git.entries.length) {
            paragraph("Your working tree is clean. Saved edits appear here.", working);
          }
          for (const entry of git.entries) {
            const row = document.createElement("div");
            row.className = "context-change-row";
            const icon = fileIcon(entry.path);
            icon.setAttribute("aria-hidden", "true");
            const name = document.createElement("button");
            name.type = "button";
            name.className = "context-change-name";
            name.title = `${entry.path} — show diff`;
            const label = document.createElement("span");
            label.textContent = entry.path;
            name.append(label);
            name.setAttribute("aria-expanded", "false");
            const count = document.createElement("span");
            if (entry.isConflicted) {
              count.className = "context-change-conflict";
              count.textContent = "Conflict";
            } else if (entry.worktree === "untracked" && entry.staged === "none") {
              count.className = "context-change-new";
              count.textContent = "New";
            } else if (entry.added !== null || entry.removed !== null) {
              count.className = "context-change-count";
              count.textContent = `+${entry.added ?? 0} −${entry.removed ?? 0}`;
            } else {
              count.className = "context-change-count";
              count.textContent = "Binary";
            }
            const toggle = document.createElement("button");
            toggle.type = "button";
            const staged = entry.staged !== "none" && entry.worktree === "none";
            toggle.className = "context-change-stage";
            toggle.setAttribute("aria-pressed", String(staged));
            toggle.title = entry.worktree !== "none" ? `Stage ${entry.path}` : `Unstage ${entry.path}`;
            toggle.setAttribute("aria-label", toggle.title);
            toggle.textContent = staged ? "✓" : "+";
            toggle.addEventListener("click", () => {
              const call = entry.worktree !== "none"
                ? window.adcode.git.stage([entry.path])
                : window.adcode.git.unstage([entry.path]);
              void call.then(() => { void refresh(); });
            });
            row.append(icon, name, count, toggle);
            const preview = document.createElement("div");
            preview.className = "context-change-diff";
            preview.hidden = true;
            let loaded = false;
            name.addEventListener("click", () => {
              const open = preview.hidden;
              preview.hidden = !open;
              name.setAttribute("aria-expanded", String(open));
              name.title = open ? `${entry.path} — hide diff` : `${entry.path} — show diff`;
              if (!open || loaded) return;
              loaded = true;
              const note = document.createElement("p");
              note.className = "context-caption";
              note.textContent = "Loading diff…";
              preview.append(note);
              void window.adcode.git.diff(entry.path).then((text) => {
                preview.replaceChildren();
                if (text.trim().length === 0) {
                  paragraph(entry.worktree === "untracked" ? "New file — its contents join the commit when staged." : "No text diff. Open in Source Control for the full picture.", preview);
                  return;
                }
                const lines = text.split("\n");
                const body = lines.length > 400 ? `${lines.slice(0, 400).join("\n")}\n… diff truncated — open in Source Control for the rest.` : text;
                const pre = document.createElement("pre");
                pre.className = "context-diff-text";
                pre.textContent = body.length > 30000 ? `${body.slice(0, 30000)}\n… diff truncated — open in Source Control for the rest.` : body;
                preview.append(pre);
              }).catch(() => {
                preview.replaceChildren();
                paragraph("Could not load the diff. Open in Source Control instead.", preview);
              });
            });
            working.append(row, preview);
          }
          // One Commit & Push beside the list: stages what is unstaged, commits
          // the message, then pushes — each step reported where the eye is.
          if (!git.hasConflicts && git.entries.length > 0) {
            const form = document.createElement("form");
            form.className = "context-commit-form";
            const box = document.createElement("input");
            box.type = "text";
            box.className = "context-commit-box";
            box.placeholder = "Commit message";
            box.setAttribute("aria-label", "Commit message");
            const send = document.createElement("button");
            send.type = "submit";
            send.className = "context-commit-send";
            send.textContent = "Commit & Push";
            const status = document.createElement("p");
            status.className = "context-caption";
            status.setAttribute("role", "status");
            form.append(box, send);
            form.addEventListener("submit", (event) => {
              event.preventDefault();
              const text = box.value.trim();
              if (text.length === 0) {
                status.textContent = "A commit needs a message.";
                box.focus();
                return;
              }
              send.disabled = true;
              status.textContent = "Committing…";
              void (async () => {
                try {
                  const fresh = await window.adcode.git.status();
                  const unstaged = fresh.entries.filter((entry) => entry.worktree !== "none" && !entry.isConflicted).map((entry) => entry.path);
                  if (unstaged.length > 0) {
                    const staged = await window.adcode.git.stage(unstaged);
                    if (!staged.ok) {
                      status.textContent = staged.message;
                      return;
                    }
                  }
                  const committed = await window.adcode.git.commit(text);
                  if (!committed.ok) {
                    status.textContent = committed.message;
                    return;
                  }
                  box.value = "";
                  status.textContent = "Committed — pushing…";
                  const pushed = await window.adcode.git.push();
                  status.textContent = pushed.ok ? "Committed and pushed." : `Committed. Push needs attention: ${pushed.message}`;
                } catch {
                  status.textContent = "Could not commit. Open Source Control and try there.";
                } finally {
                  send.disabled = false;
                  void refresh();
                }
              })();
            });
            working.append(form, status);
          }
          action("Open Source Control", deps.reviewGit, working);
        }
      } else {
        const tasks = await window.adcode.aiWorkspace.list();
        signature += JSON.stringify(tasks);
        if (current() && signature === lastSignature) return;
        const title = section("Project tasks", fragment);
        paragraph("Return to a task to inspect its request, file changes and command results.", title);
        action("Agents & team setup", () => deps.run("ai.team"), title);
        action("Schedule a task", () => deps.run("ai.schedule"), title);
        if (!tasks.length) paragraph("No tasks yet. Ask ADCode to build or change something and its progress will appear here.", fragment);
        for (const task of [...tasks].sort((a, b) => b.updatedAt - a.updatedAt)) {
          const row = document.createElement("details");
          row.className = "context-task";
          row.dataset["taskId"] = task.id;
          const summary = document.createElement("summary");
          const title = document.createElement("strong");
          title.textContent = task.prompt;
          const state = document.createElement("span");
          state.textContent = `${task.state.replaceAll("-", " ")} · ${task.changedPaths.length} files`;
          summary.append(title, state);
          row.append(summary);
          paragraph(new Date(task.updatedAt).toLocaleString(), row);
          action("Review this task", () => deps.reviewTask(task), row);
          const activity = document.createElement("div");
          row.append(activity);
          let loaded = false;
          row.addEventListener("toggle", () => {
            if (!row.open || loaded) return;
            loaded = true;
            paragraph("Loading work history…", activity);
            void Promise.all([window.adcode.aiWorkspace.traces(task.id), window.adcode.aiWorkspace.changes(task.id)]).then(([events, changes]) => {
              activity.replaceChildren();
              for (const change of changes) {
                const added = change.hunks.reduce((n, h) => n + h.replacement.length, 0);
                const removed = change.hunks.reduce((n, h) => n + h.original.length, 0);
                action(change.path, () => deps.reviewTask(task), activity, `+${added} −${removed} · Review proposed file`);
              }
              // Each tool call is stored as a start and a finish event. Grouping
              // them and capping the list keeps a 40-step task to one screen.
              const grouped = groupWorkspaceTraces(events);
              if (!events.length) paragraph("No recorded commands or results for this task.", activity);
              const list = document.createElement("div");
              activity.append(list);
              const paintSteps = (visible: number): void => {
                list.replaceChildren();
                for (const step of grouped.slice(0, visible)) {
                  const entry = document.createElement("details");
                  entry.className = "context-trace";
                  const label = document.createElement("summary");
                  label.textContent = `${step.outcome} · ${step.summary}`;
                  entry.append(label);
                  if (step.detail.length > 0) paragraph(step.detail, entry, "context-trace-detail");
                  list.append(entry);
                }
                if (visible < grouped.length) {
                  const more = document.createElement("button");
                  more.type = "button";
                  more.className = "context-action";
                  more.textContent = `Show all ${grouped.length} steps`;
                  more.addEventListener("click", () => paintSteps(grouped.length));
                  list.append(more);
                }
              };
              paintSteps(Math.min(TRACE_PREVIEW_LIMIT, grouped.length));
            }).catch(() => { activity.replaceChildren(); paragraph("Could not load task details. Close and reopen this task to retry.", activity); loaded = false; });
          });
          fragment.append(row);
        }
      }
      if (!current()) return;
      lastSignature = signature;
      const openIds = [...content.querySelectorAll<HTMLDetailsElement>(".context-task[open]")].map(row => row.dataset["taskId"]);
      content.replaceChildren(fragment);
      for (const row of content.querySelectorAll<HTMLDetailsElement>(".context-task")) row.open = openIds.includes(row.dataset["taskId"]);
    } catch {
      if (!current()) return;
      content.replaceChildren();
      paragraph("Could not load workspace context.", content);
      action("Try again", () => { void refresh(); }, content);
    }
  }
  function show(tab: ContextTab): void {
    selected = tab;
    lastSignature = "";
    for (const [id, button] of tabs) { button.setAttribute("aria-selected", String(tab === id)); button.tabIndex = tab === id ? 0 : -1; }
    content.setAttribute("aria-labelledby", `context-tab-${tab}`);
    content.replaceChildren();
    paragraph("Loading workspace context…", content);
    void refresh();
  }
  function schedule(): void {
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => { void refresh(); }, 200);
  }
  window.adcode.aiWorkspace.onChanged(schedule);
  window.adcode.settings.onChanged(schedule);
  window.addEventListener("focus", schedule);
  return {
    element, show, refresh: schedule,
    /** The tab last shown, so a sidebar row can tell whether it would open or close it. */
    selected: (): ContextTab => selected,
    setVisible(value: boolean): void { visible = value; if (value) show(selected); else generation++; },
  };
}
