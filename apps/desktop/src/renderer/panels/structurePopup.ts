/**
 * Structure, as a popup rather than a sidebar view.
 *
 * It started in the sidebar and does not belong there. A sidebar view costs you the
 * explorer for as long as it is open, it is 240 pixels wide when the thing it is showing is
 * a *tree with a second column of relations*, and it is the wrong shape for the two-column
 * reading this is: name on the left, what it does on the right. A popup can be six hundred
 * pixels wide, can be dismissed with Escape, and takes nothing away while it is up.
 *
 * Two tabs, because there are two questions and they arrive at different moments:
 *
 * - **This file** - what is in the thing I am looking at. The outline and its relations.
 * - **This project** - what are all these folders. Asked once, on the first morning, and
 *   never answered by any editor.
 *
 * The popup owns the frame, the tabs and the keyboard; the two panels own their contents.
 * It deliberately knows nothing about outlines or folders beyond which element to show.
 */
import type { ProjectMap } from "./projectMap.ts";
import type { StructurePanel } from "./structurePanel.ts";
import { ICON, createIcon } from "../workbench/icons.ts";

export type StructureTab = "file" | "project";

export interface StructurePopupDeps {
  readonly filePanel: StructurePanel;
  readonly projectMap: ProjectMap;
  /** Focus goes back here on close - the editor, normally. */
  readonly restoreFocus: () => void;
  /**
   * The activity-bar button that opens this, if there is one.
   *
   * Owned here rather than by whoever wires the click, because this module is the only
   * thing that knows every way the popup can close - Escape, the backdrop, the close
   * button, a second press of the shortcut. A button whose `aria-expanded` is set by the
   * opener and never cleared tells a screen reader the popup is still up long after it
   * has gone.
   */
  readonly anchor?: HTMLElement;
}

export interface StructurePopup {
  /** Open on a tab, or toggle shut if it is already open on that tab. */
  toggle(tab?: StructureTab): void;
  open(tab?: StructureTab): void;
  close(): void;
  isOpen(): boolean;
}

export function createStructurePopup(host: HTMLElement, deps: StructurePopupDeps): StructurePopup {
  const dialog = document.createElement("dialog");
  dialog.className = "structure-popup";

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
  host.append(dialog);

  let current: StructureTab = "file";

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
    current = tab;

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

  close.addEventListener("click", () => api.close());

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    api.close();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) api.close();
  });

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

  const api: StructurePopup = {
    open(tab = "file"): void {
      if (!dialog.open) dialog.showModal();
      deps.anchor?.setAttribute("aria-expanded", "true");
      show(tab);
    },

    close(): void {
      if (dialog.open) dialog.close();
      deps.anchor?.setAttribute("aria-expanded", "false");
      deps.restoreFocus();
    },

    isOpen: () => dialog.open,

    toggle(tab = "file"): void {
      // Toggling to the tab you are already on closes it; toggling to the other one
      // switches. Anything else makes the shortcut feel like it did not work.
      if (dialog.open && current === tab) {
        api.close();
        return;
      }

      api.open(tab);
    },
  };

  return api;
}
