import type { SharedProjectView } from "../../shared/api.ts";
interface ProjectPanelDeps {
  notify(message: string): void;
  confirm(title: string, detail: string, confirmLabel: string): Promise<boolean>;
  prompt(title: string, detail: string, initial: string): Promise<string | null>;
}

/** Uses the existing collaboration controls and styles; no workbench layout changes. */
export function sharedProjectsPanel(deps: ProjectPanelDeps): { element: HTMLElement; refresh(): Promise<void> } {
  const element = document.createElement("div"); element.className = "collab-section";
  const heading = document.createElement("h3"); heading.className = "collab-heading"; heading.textContent = "Online projects";
  const description = document.createElement("p"); description.className = "collab-blurb";
  description.textContent = "Stay available when you close ADCode. Friends open their own chats and use their own allowance. Free includes 3 owned projects; joining is free.";
  const status = document.createElement("p"); status.className = "collab-blurb"; status.setAttribute("aria-live", "polite");
  const actions = document.createElement("div"); actions.className = "collab-actions";
  actions.style.flexWrap = "wrap";
  const list = document.createElement("div"); list.className = "collab-section-body";
  element.append(heading, description, status, actions, list);
  let busy = false;
  const button = (text: string, work: () => Promise<void>, primary = false): HTMLButtonElement => {
    const result = document.createElement("button"); result.type = "button"; result.className = primary ? "collab-primary" : "ghost-button"; result.textContent = text;
    result.style.maxWidth = "100%"; result.style.whiteSpace = "normal"; result.style.overflowWrap = "anywhere";
    result.addEventListener("click", () => {
      if (busy) return; busy = true;
      for (const control of element.querySelectorAll("button")) control.disabled = true;
      status.textContent = "Working…";
      void work().then(refresh).catch(async error => { await refresh(); status.textContent = error instanceof Error ? error.message : "Project is unavailable. Try again."; }).finally(() => { busy = false; for (const control of element.querySelectorAll("button")) control.disabled = false; });
    });
    return result;
  };
  actions.append(button("Share project online", async () => {
    if (!await deps.confirm("Save this project online?", "Upload this folder’s files so invited friends can read and edit them even while you are offline. Each person has separate chats and AI usage. Private configuration (.env, keys), linked folders, dependencies and generated files are excluded. Up to 4,000 files, 1 MB per file and 16 MB total. Review your source files before sharing.", "Save online")) return;
    const saved = await window.adcode.projects.action("publish");
    if (saved.invite) { await window.adcode.clipboard.writeText(saved.invite); deps.notify("Project is online. Invite copied—send it to your friends."); }
  }, true), button("Join project", async () => {
    const code = await deps.prompt("Join an online project", "Paste your friend’s adproject: invite. You’ll get the shared files and can start your own chats.", "");
    if (code?.trim()) await window.adcode.projects.action("join", { code: code.trim() });
  }), button("Plans", async () => { window.open("https://adcode.bluethenics.com/pricing", "_blank", "noopener"); }));

  function row(project: SharedProjectView, owned: boolean, current: SharedProjectView | null): HTMLElement {
    const result = document.createElement("div"); result.className = "collab-section";
    const name = document.createElement("strong"); name.textContent = project.name + (project.id === current?.id ? " · open" : "");
    name.style.overflowWrap = "anywhere";
    const controls = document.createElement("div"); controls.className = "collab-actions";
    controls.style.flexWrap = "wrap";
    controls.append(button("Open", async () => { await window.adcode.projects.action("open", { id: project.id }); deps.notify("Shared project opened. Start a new chat to work on it."); }));
    if (project.id === current?.id) {
      controls.append(button("Sync now", async () => { await window.adcode.projects.action("sync", { id: project.id }); }));
      if (owned && current.invite) controls.append(button("Copy invite", async () => { await window.adcode.clipboard.writeText(current.invite!); deps.notify("Project invite copied."); }));
      if (owned) {
        controls.append(button("Reset invite", async () => {
          if (await deps.confirm("Reset project invite?", "The old invite will stop working. Existing members keep access until you remove them.", "Reset invite")) await window.adcode.projects.action("rotate", { id: project.id });
        }));
        for (const [uid, label] of Object.entries(current.members ?? {})) {
          controls.append(button("Remove " + label, async () => {
            if (await deps.confirm("Remove project member?", `${label} will lose online access. Files already downloaded stay on their computer.`, "Remove")) await window.adcode.projects.action("remove", { id: project.id, uid });
          }));
        }
      }
    }
    if (owned) controls.append(button("Delete online project", async () => {
      if (await deps.confirm("Delete this online project?", "Online files and everyone’s project access will be removed. Local copies and chats will be kept. This frees an owned project slot.", "Delete online project")) await window.adcode.projects.action("delete", { id: project.id });
    }));
    result.append(name, controls); return result;
  }
  async function refresh(): Promise<void> {
    if (!window.adcode.projects) { status.textContent = "Online projects are available in the desktop app."; actions.hidden = true; return; }
    try {
      const view = await window.adcode.projects.action("list");
      status.textContent = view.syncError ?? `${view.owned.length} owned · ${view.joined.length} joined · saved files sync every few seconds`;
      list.replaceChildren(...view.owned.map(item => row(item, true, view.current)), ...view.joined.map(item => row(item, false, view.current)));
      if (view.current && view.syncError?.startsWith("Sync paused: both")) {
        for (const [label, resolution] of [["Keep my conflicting files", "local"], ["Use online conflicting files", "online"]] as const) {
          list.prepend(button(label, async () => {
            if (await deps.confirm("Resolve conflicting files?", "Only conflicting files use this choice. Both versions are backed up in ADCode’s local shared-projects cache.", label)) await window.adcode.projects.action("sync", { id: view.current!.id, resolution });
          }));
        }
      }
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Sign in to use online projects."; }
  }
  return { element, refresh };
}
