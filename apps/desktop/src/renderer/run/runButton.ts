/**
 * The Go Live / Run button, at the far right of the status bar.
 *
 * VS Code puts Live Server's "Go Live" here and its Run control somewhere else entirely,
 * which means a beginner has to already know which of the two their file needs. This is one
 * control that reads the file in front of them and says what pressing it will do - "Go
 * Live" on a page, "Run Python" on a script.
 *
 * It hides when neither applies, rather than sitting there greyed out. A permanently
 * disabled control is a standing invitation to wonder what you did wrong; an absent one is
 * simply not part of this file's world.
 *
 * The decision itself is in `runCommands.ts`, which is pure and tested. This file is the
 * button.
 */
import { runActionFor } from "./runCommands.ts";

export interface ActiveFile {
  /** Workspace-relative, forward-slashed - what goes on the command line. */
  readonly relativePath: string;
  readonly languageId: string;
}

export interface RunButtonDeps {
  readonly activeFile: () => ActiveFile | null;
  /** Names of the files at the workspace root. Decides page-versus-program, and manifests. */
  readonly rootFiles: () => readonly string[];
  readonly platform: () => string;
  readonly togglePreview: () => Promise<void>;
  readonly isPreviewOpen: () => boolean;
  /** Type a command into the terminal and press return. */
  readonly runInTerminal: (command: string) => Promise<void>;
}

export interface RunButton {
  readonly element: HTMLElement;
  /** Recompute from the active file. Cheap, and called on every tab and preview change. */
  refresh(): void;
  /**
   * Do whatever the button currently says, without clicking it.
   *
   * The menu entry and the keyboard shortcut both come through here rather than
   * synthesising a click, so the three routes cannot drift into meaning different things.
   */
  activate(): void;
}

/** A broadcast tower for live, a triangle for run, a square for stop. */
const ICONS = {
  live: "M8 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3M4.8 4.2a4.5 4.5 0 0 0 0 7.6M11.2 4.2a4.5 4.5 0 0 1 0 7.6",
  stop: "M4.5 4.5h7v7h-7z",
  run: "M5 3.5l7 4.5-7 4.5z",
} as const;

export function createRunButton(deps: RunButtonDeps): RunButton {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "status-action";
  button.hidden = true;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");

  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.append(shape);

  const text = document.createElement("span");

  button.append(svg, text);

  let onClick: (() => void) | null = null;

  button.addEventListener("click", () => onClick?.());

  function refresh(): void {
    const file = deps.activeFile();

    if (file === null) {
      button.hidden = true;
      onClick = null;
      return;
    }

    const action = runActionFor(
      file.languageId,
      file.relativePath,
      deps.rootFiles(),
      deps.platform(),
    );

    if (action === null) {
      button.hidden = true;
      onClick = null;
      return;
    }

    button.hidden = false;

    if (action.mode === "live") {
      const live = deps.isPreviewOpen();

      shape.setAttribute("d", live ? ICONS.stop : ICONS.live);
      text.textContent = live ? "Stop preview" : "Go Live";
      button.title = live
        ? "Stop the preview server"
        : "Serve this folder and open it beside the editor (Ctrl+Shift+V)";
      button.dataset["state"] = live ? "live" : "idle";

      onClick = () => void deps.togglePreview();
      return;
    }

    shape.setAttribute("d", ICONS.run);
    text.textContent = action.label;
    button.title = `Run in the terminal: ${action.command}`;
    button.dataset["state"] = "idle";

    onClick = () => void deps.runInTerminal(action.command);
  }

  // Not refreshed here. The button's dependencies include things declared after it in the
  // shell's module, and reading them during construction would be a temporal-dead-zone
  // error waiting for the first person whose editor restores a file on launch.
  return {
    element: button,
    refresh,

    activate(): void {
      // Recomputed first: the shortcut can be pressed after a tab change that some other
      // path forgot to announce, and running the previous file would be worse than nothing.
      refresh();
      onClick?.();
    },
  };
}
