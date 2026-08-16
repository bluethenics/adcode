/**
 * The command palette.
 *
 * The menu bar is where you look when you do not know what an editor can do; the palette
 * is where you go when you do. Both resolve the same command ids, so a command is
 * reachable from both the moment it is registered - there is no second list to maintain.
 *
 * Ranking reuses the fuzzy matcher the file opener uses, for the same reason it exists
 * there: typing "tgtm" should find "Toggle Terminal".
 */
import { rankCandidates } from "@adcode/search/fuzzy";
import type { Command } from "./commands.ts";

export interface Palette {
  toggle(): void;
  close(): void;
  isOpen(): boolean;
}

export interface PaletteDeps {
  readonly commands: () => Command[];
  readonly run: (id: string) => void;
  readonly restoreFocus: () => void;
}

const MAX_ROWS = 40;

export function createPalette(deps: PaletteDeps): Palette {
  const overlay = document.createElement("div");
  overlay.className = "quickopen";
  overlay.hidden = true;

  const box = document.createElement("div");
  box.className = "quickopen-box";

  const input = document.createElement("input");
  input.className = "quickopen-input";
  input.placeholder = "Type a command";
  input.setAttribute("aria-label", "Command palette");

  const list = document.createElement("div");
  list.className = "quickopen-list";

  box.append(input, list);
  overlay.append(box);
  document.body.append(overlay);

  let shown: Command[] = [];
  let selected = 0;

  function render(): void {
    list.replaceChildren();

    shown.forEach((command, index) => {
      const row = document.createElement("button");
      row.className = "quickopen-row palette-row";
      row.type = "button";
      row.ariaSelected = String(index === selected);

      const title = document.createElement("span");
      title.textContent = command.title;

      const id = document.createElement("span");
      id.className = "palette-id";
      id.textContent = command.id;

      row.append(title, id);
      row.addEventListener("click", () => {
        api.close();
        deps.run(command.id);
      });

      list.append(row);
    });
  }

  function query(): void {
    const all = deps.commands();
    const text = input.value.trim();

    if (text.length === 0) {
      shown = all.slice(0, MAX_ROWS);
    } else {
      // Matched against the title rather than the id: people search for what a command
      // is called, not for the dotted name it happens to have internally.
      const ranked = rankCandidates(
        text,
        all.map((command) => command.title),
        MAX_ROWS,
      );

      shown = ranked.flatMap((hit) => {
        const found = all.find((command) => command.title === hit.value);
        return found === undefined ? [] : [found];
      });
    }

    selected = 0;
    render();
  }

  input.addEventListener("input", query);

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selected = Math.min(selected + 1, shown.length - 1);
      render();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selected = Math.max(selected - 1, 0);
      render();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = shown[selected];
      if (command !== undefined) {
        api.close();
        deps.run(command.id);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      api.close();
    }
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) api.close();
  });

  const api: Palette = {
    toggle(): void {
      if (!overlay.hidden) {
        api.close();
        return;
      }

      overlay.hidden = false;
      input.value = "";
      query();
      input.focus();
    },

    close(): void {
      if (overlay.hidden) return;

      overlay.hidden = true;
      deps.restoreFocus();
    },

    isOpen: () => !overlay.hidden,
  };

  return api;
}
