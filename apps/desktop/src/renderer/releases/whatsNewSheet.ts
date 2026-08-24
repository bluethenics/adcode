/**
 * Every release note this build has, in one scrollable list.
 *
 * The counterpart to the card: the card is what ADCode says unasked and is therefore kept
 * to one version and four lines, while this is what somebody gets when they go looking.
 * It is reachable from Help whether or not the card is switched on, which is what makes
 * turning the card off a real choice rather than a way to lose information.
 *
 * A `<dialog>` opened with `showModal`, for the reasons in popups.css: the top layer,
 * Escape, and a focus trap, none of them hand-written.
 *
 * Note bodies are rendered as text, never as HTML. They come from a server, and the one
 * thing a release note must never be able to do is run script inside the editor.
 */
import { releasesInBuild } from "@adcode/release";
import type { Release } from "@adcode/release";
import type { ReleaseAnnouncement, ReleaseNote } from "../../shared/api.ts";
import { ICON, createIcon } from "../workbench/icons.ts";

export interface WhatsNewSheet {
  open(announcement: ReleaseAnnouncement): void;
  close(): void;
  isOpen(): boolean;
}

function formatDate(at: number | null): string {
  if (at === null) return "";
  try {
    return new Date(at).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

/**
 * A note's body, split into the pieces worth drawing separately.
 *
 * Deliberately not a Markdown renderer. Notes are short and the only structure that has
 * ever mattered in one is "heading, then some lines, then a list", so `#` and `-` are
 * recognised and everything else is a paragraph. A full parser here would be a much
 * larger attack surface for something nobody would notice.
 */
function renderBody(body: string, into: HTMLElement): void {
  let list: HTMLUListElement | null = null;

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();

    if (line.length === 0) {
      list = null;
      continue;
    }

    if (line.startsWith("#")) {
      list = null;
      const heading = document.createElement("h4");
      heading.className = "whats-new-heading";
      heading.textContent = line.replace(/^#+\s*/, "");
      into.append(heading);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      if (list === null) {
        list = document.createElement("ul");
        list.className = "whats-new-list";
        into.append(list);
      }
      const item = document.createElement("li");
      item.textContent = line.replace(/^[-*]\s+/, "");
      list.append(item);
      continue;
    }

    list = null;
    const paragraph = document.createElement("p");
    paragraph.className = "whats-new-paragraph";
    paragraph.textContent = line;
    into.append(paragraph);
  }
}

function renderNote(note: ReleaseNote, isCurrent: boolean): HTMLElement {
  const entry = document.createElement("article");
  entry.className = "whats-new-entry";

  const head = document.createElement("header");
  head.className = "whats-new-entry-head";

  const version = document.createElement("span");
  version.className = "whats-new-version";
  version.textContent = note.version;
  head.append(version);

  if (isCurrent) {
    const badge = document.createElement("span");
    badge.className = "whats-new-current";
    badge.textContent = "You have this";
    head.append(badge);
  }

  if (note.critical) {
    const badge = document.createElement("span");
    badge.className = "whats-new-critical";
    badge.textContent = "Important";
    head.append(badge);
  }

  const date = formatDate(note.publishedAt);
  if (date.length > 0) {
    const stamp = document.createElement("time");
    stamp.className = "whats-new-date";
    stamp.textContent = date;
    head.append(stamp);
  }

  const title = document.createElement("h3");
  title.className = "whats-new-title";
  title.textContent = note.title;

  entry.append(head, title);

  if (note.highlights.length > 0) {
    const list = document.createElement("ul");
    list.className = "whats-new-list";
    for (const highlight of note.highlights) {
      const item = document.createElement("li");
      item.textContent = highlight;
      list.append(item);
    }
    entry.append(list);
  }

  if (note.body.trim().length > 0) renderBody(note.body, entry);

  return entry;
}

export function createWhatsNewSheet(host: HTMLElement): WhatsNewSheet {
  const dialog = document.createElement("dialog");
  dialog.className = "whats-new-dialog";

  const card = document.createElement("div");
  card.className = "whats-new-card";

  const header = document.createElement("header");
  header.className = "whats-new-header";

  const title = document.createElement("h2");
  title.className = "whats-new-heading-main";
  title.textContent = "What's new";

  const subtitle = document.createElement("p");
  subtitle.className = "whats-new-subtitle";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-button whats-new-close";
  close.title = "Close";
  close.setAttribute("aria-label", "Close");
  close.append(createIcon(ICON.close));
  close.addEventListener("click", () => dialog.close());

  const titles = document.createElement("div");
  titles.className = "whats-new-titles";
  titles.append(title, subtitle);
  header.append(titles, close);

  const list = document.createElement("div");
  list.className = "whats-new-body";

  card.append(header, list);
  dialog.append(card);
  host.append(dialog);

  return {
    open(announcement: ReleaseAnnouncement): void {
      list.replaceChildren();

      const notes = releasesInBuild(
        announcement.releases as readonly Release[],
        announcement.currentVersion,
      );

      subtitle.textContent =
        notes.length === 0
          ? `You are running ADCode ${announcement.currentVersion}.`
          : `You are running ADCode ${announcement.currentVersion}. ${String(notes.length)} ${notes.length === 1 ? "note" : "notes"}.`;

      if (notes.length === 0) {
        const empty = document.createElement("p");
        empty.className = "whats-new-empty";
        // Honest about which of the two it is, because they call for different actions.
        empty.textContent =
          "No release notes yet. Either nothing has been published for this version, or ADCode has not been able to reach the server.";
        list.append(empty);
      } else {
        for (const note of notes) {
          list.append(renderNote(note, note.version === announcement.currentVersion));
        }
      }

      /*
       * Opening this deliberately counts as having seen the notes in it. Somebody who has
       * just read the list should not be shown a card about the same release ten minutes
       * later - that is the nagging this whole feature is written to avoid.
       */
      if (notes.length > 0) {
        void window.adcode.releases.markSeen(notes.map((note) => note.version));
      }

      if (!dialog.open) dialog.showModal();
      list.scrollTop = 0;
    },

    close(): void {
      if (dialog.open) dialog.close();
    },

    isOpen(): boolean {
      return dialog.open;
    },
  };
}
