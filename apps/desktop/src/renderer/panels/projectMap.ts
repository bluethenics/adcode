/**
 * What this project *is*, for somebody who has just opened it.
 *
 * The file tree answers "what is here". It does not answer the question anybody actually
 * has on their first morning in an unfamiliar repository, which is "which of these
 * nineteen folders is the one I am looking for, and what are the other eighteen". Every
 * editor leaves that to be worked out by opening things.
 *
 * So this reads the root, names what kind of project it is from the manifests it finds,
 * and writes a sentence beside every folder and file it recognises. The dictionary is
 * `@adcode/structure`'s `folders.ts` - it is not inferred and it is never guessed, and an
 * entry with no note gets no note rather than a hedge.
 *
 * One level deep by default, with folders expandable. Two levels of an unfamiliar project
 * is already more than anybody reads at once, and the point of this view is to be shorter
 * than the tree it describes.
 */
import { describeEntry, HIDDEN_DIRECTORIES, projectKinds, whereToStart } from "@adcode/structure";
import type { DirEntry } from "../../shared/api.ts";
import { fileIcon, folderIcon } from "../workbench/fileIcons.ts";

export interface ProjectMapDeps {
  /** The workspace root's absolute path, or null when no folder is open. */
  readonly root: () => string | null;
  readonly list: (dirPath: string) => Promise<readonly DirEntry[]>;
  /** Open a file in the editor. Directories are expanded in place instead. */
  readonly open: (absolutePath: string) => void;
}

export interface ProjectMap {
  readonly element: HTMLElement;
  /** Re-read the root. Called when the popup opens on this tab. */
  refresh(): Promise<void>;
}

export function createProjectMap(deps: ProjectMapDeps): ProjectMap {
  const element = document.createElement("div");
  element.className = "projectmap";

  const summary = document.createElement("div");
  summary.className = "projectmap-summary";

  const list = document.createElement("div");
  list.className = "projectmap-list";

  element.append(summary, list);

  /** Directories already expanded, by absolute path, so a redraw keeps them open. */
  const expanded = new Set<string>();

  async function refresh(): Promise<void> {
    const root = deps.root();

    if (root === null) {
      summary.replaceChildren(note("No folder is open, so there is nothing to describe yet."));
      list.replaceChildren();
      return;
    }

    let entries: readonly DirEntry[];
    try {
      entries = await deps.list(root);
    } catch {
      summary.replaceChildren(note("Could not read this folder."));
      list.replaceChildren();
      return;
    }

    drawSummary(root, entries);

    list.replaceChildren();
    await drawEntries(entries, list, 0);
  }

  function drawSummary(root: string, entries: readonly DirEntry[]): void {
    const names = entries.map((entry) => entry.name);
    const kinds = projectKinds(names);
    const starts = whereToStart(names);

    summary.replaceChildren();

    const heading = document.createElement("p");
    heading.className = "projectmap-heading";
    heading.textContent = root.split(/[\\/]/).filter((part) => part.length > 0).pop() ?? root;
    summary.append(heading);

    const what = document.createElement("p");
    what.className = "projectmap-line";
    what.textContent =
      kinds.length === 0
        ? "ADCode does not recognise a manifest here, so it cannot say what kind of project this is."
        : `This looks like ${joinWords(kinds)}.`;
    summary.append(what);

    if (starts.length > 0) {
      const where = document.createElement("p");
      where.className = "projectmap-line";
      where.append(document.createTextNode("Start with "));

      for (const [index, name] of starts.entries()) {
        if (index > 0) where.append(document.createTextNode(index === starts.length - 1 ? ", then " : ", "));

        const link = document.createElement("button");
        link.type = "button";
        link.className = "projectmap-start";
        link.textContent = name;

        // The entry's own path, not one built from the root and the name: the workspace
        // bridge already returns an absolute path with this platform's separator, and
        // rebuilding it here is a way to get that wrong on exactly one operating system.
        const target = entries.find((candidate) => candidate.name === name);
        if (target !== undefined) link.addEventListener("click", () => deps.open(target.path));

        where.append(link);
      }

      where.append(document.createTextNode("."));
      summary.append(where);
    }

    /*
     * What is here and deliberately not listed.
     *
     * The tree does not walk `node_modules`, `.git` or a build directory - they are slow to
     * read and never worth reading. But a newcomer's biggest question about a project root
     * is often about exactly those, and a map that silently omitted them would be describing
     * a folder the user does not have. Naming them, with what they are, answers the question
     * and explains the omission in one line.
     */
    const hidden = document.createElement("p");
    hidden.className = "projectmap-line projectmap-hidden";
    hidden.textContent =
      `Not listed: ${HIDDEN_DIRECTORIES.join(", ")} — downloaded, generated, or git's own ` +
      `storage. ADCode skips them because reading them is slow and editing them is always a mistake.`;
    summary.append(hidden);
  }

  async function drawEntries(
    entries: readonly DirEntry[],
    into: HTMLElement,
    depth: number,
  ): Promise<void> {
    // Folders first, then files, each alphabetically. The tree sorts this way too, and a
    // second ordering for the same data would make the two views feel like two projects.
    const sorted = [...entries].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      const full = entry.path;
      const note = describeEntry(entry.name, entry.isDirectory);

      const row = document.createElement("div");
      row.className = "projectmap-row";
      row.style.setProperty("--map-depth", String(depth));
      if (note?.generated === true) row.dataset["generated"] = "true";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "projectmap-entry";

      const icon = entry.isDirectory ? folderIcon(expanded.has(full)) : fileIcon(entry.name);
      icon.classList.add("projectmap-icon");
      button.append(icon);

      const name = document.createElement("span");
      name.className = "projectmap-name";
      name.textContent = entry.name;
      button.append(name);

      if (note !== null) {
        const title = document.createElement("span");
        title.className = "projectmap-title";
        title.textContent = note.title;
        button.append(title);
      }

      button.addEventListener("click", () => {
        if (!entry.isDirectory) {
          deps.open(full);
          return;
        }

        if (expanded.has(full)) expanded.delete(full);
        else expanded.add(full);
        void refresh();
      });

      row.append(button);
      into.append(row);

      if (note !== null) {
        const detail = document.createElement("p");
        detail.className = "projectmap-detail";
        detail.style.setProperty("--map-depth", String(depth));
        detail.textContent = note.detail;
        into.append(detail);
      }

      /*
       * One level of expansion, and no deeper.
       *
       * A folder that expands without limit turns this into the file tree, which already
       * exists three inches to the left and is better at being one. The notes are about the
       * shape of a project, and a project's shape is at its top.
       */
      if (entry.isDirectory && expanded.has(full) && depth < 1) {
        try {
          const children = await deps.list(full);
          await drawEntries(children, into, depth + 1);
        } catch {
          // A folder that cannot be read is not an error worth a dialog; the row above it
          // simply has nothing under it.
        }
      }
    }
  }

  function note(text: string): HTMLElement {
    const paragraph = document.createElement("p");
    paragraph.className = "projectmap-line";
    paragraph.textContent = text;
    return paragraph;
  }

  return { element, refresh };
}

/** `a`, `a and b`, `a, b and c`. */
function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
