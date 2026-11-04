import type { CollabStatusView, ProjectDetailsView, RecentFolderView } from "../../shared/api.ts";
import { ArrowUpRight, Check, ChevronRight, FileDiff, FolderGit2, GitBranch, GitCommitHorizontal, History, Radio, Search, Users } from "lucide";
import { createFloatingPanel } from "../workbench/floatingPanel.ts";
import { createIcon, ICON, iconButton, type IconSource } from "../workbench/icons.ts";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text; element.className = className;
  return element;
}
function avatar(name: string, index = 0) {
  const initials = Array.from(name.trim().split(/\s+/).map(part => Array.from(part)[0] ?? "").join("")).slice(0, 2).join("").toLocaleUpperCase() || "?";
  const element = node("span", initials, "projects-avatar");
  element.dataset["tone"] = String(index % 4); element.setAttribute("aria-hidden", "true");
  return element;
}
function heading(title: string, icon: IconSource, trailing?: string) {
  const row = node("div", "", "projects-section-heading");
  row.append(createIcon(icon), node("h3", title));
  if (trailing) row.append(node("span", trailing, "projects-count"));
  return row;
}

export function createProjectsPanel(deps: { workspaceRoot: () => string | null; openProject: (root: string) => Promise<void>; share?: () => void; sharedProjects?: () => void }) {
  const content = node("div", "", "projects-content");
  const sidebar = node("aside", "", "projects-sidebar");
  const sidebarHeading = node("div", "", "projects-sidebar-heading");
  const count = node("span", "0", "projects-count");
  const refresh = iconButton("Refresh projects", ICON.reload, "icon-button projects-refresh");
  sidebarHeading.append(node("h2", "Your workspace"), count, refresh);
  const toolbar = node("div", "", "projects-toolbar");
  const search = node("input"); search.type = "search"; search.placeholder = "Find a project…"; search.setAttribute("aria-label", "Find a project");
  toolbar.append(createIcon(Search), search);
  const list = node("div", "", "projects-list"); list.setAttribute("aria-label", "Your projects");
  const notice = node("p", "Saved on this device", "projects-library-note"); notice.setAttribute("role", "status");
  sidebar.append(sidebarHeading, toolbar, list, notice);
  if (deps.sharedProjects) {
    const shared = node("button","Shared projects & chats","projects-button projects-button-secondary"); shared.type="button";
    shared.addEventListener("click",deps.sharedProjects); sidebar.insertBefore(shared,toolbar);
  }
  const detail = node("section", "", "projects-detail"); detail.setAttribute("aria-label", "Project details");
  content.append(sidebar, detail);
  let projects: readonly RecentFolderView[] = [], selected: string | null = null;
  let status: CollabStatusView | null = null, sessionRoot: string | null = null;
  let version = 0, loading = false, loadError = "";
  let peopleHost: HTMLElement | null = null, liveBadge: HTMLElement | null = null, sessionActionLabel: HTMLElement | null = null;
  let motion: Animation | undefined;
  const buttons = new Map<string, HTMLButtonElement>();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  content.dataset["input"] = "keyboard";
  content.addEventListener("pointerdown", () => { content.dataset["input"] = "pointer"; });
  content.addEventListener("keydown", () => { content.dataset["input"] = "keyboard"; motion?.cancel(); });
  const panel = createFloatingPanel({ id: "projects", title: "Projects", content,
    defaultSize: { width: 980, height: 720 }, anchor: "centre",
    onVisibilityChange: open => {
      document.getElementById("open-projects")?.setAttribute("aria-expanded", String(open));
      if (!open) { motion?.cancel(); version++; }
    },
  });
  function reveal(element: HTMLElement, pointer: boolean) {
    if (!pointer || !panel.isOpen()) return;
    motion?.cancel();
    motion = element.animate(reduced.matches ? [{ opacity: 0.55 }, { opacity: 1 }] : [
      { opacity: 0.4, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" },
    ], { duration: 160, easing: getComputedStyle(content).getPropertyValue("--ease-toast").trim() || "cubic-bezier(0.23, 1, 0.32, 1)" });
  }
  function live(root: string) { return root === sessionRoot && (status?.mode === "hosting" || status?.mode === "joined"); }
  function empty(title: string, text: string, icon: IconSource = FolderGit2) {
    const state = node("div", "", "projects-empty");
    state.append(createIcon(icon), node("strong", title), node("p", text, "projects-muted")); return state;
  }
  function renderList() {
    count.textContent = String(projects.length);
    const filtered = projects.filter(p => `${p.name} ${p.path}`.toLowerCase().includes(search.value.toLowerCase()));
    const active = document.activeElement, fragment = document.createDocumentFragment();
    for (const p of filtered) {
      let button = buttons.get(p.path);
      if (!button) {
        button = node("button", "", "projects-item"); button.type = "button";
        button.addEventListener("click", event => {
          if (selected === p.path) return;
          selected = p.path; renderList(); detail.scrollTop = 0; void renderDetails(event.detail > 0);
        });
        buttons.set(p.path, button);
      }
      button.setAttribute("aria-pressed", String(selected === p.path));
      const mark = node("span", "", "projects-folder-mark"); mark.append(createIcon(FolderGit2));
      const label = node("span", "", "projects-item-label"), name = node("strong", p.name); name.title = p.name;
      const state = node("span", live(p.path) ? `${status!.participants.length} connected now` : p.path === deps.workspaceRoot() ? "Current project" : "Saved project", "projects-item-state");
      if (live(p.path)) state.dataset["live"] = "true";
      label.append(name, state);
      const arrow = createIcon(ChevronRight); arrow.classList.add("projects-item-arrow");
      button.title = p.path; button.replaceChildren(mark, label, arrow); fragment.append(button);
    }
    if (!filtered.length) fragment.append(empty(loading ? "Loading projects…" : loadError ? "Couldn't load projects" : projects.length ? "No matching projects." : "A place for your projects", loadError || (projects.length ? "Try another name or folder." : "Open a folder to add your first project."), Search));
    list.replaceChildren(fragment);
    // Reuse buttons and restore focus when presence changes or selection redraws the list.
    if (active instanceof HTMLButtonElement && list.contains(active)) active.focus({ preventScroll: true });
    for (const path of buttons.keys()) if (!projects.some(p => p.path === path)) buttons.delete(path);
  }
  function renderPeople() {
    if (!peopleHost || !selected) return;
    const connected = live(selected);
    if (sessionActionLabel) sessionActionLabel.textContent = connected ? "Manage session" : "Share project";
    if (liveBadge) { liveBadge.textContent = connected ? "Live session" : "No live session"; liveBadge.dataset["live"] = String(connected); }
    peopleHost.replaceChildren(heading("People", Users, connected ? `${status!.participants.length} connected` : "Offline"));
    if (connected) {
      const people = node("ul", "", "projects-people");
      status!.participants.forEach((person, index) => {
        const row = node("li", "", "projects-person"), label = node("span", "", "projects-person-label");
        label.append(node("strong", person.name + (person.id === status!.selfId ? " (you)" : "")), node("span", person.role === "host" ? "Host" : person.role === "editor" ? "Can edit" : "View only", "projects-muted"));
        row.append(avatar(person.name, index), label, node("span", "", "projects-presence-dot")); people.append(row);
      });
      peopleHost.append(people);
    } else {
      const message = node("div", "", "projects-session-empty");
      message.append(createIcon(Radio), node("p", "Better together. Start or join a session to see who's here.", "projects-muted")); peopleHost.append(message);
    }
  }
  function renderHistory(host: HTMLElement, data: ProjectDetailsView) {
    host.replaceChildren();
    const meta = node("div", "", "projects-repo-meta"); meta.append(createIcon(GitBranch), node("span", data.branch));
    if (data.repository) { const repo = node("span", data.repository.replace(/^https?:\/\/(?:www\.)?github.com\//, "").replace(/\.git$/, ""), "projects-repository"); repo.title = data.repository; meta.append(repo); }
    const metrics = node("div", "", "projects-metrics");
    for (const [label, value, icon] of [["Commits", data.commitCount, GitCommitHorizontal], ["Contributors", data.contributors.length, Users], ["Uncommitted files", data.changedFiles, FileDiff]] as const) {
      const metric = node("div", "", "projects-metric");
      metric.append(createIcon(icon), node("strong", value.toLocaleString()), node("span", label, "projects-muted")); metrics.append(metric);
    }
    const contributions = node("section", "", "projects-section"); contributions.append(heading("Contributions", GitCommitHorizontal, `${data.commitCount.toLocaleString()} commits`));
    if (!data.commitCount) contributions.append(empty("Your first commit starts here", "Contributions will appear after the first commit.", GitCommitHorizontal));
    data.contributors.forEach((c, index) => {
      const row = node("div", "", "projects-contribution"), label = node("span", "", "projects-contributor-label");
      label.append(node("strong", c.name), node("span", c.email || "Git contributor", "projects-muted"));
      const figures = node("span", "", "projects-contribution-figures"), percentage = data.commitCount ? Math.round(c.commits / data.commitCount * 100) : 0;
      figures.append(node("strong", `${c.commits.toLocaleString()} commits`), node("span", `${percentage}%`, "projects-muted"));
      row.append(avatar(c.name, index), label, figures);
      const bar = node("progress"); bar.max = Math.max(1, data.commitCount); bar.value = c.commits;
      bar.setAttribute("aria-label", `${c.name}: ${c.commits} of ${data.commitCount} commits`); row.append(bar); contributions.append(row);
    });
    contributions.append(node("p", "Git authors + coauthors · Shared commits can credit more than one person.", "projects-footnote"));
    const activity = node("section", "", "projects-section"); activity.append(heading("Recent activity", History, "All branches"));
    const commits = node("ol", "", "projects-commits");
    data.commits.forEach(c => {
      const row = node("li"), mark = node("span", "", "projects-commit-mark"); mark.append(createIcon(GitCommitHorizontal));
      const label = node("div", "", "projects-commit-label"), date = new Date(c.date);
      label.append(node("strong", c.subject), node("span", `${c.author} · ${Number.isNaN(date.getTime()) ? c.date : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`, "projects-muted"));
      row.append(mark, label, node("code", c.hash)); commits.append(row);
    });
    activity.append(commits); host.append(meta, metrics, ...(peopleHost ? [peopleHost] : []), contributions, activity);
  }
  async function renderDetails(pointer = false) {
    motion?.cancel();
    const request = ++version, project = projects.find(p => p.path === selected);
    detail.replaceChildren(); peopleHost = null; liveBadge = null; sessionActionLabel = null;
    if (!project) { detail.append(empty("Your next project starts here", "Choose a project to explore its people, contributions, and latest work.")); return; }
    const hero = node("header", "", "projects-hero"), top = node("div", "", "projects-hero-top"), mark = node("span", "", "projects-hero-mark"); mark.append(createIcon(FolderGit2));
    liveBadge = node("span", "", "projects-live-badge"); top.append(mark, liveBadge);
    hero.append(top, node("p", project.path === deps.workspaceRoot() ? "CURRENT WORKSPACE" : "PROJECT OVERVIEW", "projects-eyebrow"), node("h2", project.name));
    const path = node("p", project.path, "projects-path"); path.title = project.path; hero.append(path);
    const actions = node("div", "", "projects-actions"), current = project.path === deps.workspaceRoot();
    const open = node("button", "", "projects-button projects-button-secondary"); open.type = "button"; open.disabled = current;
    open.append(createIcon(current ? Check : ArrowUpRight), node("span", current ? "Current project" : "Open project"));
    open.addEventListener("click", () => {
      open.disabled = true;
      void deps.openProject(project.path).then(() => { void load(); }).catch(error => { detail.append(node("p", error instanceof Error ? error.message : "Could not open project.", "collab-error")); open.disabled = false; });
    });
    if (current && deps.share) {
      const share = node("button", "", "projects-button projects-button-primary"); share.type = "button";
      sessionActionLabel = node("span", live(project.path) ? "Manage session" : "Share project");
      share.append(createIcon(Users), sessionActionLabel); share.addEventListener("click", deps.share); actions.append(share);
    }
    actions.append(open); hero.append(actions); detail.append(hero);
    const history = node("div", "", "projects-history"); history.setAttribute("aria-busy", "true"); history.append(node("p", "Loading contributions…", "projects-muted"));
    peopleHost = node("section", "", "projects-section projects-team"); detail.append(peopleHost, history); renderPeople(); reveal(detail, pointer);
    try {
      const data = await window.adcode.collab.projectDetails(project.path);
      if (request !== version) return;
      renderHistory(history, data); history.setAttribute("aria-busy", "false");
    } catch (error) {
      if (request !== version) return;
      history.replaceChildren(empty("History isn't available", error instanceof Error ? error.message : "Contributions could not be loaded.", History)); history.setAttribute("aria-busy", "false");
    }
  }
  async function load() {
    if (loading) return;
    loading = true; refresh.disabled = true; refresh.setAttribute("aria-busy", "true"); loadError = ""; renderList();
    try {
      projects = await window.adcode.collab.projects();
      selected = projects.some(p => p.path === selected) ? selected : projects.find(p => p.path === deps.workspaceRoot())?.path ?? projects[0]?.path ?? null;
    } catch (error) { loadError = error instanceof Error ? error.message : "Projects could not be loaded."; }
    finally {
      loading = false; refresh.disabled = false; refresh.setAttribute("aria-busy", "false"); notice.textContent = loadError || "Saved on this device"; renderList(); void renderDetails();
    }
  }
  search.addEventListener("input", renderList); refresh.addEventListener("click", () => { void load(); });
  return {
    open() { panel.open(); void load(); },
    toggle() { if (panel.isOpen()) panel.close(); else { panel.open(); void load(); } },
    update(next: CollabStatusView) {
      if ((next.mode === "hosting" || next.mode === "joined") && !sessionRoot) sessionRoot = deps.workspaceRoot();
      if (next.mode === "off") sessionRoot = null;
      status = next;
      if (panel.isOpen()) { renderList(); renderPeople(); }
    },
  };
}
