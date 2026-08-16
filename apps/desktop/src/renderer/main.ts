/**
 * Workbench bootstrap: layout, file tree, tabs, editor, terminal, status bar.
 *
 * Everything except the text-editing surface itself is ours (brief §2).
 */
import "./styles/tokens.css";
import "./styles/workbench.css";
import "./styles/notifications.css";
import "./styles/settings.css";
import "./styles/ai.css";
import { createChatWidget } from "./ai/chatWidget.ts";
import { createSettingsView } from "./settings/settingsView.ts";
import { createEditorHost, languageForFilename, type EditorHost } from "./editor/editorHost.ts";
import { createTerminalHost, type TerminalHost } from "./terminal/terminalHost.ts";
import { createNotificationCentre } from "./notifications/notifications.ts";
import type { AdcodeApi, DirEntry, TerminalProfile } from "../shared/api.ts";

declare global {
  interface Window {
    readonly adcode: AdcodeApi;
  }
}

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`missing element: ${id}`);
  return found as T;
};

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

/* ── State ────────────────────────────────────────────────────────────── */

interface OpenTab {
  readonly path: string;
  readonly name: string;
  dirty: boolean;
}

const tabs: OpenTab[] = [];
let activePath: string | null = null;
let workspaceRoot: string | null = null;
let terminal: TerminalHost | null = null;
let theme: "light" | "dark" = "dark";

const editorHost: EditorHost = createEditorHost(el("editor-host"));

/* ── Settings ─────────────────────────────────────────────────────────── */

let settingsValues: Record<string, boolean | string> = {};
let serverProjections: Record<string, string> | null = null;

/** Everything a settings change has to reach. */
function applySettings(values: Record<string, boolean | string>): void {
  settingsValues = values;

  // §3: "Density is a setting, not a decision."
  const density = values["adcode.appearance.density"];
  document.documentElement.dataset["density"] = density === "compact" ? "compact" : "comfortable";

  editorHost.applySettings(values);
  syncTheme();
}

/* ── Theme ────────────────────────────────────────────────────────────── */

function syncTheme(): void {
  const preference = settingsValues["adcode.appearance.theme"];
  theme =
    preference === "light" || preference === "dark"
      ? preference
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

  document.documentElement.dataset["theme"] = theme;
  editorHost.applyTheme(theme);
  terminal?.applyTheme(theme);
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);

/* ── Tabs ─────────────────────────────────────────────────────────────── */

function renderTabs(): void {
  const host = el("tabs");
  host.replaceChildren();

  for (const tab of tabs) {
    const button = document.createElement("button");
    button.className = "tab";
    button.role = "tab";
    button.dataset["path"] = tab.path;
    button.dataset["dirty"] = String(tab.dirty);
    button.ariaSelected = String(tab.path === activePath);
    button.title = tab.path;

    const dot = document.createElement("span");
    dot.className = "tab-dirty";

    const label = document.createElement("span");
    label.textContent = tab.name;

    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "×";
    close.ariaLabel = `Close ${tab.name}`;
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(tab.path);
    });

    button.append(dot, label, close);
    button.addEventListener("click", () => activateTab(tab.path));
    host.append(button);
  }
}

function activateTab(path: string): void {
  activePath = path;
  editorHost.activate(path);
  el("editor-placeholder").hidden = true;

  const tab = tabs.find((t) => t.path === path);
  el("status-language").textContent = tab === undefined ? "" : languageForFilename(tab.name);

  renderTabs();
}

function closeTab(path: string): void {
  const index = tabs.findIndex((t) => t.path === path);
  if (index === -1) return;

  tabs.splice(index, 1);
  editorHost.close(path);

  if (activePath === path) {
    const next = tabs[index] ?? tabs[index - 1];
    if (next === undefined) {
      activePath = null;
      el("editor-placeholder").hidden = false;
      el("status-language").textContent = "";
      el("status-position").textContent = "Ln 1, Col 1";
    } else {
      activateTab(next.path);
      return;
    }
  }

  renderTabs();
}

async function openFile(path: string): Promise<void> {
  const existing = tabs.find((t) => t.path === path);
  if (existing !== undefined) {
    activateTab(path);
    return;
  }

  try {
    const file = await window.adcode.files.read(path);
    const name = basename(path);

    editorHost.open(path, file.text, languageForFilename(name));
    tabs.push({ path, name, dirty: false });
    activateTab(path);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "could not open file");
  }
}

async function saveActive(): Promise<void> {
  if (activePath === null) return;

  const text = editorHost.text(activePath);
  if (text === null) return;

  const result = await window.adcode.files.write(activePath, text);
  if (result.ok) {
    editorHost.markSaved(activePath);
    setStatus("Saved", 1200);
  } else {
    setStatus(result.reason ?? "save failed", 3000);
  }
}

/* ── File tree ────────────────────────────────────────────────────────── */

function makeRow(entry: DirEntry, depth: number): HTMLElement {
  const wrapper = document.createElement("div");

  const row = document.createElement("div");
  row.className = "tree-row";
  row.dataset["path"] = entry.path;
  row.style.paddingLeft = `${8 + depth * 10}px`;

  const twisty = document.createElement("span");
  twisty.className = "tree-twisty";
  twisty.textContent = entry.isDirectory ? "▶" : "";

  const name = document.createElement("span");
  name.className = "tree-name";
  name.textContent = entry.name;

  row.append(twisty, name);
  wrapper.append(row);

  if (entry.isDirectory) {
    const children = document.createElement("div");
    children.className = "tree-children";
    children.hidden = true;
    wrapper.append(children);

    row.addEventListener("click", async () => {
      const open = row.dataset["open"] === "true";

      if (open) {
        row.dataset["open"] = "false";
        children.hidden = true;
        return;
      }

      if (children.childElementCount === 0) {
        try {
          const entries = await window.adcode.workspace.list(entry.path);
          for (const child of entries) children.append(makeRow(child, depth + 1));
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "could not read folder");
          return;
        }
      }

      row.dataset["open"] = "true";
      children.hidden = false;
    });
  } else {
    row.addEventListener("click", () => {
      for (const selected of document.querySelectorAll<HTMLElement>('.tree-row[aria-selected="true"]')) {
        selected.ariaSelected = "false";
      }
      row.ariaSelected = "true";
      void openFile(entry.path);
    });
  }

  return wrapper;
}

async function renderTree(root: string): Promise<void> {
  const host = el("filetree");
  host.replaceChildren();

  try {
    const entries = await window.adcode.workspace.list(root);
    for (const entry of entries) host.append(makeRow(entry, 0));
  } catch (error) {
    const message = document.createElement("p");
    message.className = "empty-hint";
    message.textContent = error instanceof Error ? error.message : "could not read folder";
    host.append(message);
  }
}

async function openFolder(): Promise<void> {
  const opened = await window.adcode.workspace.open();
  if (opened === null) return;

  workspaceRoot = opened.root;
  chat.setWorkspace(opened.root);
  el("sidebar-title").textContent = opened.name;
  el("status-workspace").textContent = opened.name;
  el("titlebar-title").textContent = `${opened.name} — ADCode`;

  await renderTree(opened.root);
}

/* ── Terminal ─────────────────────────────────────────────────────────── */

async function toggleTerminal(): Promise<void> {
  const panel = el("panel");

  if (!panel.hidden) {
    panel.hidden = true;
    editorHost.layout();
    editorHost.focus();
    return;
  }

  panel.hidden = false;

  if (terminal === null) {
    const select = el<HTMLSelectElement>("profile-select");
    try {
      terminal = await createTerminalHost(el("terminal-host"), {
        ...(select.value === "" ? {} : { profileId: select.value }),
        ...(workspaceRoot === null ? {} : { cwd: workspaceRoot }),
        theme,
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "could not start terminal", 4000);
      panel.hidden = true;
      return;
    }
  }

  editorHost.layout();
  terminal.fit();
  terminal.focus();
}

/* ── Status ───────────────────────────────────────────────────────────── */

let statusTimer: number | undefined;

function setStatus(message: string, clearAfterMs?: number): void {
  const node = el("status-dirty");
  node.textContent = message;

  if (statusTimer !== undefined) window.clearTimeout(statusTimer);
  if (clearAfterMs !== undefined) {
    statusTimer = window.setTimeout(() => {
      node.textContent = "";
    }, clearAfterMs);
  }
}

/* ── Wiring ───────────────────────────────────────────────────────────── */

editorHost.onCursorChange((line, column) => {
  el("status-position").textContent = `Ln ${line}, Col ${column}`;
});

editorHost.onDirtyChange((path, dirty) => {
  const tab = tabs.find((t) => t.path === path);
  if (tab === undefined) return;

  tab.dirty = dirty;
  renderTabs();
});

editorHost.onSaveRequested(() => void saveActive());

el("open-folder").addEventListener("click", () => void openFolder());
el("open-settings").addEventListener("click", () => settingsView.toggle());
el("panel-close").addEventListener("click", () => void toggleTerminal());

for (const activity of document.querySelectorAll<HTMLElement>(".activity")) {
  activity.addEventListener("click", () => {
    for (const other of document.querySelectorAll<HTMLElement>(".activity")) {
      other.ariaSelected = String(other === activity);
    }
  });
}

document.querySelector<HTMLElement>('.activity[data-view="explorer"]')?.setAttribute("aria-selected", "true");

window.addEventListener("keydown", (event) => {
  const mod = event.ctrlKey || event.metaKey;

  if (mod && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveActive();
    return;
  }

  if (mod && event.key === "`") {
    event.preventDefault();
    void toggleTerminal();
    return;
  }

  if (mod && event.key.toLowerCase() === "o") {
    event.preventDefault();
    void openFolder();
    return;
  }

  if (mod && event.key === ",") {
    event.preventDefault();
    settingsView.toggle();
    return;
  }

  // §5.3: the chat widget is "summoned by keyboard shortcut".
  if (mod && event.key.toLowerCase() === "i") {
    event.preventDefault();
    chat.toggle();
  }
});

/* ── Sponsored notifications ──────────────────────────────────────────── */

const settingsView = createSettingsView({
  host: document.body,
  read: () => window.adcode.settings.read(),
  write: (id, value) => window.adcode.settings.write(id, value),
  reset: () => window.adcode.settings.reset(),
  projections: () => serverProjections,
  mcpConnection: () => window.adcode.memory.connection(),
});

window.adcode.settings.onChanged((values) => applySettings(values));

/* ── Assistant (§5.3) ─────────────────────────────────────────────────── */

const chat = createChatWidget({
  host: document.body,
  // Applying a proposal reopens the file so the user sees the result in the editor.
  openExternalPath: (path) => void openFile(path),
});

const notifications = createNotificationCentre(el("toast-layer"));

window.adcode.ads.onShow((toast) => notifications.showSponsored(toast));

window.adcode.ads.onEarnings((earnings) => {
  // A cached mirror of a server value (§1). The renderer never computes money.
  el("status-earnings").textContent = earnings.hasServerBalance
    ? `${earnings.availableLabel} earned`
    : "";
});

document.addEventListener("keydown", (event) => {
  // Escape dismisses a sponsored toast, matching every other transient surface.
  if (event.key === "Escape") notifications.dismissAll();
});

const resizeObserver = new ResizeObserver(() => {
  editorHost.layout();
  terminal?.fit();
});
resizeObserver.observe(el("editor-host"));
resizeObserver.observe(el("terminal-host"));

/* ── Boot ─────────────────────────────────────────────────────────────── */

async function boot(): Promise<void> {
  applySettings(await window.adcode.settings.read());

  // §1: reduce-motion follows the OS. Chromium's media query is the single source of
  // truth for it; the attribute just lets JS-driven animations read the same value.
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const syncMotion = (): void => {
    document.documentElement.dataset["reducedMotion"] = String(reduceMotion.matches);
  };
  reduceMotion.addEventListener("change", syncMotion);
  syncMotion();

  const profiles: TerminalProfile[] = await window.adcode.terminal.profiles();
  const select = el<HTMLSelectElement>("profile-select");
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.label;
    select.append(option);
  }

  const existing = await window.adcode.workspace.current();
  if (existing !== null) {
    workspaceRoot = existing.root;
    chat.setWorkspace(existing.root);
    el("sidebar-title").textContent = existing.name;
    el("status-workspace").textContent = existing.name;
    await renderTree(existing.root);
  }
}

void boot();
