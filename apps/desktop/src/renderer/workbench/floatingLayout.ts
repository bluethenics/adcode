/**
 * Geometry for the floating cards - the chat widget, and the undocked preview.
 *
 * Pure, and separate from either card, for the reason `packages/lsp` is separate from the
 * LSP client: the parts that actually break are the arithmetic, and arithmetic is only ever
 * tested when it can be called without a window existing.
 *
 * The bug this exists to prevent has a specific shape. A remembered position is a pair of
 * numbers from a previous session, and nothing guarantees the window is still the size it
 * was when they were written - an external monitor gets unplugged, the window is restored
 * from a maximised state, the display scale changes. Replaying those coordinates unchecked
 * puts the card partly or wholly outside the viewport, and because a card is dragged by its
 * own header, a card whose header is off-screen cannot be dragged back. It is not merely
 * misplaced; it is unrecoverable without clearing storage.
 *
 * So every remembered geometry is clamped on the way *in* rather than on the way out. The
 * stored value is left alone: it is a record of what the user chose, and a window that is
 * temporarily small should not permanently overwrite a position that was fine on the big
 * monitor.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * How much of the card must stay on screen, in pixels.
 *
 * Sized to a drag handle rather than to a hairline: leaving one visible pixel satisfies the
 * letter of "still on screen" while leaving nothing a pointer can realistically grab.
 */
export const KEEP_VISIBLE = 56;

/** Floors for a resize. Below these the preview's own toolbar starts to collapse. */
export const MIN_FLOAT_WIDTH = 320;
export const MIN_FLOAT_HEIGHT = 240;

function clamp(value: number, low: number, high: number): number {
  // `low` wins when the range inverts, which happens when the viewport is smaller than the
  // card. Preferring the low end pins the card to the top-left, where its header is
  // reachable, instead of pushing it off the opposite edge.
  if (high < low) return low;
  return Math.min(high, Math.max(low, value));
}

/**
 * Put a remembered position back inside the viewport.
 *
 * Horizontally the card may hang off either edge, so long as `KEEP_VISIBLE` pixels remain.
 * Vertically the top edge is never allowed above zero: the header is the drag handle, and a
 * handle above the top of the window cannot be reached at all - whereas a card hanging off
 * the bottom can still be grabbed by its header and pulled back up.
 */
export function clampToViewport(position: Point, size: Size, viewport: Viewport): Point {
  return {
    x: clamp(position.x, KEEP_VISIBLE - size.width, viewport.width - KEEP_VISIBLE),
    y: clamp(position.y, 0, viewport.height - KEEP_VISIBLE),
  };
}

/** Hold a card to its floors, and to a viewport it has to fit inside. */
export function clampSize(size: Size, viewport: Viewport): Size {
  return {
    width: Math.max(MIN_FLOAT_WIDTH, Math.min(size.width, viewport.width)),
    height: Math.max(MIN_FLOAT_HEIGHT, Math.min(size.height, viewport.height)),
  };
}

/**
 * Centre a card in the viewport, biased slightly up.
 *
 * Where a card goes the first time it is ever floated. Optical centre rather than
 * geometric: a card sitting at true centre reads as low, because the eye weights the empty
 * space below it against the window chrome above.
 */
export function centreIn(size: Size, viewport: Viewport): Point {
  return clampToViewport(
    {
      x: Math.round((viewport.width - size.width) / 2),
      y: Math.round((viewport.height - size.height) / 2.4),
    },
    size,
    viewport,
  );
}

/**
 * Read a `{ x, y }` back out of storage.
 *
 * `null` for anything that is not two finite numbers. `localStorage` is a string store that
 * survives upgrades, so the value here may have been written by an older build with a
 * different shape, hand-edited in devtools, or truncated by a full disk - and `NaN` from a
 * bad parse would propagate silently through the clamp and place the card nowhere.
 */
export function parsePoint(raw: string | null): Point | null {
  const parsed = parseObject(raw);
  if (parsed === null) return null;

  const { x, y } = parsed as Partial<Point>;
  if (!isFinite(x) || !isFinite(y)) return null;

  return { x, y };
}

export function parseSize(raw: string | null): Size | null {
  const parsed = parseObject(raw);
  if (parsed === null) return null;

  const { width, height } = parsed as Partial<Size>;
  if (!isFinite(width) || !isFinite(height)) return null;

  return { width, height };
}

function parseObject(raw: string | null): object | null {
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** Narrower than `Number.isFinite`: rejects `undefined` and non-numbers at the type level. */
function isFinite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
