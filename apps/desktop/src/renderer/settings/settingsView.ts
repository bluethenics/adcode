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
import {
  GROUPS,
  searchSettings,
  type Setting,
  type SettingValue,
} from "@adcode/settings";

export interface SettingsView {
  open(): void;
  close(): void;
  isOpen(): boolean;
  toggle(): void;
}

export interface SettingsViewDeps {
  readonly host: HTMLElement;
  readonly read: () => Promise<Record<string, SettingValue>>;
  readonly write: (id: string, value: SettingValue) => Promise<Record<string, SettingValue>>;
  readonly reset: () => Promise<Record<string, SettingValue>>;
  /** Projected hourly earnings per frequency preset, from the server (deviation D1). */
  readonly projections?: () => Record<string, string> | null;
  /** How to connect an external agent to the shared memory (§5.2). */
  readonly mcpConnection?: () => Promise<{ command: string; storePath: string | null; available: boolean }>;
}

/**
 * The MCP connection card.
 *
 * §5.2: "Write the connection instructions into the IDE's own onboarding - a user who
 * has to figure out MCP configuration by themselves will not do it, and the entire
 * feature dies there." So the exact command is shown, ready to copy, rather than
 * described in documentation the user would have to go and find.
 */
function connectionCard(
  load: () => Promise<{ command: string; storePath: string | null; available: boolean }>,
): HTMLElement {
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
    void navigator.clipboard.writeText(code.textContent ?? "").then(() => {
      copy.textContent = "Copied";
      window.setTimeout(() => (copy.textContent = "Copy"), 1400);
    });
  });

  const location = document.createElement("p");
  location.className = "settings-row-description";

  actions.append(copy);
  card.append(heading, explanation, code, actions, location);

  void load().then((info) => {
    code.textContent = info.command;
    copy.disabled = !info.available;
    location.textContent =
      info.storePath === null ? "" : `Memories are stored as markdown in ${info.storePath}`;
  });

  return card;
}

function iosSwitch(checked: boolean, disabled: boolean, onChange: (next: boolean) => void): HTMLElement {
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
  options: readonly { value: string; label: string; detail?: string | undefined }[],
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

export function createSettingsView(deps: SettingsViewDeps): SettingsView {
  let values: Record<string, SettingValue> = {};
  let query = "";
  let open = false;

  const sheet = document.createElement("div");
  sheet.className = "settings-sheet";
  sheet.hidden = true;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Settings");

  const panel = document.createElement("div");
  panel.className = "settings-panel";

  const header = document.createElement("header");
  header.className = "settings-header";

  const title = document.createElement("h1");
  title.className = "settings-title";
  title.textContent = "Settings";

  const closeButton = document.createElement("button");
  closeButton.className = "ghost-button";
  closeButton.textContent = "Done";
  closeButton.addEventListener("click", () => api.close());

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

  const body = document.createElement("div");
  body.className = "settings-body";

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
  panel.append(header, search, body, footer);

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

  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) api.close();
  });

  function rowFor(setting: Setting): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-row";
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

    const description = document.createElement("div");
    description.className = "settings-row-description";
    description.textContent = setting.description;

    text.append(label, description);
    row.append(text);

    const current = values[setting.id] ?? setting.default;

    if (setting.kind === "boolean") {
      row.append(
        iosSwitch(current === true, !setting.available, (next) => {
          void deps.write(setting.id, next).then((updated) => {
            values = updated;
          });
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
        if (field.value === String(values[setting.id] ?? setting.default)) return;

        void deps.write(setting.id, field.value).then((updated) => {
          values = updated;
        });
      });

      row.classList.add("settings-row-stacked");
      row.append(field);
    } else {
      // §8.1: show projected hourly earnings beside each frequency option. The figure is
      // computed by the server and selected here - the client never multiplies money.
      const projections = setting.id === "adcode.ads.frequency" ? (deps.projections?.() ?? null) : null;

      const options = setting.options.map((option) => ({
        value: option.value,
        label: option.label,
        detail:
          projections !== null && projections[option.value] !== undefined
            ? `${projections[option.value]}/hr`
            : option.detail,
      }));

      row.classList.add("settings-row-stacked");
      row.append(
        segmented(options, String(current), !setting.available, (next) => {
          void deps.write(setting.id, next).then((updated) => {
            values = updated;
            renderBody();
          });
        }),
      );
    }

    return row;
  }

  function renderBody(): void {
    body.replaceChildren();

    const matches = new Set(searchSettings(query).map((setting) => setting.id));
    let shown = 0;

    for (const group of GROUPS) {
      const inGroup = searchSettings(query).filter((setting) => setting.group === group.id);
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
      if (group.id === "ai" && deps.mcpConnection !== undefined && query.trim().length === 0) {
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

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      api.close();
    }
  };

  const api: SettingsView = {
    open(): void {
      if (open) return;
      open = true;

      void showVersion();
      void deps.read().then((next) => {
        values = next;
        renderBody();
      });

      sheet.hidden = false;
      // Two frames so the sheet has a laid-out start state to transition from.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          sheet.dataset["state"] = "open";
          search.focus();
        });
      });

      document.addEventListener("keydown", onKeydown);
    },

    close(): void {
      if (!open) return;
      open = false;

      delete sheet.dataset["state"];
      document.removeEventListener("keydown", onKeydown);

      window.setTimeout(() => {
        if (!open) sheet.hidden = true;
      }, 220);
    },

    isOpen: () => open,

    toggle(): void {
      if (open) api.close();
      else api.open();
    },
  };

  deps.host.append(sheet);
  return api;
}
