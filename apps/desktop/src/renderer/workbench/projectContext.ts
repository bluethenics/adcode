import type { AiWorkspaceTaskView } from "../../shared/api.ts";
import { createHelpPopover } from "../help/helpPopover.ts";
import { createChangesView } from "./changesView.ts";

export type ContextTab = "project" | "changes";
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
  const changes = createChangesView({
    root: deps.root,
    openSourceControl: (path) => deps.reviewGit(path),
    reviewTask: deps.reviewTask,
    // An action's result is news even when Git's state is not, so this redraws regardless.
    refresh: () => { lastSignature = ""; void refresh(); },
  });
  const tabs = new Map<ContextTab, HTMLButtonElement>();
  for (const id of ["project", "changes"] as const) {
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
      const count = ids.length;
      const next = event.key === "ArrowRight" ? (index + 1) % count : event.key === "ArrowLeft" ? (index + count - 1) % count : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : -1;
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
        for (const [count, label] of [[entries.filter(e => !e.isDirectory).length, "files"], [entries.filter(e => e.isDirectory).length, "folders"], [git.isRepo ? git.entries.length : 0, "changes"]] as const) {
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
          action("View all tasks", () => deps.run("workspace.tasks"), task);
        }
        if (git.entries.length || latest?.changedPaths.length) {
          const changes = section("Recent changes", fragment);
          if (latest && latest.changedPaths.length && !["applied", "discarded", "rolled-back"].includes(latest.state)) {
            for (const path of latest.changedPaths.slice(0, 3)) action(path, () => deps.reviewTask(latest), changes, "AI change · waiting to apply");
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
        explain(assistant, "AI context", "Vibe and Code use the same conversation and project folder.", "The assistant can read and edit project files and run commands. Its edits land as it works, and every turn can be undone from the chat.");
        action(ai.ready ? "Models & connections" : "Connect an AI provider", () => deps.run("ai.connect"), assistant);
        const work = section("Build & check", fragment);
        action("Open preview", () => deps.run("workspace.preview"), work, "See the running application");
        action("Terminal", () => deps.run("terminal.toggle"), work, "Run project commands");
        action("Problems", () => deps.run("view.problems"), work, "Go to diagnostics and fixes");
        const earn = section("Build. Earn. Keep creating.", fragment);
        paragraph("Track earnings from verified sponsored views in your real ledger.", earn);
        action("Open earnings", () => document.getElementById("open-earnings")?.click(), earn, "Balance, activity and payout details");
      } else {
        const [git, tasks] = await Promise.all([window.adcode.git.status(), window.adcode.aiWorkspace.list()]);
        signature += JSON.stringify([git, tasks]);
        if (current() && signature === lastSignature) return;
        // AI edits land in the project as the assistant works, so they are ordinary
        // uncommitted files. Only staged work - Review mode, or a Team's result - waits to
        // be applied, and that section exists only while something does.
        const pending = tasks.filter(task => task.changedPaths.length > 0 && ["review", "paused", "ready", "conflict", "failed"].includes(task.state));
        changes.render(fragment, git, pending);
      }
      if (!current()) return;
      lastSignature = signature;
      // A redraw on every save must not throw the reader back to the top of a long list.
      const scrollTop = content.scrollTop;
      content.replaceChildren(fragment);
      content.scrollTop = scrollTop;
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
    content.dataset["view"] = tab;
    content.replaceChildren();
    paragraph("Loading workspace context…", content);
    void refresh();
  }
  function schedule(): void {
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => { void refresh(); }, 200);
  }
  window.adcode.aiWorkspace.onChanged(schedule);
  // The assistant's edits land as it works: Changes follows the files, not only the window focus.
  window.adcode.workspace.onFilesChanged(schedule);
  window.adcode.settings.onChanged(schedule);
  window.addEventListener("focus", schedule);
  return {
    element, show, refresh: schedule,
    /** The tab last shown, so a sidebar row can tell whether it would open or close it. */
    selected: (): ContextTab => selected,
    setVisible(value: boolean): void { visible = value; if (value) show(selected); else generation++; },
  };
}
