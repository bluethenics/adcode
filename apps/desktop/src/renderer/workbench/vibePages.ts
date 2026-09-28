/**
 * Vibe's centre: one page at a time - Chat, Agents or Tools.
 *
 * Pages are hidden, never destroyed, so switching back to Chat never reloads a streaming
 * conversation and the Agents board keeps its scroll position. Everything that is not a page
 * (Changes, Preview, the project overview) opens as a floating panel over whichever page is
 * showing, so nothing ever docks on the right.
 */
import { VIBE_PAGES, type VibePage } from "./vibeSidebarModel.ts";

export interface VibePages {
  readonly element: HTMLElement;
  /** Where a page's content mounts. */
  host(page: VibePage): HTMLElement;
  show(page: VibePage): void;
  current(): VibePage;
  onChange(listener: (page: VibePage) => void): void;
}

export function createVibePages(): VibePages {
  const element = document.createElement("div");
  element.className = "vibe-pages";
  const hosts = new Map<VibePage, HTMLElement>();
  for (const page of VIBE_PAGES) {
    const section = document.createElement("section");
    section.className = "vibe-page";
    section.id = `vibe-page-${page.id}`;
    section.dataset["page"] = page.id;
    section.setAttribute("aria-label", page.label);
    section.hidden = page.id !== "chat";
    hosts.set(page.id, section);
    element.append(section);
  }
  let current: VibePage = "chat";
  const listeners: ((page: VibePage) => void)[] = [];
  document.body.dataset["vibePage"] = current;

  return {
    element,
    host: (page) => hosts.get(page)!,
    show(page): void {
      if (page === current) return;
      current = page;
      for (const [id, section] of hosts) section.hidden = id !== page;
      document.body.dataset["vibePage"] = page;
      for (const listener of listeners) listener(page);
    },
    current: () => current,
    onChange(listener): void {
      listeners.push(listener);
    },
  };
}
