/**
 * Help > Open Source Licences.
 *
 * A `<dialog>` opened with `showModal`, like What's New: the top layer, Escape and a focus
 * trap, none of them hand-written. It reuses that sheet's card classes so the two cannot
 * drift apart; only the tab strip and the text pane are its own.
 *
 * Licence text is set as text, never as HTML. Most of it comes from third-party packages,
 * and a licence file must never be able to run script inside the editor.
 */
import type { LicenceDocuments } from "../../shared/api.ts";
import { ICON, createIcon } from "../workbench/icons.ts";
import { REPOSITORY_URL, licenceTabs, type LicenceTab } from "./licencesModel.ts";

export interface LicencesSheet {
  open(documents: LicenceDocuments): void;
  close(): void;
  isOpen(): boolean;
}

export function createLicencesSheet(host: HTMLElement): LicencesSheet {
  const dialog = document.createElement("dialog");
  dialog.className = "whats-new-dialog licences-dialog";
  dialog.setAttribute("aria-label", "Open Source Licences");

  const card = document.createElement("div");
  card.className = "whats-new-card";

  const header = document.createElement("header");
  header.className = "whats-new-header";

  const title = document.createElement("h2");
  title.className = "whats-new-heading-main";
  title.textContent = "Open source licences";

  const subtitle = document.createElement("p");
  subtitle.className = "whats-new-subtitle";
  subtitle.textContent = `ADCode is open source under the Apache License 2.0. Source: ${REPOSITORY_URL}`;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-button whats-new-close";
  close.title = "Close";
  close.setAttribute("aria-label", "Close Open Source Licences");
  close.append(createIcon(ICON.close));
  close.addEventListener("click", () => dialog.close());

  const titles = document.createElement("div");
  titles.className = "whats-new-titles";
  titles.append(title, subtitle);
  header.append(titles, close);

  const tabList = document.createElement("div");
  tabList.className = "licences-tabs";
  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-label", "Licence documents");

  const text = document.createElement("pre");
  text.className = "licences-text";
  text.setAttribute("role", "tabpanel");
  text.tabIndex = 0;

  card.append(header, tabList, text);
  dialog.append(card);
  host.append(dialog);

  let tabs: readonly LicenceTab[] = [];
  let buttons: HTMLButtonElement[] = [];

  function select(index: number, focus: boolean): void {
    const tab = tabs[index];
    if (tab === undefined) return;

    buttons.forEach((button, at) => {
      const selected = at === index;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    text.textContent = tab.text;
    text.setAttribute("aria-label", tab.label);
    text.scrollTop = 0;
    if (focus) buttons[index]?.focus();
  }

  function render(): void {
    buttons = tabs.map((tab, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "licences-tab";
      button.setAttribute("role", "tab");
      button.dataset["tab"] = tab.id;
      button.textContent = tab.label;
      button.addEventListener("click", () => select(index, false));
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        select((index + step + tabs.length) % tabs.length, true);
      });
      return button;
    });
    tabList.replaceChildren(...buttons);
  }

  return {
    open(documents: LicenceDocuments): void {
      tabs = licenceTabs(documents);
      render();
      select(0, false);
      if (!dialog.open) dialog.showModal();
      buttons[0]?.focus();
    },

    close(): void {
      if (dialog.open) dialog.close();
    },

    isOpen(): boolean {
      return dialog.open;
    },
  };
}
