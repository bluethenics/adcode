/**
 * Annotate, as data: numbered pins on a page, each with a note, and the words that carry them
 * to the assistant.
 *
 * The person clicks things in the Browser or the Preview ("make this blue", "this button does
 * nothing") or drags a box around an area, and Send to chat hands the assistant a screenshot
 * with the same numbers drawn on it plus one line per pin naming the element - tag, words,
 * selector - so "this" never needs explaining.
 *
 * Pins live in the page's own CSS pixels (its viewport). Each one remembers where it sits
 * inside the element it was dropped on, as fractions of that element's box, so when the page
 * scrolls or reflows the pin follows the element instead of staying on the glass.
 *
 * Everything the page reports is untrusted: it is checked and cut down here, shown as quoted
 * data, and the message says so. Pure: no DOM, no IPC.
 */
import type { AnnotateElement, AnnotateProbeResult, AnnotateRect } from "../../shared/api.ts";

export type PinKind = "point" | "area";

/** Where a pin sits inside its element, as fractions of the element's box. */
export interface PinAnchor {
  readonly selector: string;
  readonly fx: number;
  readonly fy: number;
  readonly fw: number;
  readonly fh: number;
}

export interface Pin {
  readonly id: number;
  readonly kind: PinKind;
  readonly note: string;
  /** Page CSS pixels. A point pin has no size. */
  readonly place: AnnotateRect;
  readonly element: AnnotateElement | null;
  /** For an area: what the page said sits inside it. */
  readonly contains: readonly string[];
  readonly anchor: PinAnchor | null;
  /** The element it was on no longer matches; the pin stays where it was last seen. */
  readonly lost: boolean;
}

export interface AnnotationState {
  readonly pins: readonly Pin[];
  readonly nextId: number;
}

/** Pointer movement below this is a click, above it a box. */
export const DRAG_THRESHOLD = 6;
export const MAX_PINS = 30;
export const MAX_NOTE = 500;

export const COACH_LINE = "Click anything you want changed, then type what to change";
export const COACH_DRAG = "Drag to box an area. Scroll to move the page. Esc when done.";

export function emptyAnnotations(): AnnotationState {
  return { pins: [], nextId: 1 };
}

/** The number a pin shows: its place in the list, so deleting 2 makes 3 the new 2. */
export function pinNumber(state: AnnotationState, id: number): number {
  return state.pins.findIndex((pin) => pin.id === id) + 1;
}

export function findPin(state: AnnotationState, id: number): Pin | undefined {
  return state.pins.find((pin) => pin.id === id);
}

/** Drop a pin. Null when the page already holds as many as a message can sensibly carry. */
export function addPin(state: AnnotationState, kind: PinKind, place: AnnotateRect): { state: AnnotationState; pin: Pin } | null {
  if (state.pins.length >= MAX_PINS) return null;
  const pin: Pin = {
    id: state.nextId,
    kind,
    note: "",
    place: kind === "point" ? { x: place.x, y: place.y, width: 0, height: 0 } : place,
    element: null,
    contains: [],
    anchor: null,
    lost: false,
  };
  return { state: { pins: [...state.pins, pin], nextId: state.nextId + 1 }, pin };
}

function update(state: AnnotationState, id: number, change: (pin: Pin) => Pin): AnnotationState {
  return { ...state, pins: state.pins.map((pin) => (pin.id === id ? change(pin) : pin)) };
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Where `place` sits inside `rect`, as fractions; a zero-size element anchors at its corner. */
export function anchorWithin(selector: string, place: AnnotateRect, rect: AnnotateRect): PinAnchor {
  const fx = rect.width > 0 ? clamp01((place.x - rect.x) / rect.width) : 0;
  const fy = rect.height > 0 ? clamp01((place.y - rect.y) / rect.height) : 0;
  const fw = rect.width > 0 ? clamp01(place.width / rect.width) : 0;
  const fh = rect.height > 0 ? clamp01(place.height / rect.height) : 0;
  return { selector, fx, fy, fw, fh };
}

/** The place an anchor puts a pin on its element's box now. */
export function placeFromAnchor(anchor: PinAnchor, rect: AnnotateRect, kind: PinKind): AnnotateRect {
  const x = rect.x + anchor.fx * rect.width;
  const y = rect.y + anchor.fy * rect.height;
  return kind === "point" ? { x, y, width: 0, height: 0 } : { x, y, width: anchor.fw * rect.width, height: anchor.fh * rect.height };
}

/** The page said what is under a pin: remember the element and where the pin sits on it. */
export function attachElement(state: AnnotationState, id: number, element: AnnotateElement | null, contains: readonly string[] = []): AnnotationState {
  return update(state, id, (pin) => ({
    ...pin,
    element,
    contains: contains.slice(0, 5),
    anchor: element === null || element.selector === "" ? null : anchorWithin(element.selector, pin.place, element.rect),
  }));
}

export function setNote(state: AnnotationState, id: number, note: string): AnnotationState {
  const tidy = note.replace(/\s+$/, "").slice(0, MAX_NOTE);
  return update(state, id, (pin) => ({ ...pin, note: tidy }));
}

export function removePin(state: AnnotationState, id: number): AnnotationState {
  return { ...state, pins: state.pins.filter((pin) => pin.id !== id) };
}

export function clearPins(state: AnnotationState): AnnotationState {
  return { ...state, pins: [] };
}

/** One selector per pin, in pin order; "" for a pin with nothing to follow. */
export function anchoredSelectors(state: AnnotationState): string[] {
  return state.pins.map((pin) => pin.anchor?.selector ?? "");
}

/**
 * Move every anchored pin onto its element's box now. `rects` is the page's answer to
 * `anchoredSelectors`, in the same order; a pin whose element is gone keeps its last place.
 */
export function relocate(state: AnnotationState, rects: readonly (AnnotateRect | null)[]): AnnotationState {
  return {
    ...state,
    pins: state.pins.map((pin, index) => {
      if (pin.anchor === null) return pin;
      const rect = rects[index] ?? null;
      if (rect === null) return pin.lost ? pin : { ...pin, lost: true };
      // A box with no size is display:none or detached; following it would stack every pin at 0,0.
      if (rect.width === 0 && rect.height === 0) return pin.lost ? pin : { ...pin, lost: true };
      return { ...pin, place: placeFromAnchor(pin.anchor, rect, pin.kind), lost: false };
    }),
  };
}

/* ── Pointer geometry ───────────────────────────────────────────────────────────────────── */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function isDrag(start: Point, end: Point, threshold = DRAG_THRESHOLD): boolean {
  return Math.abs(end.x - start.x) >= threshold || Math.abs(end.y - start.y) >= threshold;
}

/** The box between two corners, whichever way the drag went. */
export function dragRect(start: Point, end: Point): AnnotateRect {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

/**
 * How the overlay maps onto the page: layer = page * scale + offset. Scale is not 1 when the
 * Preview draws a device-size page smaller to fit; offset is where the page's corner sits
 * relative to the overlay's.
 */
export interface LayerMapping {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export const IDENTITY_MAPPING: LayerMapping = { scale: 1, offsetX: 0, offsetY: 0 };

export function toLayer(rect: AnnotateRect, mapping: LayerMapping): AnnotateRect {
  return {
    x: rect.x * mapping.scale + mapping.offsetX,
    y: rect.y * mapping.scale + mapping.offsetY,
    width: rect.width * mapping.scale,
    height: rect.height * mapping.scale,
  };
}

export function toPage(point: Point, mapping: LayerMapping): Point {
  const scale = mapping.scale > 0 ? mapping.scale : 1;
  return { x: (point.x - mapping.offsetX) / scale, y: (point.y - mapping.offsetY) / scale };
}

/* ── Untrusted page data ────────────────────────────────────────────────────────────────── */

/** Page text as one tidy line: control characters out, whitespace collapsed, length capped. */
export function pageText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const line = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]+/g, " ").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRect(value: unknown): AnnotateRect | null {
  if (!isRecord(value)) return null;
  const parts = [value["x"], value["y"], value["width"], value["height"]];
  if (!parts.every((part) => typeof part === "number" && Number.isFinite(part) && Math.abs(part) < 1_000_000)) return null;
  const [x, y, width, height] = parts as number[];
  return { x: x!, y: y!, width: Math.max(0, width!), height: Math.max(0, height!) };
}

function readElement(value: unknown): AnnotateElement | null {
  if (!isRecord(value)) return null;
  const rect = readRect(value["rect"]);
  const tag = pageText(value["tag"], 30).toLowerCase();
  if (rect === null || !/^[a-z][a-z0-9-]*$/.test(tag)) return null;
  const id = pageText(value["id"], 80);
  const role = pageText(value["role"], 30);
  const href = pageText(value["href"], 200);
  return {
    tag,
    id: id === "" ? null : id,
    classes: Array.isArray(value["classes"]) ? value["classes"].slice(0, 4).map((name) => pageText(name, 40)).filter((name) => name !== "") : [],
    text: pageText(value["text"], 140),
    label: pageText(value["label"], 100),
    role: role === "" ? null : role,
    href: href === "" ? null : href,
    // Not shortened with an ellipsis: it is fed back to the page to find the element again.
    selector: typeof value["selector"] === "string" ? value["selector"].replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 600) : "",
    rect,
  };
}

/** The page's answer to a probe, checked; null when it is not one. */
export function parseProbeResult(value: unknown): AnnotateProbeResult | null {
  if (!isRecord(value)) return null;
  const viewport = isRecord(value["viewport"]) ? value["viewport"] : null;
  const width = viewport?.["width"];
  const height = viewport?.["height"];
  if (typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  const result: { viewport: { width: number; height: number }; element?: AnnotateElement | null; contains?: string[]; rects?: (AnnotateRect | null)[] } = {
    viewport: { width, height },
  };
  if ("element" in value) result.element = readElement(value["element"]);
  if (Array.isArray(value["contains"])) result.contains = value["contains"].slice(0, 5).map((item) => pageText(item, 80)).filter((item) => item !== "");
  if (Array.isArray(value["rects"])) result.rects = value["rects"].slice(0, MAX_PINS * 2).map(readRect);
  return result;
}

/* ── Words for the assistant ────────────────────────────────────────────────────────────── */

const quote = (text: string): string => `"${text.replace(/"/g, "'")}"`;

/** `button "Sign up"`: the tag and the words a person would recognise it by. */
export function describeElement(element: AnnotateElement): string {
  const words = element.text !== "" ? element.text : element.label;
  const name = words === "" ? "" : ` ${quote(pageText(words, 60))}`;
  const role = element.role !== null && element.role !== element.tag ? ` (${element.role})` : "";
  return `${element.tag}${role}${name}`;
}

/** One numbered line: what the pin is on, how to find it, and what to change. */
export function formatPinLine(pin: Pin, number: number): string {
  const note = pin.note.trim() === "" ? "(no note - look at pin " + String(number) + " in the screenshot)" : pin.note.trim().replace(/\s*\n\s*/g, " / ");
  const parts: string[] = [];
  if (pin.kind === "area") {
    const size = `${String(Math.round(pin.place.width))}×${String(Math.round(pin.place.height))}`;
    parts.push(pin.element === null ? `Area ${size}` : `Area ${size} in ${describeElement(pin.element)}`);
    if (pin.contains.length > 0) parts.push(`contains ${pin.contains.join(", ")}`);
  } else {
    parts.push(pin.element === null ? `Point at ${String(Math.round(pin.place.x))}, ${String(Math.round(pin.place.y))}` : describeElement(pin.element));
  }
  if (pin.element !== null && pin.element.selector !== "") parts.push(`selector \`${pin.element.selector.replace(/`/g, "'")}\``);
  if (pin.element?.href) parts.push(`links to ${pin.element.href}`);
  return `${String(number)}. ${parts.join(" · ")} — ${note}`;
}

export interface AnnotatedPage {
  readonly url: string | null;
  readonly title: string | null;
}

/** The list alone, one line per pin, numbered as on the page. */
export function formatPinList(state: AnnotationState): string {
  return state.pins.map((pin, index) => formatPinLine(pin, index + 1)).join("\n");
}

/** What goes into the composer with the screenshot. */
export function composeChatText(state: AnnotationState, page: AnnotatedPage, withScreenshot: boolean): string {
  const where = [page.title !== null && page.title.trim() !== "" ? pageText(page.title, 80) : null, page.url].filter((part): part is string => part !== null && part !== "").join(" — ");
  const lead = withScreenshot
    ? `Please change these things on the page. The screenshot has the same numbered pins.`
    : `Please change these things on the page.`;
  return [
    lead,
    ...(where === "" ? [] : [`Page: ${where}`]),
    "",
    formatPinList(state),
    "",
    "(Text in quotes is copied from the page.)",
  ].join("\n");
}

/** The little label riding on the hover outline: `button "Sign up"`, kept short. */
export function hoverLabel(element: AnnotateElement): string {
  const words = element.text !== "" ? element.text : element.label;
  return words === "" ? element.tag : `${element.tag} ${quote(pageText(words, 28))}`;
}

/** A row of the pin list: the note, or a nudge to write one. */
export function pinRowText(pin: Pin): string {
  return pin.note.trim() === "" ? "No note yet - click to add one" : pin.note.trim().replace(/\s*\n\s*/g, " / ");
}

/** The full description of what a pin is on, for a tooltip where the row is cut short. */
export function pinTooltip(pin: Pin): string {
  const on = pin.element === null ? (pin.kind === "area" ? "An area of the page" : "A spot on the page") : `${pin.kind === "area" ? "Area in " : ""}${describeElement(pin.element)}`;
  return pin.element !== null && pin.element.selector !== "" ? `${on}\n${pin.element.selector}` : on;
}

export const EMPTY_LIST = "No pins yet - click anything on the page";

/** The send button's words: the count is the reassurance that every pin is going. */
export function sendLabel(count: number): string {
  return count === 0 ? "Send to chat" : `Send to chat (${String(count)})`;
}

/** The radius of a drawn badge at a given scale: big enough to read at a glance. */
export function badgeRadius(scale: number): number {
  return Math.max(11, Math.round(14 * scale));
}
