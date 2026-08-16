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

  footer.append(resetButton);
  panel.append(header, search, body, footer);
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
