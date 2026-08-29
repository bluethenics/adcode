/**
 * The ADCode Guide.
 *
 * Help menus in editors are almost always a list of links to a website. This one is the
 * manual, in the window, offline, and searchable - because the moment somebody wants to
 * know what a feature does is the moment they are looking at it, and sending them to a
 * browser is how that question goes unanswered.
 *
 * It is built from the same `@adcode/help` catalogue as the `?` popovers on the settings
 * rows and the website's docs pages. One text, three renderings; the alternative was three
 * texts that disagree by the second release.
 *
 * The shape deliberately matches the settings sheet - same search field at the top, same
 * group order, same inset cards - so the two screens feel like two views of one thing,
 * which is what they are.
 */
import {
  helpForGroup,
  helpGroups,
  relatedTo,
  searchHelp,
  type HelpEntry,
  type HelpGroupId,
} from "@adcode/help";

export interface HelpGuide {
  open(): void;
  /** Open scrolled to one entry, as the "Learn more" links on settings rows do. */
  openAt(entryId: string): void;
  close(): void;
  isOpen(): boolean;
  toggle(): void;
}

export interface HelpGuideDeps {
  readonly host: HTMLElement;
  /** Run the catalogue's primary safe route for this feature. */
  readonly openFeature: (entryId: string) => void;
  /**
   * Open the settings screen at a row.
   *
   * The guide explains what a thing does; the settings screen is where it is switched on.
   * Reading the first and then hunting the second is the gap this closes.
   */
  readonly openSetting: (settingId: string) => void;
  /** How to render an accelerator for this platform, so the keys shown are the real ones. */
  readonly formatShortcut: (accelerator: string) => string;
}

/** Headings for our own groups; the settings groups supply their own titles. */
const GROUP_TITLES: Readonly<Record<string, string>> = {
  ads: "Ads & Earnings",
  appearance: "Appearance",
  editing: "Editing",
  formatting: "Formatting",
  git: "Git",
  navigation: "Navigation",
  language: "Language",
  session: "Session",
  updates: "Updates",
  ai: "AI",
  workbench: "The workbench",
  account: "Account & earnings",
  gestures: "Files and gestures",
};

const titleFor = (group: HelpGroupId): string => GROUP_TITLES[group] ?? group;

export function createHelpGuide(deps: HelpGuideDeps): HelpGuide {
  let open = false;
  let query = "";

  const sheet = document.createElement("div");
  sheet.className = "settings-sheet help-sheet";
  sheet.hidden = true;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "ADCode Guide");

  const panel = document.createElement("div");
  panel.className = "settings-panel";

  const header = document.createElement("header");
  header.className = "settings-header";

  const title = document.createElement("h1");
  title.className = "settings-title";
  title.textContent = "ADCode Guide";

  const closeButton = document.createElement("button");
  closeButton.className = "ghost-button";
  closeButton.textContent = "Done";
  closeButton.addEventListener("click", () => api.close());

  header.append(title, closeButton);

  const search = document.createElement("input");
  search.className = "settings-search";
  search.type = "search";
  search.placeholder = "Search for anything ADCode does";
  search.setAttribute("aria-label", "Search the guide");
  search.addEventListener("input", () => {
    query = search.value;
    render();
  });

  const lede = document.createElement("p");
  lede.className = "help-lede";
  lede.textContent =
    "Every feature, in plain English. Search by what it does if you do not know what it is called.";

  const body = document.createElement("div");
  body.className = "settings-body";

  panel.append(header, search, lede, body);
  sheet.append(panel);

  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) api.close();
  });

  function cardFor(entry: HelpEntry): HTMLElement {
    const card = document.createElement("article");
    card.className = "help-card";
    card.id = `help-${entry.id}`;

    const heading = document.createElement("h3");
    heading.className = "help-card-title";
    heading.textContent = entry.title;

    if (entry.shortcut !== undefined) {
      const keys = document.createElement("kbd");
      keys.className = "help-card-keys";
      keys.textContent = deps.formatShortcut(entry.shortcut);
      heading.append(keys);
    }

    const plain = document.createElement("p");
    plain.className = "help-card-plain";
    plain.textContent = entry.plain;

    const why = document.createElement("p");
    why.className = "help-card-detail";
    why.textContent = entry.why;

    const how = document.createElement("p");
    how.className = "help-card-detail";
    how.textContent = entry.how;

    card.append(heading, plain, why, how);

    const footer = document.createElement("div");
    footer.className = "help-card-footer";

    const openFeature = document.createElement("button");
    openFeature.type = "button";
    openFeature.className = "ghost-button help-card-jump";
    openFeature.textContent = "Open";
    openFeature.addEventListener("click", () => {
      api.close();
      deps.openFeature(entry.id);
    });
    footer.append(openFeature);

    /*
     * Only the first setting gets a button.
     *
     * An entry owns at most one settings row now, but the type allows several, and three
     * near-identical buttons would be a worse answer to that than one that lands the reader
     * on the right screen - where the other rows are visible anyway.
     */
    const [settingId] = entry.settingIds;
    if (settingId !== undefined) {
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "ghost-button help-card-jump";
      jump.textContent = "Open its setting";
      jump.addEventListener("click", () => {
        api.close();
        deps.openSetting(settingId);
      });
      footer.append(jump);
    }

    for (const related of relatedTo(entry)) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "help-card-related";
      link.textContent = related.title;
      link.addEventListener("click", () => {
        // Clearing the search first: a related entry that the current query filters out
        // would otherwise be scrolled to and not be there.
        query = "";
        search.value = "";
        render();
        scrollTo(related.id);
      });
      footer.append(link);
    }

    if (footer.childElementCount > 0) card.append(footer);
    return card;
  }

  function scrollTo(entryId: string): void {
    const card = body.querySelector(`#help-${CSS.escape(entryId)}`);
    if (!(card instanceof HTMLElement)) return;

    card.scrollIntoView({ block: "center", behavior: "smooth" });
    card.dataset["highlight"] = "true";
    window.setTimeout(() => delete card.dataset["highlight"], 1600);
  }

  function render(): void {
    body.replaceChildren();

    const matches = new Set(searchHelp(query).map((entry) => entry.id));
    let shown = 0;

    for (const group of helpGroups()) {
      const inGroup = helpForGroup(group).filter((entry) => matches.has(entry.id));
      if (inGroup.length === 0) continue;

      const section = document.createElement("section");
      section.className = "settings-group";

      const heading = document.createElement("h2");
      heading.className = "settings-group-title";
      heading.textContent = titleFor(group);
      section.append(heading);

      for (const entry of inGroup) {
        section.append(cardFor(entry));
        shown += 1;
      }

      body.append(section);
    }

    if (shown === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-hint";
      empty.textContent = `Nothing in the guide matches “${query}”.`;
      body.append(empty);
    }
  }

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      api.close();
    }
  };

  function reveal(focusSearch: boolean): void {
    sheet.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sheet.dataset["state"] = "open";
        if (focusSearch) search.focus();
      });
    });

    document.addEventListener("keydown", onKeydown);
  }

  const api: HelpGuide = {
    open(): void {
      if (open) return;
      open = true;

      query = "";
      search.value = "";
      render();
      reveal(true);
    },

    openAt(entryId: string): void {
      const wasOpen = open;
      open = true;

      query = "";
      search.value = "";
      render();
      if (!wasOpen) reveal(false);

      // After the sheet's opening transition, or the scroll lands on a panel that is still
      // sliding in and ends up somewhere else entirely.
      window.setTimeout(() => scrollTo(entryId), wasOpen ? 0 : 260);
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
