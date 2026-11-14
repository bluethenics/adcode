/**
 * The settings screen.
 *
 * Brief §3: "Settings are inset-grouped lists of switches, organized by the six feature
 * groups in §4, with a search field at the top. Every toggle in §4 appears here. This
 * screen is where the 'turn anything off' promise is actually kept, so it deserves real
 * design attention rather than a generated form."
 *
 * Controls follow §3's vocabulary: an iOS switch for booleans, a segmented control for
 * two-to-four exclusive choices, inset-grouped lists throughout, and a sheet for the
 * screen itself.
 *
 * Rows whose feature is not built yet render disabled with a "Soon" pill rather than
 * being hidden. Hiding them would misrepresent the roster; showing them live would
 * misrepresent the build. Neither is worth doing to avoid an honest third state.
 */
import { helpForSetting } from "@adcode/help";
import type { McpConnectionInfo } from "../../shared/api.ts";
import { MCP_NODE_REQUIREMENT, mcpNodeNote } from "../../shared/mcpNode.ts";
import { copyText } from "../clipboard.ts";
import {
  GROUPS,
  searchSettings,
  type Setting,
  type SettingGroupId,
  type SettingValue,
} from "@adcode/settings";
import { Braces, ChartColumn, CircleArrowDown, Compass, GitBranch, Megaphone, Network, Palette, PenLine, RotateCcw, Sparkles, WandSparkles, type IconNode } from "lucide";
import { createIcon } from "../workbench/icons.ts";
import { createHelpButton, createHelpPopover } from "../help/helpPopover.ts";
import { themePicker } from "./themePicker.ts";

export interface SettingsView {
  readonly element: HTMLElement;
  shown(): void;
  hidden(): void;
  /**
   * Open scrolled to one row, with it briefly marked.
   *
   * The guide's "Open its setting" button is the caller. Landing on the settings screen
   * and then having to find the row you just read about is the gap this closes - and on a
   * screen with fifty-five rows, "it is in Editing somewhere" is not good enough.
   */
  openAt(settingId: string): void;
  isOpen(): boolean;
}

export interface SettingsViewDeps {
  /** Legacy construction option; modal Settings keeps its popover in its own subtree. */
  readonly overlayHost?: HTMLElement;
  /** The coordinator owns shell dismissal and focus restoration. */
  readonly onRequestClose: () => void;
  readonly read: () => Promise<Record<string, SettingValue>>;
  readonly write: (
    id: string,
    value: SettingValue,
  ) => Promise<Record<string, SettingValue>>;
  readonly reset: () => Promise<Record<string, SettingValue>>;
  /** How to connect an external agent to the shared memory (§5.2). */
  readonly mcpConnection?: () => Promise<McpConnectionInfo>;
}

/**
 * The MCP connection card.
 *
 * §5.2: "Write the connection instructions into the IDE's own onboarding - a user who
 * has to figure out MCP configuration by themselves will not do it, and the entire
 * feature dies there." So the exact command is shown, ready to copy, rather than
 * described in documentation the user would have to go and find.
 *
 * The command is only half of it. It runs on the user's own Node.js, which ADCode cannot
 * supply (`shared/mcpNode.ts`), so the card says so up front - a command that `claude mcp
 * add` accepts and then cannot start is exactly the dead end §5.2 warns about.
 */
function connectionCard(load: () => Promise<McpConnectionInfo>): HTMLElement {
  const card = document.createElement("div");
  card.className = "connection-card";

  const heading = document.createElement("div");
  heading.className = "settings-row-label";
  heading.textContent = "Connect an external agent";

  const explanation = document.createElement("p");
  explanation.className = "settings-row-description";
  explanation.textContent =
    "Claude Code, Codex, and anything else that speaks MCP can read and write this project's memory. Run this once, from the project folder.";

  const code = document.createElement("code");
  code.className = "connection-command";
  code.textContent = "Loading…";

  const actions = document.createElement("div");
  actions.className = "connection-actions";

  const copy = document.createElement("button");
  copy.className = "ghost-button";
  copy.textContent = "Copy";
  copy.addEventListener("click", () => {
    copy.disabled = true;
    void copyText(code.textContent ?? "").then((ok) => {
      copy.textContent = ok ? "Copied" : "Copy failed";
      window.setTimeout(() => {
        copy.textContent = "Copy";
        copy.disabled = false;
      }, 1400);
    });
  });

  const requirement = document.createElement("p");
  requirement.className = "settings-row-description";
  requirement.textContent = MCP_NODE_REQUIREMENT;

  // Why there is no command, or what is wrong with the Node.js it would run. A sentence, so
  // it wraps - the command block keeps everything on one line, which suits only a command.
  const problem = document.createElement("p");
  problem.className = "connection-problem";
  problem.setAttribute("role", "status");
  problem.hidden = true;

  const location = document.createElement("p");
  location.className = "settings-row-description";

  actions.append(copy);
  card.append(heading, explanation, requirement, code, actions, problem, location);

  void load().then((info) => {
    const note = info.available ? mcpNodeNote(info.node) : info.command;
    code.textContent = info.available ? info.command : "";
    code.hidden = !info.available;
    actions.hidden = !info.available;
    copy.disabled = !info.available;
    problem.textContent = note ?? "";
    problem.hidden = note === null;
    location.textContent =
      info.storePath === null
        ? ""
        : `Memories are stored as markdown in ${info.storePath}`;
  });

  return card;
}

function iosSwitch(
  checked: boolean,
  disabled: boolean,
  onChange: (next: boolean) => void,
): HTMLElement {
  const label = document.createElement("label");
  label.className = "ios-switch";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener("change", () => onChange(input.checked));

  const track = document.createElement("span");
  track.className = "ios-switch-track";
  const knob = document.createElement("span");
  knob.className = "ios-switch-knob";
  track.append(knob);

  label.append(input, track);
  return label;
}

function segmented(
  options: readonly {
    value: string;
    label: string;
    detail?: string | undefined;
  }[],
  current: string,
  disabled: boolean,
  onChange: (next: string) => void,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "segmented";
  group.setAttribute("role", "radiogroup");

  for (const option of options) {
    const button = document.createElement("button");
    button.className = "segment";
    button.type = "button";
    button.setAttribute("role", "radio");
    button.ariaChecked = String(option.value === current);
    button.disabled = disabled;

    const label = document.createElement("span");
    label.className = "segment-label";
    label.textContent = option.label;
    button.append(label);

    if (option.detail !== undefined) {
      const detail = document.createElement("span");
      detail.className = "segment-detail";
      detail.textContent = option.detail;
      button.append(detail);
    }

    button.addEventListener("click", () => onChange(option.value));
    group.append(button);
  }

  return group;
}

export interface SettingsTargetLifecycle {
  shown(read: () => Promise<void>): void;
  openAt(settingId: string): void;
  hidden(): void;
}

export function createSettingsTargetLifecycle(deps: {
  readonly render: () => void;
  readonly reveal: (settingId: string) => void;
}): SettingsTargetLifecycle {
  let active = false;
  let pendingTarget: string | null = null;
  let readGeneration = 0;

  const revealPendingTarget = (): void => {
    if (pendingTarget !== null) deps.reveal(pendingTarget);
  };

  return {
    shown(read): void {
      active = true;
      const generation = ++readGeneration;
      deps.render();
      revealPendingTarget();
      void read().then(() => {
        if (!active || generation !== readGeneration) return;
        deps.render();
        revealPendingTarget();
      });
    },
    openAt(settingId): void {
      pendingTarget = settingId;
      deps.render();
      revealPendingTarget();
    },
    hidden(): void {
      active = false;
      pendingTarget = null;
      readGeneration += 1;
    },
  };
}

/** One icon per section, from the same library as the rest of the app. */
const GROUP_ICONS: Record<SettingGroupId, IconNode> = {
  ads: Megaphone, appearance: Palette, editing: PenLine, formatting: WandSparkles, git: GitBranch,
  navigation: Compass, structure: Network, language: Braces, session: RotateCcw, updates: CircleArrowDown, ai: Sparkles, privacy: ChartColumn,
};
const LAST_GROUP = "adcode.settings.section";

/**
 * Which section the screen opens on: the one somebody last used, else the first.
 *
 * Reported 2026-10-27: one sheet of sixty-odd rows was "a huge scroll". Sections now sit in a
 * sidebar and one shows at a time; search still looks through every section at once.
 */
export function initialSettingsGroup(stored: string | null): SettingGroupId {
  return GROUPS.find((group) => group.id === stored)?.id ?? GROUPS[0]!.id;
}

export function createSettingsView(deps: SettingsViewDeps): SettingsView {
  let values: Record<string, SettingValue> = {};
  let query = "";
  let open = false;
  let activeGroup = initialSettingsGroup((() => { try { return localStorage.getItem(LAST_GROUP); } catch { return null; } })());

  const sheet = document.createElement("div");
  sheet.className = "settings-sheet";
  sheet.setAttribute("role", "region");
  sheet.setAttribute("aria-label", "Settings");

  const panel = document.createElement("div");
  panel.className = "settings-panel";

  const header = document.createElement("header");
  header.className = "settings-header";

  const title = document.createElement("h1");
  title.className = "settings-title";
  title.textContent = "Settings";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "settings-close";
  closeButton.textContent = "Close";
  closeButton.setAttribute("aria-label", "Close Settings");
  closeButton.title = "Close Settings";
  closeButton.addEventListener("click", () => deps.onRequestClose());

  const search = document.createElement("input");
  search.className = "settings-search";
  search.type = "search";
  search.placeholder = "Search settings";
  search.setAttribute("aria-label", "Search settings");
  search.addEventListener("input", () => {
    query = search.value;
    renderBody();
  });

  header.append(title, closeButton);

  const stickyHeader = document.createElement("div");
  stickyHeader.className = "settings-sticky-header";
  stickyHeader.append(header, search);

  const body = document.createElement("div");
  body.className = "settings-body";

  const nav = document.createElement("nav");
  nav.className = "settings-nav";
  nav.setAttribute("aria-label", "Settings sections");
  const navButtons = new Map<SettingGroupId, HTMLButtonElement>();
  for (const group of GROUPS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-nav-item";
    button.dataset["group"] = group.id;
    const name = document.createElement("span");
    name.className = "settings-nav-label";
    name.textContent = group.title;
    const count = document.createElement("span");
    count.className = "settings-nav-count";
    button.append(createIcon(GROUP_ICONS[group.id]), name, count);
    button.addEventListener("click", () => showGroup(group.id));
    navButtons.set(group.id, button);
    nav.append(button);
  }
  // Up and Down walk the sections, the way a sidebar list is expected to behave.
  nav.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const order = [...navButtons.values()];
    const at = order.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    order[(at + (event.key === "ArrowDown" ? 1 : order.length - 1)) % order.length]!.focus();
  });

  const layout = document.createElement("div");
  layout.className = "settings-layout";
  layout.append(nav, body);

  function showGroup(id: SettingGroupId): void {
    activeGroup = id;
    try { localStorage.setItem(LAST_GROUP, id); } catch { /* Storage off: the section is simply not remembered. */ }
    if (query !== "") { query = ""; search.value = ""; }
    renderBody();
    body.scrollTop = 0;
  }

  const footer = document.createElement("footer");
  footer.className = "settings-footer";

  const resetButton = document.createElement("button");
  resetButton.className = "danger-button";
  resetButton.textContent = "Reset all settings";
  resetButton.addEventListener("click", () => {
    void deps.reset().then((next) => {
      values = next;
      renderBody();
    });
  });

  /*
   * The build, in the footer.
   *
   * Here as well as on the welcome screen because these are the two moments someone needs it:
   * the welcome screen is where they notice the app, and Settings is where they look when
   * something is wrong and a bug report wants a version. Asked for on open rather than at
   * construction, so it is a fact about the running build rather than a value captured before
   * the main process was necessarily listening.
   */
  const about = document.createElement("p");
  about.className = "settings-about";
  about.textContent = "";

  footer.append(resetButton, about);
  panel.append(stickyHeader, layout, footer);

  // One popover for the whole screen, not one per row. It remains a descendant of the
  // modal dialog so the browser does not make it inert when promoting it to the top layer.
  const popover = createHelpPopover(panel);

  async function showVersion(): Promise<void> {
    if (about.textContent !== "") return;

    try {
      const info = await window.adcode.app.info();
      about.textContent = `ADCode ${info.version}`;
      // The runtime versions matter to whoever reads a bug report, and to nobody else - so
      // they are on the tooltip rather than taking a line of the footer.
      about.title = `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node} · ${info.platform}`;
    } catch {
      // A version that cannot be read costs the line, never the settings screen.
      about.textContent = "";
    }
  }
  sheet.append(panel);

  /*
   * Every change says whether it took. A write used to be fire-and-forget: a switch that
   * flipped but failed to save looked exactly like one that saved. The row now shows
   * "Saving…", then "Saved" for a moment, or "Not saved" until the next try.
   */
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function markSave(settingId: string, state: "saving" | "saved" | "failed"): void {
    const row = panel.querySelector<HTMLElement>(`.settings-row[data-setting-id="${CSS.escape(settingId)}"]`);
    const text = row?.querySelector<HTMLElement>(".settings-row-text");
    if (!row || !text) return;
    let badge = text.querySelector<HTMLElement>(".settings-save-state");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "settings-save-state";
      badge.setAttribute("role", "status");
      text.append(badge);
    }
    badge.dataset["state"] = state;
    badge.textContent = state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Not saved - try again";
    clearTimeout(saveTimers.get(settingId));
    if (state === "saved") saveTimers.set(settingId, setTimeout(() => badge?.remove(), 1600));
  }
  function save(settingId: string, value: SettingValue, rerender = false): void {
    markSave(settingId, "saving");
    deps.write(settingId, value).then((updated) => {
      values = updated;
      if (rerender) renderBody();
      markSave(settingId, "saved");
    }, () => {
      // The control moved because it was clicked, not because the value was stored. Rebuild
      // from what is actually on disk, then say it did not save - a switch that stays flipped
      // after a failed write claims something that is not true.
      renderBody();
      markSave(settingId, "failed");
    });
  }

  function rowFor(setting: Setting): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-row";
    row.dataset["settingId"] = setting.id;
    if (!setting.available) row.dataset["unavailable"] = "true";

    const text = document.createElement("div");
    text.className = "settings-row-text";

    const label = document.createElement("div");
    label.className = "settings-row-label";
    label.textContent = setting.label;

    if (!setting.available) {
      const pill = document.createElement("span");
      pill.className = "soon-pill";
      pill.textContent = "Soon";
      pill.title = "This feature is not built yet";
      label.append(pill);
    }

    /*
     * The `?`.
     *
     * Beside the label rather than at the end of the row, because at the end of the row is
     * where the control is, and a question mark next to a switch reads as a question about
     * whether to flip it. `@adcode/help` has an entry for every setting - a test fails the
     * build otherwise - so the `undefined` branch is unreachable in practice and is here
     * because a missing explanation must cost the button, never the row.
     */
    const help = helpForSetting(setting.id);
    if (help !== undefined) label.append(createHelpButton(help, popover));

    const description = document.createElement("div");
    description.className = "settings-row-description";
    description.textContent = setting.description;

    text.append(label, description);
    row.append(text);

    const current = values[setting.id] ?? setting.default;

    if (setting.kind === "boolean") {
      row.append(
        iosSwitch(current === true, !setting.available, (next) => {
          save(setting.id, next);
        }),
      );
    } else if (setting.kind === "text") {
      const field = document.createElement("textarea");
      field.className = "settings-text";
      field.rows = setting.multiline ? 3 : 1;
      field.placeholder = setting.placeholder;
      field.maxLength = setting.maxLength;
      field.disabled = !setting.available;
      field.value = String(current);
      field.setAttribute("aria-label", setting.label);

      /*
       * Written on blur rather than on input.
       *
       * Every keystroke here would be a disk write and, for the language-server row, a
       * round of stopping and starting subprocesses - so typing `zig: zls` would try to
       * launch `z`, then `zi`, then `zig`. Blur is when the user has finished saying it.
       */
      field.addEventListener("blur", () => {
        if (field.value === String(values[setting.id] ?? setting.default))
          return;

        save(setting.id, field.value);
      });

      row.classList.add("settings-row-stacked");
      row.append(field);
    } else if (setting.id === "adcode.appearance.theme") {
      /*
       * The one enum that is shown rather than listed.
       *
       * "Light" and "Dark" are guessable; "Midnight" is not, and neither is what
       * "System" resolves to on this machine. Four words in a segmented control ask
       * somebody to click each one to find out - which is fine once and irritating
       * every time after. Each card draws the window it produces instead.
       */
      row.classList.add("settings-row-stacked");
      row.append(
        themePicker(
          setting.options,
          String(current),
          !setting.available,
          (next) => {
            save(setting.id, next, true);
          },
        ),
      );
    } else {
      row.classList.add("settings-row-stacked");
      row.append(
        segmented(setting.options, String(current), !setting.available, (next) => {
          save(setting.id, next, true);
        }),
      );
    }

    return row;
  }

  function renderBody(): void {
    body.replaceChildren();

    const found = searchSettings(query);
    const matches = new Set(found.map((setting) => setting.id));
    const searching = query.trim().length > 0;
    let shown = 0;
    layout.dataset["searching"] = String(searching);
    // The sidebar says where the matches are while searching, and which section is open otherwise.
    for (const [id, button] of navButtons) {
      const hits = found.filter((setting) => setting.group === id).length;
      const count = button.querySelector<HTMLElement>(".settings-nav-count")!;
      count.textContent = searching && hits > 0 ? String(hits) : "";
      button.dataset["empty"] = String(searching && hits === 0);
      if (!searching && id === activeGroup) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }

    for (const group of GROUPS) {
      if (!searching && group.id !== activeGroup) continue;
      const inGroup = found.filter(
        (setting) => setting.group === group.id,
      );
      if (inGroup.length === 0) continue;

      const section = document.createElement("section");
      section.className = "settings-group";

      const heading = document.createElement("h2");
      heading.className = "settings-group-title";
      heading.textContent = group.title;

      const caption = document.createElement("p");
      caption.className = "settings-group-caption";
      caption.textContent = group.caption;

      const list = document.createElement("div");
      list.className = "inset-list";

      for (const setting of inGroup) {
        if (!matches.has(setting.id)) continue;
        list.append(rowFor(setting));
        shown += 1;
      }

      section.append(heading, caption, list);

      // The AI group carries the onboarding §5.2 requires, but only when the user is not
      // filtering - a search for "minimap" should not surface MCP setup.
      if (
        group.id === "ai" &&
        deps.mcpConnection !== undefined &&
        query.trim().length === 0
      ) {
        section.append(connectionCard(deps.mcpConnection));
      }

      body.append(section);
    }

    if (shown === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-hint";
      empty.textContent = `Nothing matches “${query}”.`;
      body.append(empty);
    }
  }

  const targetLifecycle = createSettingsTargetLifecycle({
    render: renderBody,
    reveal(settingId): void {
      const row = body.querySelector(
        `[data-setting-id="${CSS.escape(settingId)}"]`,
      );
      if (!(row instanceof HTMLElement)) return;

      row.scrollIntoView({
        block: "center",
        behavior:
          document.documentElement.dataset["reducedMotion"] === "true"
            ? "auto"
            : "smooth",
      });
      row.dataset["highlight"] = "true";
      row.tabIndex = -1;
      row.focus({ preventScroll: true });
      window.setTimeout(() => delete row.dataset["highlight"], 1600);
    },
  });

  const api: SettingsView = {
    element: sheet,
    shown(): void {
      if (open) return;
      open = true;

      void showVersion();
      targetLifecycle.shown(async () => {
        values = await deps.read();
      });

      sheet.dataset["state"] = "open";
      search.focus({ preventScroll: true });
    },

    openAt(settingId: string): void {
      // Clearing any search first, or the row being jumped to may be filtered out - and a
      // jump that lands nowhere is worse than not offering one.
      query = "";
      search.value = "";
      const group = searchSettings("").find((setting) => setting.id === settingId)?.group;
      if (group !== undefined) activeGroup = group;
      targetLifecycle.openAt(settingId);
    },

    hidden(): void {
      open = false;
      targetLifecycle.hidden();
      popover.close();
      delete sheet.dataset["state"];
    },

    isOpen: () => open,
  };

  return api;
}
