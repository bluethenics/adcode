/**
 * A colour per participant, agreed without negotiation.
 *
 * Everyone's cursor has to be the same colour on every machine in the session, or two people
 * talking about "the green cursor" are talking about different people. The cheap way to get
 * that is to make colour a pure function of join order, which every peer already knows from
 * the roster - so no message ever needs to carry a colour, and there is nothing to
 * disagree about.
 *
 * The palette is the iOS system set the workbench already uses (`tokens.css`), minus two:
 *
 * - **Blue** is missing because `--accent` is blue and the user's own caret is drawn in it.
 *   A remote cursor in the same blue would read as your own.
 * - **Red** is missing because `--danger` is red and it marks errors everywhere else in the
 *   window. A teammate is not an error.
 *
 * Eight colours, chosen to stay distinguishable on both the light and the dark editor
 * background - which is why the palette is mid-tone throughout rather than including
 * anything near white or black.
 */

export const CURSOR_COLOURS: readonly string[] = [
  "#34c759", // green
  "#ff9500", // orange
  "#af52de", // purple
  "#00c7be", // teal
  "#ff2d55", // pink
  "#a2845e", // brown
  "#5856d6", // indigo
  "#ffcc00", // yellow
];

/**
 * The colour for a participant at a given index.
 *
 * Wraps rather than running out. A ninth participant repeating the first one's colour is a
 * cosmetic collision; returning `null` and having no colour to draw with is a missing cursor,
 * which is worse. `Math.abs` and the floor guard against a negative or fractional index
 * arriving from a corrupted roster and indexing off the end of the array into `undefined`.
 */
export function colourForIndex(index: number): string {
  if (!Number.isFinite(index)) return CURSOR_COLOURS[0] as string;

  const safe = Math.abs(Math.floor(index)) % CURSOR_COLOURS.length;
  return CURSOR_COLOURS[safe] as string;
}

/**
 * A readable text colour to sit on top of a cursor's own colour.
 *
 * Name labels are drawn on a chip filled with the participant's colour, and yellow needs
 * black text where purple needs white. Computed from relative luminance rather than from a
 * hand-maintained second table, so adding a colour above cannot leave an unreadable label
 * behind.
 */
export function labelInkFor(colour: string): "#000000" | "#ffffff" {
  const rgb = parseHex(colour);
  if (rgb === null) return "#ffffff";

  // Rec. 709 luma. Enough to pick a side; this is not a contrast-ratio calculation.
  const luma = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luma > 0.6 ? "#000000" : "#ffffff";
}

function parseHex(colour: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (match === null) return null;

  const value = Number.parseInt(match[1] as string, 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/**
 * A translucent form of a colour, for selection highlights.
 *
 * A selection is a filled region behind the user's own text, so it has to be transparent
 * enough to read through. Built as `#rrggbb` + an alpha pair rather than `rgba()` so the
 * result is still a plain hex string Monaco accepts in a theme rule.
 */
export function selectionTintFor(colour: string, alpha = 0x33): string {
  const rgb = parseHex(colour);
  if (rgb === null) return colour;

  const clamped = Math.max(0, Math.min(255, Math.floor(alpha)));
  return `${colour}${clamped.toString(16).padStart(2, "0")}`;
}
