/**
 * The welcome screen: what the window shows before anything is open.
 *
 * It replaces a placeholder that said "Open a folder, pick a file, and start editing" and then
 * offered no way to do any of those things - the instruction was accurate and the screen was
 * inert, so the reader had to already know where the controls were. Everything it now names is
 * a button.
 *
 * Four starting points, in the order a person actually needs them:
 *
 * - **Recent folders first.** After the first week this is the only row that gets used, and
 *   putting it under three buttons that are each pressed once would be optimising the screen
 *   for the day it is least needed.
 * - **Open Folder** is the primary action, because a folder is what this editor works on: the
 *   tree, search, source control and the language servers are all scoped to one.
 * - **Open File** is offered second and honestly - a single file outside any folder can be read
 *   and edited, but the rest of the workbench has nothing to point at.
 * - **Clone from GitHub** exists because "get the code onto this machine" is a step that
 *   otherwise happens somewhere else entirely, and a beginner who has been sent a repository
 *   URL has nowhere to put it.
 *
 * The version is on this screen rather than only in Settings because it is the thing people are
 * asked for when reporting something broken, and hunting for it is the point at which they give
 * up and describe the bug without one.
 */
import { brandMark } from "./brandMark.ts";
import type { AccountState, AppInfo, RecentFolderView } from "../../shared/api.ts";

export interface WelcomeViewDeps {
  /** The placeholder element the editor already shows when no file is open. */
  readonly host: HTMLElement;
  readonly openFolder: () => void;
  readonly openFile: () => void;
  readonly cloneRepository: () => void;
  readonly openRecent: (path: string) => void;
  readonly forgetRecent: (path: string) => void;
}

export interface WelcomeView {
  /** Re-read the recents list and the version. Cheap, and called whenever the screen appears. */
  refresh(): Promise<void>;
}

function actionButton(label: string, hint: string, iconPaths: readonly string[]): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "welcome-action";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const path of iconPaths) {
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
    shape.setAttribute("d", path);
    svg.append(shape);
  }

  const text = document.createElement("span");
  text.className = "welcome-action-text";

  const title = document.createElement("strong");
  title.textContent = label;

  const detail = document.createElement("small");
  detail.textContent = hint;

  text.append(title, detail);
  button.append(svg, text);

  return button;
}

/** `E:\Work\Project` → `E:\Work`, for the dimmed half of a recent row. */
function parentOf(path: string): string {
  const normalised = path.replace(/[\\/]+$/, "");
  const cut = Math.max(normalised.lastIndexOf("/"), normalised.lastIndexOf("\\"));
  return cut <= 0 ? "" : normalised.slice(0, cut);
}

export function createWelcomeView(deps: WelcomeViewDeps): WelcomeView {
  const inner = document.createElement("div");
  inner.className = "welcome-inner";

  /* ── Identity ───────────────────────────────────────────────────────────── */

  const mark = document.createElement("div");
  mark.className = "welcome-mark";
  mark.append(brandMark({ size: 64, accent: true }));

  const title = document.createElement("h1");
  title.className = "welcome-title";
  title.textContent = "ADCode";

  const tagline = document.createElement("p");
  tagline.className = "welcome-tagline";
  tagline.textContent = "An ad-supported, AI-native editor.";

  const version = document.createElement("p");
  version.className = "welcome-version";
  // Filled by `refresh`. Never a guess: the renderer does not know its own build.
  version.textContent = "";

  const identity = document.createElement("div");
  identity.className = "welcome-identity";
  identity.append(mark, title, tagline, version);

  /* ── Start ──────────────────────────────────────────────────────────────── */

  const start = document.createElement("div");
  start.className = "welcome-start";

  const folderButton = actionButton("Open Folder", "Work on a project", [
    "M3 6.5A2.5 2.5 0 0 1 5.5 4h3.4c.5 0 1 .2 1.4.6l1.1 1.1c.2.2.4.3.7.3h6.4A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z",
  ]);
  folderButton.classList.add("welcome-action-primary");
  folderButton.addEventListener("click", () => deps.openFolder());

  const fileButton = actionButton("Open File", "Edit a single file", [
    "M13.5 3.5H7A2 2 0 0 0 5 5.5v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z",
    "M13.5 3.5V9H19",
  ]);
  fileButton.addEventListener("click", () => deps.openFile());

  const cloneButton = actionButton("Clone from GitHub", "Copy a repository here", [
    "M12 3.5a8.5 8.5 0 0 0-2.7 16.6c.4.1.6-.2.6-.4v-1.6c-2.4.5-2.9-1.1-2.9-1.1-.4-1-1-1.3-1-1.3-.8-.5.1-.5.1-.5.9.1 1.3.9 1.3.9.8 1.3 2.1.9 2.6.7.1-.6.3-.9.6-1.2-1.9-.2-3.9-1-3.9-4.2 0-.9.3-1.7.9-2.3-.1-.2-.4-1.1.1-2.3 0 0 .7-.2 2.3.9a8 8 0 0 1 4.2 0c1.6-1.1 2.3-.9 2.3-.9.5 1.2.2 2.1.1 2.3.6.6.9 1.4.9 2.3 0 3.2-2 4-3.9 4.2.3.3.6.9.6 1.8v2.6c0 .2.2.5.6.4A8.5 8.5 0 0 0 12 3.5z",
  ]);
  cloneButton.addEventListener("click", () => deps.cloneRepository());

  start.append(folderButton, fileButton, cloneButton);

  /* ── Recent ─────────────────────────────────────────────────────────────── */

  const recentSection = document.createElement("div");
  recentSection.className = "welcome-recent";
  recentSection.hidden = true;

  const recentHeading = document.createElement("h2");
  recentHeading.className = "welcome-heading";
  recentHeading.textContent = "Recent";

  const recentList = document.createElement("ul");
  recentList.className = "welcome-recent-list";

  recentSection.append(recentHeading, recentList);

  /* ── Shortcuts ──────────────────────────────────────────────────────────── */

  const shortcuts = document.createElement("dl");
  shortcuts.className = "shortcuts";
  for (const [label, keys] of [
    ["Command palette", ["Ctrl", "Shift", "P"]],
    ["Save", ["Ctrl", "S"]],
    ["Terminal", ["Ctrl", "`"]],
  ] as const) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;

    const definition = document.createElement("dd");
    for (const key of keys) {
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      definition.append(kbd);
    }

    row.append(term, definition);
    shortcuts.append(row);
  }

  /* ── Account ────────────────────────────────────────────────────────────── */

  /*
   * A recommendation, never a gate.
   *
   * The welcome screen is the one place someone reliably looks before starting work, so
   * it is where this belongs - but it stays a single quiet row. §8.4 promises first launch
   * has "no UI and no wall", and a sign-in panel competing with Open Folder would be a
   * wall in everything but name.
   *
   * Once linked it becomes an avatar and a name: the same row, now reassurance rather than
   * a request.
   */
  const account = document.createElement("div");
  account.className = "welcome-account";
  account.hidden = true;

  const accountAvatar = document.createElement("img");
  accountAvatar.className = "welcome-avatar";
  accountAvatar.alt = "";
  accountAvatar.hidden = true;
  accountAvatar.addEventListener("error", () => {
    accountAvatar.hidden = true;
  });

  const accountLabel = document.createElement("span");
  accountLabel.className = "welcome-account-label";

  const accountButtons = document.createElement("span");
  accountButtons.className = "welcome-account-actions";

  const googleLink = document.createElement("button");
  googleLink.type = "button";
  googleLink.className = "ghost-button";
  googleLink.textContent = "Google";

  const githubLink = document.createElement("button");
  githubLink.type = "button";
  githubLink.className = "ghost-button";
  githubLink.textContent = "GitHub";

  accountButtons.append(googleLink, githubLink);
  account.append(accountAvatar, accountLabel, accountButtons);

  function paintAccount(state: AccountState): void {
    if (state.state === "unavailable") {
      account.hidden = true;
      return;
    }

    account.hidden = false;

    if (state.state === "linked") {
      accountButtons.hidden = true;
      accountLabel.textContent = `Signed in as ${state.displayName ?? state.email ?? "your account"}`;

      if (state.photoUrl !== null) {
        accountAvatar.src = state.photoUrl;
        accountAvatar.hidden = false;
      }
      return;
    }

    accountAvatar.hidden = true;
    accountButtons.hidden = false;
    accountLabel.textContent = "Sign in to keep your earnings — recommended";
  }

  const startLink = (provider: "google" | "github") => {
    googleLink.disabled = true;
    githubLink.disabled = true;
    accountLabel.textContent = "Finishing in your browser…";

    void window.adcode.account
      .link(provider)
      .then((outcome) => {
        googleLink.disabled = false;
        githubLink.disabled = false;
        if (outcome.ok) paintAccount(outcome.state);
        else accountLabel.textContent = outcome.message;
      })
      .catch(() => {
        googleLink.disabled = false;
        githubLink.disabled = false;
        accountLabel.textContent = "Sign-in didn't complete. Try again.";
      });
  };

  googleLink.addEventListener("click", () => startLink("google"));
  githubLink.addEventListener("click", () => startLink("github"));

  window.adcode.account.onDeviceCode((code) => {
    accountLabel.textContent = `Enter code ${code.userCode} at ${code.verificationUri}`;
  });

  window.adcode.account.onChanged(paintAccount);
  void window.adcode.account.status().then(paintAccount);

  inner.append(identity, account, start, recentSection, shortcuts);
  deps.host.replaceChildren(inner);

  function renderRecents(list: readonly RecentFolderView[]): void {
    recentSection.hidden = list.length === 0;

    recentList.replaceChildren(
      ...list.map((folder) => {
        const row = document.createElement("li");
        row.className = "welcome-recent-row";

        const open = document.createElement("button");
        open.type = "button";
        open.className = "welcome-recent-open";
        open.title = folder.path;

        const name = document.createElement("span");
        name.className = "welcome-recent-name";
        name.textContent = folder.name;

        const parent = document.createElement("span");
        parent.className = "welcome-recent-path";
        // The containing directory, not the whole path: two projects called `src` are told
        // apart by where they live, and the full path is on the tooltip for when it matters.
        parent.textContent = parentOf(folder.path);

        open.append(name, parent);
        open.addEventListener("click", () => deps.openRecent(folder.path));

        const forget = document.createElement("button");
        forget.type = "button";
        forget.className = "welcome-recent-forget";
        forget.title = `Remove ${folder.name} from this list`;
        forget.setAttribute("aria-label", forget.title);

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 16 16");
        svg.setAttribute("aria-hidden", "true");
        const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
        shape.setAttribute("d", "M4 4l8 8M12 4l-8 8");
        svg.append(shape);
        forget.append(svg);

        forget.addEventListener("click", (event) => {
          // Or the row's own button fires too and opens the folder being removed.
          event.stopPropagation();
          deps.forgetRecent(folder.path);
        });

        row.append(open, forget);
        return row;
      }),
    );
  }

  function renderVersion(info: AppInfo | null): void {
    version.textContent = info === null ? "" : `Version ${info.version}`;
    version.title = info === null ? "" : `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node} · ${info.platform}`;
  }

  return {
    async refresh(): Promise<void> {
      /*
       * Both reads are allowed to fail without taking the screen with them.
       *
       * This is the first thing drawn on launch. A recents file that cannot be read, or an IPC
       * call that arrives before the main process is listening, must cost the list and not the
       * window - the buttons above still work with neither.
       */
      try {
        renderRecents(await window.adcode.workspace.recents());
      } catch {
        renderRecents([]);
      }

      try {
        renderVersion(await window.adcode.app.info());
      } catch {
        renderVersion(null);
      }
    },
  };
}
