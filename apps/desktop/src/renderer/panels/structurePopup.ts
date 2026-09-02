/**
 * Structure content for an activity-anchored popup shell.
 *
 * The workbench owns disclosure, anchoring, focus and responsive behavior. This module owns
 * only the Structure content and its local keyboard navigation.
 *
 * Two tabs, because there are two questions and they arrive at different moments:
 *
 * - **This file** - what is in the thing I am looking at. The outline and its relations.
 * - **This project** - what are all these folders. Asked once, on the first morning, and
 *   never answered by any editor.
 *
 * The view owns the tabs and their keyboard behavior; the two panels own their contents.
 * It deliberately knows nothing about outlines or folders beyond which element to show.
 */
import type { ProjectMap } from "./projectMap.ts";
import type { StructurePanel } from "./structurePanel.ts";
import { ICON, createIcon } from "../workbench/icons.ts";

export type StructureTab = "file" | "project";

export interface StructurePopupDeps {
  readonly filePanel: StructurePanel;
  readonly projectMap: ProjectMap;
  /** Used only by the visible close button; the workbench shell owns all other dismissal. */
  readonly onRequestClose: () => void;
}

export interface AnchoredTool {
  readonly element: HTMLElement;
  shown(): void;
  hidden(): void;
  isOpen(): boolean;
}

export interface StructurePopup extends AnchoredTool {
  /** Select a tab, or request dismissal if that tab is already visible. */
  toggle(tab?: StructureTab): void;
  open(tab?: StructureTab): void;
  /**
   * `adcode.navigation.outline`.
   *
   * Off hides the file tab rather than emptying it. An outline switched off should look
   * like a feature that is not there, not like one that failed to find anything.
   */
  setOutlineEnabled(enabled: boolean): void;
}

export function createStructurePopup(deps: StructurePopupDeps): StructurePopup {
  const dialog = document.createElement("section");
  dialog.className = "structure-popup";
  dialog.setAttribute("role", "region");
  dialog.setAttribute("aria-label", "Structure browser");

  const card = document.createElement("div");
  card.className = "structure-popup-card";

  const header = document.createElement("header");
  header.className = "structure-popup-header";

  const tabs = document.createElement("div");
  tabs.className = "structure-tabs";
  tabs.setAttribute("role", "tablist");

  const fileTab = tabButton("This file", "file");
  const projectTab = tabButton("This project", "project");
  tabs.append(fileTab, projectTab);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-button structure-popup-close";
  close.title = "Close (Esc)";
  close.setAttribute("aria-label", "Close");
  close.append(createIcon(ICON.close));

  header.append(tabs, close);

  const body = document.createElement("div");
  body.className = "structure-popup-body";
  body.append(deps.filePanel.element, deps.projectMap.element);

  card.append(header, body);
  dialog.append(card);

  let current: StructureTab = "file";
  let visible = false;

  function tabButton(label: string, tab: StructureTab): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "structure-tab";
    button.textContent = label;
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => show(tab));
    return button;
  }

  function show(tab: StructureTab): void {
    // The project map is always available; the outline is the half with a switch.
    current = tab === "file" && !outlineEnabled ? "project" : tab;
    tab = current;

    fileTab.ariaSelected = String(tab === "file");
    projectTab.ariaSelected = String(tab === "project");

    deps.filePanel.element.hidden = tab !== "file";
    deps.projectMap.element.hidden = tab !== "project";

    /*
     * Each tab re-reads on the way in.
     *
     * The file's outline is cheap and always current. The project map is a directory read,
     * and doing it on open rather than keeping it live is what stops this feature from
     * touching the disk while somebody is typing.
     */
    if (tab === "file") {
      deps.filePanel.render();
      deps.filePanel.focus();
    } else {
      void deps.projectMap.refresh();
    }
  }

  close.addEventListener("click", deps.onRequestClose);

  // Left and right walk the tabs, which is what a tablist is supposed to do and what
  // anybody who has used one will try.
  dialog.addEventListener("keydown", (event) => {
    if (event.target !== fileTab && event.target !== projectTab) return;

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = current === "file" ? "project" : "file";
      show(next);
      (next === "file" ? fileTab : projectTab).focus();
    }
  });

  let outlineEnabled = true;

  const api: StructurePopup = {
    element: dialog,

    setOutlineEnabled(enabled: boolean): void {
      outlineEnabled = enabled;
      fileTab.hidden = !enabled;

      // Already looking at the tab that just disappeared.
      if (!enabled && current === "file") show("project");
    },

    open(tab = "file"): void {
      show(tab);
    },

    shown(): void {
      visible = true;
      show(current);
    },

    hidden(): void {
      visible = false;
    },

    isOpen: () => visible,

    toggle(tab = "file"): void {
      // Toggling to the tab you are already on closes it; toggling to the other one
      // switches. Anything else makes the shortcut feel like it did not work.
      if (visible && current === tab) {
        deps.onRequestClose();
        return;
      }

      api.open(tab);
    },
  };

  return api;
}
