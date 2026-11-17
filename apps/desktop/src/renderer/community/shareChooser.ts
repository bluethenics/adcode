/**
 * The one Share button's question: send a copy, or work on it live together.
 *
 * Sharing had six doors across three systems (shared projects, live collaboration, the
 * Artifacts page), and the visible ones sat inside a page most people never opened. This is
 * the single door. Both answers hand off to flows that already exist on the Artifacts page,
 * which owns the code, the outcome card and the team room.
 */
import { button, el } from "../dialogs/formDialog.ts";
import { createIcon, ICON } from "../workbench/icons.ts";
import { detailDialog } from "./communityShell.ts";

export interface ShareChooserDeps {
  /** Publish a copy of the open project and get a code for it. */
  readonly sendCopy: () => void;
  /** Share the open project and start a live session on it. */
  readonly workLive: () => void;
  /** Paste a code a friend sent. */
  readonly join: () => void;
}

export function openShareChooser(deps: ShareChooserDeps): void {
  const { dialog, card, finish } = detailDialog("share-chooser", "Share this project");
  const choose = (run: () => void) => () => { finish(); run(); };
  const option = (icon: string, title: string, text: string, run: () => void, primary = false): HTMLButtonElement => {
    const node = button("", `share-choice${primary ? " share-choice-primary" : ""}`, choose(run));
    const tile = el("span", "share-choice-icon");
    tile.setAttribute("aria-hidden", "true");
    tile.append(createIcon(icon));
    const words = el("span", "share-choice-words");
    words.append(el("strong", "share-choice-title", title), el("span", "share-choice-text", text));
    node.append(tile, words);
    return node;
  };
  const options = el("div", "share-choices");
  options.append(
    option(ICON.copy, "Send a copy", "Friends get their own copy from a code. Nothing they change touches your files.", deps.sendCopy, true),
    option(ICON.projects, "Work on it live together", "Friends edit these files with you as you work. You get a code to send them.", deps.workLive),
  );
  const joinLine = el("p", "share-join");
  joinLine.append(document.createTextNode("Got a code from a friend? "), button("Join their project", "share-join-link", choose(deps.join)));
  const privacy = el("p", "share-privacy", "Only the project's own files are shared - never keys, .env files or anything .gitignore leaves out. You see the list first.");
  card.append(options, joinLine, privacy);
  dialog.showModal();
}
