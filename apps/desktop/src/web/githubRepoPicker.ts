/**
 * "Open from GitHub": the web version's way in to a project (2026-11-21).
 *
 * The web has no computer of the person's own, so a project is a GitHub repository copied into
 * the tab (src/browserHost/githubProjects.ts). This lists the person's repositories - connecting
 * GitHub first if they have not - and takes a pasted address for anything else they can read.
 * Changes go back as a pull request from the Changes list.
 */
import { connectGitHub } from "./githubConnect.ts";
import type { HostSocket } from "./socket.ts";

interface RepoSummary { readonly fullName: string; readonly defaultBranch: string; readonly private: boolean; readonly canPush: boolean }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const message = (error: unknown): string => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "Something went wrong. Try again.");

/** Resolves with the opened project's folder, or null when the person closes the dialog. */
export function openFromGitHub(socket: HostSocket): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = el("dialog", "web-picker web-github-repos");
    dialog.setAttribute("aria-labelledby", "web-github-repos-title");
    let settled = false;
    let busy = false;
    const finish = (path: string | null): void => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(path);
    };

    const header = el("header", "web-picker-header");
    const title = el("h2", undefined, "Open from GitHub");
    title.id = "web-github-repos-title";
    const close = el("button", "web-picker-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => { if (!busy) finish(null); });
    header.append(title, close);

    const body = el("div", "web-action-body");
    const lead = el("p", "web-gate-lead", "Pick a repository. ADCode copies its files into this tab - nothing runs on a computer of yours - and your changes go back as a pull request.");
    const search = el("input", "web-gate-input");
    search.type = "search";
    search.placeholder = "Find a repository";
    search.setAttribute("aria-label", "Find a repository");
    const list = el("ul", "web-picker-list web-github-repo-list");
    list.setAttribute("aria-label", "Your GitHub repositories");
    const more = el("button", "web-gate-button", "Load more");
    more.type = "button";
    more.hidden = true;
    const status = el("p", "web-action-status");
    status.setAttribute("role", "status");
    const error = el("p", "web-gate-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    const address = el("form", "web-github-address");
    const addressInput = el("input", "web-gate-input");
    addressInput.type = "text";
    addressInput.placeholder = "Or paste an address: https://github.com/you/project";
    addressInput.setAttribute("aria-label", "Repository address");
    const addressButton = el("button", "web-gate-button", "Open");
    addressButton.type = "submit";
    address.append(addressInput, addressButton);
    body.append(lead, search, list, more, address, status, error);
    dialog.append(header, body);

    const repos: RepoSummary[] = [];
    let nextPage: number | null = 1;

    function showError(text: string): void {
      error.textContent = text;
      error.hidden = false;
    }

    function render(): void {
      const query = search.value.trim().toLowerCase();
      const shown = repos.filter((repo) => repo.fullName.toLowerCase().includes(query));
      list.replaceChildren();
      if (shown.length === 0) {
        list.append(el("li", "web-picker-empty", repos.length === 0 ? "No repositories yet." : "No repository matches that."));
        return;
      }
      for (const repo of shown) {
        const item = el("li");
        const button = el("button", "web-picker-item");
        button.type = "button";
        button.append(el("span", "web-picker-name", repo.fullName), el("span", "web-picker-when", `${repo.private ? "Private · " : ""}${repo.defaultBranch}${repo.canPush ? "" : " · read only"}`));
        button.addEventListener("click", () => void open(`https://github.com/${repo.fullName}/tree/${repo.defaultBranch}`, repo.fullName));
        item.append(button);
        list.append(item);
      }
    }

    async function loadPage(): Promise<void> {
      if (nextPage === null) return;
      more.disabled = true;
      status.textContent = "Loading your repositories…";
      try {
        const page = (await socket.op("githubRepos", [nextPage])) as { repos: RepoSummary[]; nextPage: number | null };
        repos.push(...page.repos);
        nextPage = page.nextPage;
        status.textContent = "";
        render();
      } catch (failure) {
        status.textContent = "";
        showError(message(failure));
      } finally {
        more.disabled = false;
        more.hidden = nextPage === null;
      }
    }

    async function open(target: string, name: string): Promise<void> {
      if (busy) return;
      busy = true;
      error.hidden = true;
      for (const control of dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) control.disabled = true;
      status.textContent = `Opening ${name}… copying its files into this tab.`;
      try {
        const path = (await socket.op("cloneProject", [target])) as string;
        busy = false;
        finish(path);
      } catch (failure) {
        busy = false;
        for (const control of dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) control.disabled = false;
        status.textContent = "";
        showError(message(failure));
      }
    }

    search.addEventListener("input", render);
    more.addEventListener("click", () => void loadPage());
    address.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = addressInput.value.trim();
      if (value !== "") void open(value, value.replace(/^https:\/\/github\.com\//, ""));
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!busy) finish(null);
    });
    document.body.append(dialog);
    dialog.showModal();

    void (async () => {
      status.textContent = "Checking GitHub…";
      const state = (await socket.op("githubStatus", []).catch(() => null)) as { connected?: boolean; error?: string } | null;
      if (typeof state?.error === "string") {
        status.textContent = "";
        showError(state.error);
        return;
      }
      if (state?.connected !== true) {
        status.textContent = "";
        const connect = el("button", "web-gate-button web-gate-primary", "Connect GitHub");
        connect.type = "button";
        const prompt = el("li", "web-picker-empty", "Connect GitHub to see your repositories. A public repository opens by its address too, once GitHub is connected.");
        list.replaceChildren(prompt);
        prompt.append(el("br"), connect);
        connect.addEventListener("click", () => {
          void connectGitHub(socket, "Opening your repositories needs your permission once.").then((connected) => {
            if (connected) void loadPage();
          });
        });
        return;
      }
      await loadPage();
      search.focus();
    })();
  });
}
