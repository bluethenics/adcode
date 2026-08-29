/**
 * The command centre: the search box in the middle of the title bar.
 *
 * A launcher rather than a search implementation. The universal overlay owns result
 * providers and ranking; this title-bar control only hands over a click or first character.
 *
 * Idle it shows the folder name, which is what the title bar's own label used to carry.
 */

export interface CommandCentre {
  readonly element: HTMLElement;
  /** Show the open folder's name, or the product name when nothing is open. */
  setWorkspace(name: string | null): void;
  focus(): void;
}

export interface CommandCentreDeps {
  /** Open universal search, seeded with whatever has been typed so far. */
  readonly openSearch: (seed: string) => void;
}

export function createCommandCentre(deps: CommandCentreDeps): CommandCentre {
  const element = document.createElement("button");
  element.className = "command-centre";
  element.type = "button";
  element.setAttribute("aria-label", "Search all of ADCode");

  // Built node by node rather than through `innerHTML`: the shell runs under a strict CSP
  // and nothing here is worth making an exception for.
  const SVG_NS = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("aria-hidden", "true");

  const ring = document.createElementNS(SVG_NS, "circle");
  ring.setAttribute("cx", "7");
  ring.setAttribute("cy", "7");
  ring.setAttribute("r", "4.2");

  const handle = document.createElementNS(SVG_NS, "path");
  handle.setAttribute("d", "M10.2 10.2L13.5 13.5");

  icon.append(ring, handle);

  const label = document.createElement("span");
  label.className = "command-centre-label";

  const hint = document.createElement("kbd");
  hint.className = "command-centre-hint";
  hint.textContent = "Ctrl+P";

  element.append(icon, label, hint);

  function route(text: string): void {
    deps.openSearch(text);
  }

  element.addEventListener("click", () => route(""));

  /**
   * Typing straight into the bar opens the right overlay already carrying the character.
   *
   * Without this the first keystroke would be swallowed - the button is what has focus,
   * and the overlay it opens is a different input entirely. Modified presses are left
   * alone so the shell's own shortcuts still reach the keydown handler on `window`.
   */
  element.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return;

    event.preventDefault();
    route(event.key);
  });

  return {
    element,

    setWorkspace(name) {
      label.textContent = name === null ? "Search" : `Search ${name}`;
    },

    focus: () => element.focus(),
  };
}
