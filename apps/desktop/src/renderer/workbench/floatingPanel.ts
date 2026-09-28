/**
 * A non-modal floating panel: the one home for everything that used to dock on the right.
 *
 * Changes, the project overview, the chat's activity inspector and the IDE's assistant all
 * open in one of these. They float over the work instead of squeezing it, so the editor and
 * the conversation always keep the full width of the window.
 *
 * What it guarantees:
 *  - It is a labelled `role="dialog"` with `aria-modal="false"`: what is behind it stays
 *    usable, and a screen reader still announces it as its own region.
 *  - Drag by the header, resize from any of eight edges, double-click the header to maximise.
 *  - Geometry is remembered per panel and clamped on the way in and on every window resize,
 *    so a header can never end up somewhere a pointer cannot reach (see `floatingLayout.ts`).
 *  - Escape closes it when focus is inside, and focus goes back where it came from.
 *  - Below `FLOATING_SHEET_BREAKPOINT` it is a full-window sheet: there is no room to float.
 *
 * The content element is appended once and never moved again, so a panel can host live
 * state - a streaming conversation, a scrolled diff - without losing it on open or close.
 */
import {
  FLOATING_SHEET_BREAKPOINT,
  bottomRightIn,
  centreIn,
  clampSize,
  clampToViewport,
  fitInViewport,
  maximisedIn,
  resizeGeometry,
  type Geometry,
  type ResizeEdge,
  type Size,
} from "./floatingLayout.ts";
import { ICON, createIcon, iconButton } from "./icons.ts";

export interface FloatingPanelOptions {
  /** Storage key and DOM id suffix, e.g. "changes". */
  readonly id: string;
  readonly title: string;
  readonly content: HTMLElement;
  readonly defaultSize: Size;
  readonly anchor: "centre" | "bottom-right";
  /** Extra classes on the panel, e.g. "assistant-dock" so the chat keeps its docked styling. */
  readonly className?: string;
  readonly headerActions?: readonly HTMLElement[];
  readonly onVisibilityChange?: (open: boolean) => void;
}

export interface FloatingPanel {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** Bring this panel above the other floating panels. */
  raise(): void;
  setTitle(title: string): void;
  /** Forget where it was put: back to its default size and place. */
  resetGeometry(): void;
  /**
   * Live inside another element - a modal popup that must not cover it - or, with null, back
   * in the shared floating layer. A modal dialog is in the top layer; a panel opened from
   * inside one has to be too, or it would sit behind the dialog's backdrop, unclickable.
   */
  setHost(host: HTMLElement | null): void;
}

const panels: FloatingPanel[] = [];

/** Every floating panel back to its default size and place - the way out of a lost layout. */
export function resetAllFloatingPanels(): void {
  for (const panel of panels) panel.resetGeometry();
}

const EDGES: readonly ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const MAXIMISE = "M3 3h10v10H3z";
const RESTORE = "M5 3h8v8M3 5h8v8H3z";
/** Stacking order, bottom to top. A raised panel moves to the end. */
const stack: HTMLElement[] = [];
const Z_BASE = 32;

function layer(): HTMLElement {
  let host = document.getElementById("floating-layer");
  if (host === null) {
    host = document.createElement("div");
    host.id = "floating-layer";
    document.body.append(host);
  }
  return host;
}

function restack(): void {
  stack.forEach((panel, index) => { panel.style.zIndex = String(Z_BASE + index); });
}

interface Stored {
  readonly geometry: Geometry | null;
  readonly maximised: boolean;
}

function readStored(key: string): Stored {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (typeof raw !== "object" || raw === null) return { geometry: null, maximised: false };
    const value = raw as { position?: { x?: unknown; y?: unknown }; size?: { width?: unknown; height?: unknown }; maximised?: unknown };
    const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
    const geometry = finite(value.position?.x) && finite(value.position?.y) && finite(value.size?.width) && finite(value.size?.height)
      ? { position: { x: value.position.x, y: value.position.y }, size: { width: value.size.width, height: value.size.height } }
      : null;
    return { geometry, maximised: value.maximised === true };
  } catch {
    // Missing, unparsable or blocked storage costs a remembered layout, nothing more.
    return { geometry: null, maximised: false };
  }
}

export function createFloatingPanel(options: FloatingPanelOptions): FloatingPanel {
  const storageKey = `adcode.float.${options.id}`;
  const element = document.createElement("section");
  element.className = `floating-panel${options.className ? ` ${options.className}` : ""}`;
  element.id = `floating-${options.id}`;
  element.dataset["panel"] = options.id;
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "false");
  element.hidden = true;

  const header = document.createElement("header");
  header.className = "floating-panel-header";
  const title = document.createElement("h2");
  title.className = "floating-panel-title";
  title.id = `floating-${options.id}-title`;
  title.textContent = options.title;
  element.setAttribute("aria-labelledby", title.id);
  const actions = document.createElement("div");
  actions.className = "floating-panel-actions";
  actions.append(...(options.headerActions ?? []));
  const maximise = iconButton("Maximise", MAXIMISE, "icon-button floating-panel-maximise");
  const close = iconButton(`Close ${options.title}`, ICON.close, "icon-button floating-panel-close");
  actions.append(maximise, close);
  header.append(title, actions);

  const body = document.createElement("div");
  body.className = "floating-panel-body";
  body.append(options.content);
  element.append(header, body);
  for (const edge of EDGES) {
    const handle = document.createElement("div");
    handle.className = "floating-panel-edge";
    handle.dataset["edge"] = edge;
    handle.setAttribute("aria-hidden", "true");
    handle.addEventListener("pointerdown", (event) => startResize(event, edge, handle));
    element.append(handle);
  }
  layer().append(element);

  const stored = readStored(storageKey);
  let geometry: Geometry | null = stored.geometry;
  let maximised = stored.maximised;
  let open = false;
  let returnFocus: HTMLElement | null = null;

  const viewport = (): { width: number; height: number } => ({ width: window.innerWidth, height: window.innerHeight });

  function initial(): Geometry {
    const size = clampSize(options.defaultSize, viewport());
    const position = options.anchor === "bottom-right" ? bottomRightIn(size, viewport()) : centreIn(size, viewport());
    return { position, size };
  }

  function persist(): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ ...(geometry ?? initial()), maximised }));
    } catch {
      // Optional storage.
    }
  }

  /** Fit: fully on screen when it fits (open, window resize). Otherwise the looser drag clamp. */
  function apply(fit = false): void {
    const bounds = viewport();
    const sheet = bounds.width < FLOATING_SHEET_BREAKPOINT;
    element.dataset["sheet"] = String(sheet);
    element.dataset["maximised"] = String(maximised && !sheet);
    maximise.title = maximised ? "Restore size" : "Maximise";
    maximise.setAttribute("aria-label", maximise.title);
    maximise.replaceChildren(createIcon(maximised ? RESTORE : MAXIMISE));
    if (sheet) {
      element.style.removeProperty("width");
      element.style.removeProperty("height");
      element.style.removeProperty("transform");
      return;
    }
    // Clamped on the way in, every time: the window may have shrunk since it was saved.
    const current = maximised ? maximisedIn(bounds) : (geometry ?? initial());
    const size = clampSize(current.size, bounds);
    const position = fit ? fitInViewport(current.position, size, bounds) : clampToViewport(current.position, size, bounds);
    if (!maximised) geometry = { position, size };
    element.style.width = `${size.width}px`;
    element.style.height = `${size.height}px`;
    element.style.transform = `translate(${position.x}px, ${position.y}px)`;
  }

  function raise(): void {
    const index = stack.indexOf(element);
    if (index >= 0) stack.splice(index, 1);
    stack.push(element);
    restack();
  }

  function startResize(event: PointerEvent, edge: ResizeEdge, handle: HTMLElement): void {
    if (event.button !== 0 || element.dataset["sheet"] === "true") return;
    event.preventDefault();
    if (maximised) { geometry = maximisedIn(viewport()); maximised = false; }
    const start = geometry ?? initial();
    const originX = event.clientX;
    const originY = event.clientY;
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent): void => {
      geometry = resizeGeometry(start, edge, moveEvent.clientX - originX, moveEvent.clientY - originY, viewport());
      apply();
    };
    const release = (): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", release);
      handle.removeEventListener("pointercancel", release);
      persist();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", release);
    handle.addEventListener("pointercancel", release);
  }

  header.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || element.dataset["sheet"] === "true") return;
    // The header also holds buttons; dragging from one would swallow its click.
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea") !== null) return;
    if (maximised) return;
    const start = geometry ?? initial();
    const offsetX = event.clientX - start.position.x;
    const offsetY = event.clientY - start.position.y;
    header.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent): void => {
      geometry = { position: { x: moveEvent.clientX - offsetX, y: moveEvent.clientY - offsetY }, size: start.size };
      apply();
    };
    const release = (): void => {
      header.removeEventListener("pointermove", move);
      header.removeEventListener("pointerup", release);
      header.removeEventListener("pointercancel", release);
      persist();
    };
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", release);
    header.addEventListener("pointercancel", release);
  });
  header.addEventListener("dblclick", (event) => {
    if ((event.target as HTMLElement).closest("button") !== null) return;
    toggleMaximised();
  });
  function toggleMaximised(): void {
    maximised = !maximised;
    apply(true);
    persist();
  }
  maximise.addEventListener("click", toggleMaximised);
  close.addEventListener("click", () => api.close());
  element.addEventListener("pointerdown", () => raise(), true);
  element.addEventListener("focusin", () => raise());
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // A menu or popover inside the panel closes itself first.
    if (document.querySelector(".menu-panel") !== null) return;
    event.preventDefault();
    event.stopPropagation();
    api.close();
  });
  window.addEventListener("resize", () => { if (open) apply(true); });

  const api: FloatingPanel = {
    element,
    open(): void {
      if (open) { raise(); return; }
      const active = document.activeElement;
      returnFocus = active instanceof HTMLElement && active !== document.body && !element.contains(active) ? active : null;
      open = true;
      element.hidden = false;
      apply(true);
      // Grow out of whatever opened it: motion.css animates `scale` from this point, which
      // leaves the translate that positions the panel alone.
      const origin = returnFocus?.isConnected === true ? returnFocus.getBoundingClientRect() : null;
      const box = element.getBoundingClientRect();
      element.style.transformOrigin =
        origin !== null && origin.width > 0
          ? `${String(Math.round(origin.left + origin.width / 2 - box.left))}px ${String(Math.round(origin.top + origin.height / 2 - box.top))}px`
          : "50% 0";
      raise();
      options.onVisibilityChange?.(true);
    },
    close(): void {
      if (!open) return;
      open = false;
      const hadFocus = element.contains(document.activeElement);
      element.hidden = true;
      const index = stack.indexOf(element);
      if (index >= 0) stack.splice(index, 1);
      restack();
      if (hadFocus && returnFocus?.isConnected) returnFocus.focus();
      returnFocus = null;
      options.onVisibilityChange?.(false);
    },
    toggle(): void {
      if (open) api.close();
      else api.open();
    },
    isOpen: () => open,
    raise,
    setTitle(text: string): void {
      title.textContent = text;
      close.title = `Close ${text}`;
      close.setAttribute("aria-label", close.title);
    },
    setHost(host: HTMLElement | null): void {
      const target = host ?? layer();
      if (element.parentElement !== target) target.append(element);
    },
    resetGeometry(): void {
      geometry = null;
      maximised = false;
      try { localStorage.removeItem(storageKey); } catch { /* Optional storage. */ }
      if (open) apply(true);
    },
  };
  panels.push(api);
  return api;
}
