/**
 * Choosing a theme by looking at it.
 *
 * A row of words - System, Light, Dark, Midnight - asks somebody to imagine the answer
 * and then click to find out. Two of these differ only in their palette, and "Midnight"
 * means nothing at all until you have seen it once. So each option draws a miniature of
 * the window it produces: title bar, sidebar, a tab, three lines of syntax, and the
 * accent as it will actually appear.
 *
 * The miniatures are built from the same tokens the real window uses, hard-coded here in
 * one table rather than read from the stylesheet. Reading the live values would only ever
 * describe the theme currently applied - every card would look identical to the one in
 * use, which is the opposite of what a preview is for.
 *
 * System draws as a diagonal split of Light and Dark, because that is what it does: it is
 * not a look, it is a deferral to the machine.
 */

interface Palette {
  chrome: string;
  app: string;
  editor: string;
  text: string;
  faint: string;
  accent: string;
  /** The three code lines, top to bottom. */
  code: [string, string, string];
}

const PALETTES: Record<string, Palette> = {
  light: {
    chrome: "#f6f6f8",
    app: "#f2f2f7",
    editor: "#ffffff",
    text: "#1c1c1e",
    faint: "#a1a1a6",
    accent: "#007aff",
    code: ["#af52de", "#007aff", "#34c759"],
  },
  dark: {
    chrome: "#2c2c2e",
    app: "#1c1c1e",
    editor: "#1e1e20",
    text: "#f5f5f7",
    faint: "#6c6c70",
    accent: "#0a84ff",
    code: ["#bf5af2", "#0a84ff", "#30d158"],
  },
  midnight: {
    chrome: "#131719",
    app: "#000000",
    editor: "#08090b",
    text: "#f1f3f3",
    faint: "#6b7577",
    accent: "#f1f3f3",
    code: ["#bf5af2", "#64d2ff", "#30d158"],
  },
};

/** One miniature window, as an SVG. Fixed 96x64 so every card is the same size. */
function preview(theme: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 96 64");
  svg.setAttribute("class", "theme-preview");
  svg.setAttribute("aria-hidden", "true");

  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    rx = 0,
  ): SVGRectElement => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    node.setAttribute("x", String(x));
    node.setAttribute("y", String(y));
    node.setAttribute("width", String(w));
    node.setAttribute("height", String(h));
    node.setAttribute("fill", fill);
    if (rx > 0) node.setAttribute("rx", String(rx));
    return node;
  };

  const draw = (p: Palette, clip?: string): SVGGElement => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    if (clip !== undefined) g.setAttribute("clip-path", clip);

    g.append(
      rect(0, 0, 96, 64, p.app),
      // Title bar, with the three dots every window on a Mac has.
      rect(0, 0, 96, 9, p.chrome),
      rect(4, 3.5, 2, 2, p.faint, 1),
      rect(8, 3.5, 2, 2, p.faint, 1),
      rect(12, 3.5, 2, 2, p.faint, 1),
      // Sidebar, with a selected row in the accent.
      rect(0, 9, 22, 55, p.chrome),
      rect(3, 13, 16, 3, p.faint, 1.5),
      rect(3, 19, 16, 4, p.accent, 2),
      rect(3, 26, 13, 3, p.faint, 1.5),
      rect(3, 32, 15, 3, p.faint, 1.5),
      // Editor, with a tab above it and three lines of "code" in it.
      rect(22, 9, 74, 55, p.editor),
      rect(24, 10.5, 20, 5, p.app, 2),
      rect(27, 21, 26, 3, p.code[0], 1.5),
      rect(30, 27, 34, 3, p.code[1], 1.5),
      rect(30, 33, 22, 3, p.code[2], 1.5),
      rect(27, 39, 30, 3, p.text, 1.5),
      rect(27, 45, 18, 3, p.faint, 1.5),
    );
    return g;
  };

  if (theme === "system") {
    // Light on the left of the diagonal, Dark on the right - the split says "whichever
    // one your machine is in" better than either half alone could.
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    for (const [id, d] of [
      ["theme-half-light", "M0 0 H60 L36 64 H0 Z"],
      ["theme-half-dark", "M60 0 H96 V64 H36 Z"],
    ] as const) {
      const clip = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
      clip.setAttribute("id", id);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      clip.append(path);
      defs.append(clip);
    }
    svg.append(
      defs,
      draw(PALETTES["light"] as Palette, "url(#theme-half-light)"),
      draw(PALETTES["dark"] as Palette, "url(#theme-half-dark)"),
    );
    return svg;
  }

  svg.append(draw(PALETTES[theme] ?? (PALETTES["dark"] as Palette)));
  return svg;
}

/**
 * The picker: one card per theme, each showing what it looks like.
 *
 * Radios rather than buttons, for the reason the segmented control uses them: a screen
 * reader then announces "3 of 4" without being told, and arrow keys work because that is
 * what radios do.
 */
export function themePicker(
  options: readonly { value: string; label: string }[],
  current: string,
  disabled: boolean,
  onChange: (next: string) => void,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "theme-picker";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Appearance");

  for (const option of options) {
    const card = document.createElement("button");
    card.className = "theme-card";
    card.type = "button";
    card.setAttribute("role", "radio");
    card.ariaChecked = String(option.value === current);
    card.disabled = disabled;

    const label = document.createElement("span");
    label.className = "theme-card-label";
    label.textContent = option.label;

    card.append(preview(option.value), label);
    card.addEventListener("click", () => onChange(option.value));
    group.append(card);
  }

  return group;
}
