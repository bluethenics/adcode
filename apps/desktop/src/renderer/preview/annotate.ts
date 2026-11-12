/**
 * Annotate: point at things on a page and say what to change.
 *
 * In the Browser or the Preview, Annotate lays a clear sheet over the page. Each click drops a
 * big numbered pin and asks "what should change?"; a drag boxes an area instead. Send to chat
 * puts a screenshot with the same numbers drawn on it into the chat composer, together with
 * one line per pin naming the element (tag, words, selector) and the note. The assistant then
 * knows which "this" each note means.
 *
 * How the sheet stays honest about the page under it:
 *  - Clicks land on the sheet, never on the page, so annotating cannot press a page's buttons.
 *    The page keeps running, and scrolling (wheel, arrows, Page Up/Down) is passed through.
 *  - Each pin asks the page what is under it with a fixed, one-shot script (main process,
 *    `annotateProbeScript`): no listener, global or element is left in the page. Browser tabs
 *    run it in an isolated world the page cannot see.
 *  - After a scroll or resize the page is asked where each pinned element is now, so pins
 *    follow their element instead of the glass.
 *  - What the page says is data: checked in `annotateModel.ts`, shown with textContent, and
 *    quoted in the message.
 *
 * Motion is CSS (`annotate.css`), all transform and opacity behind both reduce-motion switches;
 * this file only sets the states it keys off and, for exits, waits for the animation to end.
 * Positions go in the `translate` property, never `transform`, so the `scale` and `transform`
 * the animations use compose with where a thing is instead of replacing it.
 */
import type { AnnotateProbe, AnnotateRect, AnnotateTarget } from "../../shared/api.ts";
import { ICON, createIcon } from "../workbench/icons.ts";
import {
  COACH_DRAG,
  COACH_LINE,
  EMPTY_LIST,
  IDENTITY_MAPPING,
  addPin,
  anchoredSelectors,
  attachElement,
  badgeRadius,
  clearPins,
  composeChatText,
  describeElement,
  dragRect,
  emptyAnnotations,
  findPin,
  hoverLabel,
  isDrag,
  parseProbeResult,
  pinNumber,
  pinRowText,
  pinTooltip,
  relocate,
  removePin,
  sendLabel,
  setNote,
  toLayer,
  toPage,
  type AnnotationState,
  type LayerMapping,
  type Pin,
  type Point,
} from "./annotateModel.ts";

/** A page a surface can annotate right now. */
export interface AnnotatablePage {
  /** The `<webview>` or `<iframe>` showing it. */
  readonly element: HTMLElement;
  readonly target: AnnotateTarget;
  readonly url: string | null;
  readonly title: string | null;
}

export interface AnnotateSurface {
  /** "Browser" or "Preview", for the words on screen. */
  readonly name: string;
  /** Where the sheet mounts: the element holding the page, positioned. */
  readonly host: HTMLElement;
  /** The page on show, or a sentence saying why there is nothing to annotate. */
  page(): AnnotatablePage | string;
  /** Whether the surface is on screen at all. */
  isShown(): boolean;
  /** Something to say outside the sheet, such as why Annotate did not start. */
  notify(text: string): void;
}

export interface Annotator {
  /** The toolbar button: "Annotate", pressed while the sheet is up. */
  readonly button: HTMLButtonElement;
  isActive(): boolean;
  start(): void;
  stop(): void;
  toggle(): void;
}

/** What Send to chat hands over: the composer text, and the marked-up screenshot when there is one. */
export interface AnnotationMessage {
  readonly text: string;
  readonly image: File | null;
}

let sink: ((message: AnnotationMessage) => void) | null = null;

/** Where Send to chat goes. Set once by the workbench, which owns the chat. */
export function setAnnotationSink(next: (message: AnnotationMessage) => void): void {
  sink = next;
}

interface Registered {
  readonly surface: AnnotateSurface;
  api: Annotator | null;
  lastUsed: number;
}

const registry: Registered[] = [];

/**
 * The `browser.annotate` command: stop the sheet that is up, or start one on the surface the
 * person used last among those on screen. False when neither the Browser nor the Preview shows.
 */
export function annotateCurrentPage(): boolean {
  const running = registry.find((entry) => entry.api?.isActive() === true);
  if (running !== undefined) {
    running.api?.stop();
    return true;
  }
  const shown = registry.filter((entry) => entry.surface.isShown()).sort((a, b) => b.lastUsed - a.lastUsed);
  const chosen = shown[0];
  if (chosen === undefined) return false;
  chosen.api?.start();
  return true;
}

/**
 * The labelled toolbar button. A word beside the icon: an arrow alone says nothing to a
 * beginner. The arrow and sparkle are separate paths so hover can nudge one and switching on
 * can twinkle the other.
 */
function createAnnotateButton(surfaceName: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "annotate-toggle";
  button.title = `Annotate: click things on this ${surfaceName === "Preview" ? "preview" : "page"} and tell the assistant what to change`;
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", "false");
  const label = document.createElement("span");
  label.className = "annotate-toggle-label";
  label.textContent = "Annotate";
  button.append(createIcon([ICON.annotateArrow, ICON.annotateSparkle]), label);
  return button;
}

function intersect(a: DOMRect, b: DOMRect): { left: number; top: number; width: number; height: number } | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return right - left < 4 || bottom - top < 4 ? null : { left, top, width: right - left, height: bottom - top };
}

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

function sameTarget(a: AnnotateTarget, b: AnnotateTarget): boolean {
  return a.surface === b.surface && (a.surface !== "browser" || (b.surface === "browser" && a.tab === b.tab));
}

/** Restart a one-shot CSS animation keyed off a data attribute. */
function replay(node: HTMLElement, key: string): void {
  delete node.dataset[key];
  void node.offsetWidth;
  node.dataset[key] = "true";
}

/** Hide `node` once its exit animation ends - at once when motion is off and nothing runs. */
function hideAfterExit(node: HTMLElement, onHidden?: () => void): void {
  node.dataset["closing"] = "true";
  const finish = (): void => {
    if (node.dataset["closing"] !== "true") return;
    delete node.dataset["closing"];
    node.hidden = true;
    onHidden?.();
  };
  const running = typeof node.getAnimations === "function" ? node.getAnimations() : [];
  if (running.length === 0) { finish(); return; }
  void Promise.all(running.map((animation) => animation.finished.catch(() => undefined))).then(finish);
}

/** Show `node`, cancelling an exit still under way. */
function show(node: HTMLElement): void {
  delete node.dataset["closing"];
  node.hidden = false;
}

/** The base size of the hover outline; scaling it to an element is what lets it glide. */
const OUTLINE_BASE = 100;

export function createAnnotator(surface: AnnotateSurface): Annotator {
  const button = createAnnotateButton(surface.name);

  /* ── The sheet ── */
  const layer = document.createElement("div");
  layer.className = "annotate-layer";
  layer.tabIndex = -1;
  layer.hidden = true;
  layer.setAttribute("role", "application");
  layer.setAttribute("aria-label", `Annotating the ${surface.name.toLowerCase()}. ${COACH_LINE}.`);

  const catcher = document.createElement("div");
  catcher.className = "annotate-catcher";

  /* The hover outline: one box that glides and resizes by transform, and a label riding on it. */
  const outline = document.createElement("div");
  outline.className = "annotate-outline";
  outline.hidden = true;
  outline.setAttribute("aria-hidden", "true");
  const outlineLabel = document.createElement("div");
  outlineLabel.className = "annotate-outline-label";
  outlineLabel.hidden = true;
  outlineLabel.setAttribute("aria-hidden", "true");

  const pinsLayer = document.createElement("div");
  pinsLayer.className = "annotate-pins";

  const dragBox = document.createElement("div");
  dragBox.className = "annotate-area annotate-drag";
  dragBox.hidden = true;

  /* The note editor: one per sheet, moved to whichever pin is being written about. */
  const editor = document.createElement("form");
  editor.className = "annotate-editor";
  editor.hidden = true;
  const editorHead = document.createElement("div");
  editorHead.className = "annotate-editor-head";
  const editorBadge = document.createElement("span");
  editorBadge.className = "annotate-editor-badge";
  const editorTitle = document.createElement("label");
  editorTitle.className = "annotate-editor-title";
  editorTitle.textContent = "What should change?";
  editorHead.append(editorBadge, editorTitle);
  const editorWhat = document.createElement("p");
  editorWhat.className = "annotate-editor-what";
  const note = document.createElement("textarea");
  note.className = "annotate-note";
  note.rows = 2;
  note.maxLength = 500;
  note.placeholder = "For example: make this blue, or this button does nothing";
  note.id = `annotate-note-${surface.name.toLowerCase()}`;
  editorTitle.htmlFor = note.id;
  const editorActions = document.createElement("div");
  editorActions.className = "annotate-editor-actions";
  const deletePin = document.createElement("button");
  deletePin.type = "button";
  deletePin.className = "ghost-button annotate-delete";
  deletePin.textContent = "Delete pin";
  const savePin = document.createElement("button");
  savePin.type = "submit";
  savePin.className = "annotate-save";
  savePin.textContent = "Save note";
  editorActions.append(deletePin, savePin);
  editor.append(editorHead, editorWhat, note, editorActions);

  /* The coach: what to do, the pins so far, and the three ways out. */
  const coach = document.createElement("div");
  coach.className = "annotate-coach";
  coach.setAttribute("role", "toolbar");
  coach.setAttribute("aria-label", "Annotate");
  const coachTop = document.createElement("div");
  coachTop.className = "annotate-coach-top";
  const coachText = document.createElement("div");
  coachText.className = "annotate-coach-text";
  const coachIcon = createIcon([ICON.annotateArrow, ICON.annotateSparkle]);
  const coachWords = document.createElement("div");
  const coachLine = document.createElement("strong");
  coachLine.textContent = COACH_LINE;
  const coachHint = document.createElement("span");
  coachHint.textContent = COACH_DRAG;
  coachHint.setAttribute("aria-live", "polite");
  coachWords.append(coachLine, coachHint);
  coachText.append(coachIcon, coachWords);
  const clearAll = document.createElement("button");
  clearAll.type = "button";
  clearAll.className = "ghost-button annotate-clear";
  clearAll.textContent = "Clear all";
  clearAll.title = "Remove every pin";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "ghost-button annotate-done";
  done.textContent = "Done";
  done.title = "Leave Annotate (Esc). Your pins are thrown away";
  const send = document.createElement("button");
  send.type = "button";
  send.className = "annotate-send";
  send.title = "Put a screenshot with these pins, and a list of your notes, into the chat";
  const sendWords = document.createElement("span");
  sendWords.textContent = "Send to chat";
  const sendCount = document.createElement("span");
  sendCount.className = "annotate-send-count";
  send.append(sendWords, sendCount);
  const coachActions = document.createElement("div");
  coachActions.className = "annotate-coach-actions";
  coachActions.append(clearAll, done, send);
  coachTop.append(coachText, coachActions);
  const list = document.createElement("ol");
  list.className = "annotate-list";
  list.setAttribute("aria-label", "Your pins");
  const empty = document.createElement("p");
  empty.className = "annotate-empty";
  empty.textContent = EMPTY_LIST;
  coach.append(coachTop, list, empty);

  layer.append(catcher, outline, outlineLabel, pinsLayer, dragBox, editor, coach);

  /* "Sent": a short word on the page after the sheet has gone. */
  const sent = document.createElement("div");
  sent.className = "annotate-sent";
  sent.hidden = true;
  sent.setAttribute("role", "status");
  surface.host.append(layer, sent);

  /* ── State ── */
  let active = false;
  let state: AnnotationState = emptyAnnotations();
  let page: AnnotatablePage | null = null;
  let mapping: LayerMapping = IDENTITY_MAPPING;
  let visible: { left: number; top: number; width: number; height: number } | null = null;
  let editing: number | null = null;
  let sending = false;
  let generation = 0;
  let shownCount = -1;
  let sentTimer: ReturnType<typeof setTimeout> | null = null;
  interface PinNodes { readonly pin: HTMLButtonElement; readonly number: HTMLSpanElement; readonly tip: HTMLSpanElement; readonly area: HTMLElement | null; readonly row: HTMLLIElement; readonly rowNumber: HTMLSpanElement; readonly rowText: HTMLSpanElement }
  const pinNodes = new Map<number, PinNodes>();

  const entry: Registered = { surface, api: null, lastUsed: 0 };
  surface.host.addEventListener("pointerdown", () => { entry.lastUsed = Date.now(); }, true);

  function hint(text: string): void {
    coachHint.textContent = text;
  }

  /* ── Geometry: the sheet sits exactly over the visible part of the page ── */

  function layout(): boolean {
    if (page === null) return false;
    const element = page.element;
    const rect = element.getBoundingClientRect();
    const hostRect = surface.host.getBoundingClientRect();
    const shown = intersect(rect, hostRect);
    if (shown === null) return false;
    visible = shown;
    const scale = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
    mapping = {
      scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
      offsetX: rect.left + element.clientLeft * scale - shown.left,
      offsetY: rect.top + element.clientTop * scale - shown.top,
    };
    layer.style.left = `${String(shown.left - hostRect.left - surface.host.clientLeft + surface.host.scrollLeft)}px`;
    layer.style.top = `${String(shown.top - hostRect.top - surface.host.clientTop + surface.host.scrollTop)}px`;
    layer.style.width = `${String(shown.width)}px`;
    layer.style.height = `${String(shown.height)}px`;
    layer.dataset["compact"] = String(shown.width < 560);
    return true;
  }

  function pinPoint(pin: Pin): AnnotateRect {
    return toLayer(pin.place, mapping);
  }

  /** Pin and row light up together: hovering either shows which note belongs to which spot. */
  function highlight(id: number | null): void {
    for (const [key, nodes] of pinNodes) {
      const on = key === id;
      nodes.pin.dataset["highlight"] = String(on);
      nodes.row.dataset["highlight"] = String(on);
      if (nodes.area !== null) nodes.area.dataset["highlight"] = String(on);
    }
  }

  function makePinNodes(pin: Pin): PinNodes {
    const id = pin.id;
    const node = document.createElement("button");
    node.type = "button";
    node.className = "annotate-pin";
    node.dataset["kind"] = pin.kind;
    const number = document.createElement("span");
    number.className = "annotate-pin-number";
    const tip = document.createElement("span");
    tip.className = "annotate-pin-tip";
    tip.setAttribute("aria-hidden", "true");
    node.append(number, tip);
    node.addEventListener("click", (event) => { event.stopPropagation(); openEditor(id); });
    node.addEventListener("pointerenter", () => { highlight(id); hideOutline(); });
    node.addEventListener("pointerleave", () => highlight(null));
    let area: HTMLElement | null = null;
    if (pin.kind === "area") {
      area = document.createElement("div");
      area.className = "annotate-area";
      pinsLayer.append(area);
    }
    pinsLayer.append(node);

    const row = document.createElement("li");
    row.className = "annotate-row";
    const rowButton = document.createElement("button");
    rowButton.type = "button";
    rowButton.className = "annotate-row-button";
    const rowNumber = document.createElement("span");
    rowNumber.className = "annotate-row-number";
    const rowText = document.createElement("span");
    rowText.className = "annotate-row-text";
    rowButton.append(rowNumber, rowText);
    rowButton.addEventListener("click", () => openEditor(id));
    row.addEventListener("pointerenter", () => highlight(id));
    row.addEventListener("pointerleave", () => highlight(null));
    rowButton.addEventListener("focus", () => highlight(id));
    rowButton.addEventListener("blur", () => highlight(null));
    row.append(rowButton);
    list.append(row);
    return { pin: node, number, tip, area, row, rowNumber, rowText };
  }

  function paint(): void {
    const ids = new Set(state.pins.map((pin) => pin.id));
    for (const [id, nodes] of pinNodes) {
      if (ids.has(id)) continue;
      nodes.pin.remove();
      nodes.area?.remove();
      nodes.row.remove();
      pinNodes.delete(id);
    }
    for (const pin of state.pins) {
      let nodes = pinNodes.get(pin.id);
      if (nodes === undefined) {
        nodes = makePinNodes(pin);
        pinNodes.set(pin.id, nodes);
      }
      const number = String(pinNumber(state, pin.id));
      // A number that changed (a pin before it went) slides into place rather than snapping.
      if (nodes.number.textContent !== "" && nodes.number.textContent !== number) {
        replay(nodes.number, "renumber");
        replay(nodes.rowNumber, "renumber");
      }
      nodes.number.textContent = number;
      nodes.rowNumber.textContent = number;
      const at = pinPoint(pin);
      nodes.pin.style.translate = `${String(at.x)}px ${String(at.y)}px`;
      nodes.pin.dataset["lost"] = String(pin.lost);
      nodes.pin.dataset["editing"] = String(editing === pin.id);
      nodes.pin.dataset["side"] = at.x > (visible?.width ?? 0) - 200 ? "left" : "right";
      const said = pinRowText(pin);
      nodes.tip.textContent = said;
      nodes.pin.setAttribute("aria-label", `Pin ${number}: ${pin.note.trim() === "" ? "no note yet" : pin.note.trim()}. Click to edit or delete`);
      nodes.rowText.textContent = said;
      nodes.row.dataset["empty"] = String(pin.note.trim() === "");
      nodes.row.dataset["editing"] = String(editing === pin.id);
      nodes.row.title = `${pinTooltip(pin)}\n${said}`;
      if (nodes.area !== null) {
        nodes.area.style.translate = `${String(at.x)}px ${String(at.y)}px`;
        nodes.area.style.width = `${String(at.width)}px`;
        nodes.area.style.height = `${String(at.height)}px`;
        nodes.area.dataset["lost"] = String(pin.lost);
      }
    }
    const count = state.pins.length;
    list.hidden = count === 0;
    empty.hidden = count !== 0;
    sendWords.textContent = sending ? "Sending…" : "Send to chat";
    sendCount.hidden = sending || count === 0;
    if (count !== shownCount) {
      sendCount.textContent = `(${String(count)})`;
      // A small bump when the number moves, so the count is noticed without being read.
      if (shownCount > 0 || count > 0) replay(sendCount, "bump");
      shownCount = count;
    }
    send.setAttribute("aria-label", sending ? "Sending to chat" : sendLabel(count));
    send.disabled = sending || count === 0;
    clearAll.disabled = sending || count === 0;
    if (editing !== null) placeEditor();
  }

  /* ── Asking the page ── */

  async function ask(probe: AnnotateProbe): Promise<ReturnType<typeof parseProbeResult>> {
    if (page === null) return null;
    try {
      return parseProbeResult(await window.adcode.browser.annotate(page.target, probe));
    } catch {
      return null;
    }
  }

  let relocating = false;
  let relocateAgain = false;
  let relocateTimer: ReturnType<typeof setTimeout> | null = null;

  /** Ask where every pinned element is now, and move the pins there. */
  async function follow(): Promise<void> {
    if (!active) return;
    if (relocating) { relocateAgain = true; return; }
    const selectors = anchoredSelectors(state);
    if (selectors.every((selector) => selector === "")) return;
    relocating = true;
    const run = generation;
    const answer = await ask({ kind: "locate", selectors });
    relocating = false;
    if (run !== generation || !active) return;
    if (answer?.rects !== undefined && answer.rects.length === selectors.length && selectors.join("\n") === anchoredSelectors(state).join("\n")) {
      state = relocate(state, answer.rects);
      paint();
    }
    if (relocateAgain) { relocateAgain = false; void follow(); }
  }

  function followSoon(ms = 90): void {
    if (relocateTimer !== null) clearTimeout(relocateTimer);
    relocateTimer = setTimeout(() => { relocateTimer = null; void follow(); }, ms);
  }

  function relayout(): void {
    if (!active) return;
    const now = surface.page();
    if (typeof now === "string" || page === null || now.element !== page.element || !sameTarget(now.target, page.target)) {
      api.stop();
      return;
    }
    page = now;
    if (!layout()) return;
    hideOutline();
    paint();
    followSoon();
  }

  /* ── The hover outline ── */

  let hoverAt: Point | null = null;
  let hoverBusy = false;
  let hoverFrame = 0;

  function hideOutline(): void {
    hoverAt = null;
    outline.hidden = true;
    outlineLabel.hidden = true;
  }

  /** Ask what is under the pointer - one question in flight, the latest place wins. */
  async function probeHover(): Promise<void> {
    if (hoverBusy || hoverAt === null || !active || pressed !== null) return;
    hoverBusy = true;
    const asked = hoverAt;
    const run = generation;
    const answer = await ask({ kind: "point", ...toPage(asked, mapping) });
    hoverBusy = false;
    if (run !== generation || hoverAt === null || pressed !== null) return;
    const element = answer?.element ?? null;
    if (element === null) { outline.hidden = true; outlineLabel.hidden = true; }
    else {
      const box = toLayer(element.rect, mapping);
      const firstShow = outline.hidden;
      outline.dataset["instant"] = String(firstShow);
      outline.style.translate = `${String(box.x)}px ${String(box.y)}px`;
      outline.style.scale = `${String(Math.max(box.width, 1) / OUTLINE_BASE)} ${String(Math.max(box.height, 1) / OUTLINE_BASE)}`;
      outline.hidden = false;
      outlineLabel.textContent = hoverLabel(element);
      const labelTop = box.y > 26 ? box.y - 24 : box.y + Math.min(box.height, 4) + 2;
      const labelLeft = Math.min(Math.max(0, box.x), Math.max(0, (visible?.width ?? 0) - 220));
      outlineLabel.dataset["instant"] = String(firstShow);
      outlineLabel.style.translate = `${String(labelLeft)}px ${String(labelTop)}px`;
      outlineLabel.hidden = false;
    }
    if (hoverAt !== asked) void probeHover();
  }

  catcher.addEventListener("pointerenter", () => { if (editing === null) highlight(null); });
  catcher.addEventListener("pointerleave", () => hideOutline());

  /* ── Pins ── */

  async function drop(kind: Pin["kind"], place: AnnotateRect): Promise<void> {
    const added = addPin(state, kind, place);
    if (added === null) {
      hint("That is the most pins one message can carry. Send these, then start again.");
      return;
    }
    state = added.state;
    const id = added.pin.id;
    paint();
    openEditor(id);
    const run = generation;
    const answer = await ask(kind === "point" ? { kind: "point", x: place.x, y: place.y } : { kind: "area", ...place });
    if (run !== generation || findPin(state, id) === undefined) return;
    state = attachElement(state, id, answer?.element ?? null, answer?.contains ?? []);
    paint();
    if (editing === id) describeEditing();
  }

  function describeEditing(): void {
    const pin = editing === null ? undefined : findPin(state, editing);
    if (pin === undefined) return;
    if (pin.element === null) {
      editorWhat.textContent = pin.kind === "area" ? "The area you boxed" : "Reading what is here…";
      editorWhat.removeAttribute("title");
      return;
    }
    const what = describeElement(pin.element);
    editorWhat.textContent = pin.kind === "area" ? `Area in ${what}` : what;
    // The line is cut to one row; the tooltip has all of it, selector included.
    editorWhat.title = pinTooltip(pin);
  }

  function openEditor(id: number): void {
    const pin = findPin(state, id);
    if (pin === undefined) return;
    if (editing !== null && editing !== id) saveEditing();
    const reopening = editing !== null && !editor.hidden && editor.dataset["closing"] !== "true";
    editing = id;
    show(editor);
    if (!reopening) replay(editor, "open");
    editorBadge.textContent = String(pinNumber(state, id));
    note.value = pin.note;
    editorWhat.textContent = "";
    editorWhat.removeAttribute("title");
    describeEditing();
    hideOutline();
    paint();
    note.focus({ preventScroll: true });
  }

  function placeEditor(): void {
    const pin = editing === null ? undefined : findPin(state, editing);
    if (pin === undefined || visible === null) return;
    const at = pinPoint(pin);
    const width = editor.offsetWidth || 300;
    const height = editor.offsetHeight || 170;
    const ceiling = visible.height - coach.offsetHeight - 20;
    const anchorX = pin.kind === "area" ? at.x + at.width : at.x;
    let left = anchorX + 24;
    if (left + width > visible.width - 8) left = Math.max(8, at.x - width - 24);
    const top = Math.max(8, Math.min(at.y - 16, ceiling - height));
    editor.style.translate = `${String(Math.round(left))}px ${String(Math.round(top))}px`;
    // It grows out of the pin it belongs to.
    editor.style.transformOrigin = `${String(Math.round(at.x - left))}px ${String(Math.round(at.y - top))}px`;
  }

  function saveEditing(): void {
    if (editing === null) return;
    state = setNote(state, editing, note.value);
  }

  function closeEditor(save = true): void {
    if (editing === null) return;
    if (save) saveEditing();
    editing = null;
    hideAfterExit(editor);
    paint();
    layer.focus({ preventScroll: true });
  }

  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    closeEditor();
    hint(state.pins.length === 1 ? "Add more pins, or press Send to chat." : `${String(state.pins.length)} pins. Add more, or press Send to chat.`);
  });
  note.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      editor.requestSubmit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeEditor();
    }
  });
  note.addEventListener("input", () => { saveEditing(); paint(); });
  deletePin.addEventListener("click", () => {
    if (editing === null) return;
    const id = editing;
    editing = null;
    hideAfterExit(editor);
    state = removePin(state, id);
    paint();
    hint(state.pins.length === 0 ? COACH_DRAG : "Pin deleted. The others were renumbered.");
    layer.focus({ preventScroll: true });
  });

  /* ── Pointer: click for a pin, drag for a box ── */

  let pressed: { start: Point; id: number } | null = null;

  function local(event: { clientX: number; clientY: number }): Point {
    const rect = layer.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  catcher.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || sending) return;
    event.preventDefault();
    if (editing !== null) closeEditor();
    hideOutline();
    pressed = { start: local(event), id: event.pointerId };
    try { catcher.setPointerCapture(event.pointerId); } catch { /* A synthetic pointer has nothing to capture. */ }
  });
  catcher.addEventListener("pointermove", (event) => {
    if (pressed === null) {
      // Hovering: the outline follows, asked about at most once a frame.
      if (event.pointerType === "touch") return;
      hoverAt = local(event);
      if (hoverFrame === 0) hoverFrame = requestAnimationFrame(() => { hoverFrame = 0; void probeHover(); });
      return;
    }
    if (pressed.id !== event.pointerId) return;
    const now = local(event);
    if (!isDrag(pressed.start, now)) { dragBox.hidden = true; return; }
    const box = dragRect(pressed.start, now);
    dragBox.hidden = false;
    dragBox.style.translate = `${String(box.x)}px ${String(box.y)}px`;
    dragBox.style.width = `${String(box.width)}px`;
    dragBox.style.height = `${String(box.height)}px`;
  });
  const release = (event: PointerEvent): void => {
    if (pressed === null || pressed.id !== event.pointerId) return;
    const start = pressed.start;
    pressed = null;
    dragBox.hidden = true;
    if (event.type === "pointercancel") return;
    const end = local(event);
    if (isDrag(start, end)) {
      const box = dragRect(start, end);
      const corner = toPage({ x: box.x, y: box.y }, mapping);
      void drop("area", { x: corner.x, y: corner.y, width: box.width / mapping.scale, height: box.height / mapping.scale });
    } else {
      const at = toPage(end, mapping);
      void drop("point", { x: at.x, y: at.y, width: 0, height: 0 });
    }
  };
  catcher.addEventListener("pointerup", release);
  catcher.addEventListener("pointercancel", release);

  /* ── Scrolling passes through to the page, then pins follow ── */

  let pendingScroll = { dx: 0, dy: 0, at: { x: 0, y: 0 } as Point };
  let scrolling = false;

  async function flushScroll(): Promise<void> {
    if (scrolling || (pendingScroll.dx === 0 && pendingScroll.dy === 0)) return;
    scrolling = true;
    const { dx, dy, at } = pendingScroll;
    pendingScroll = { dx: 0, dy: 0, at };
    await ask({ kind: "scroll", x: at.x, y: at.y, dx, dy });
    scrolling = false;
    await follow();
    if (pendingScroll.dx !== 0 || pendingScroll.dy !== 0) void flushScroll();
  }

  function scrollBy(dx: number, dy: number, at: Point): void {
    hideOutline();
    pendingScroll = { dx: pendingScroll.dx + dx, dy: pendingScroll.dy + dy, at };
    void flushScroll();
  }

  layer.addEventListener("wheel", (event) => {
    if ((event.target as HTMLElement).closest(".annotate-editor, .annotate-coach") !== null) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (visible?.height ?? 600) : 1;
    scrollBy(event.deltaX * unit, event.deltaY * unit, toPage(local(event), mapping));
  }, { passive: false });

  layer.addEventListener("keydown", (event) => {
    const inEditor = (event.target as HTMLElement).closest(".annotate-editor") !== null;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (editing !== null) closeEditor();
      else api.stop();
      return;
    }
    if (inEditor || (event.target as HTMLElement).closest("button") !== null) return;
    const height = (visible?.height ?? 600) / mapping.scale;
    const centre = toPage({ x: (visible?.width ?? 0) / 2, y: (visible?.height ?? 0) / 2 }, mapping);
    const step: Record<string, number> = { ArrowDown: 48, ArrowUp: -48, PageDown: height * 0.85, PageUp: -height * 0.85, " ": height * 0.85 };
    const dy = step[event.key];
    if (dy !== undefined) {
      event.preventDefault();
      scrollBy(0, event.shiftKey && event.key === " " ? -dy : dy, centre);
    }
  });

  /* ── Leaving, clearing, sending ── */

  clearAll.addEventListener("click", () => {
    if (editing !== null) { editing = null; hideAfterExit(editor); }
    state = clearPins(state);
    paint();
    hint("All pins removed. Click anything to start again.");
    layer.focus({ preventScroll: true });
  });
  done.addEventListener("click", () => api.stop());
  send.addEventListener("click", () => void sendToChat());

  function readColour(name: string, fallback: string): string {
    const value = getComputedStyle(layer).getPropertyValue(name).trim();
    return value === "" ? fallback : value;
  }

  /** The screenshot with every pin drawn where it shows, as a PNG file. */
  async function markUp(dataUrl: string): Promise<File | null> {
    if (visible === null) return null;
    const image = new Image();
    image.src = dataUrl;
    try { await image.decode(); } catch { return null; }
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(image, 0, 0);
    const factor = image.naturalWidth / visible.width;
    // The sheet's own colours (see annotate.css), so the picture matches the screen.
    const pinFill = readColour("--annotate-pin", "#26241f");
    const pinText = readColour("--annotate-pin-text", "#ffffff");
    const ring = readColour("--annotate-ring", "#ffffff");
    const radius = badgeRadius(factor);
    state.pins.forEach((pin, index) => {
      const at = pinPoint(pin);
      const x = at.x * factor;
      const y = at.y * factor;
      if (pin.kind === "area") {
        const width = at.width * factor;
        const height = at.height * factor;
        context.globalAlpha = 0.12;
        context.fillStyle = pinFill;
        context.fillRect(x, y, width, height);
        context.globalAlpha = 1;
        // A solid ring under a dashed line: readable on a light page and a dark one.
        context.lineWidth = Math.max(3, 4 * factor);
        context.strokeStyle = ring;
        context.strokeRect(x, y, width, height);
        context.lineWidth = Math.max(2, 2.5 * factor);
        context.strokeStyle = pinFill;
        context.setLineDash([8 * factor, 5 * factor]);
        context.strokeRect(x, y, width, height);
        context.setLineDash([]);
      }
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = pinFill;
      context.fill();
      context.lineWidth = Math.max(2, 2.5 * factor);
      context.strokeStyle = ring;
      context.stroke();
      context.fillStyle = pinText;
      context.font = `700 ${String(Math.round(radius * 1.15))}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(index + 1), x, y + radius * 0.06);
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob === null ? null : new File([blob], "annotated-page.png", { type: "image/png" });
  }

  async function capture(): Promise<string | null> {
    if (page === null || visible === null) return null;
    if (page.target.surface === "browser") return window.adcode.browser.captureForAnnotate(page.target);
    // The Preview is captured from the window itself, so the sheet steps aside for one frame.
    const rect = { x: visible.left, y: visible.top, width: visible.width, height: visible.height };
    layer.style.visibility = "hidden";
    try {
      await frame();
      await frame();
      return await window.adcode.browser.captureForAnnotate({ surface: "preview", rect });
    } finally {
      layer.style.visibility = "";
    }
  }

  function confirmSent(count: number): void {
    sent.textContent = `Sent ${String(count)} ${count === 1 ? "note" : "notes"} to chat`;
    show(sent);
    replay(sent, "open");
    if (sentTimer !== null) clearTimeout(sentTimer);
    sentTimer = setTimeout(() => { sentTimer = null; hideAfterExit(sent); }, 1600);
  }

  async function sendToChat(): Promise<void> {
    if (sending || page === null) return;
    if (editing !== null) closeEditor();
    if (state.pins.length === 0) { hint("Click something on the page first."); return; }
    sending = true;
    hideOutline();
    paint();
    hint("Taking the screenshot…");
    let image: File | null = null;
    try {
      layout();
      const shot = await capture();
      if (shot !== null) image = await markUp(shot);
    } catch {
      image = null;
    }
    const text = composeChatText(state, { url: page.url, title: page.title }, image !== null);
    sending = false;
    if (sink === null) {
      hint("The chat is not ready yet. Try again in a moment.");
      paint();
      return;
    }
    const count = state.pins.length;
    sink({ text, image });
    api.stop();
    confirmSent(count);
    if (image === null) surface.notify(`${String(count)} ${count === 1 ? "note is" : "notes are"} in the chat. The screenshot could not be taken, so only the list went.`);
  }

  /* ── Keeping the sheet on the page ── */

  const resize = new ResizeObserver(() => relayout());
  const styleWatch = new MutationObserver(() => relayout());
  const onWindowResize = (): void => relayout();
  const onDocumentKey = (event: KeyboardEvent): void => {
    // Esc anywhere outside a text field leaves, even before the sheet has focus.
    if (event.key !== "Escape" || !active) return;
    const target = event.target as HTMLElement | null;
    if (target !== null && layer.contains(target)) return;
    if (target !== null && target !== document.body && target.closest("input, textarea, [contenteditable='true'], dialog") !== null) return;
    event.preventDefault();
    api.stop();
  };

  const api: Annotator = {
    button,
    isActive: () => active,
    start(): void {
      if (active) return;
      const now = surface.page();
      if (typeof now === "string") { surface.notify(now); return; }
      page = now;
      generation += 1;
      state = emptyAnnotations();
      shownCount = -1;
      active = true;
      layer.hidden = false;
      editor.hidden = true;
      delete editor.dataset["closing"];
      editing = null;
      hideOutline();
      entry.lastUsed = Date.now();
      if (!layout()) {
        api.stop();
        surface.notify(`Make the ${surface.name} bigger to annotate it.`);
        return;
      }
      hint(COACH_DRAG);
      paint();
      button.setAttribute("aria-pressed", "true");
      replay(button, "twinkle");
      surface.host.dataset["annotating"] = "true";
      resize.observe(surface.host);
      resize.observe(now.element);
      styleWatch.observe(now.element, { attributes: true, attributeFilter: ["style", "class"] });
      window.addEventListener("resize", onWindowResize);
      document.addEventListener("keydown", onDocumentKey, true);
      layer.focus({ preventScroll: true });
    },
    stop(): void {
      if (!active) return;
      active = false;
      generation += 1;
      state = emptyAnnotations();
      editing = null;
      sending = false;
      pressed = null;
      page = null;
      hideOutline();
      if (hoverFrame !== 0) { cancelAnimationFrame(hoverFrame); hoverFrame = 0; }
      pinNodes.forEach((nodes) => { nodes.pin.remove(); nodes.area?.remove(); nodes.row.remove(); });
      pinNodes.clear();
      layer.hidden = true;
      editor.hidden = true;
      dragBox.hidden = true;
      button.setAttribute("aria-pressed", "false");
      delete button.dataset["twinkle"];
      delete surface.host.dataset["annotating"];
      resize.disconnect();
      styleWatch.disconnect();
      if (relocateTimer !== null) { clearTimeout(relocateTimer); relocateTimer = null; }
      window.removeEventListener("resize", onWindowResize);
      document.removeEventListener("keydown", onDocumentKey, true);
      if (layer.contains(document.activeElement)) button.focus({ preventScroll: true });
    },
    toggle(): void {
      if (active) api.stop();
      else api.start();
    },
  };

  button.addEventListener("click", () => {
    entry.lastUsed = Date.now();
    api.toggle();
  });

  entry.api = api;
  registry.push(entry);
  return api;
}
