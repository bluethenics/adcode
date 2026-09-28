/**
 * The live preview surface: the user's site, running, beside the code that makes it.
 *
 * Two engines sit behind it - ADCode's static file server, and the project's own dev
 * script - and the bar always says which one is running. That distinction is not trivia:
 * "why is my page blank" has one answer when a folder is being served as files and a
 * completely different one when Vite is compiling it.
 *
 * The page renders in an iframe pointed at a loopback address. That frame is cross-origin
 * against the renderer's `app://adcode`, so the previewed page cannot reach into the
 * workbench's DOM even though it sits in the same window. The CSP allows the loopback
 * origins in `frame-src` and nothing else.
 *
 * The output drawer is the other half of "test and debug your code". A dev server that
 * fails to start is the commonest wall a beginner hits, and the toolchain's own words are
 * the useful thing - so they are shown, and shown automatically when something goes wrong.
 *
 * **Always floating, and why the iframe never moves.** The preview is a window floating over
 * the work - there is no right-hand column to dock it into any more. It moves, resizes from
 * any edge and maximises, and none of that touches the iframe: reparenting an iframe destroys
 * its document and reloads the user's page, so the pane stays exactly where it is in the DOM
 * and only its `position: fixed` geometry changes. Maximising costs nothing and the page
 * keeps running.
 */
import type { PreviewMode, PreviewStatus } from "../../shared/api.ts";
import { createDeviceToolbar, type DeviceToolbar } from "./deviceToolbar.ts";
import { createElementInspector, type ElementInspector, type InspectedBox } from "./elementInspector.ts";
import { formatViewport, parseViewport } from "./deviceSizes.ts";
import { ICON, createIcon, iconButton } from "../workbench/icons.ts";
import {
  centreIn,
  clampSize,
  clampToViewport,
  fitInViewport,
  maximisedIn,
  parsePoint,
  parseSize,
  resizeGeometry,
  type Point,
  type ResizeEdge,
  type Size,
} from "../workbench/floatingLayout.ts";

export interface PreviewPaneDeps {
  /** Where the pane mounts. Its width is driven by `--preview-width` on this element. */
  readonly host: HTMLElement;
  /** Monaco does not observe its container, so every width change has to say so. */
  readonly onLayoutChange: () => void;
  readonly notify: (message: string) => void;
  /**
   * Report a preview failure into the Problems panel.
   *
   * The panel was built first precisely so that this would have somewhere honest to report
   * to, rather than growing a second error surface of its own.
   */
  readonly reportProblem: (message: string | null) => void;
  /** Point-and-fix: an element picked in the inspector, with the page it is on. */
  readonly onFixElement?: (box: InspectedBox, pageUrl: string | null) => void;
}

/**
 * Where the preview sits: always a floating window now that nothing docks on the right.
 *
 * Deliberately not called `PreviewMode`: that name is already taken, by the choice between
 * the static file server and the project's dev script.
 */
export type PreviewPlacement = "floating";

export interface PreviewPane {
  open(): Promise<void>;
  close(): Promise<void>;
  toggle(): Promise<void>;
  isOpen(): boolean;
  reload(): void;
  /** Restart under the other engine. Ignored when no dev script was detected. */
  switchMode(): Promise<void>;
  /** Fill the window, or go back to the size it had. */
  toggleMaximised(): void;
  isMaximised(): boolean;
  /** Back to the default size, centred, not maximised - and forget the remembered place. */
  resetGeometry(): void;
  placement(): PreviewPlacement;
  /**
   * Turn device-size preview on or off.
   *
   * Checking a layout at a phone width without leaving the editor. Resizing never reloads
   * the page - see `deviceToolbar.ts` for why that is the whole design.
   */
  toggleDevice(): void;
  /**
   * Turn the element inspector on or off.
   *
   * Right-click an element in the preview to see its width, height, padding,
   * margin and markup. Only the static file server injects the bridge; on a
   * project dev server the toggle explains that instead of pretending.
   */
  toggleInspect(): void;
  isInspecting(): boolean;
  /** Placement, position and size are remembered per folder, as the chat card is. */
  setWorkspace(root: string | null): void;
}

/** Enough to read a stack trace without letting a chatty watcher grow without bound. */
const LOG_LIMIT = 40_000;

const MAXIMISE = "M3 3h10v10H3z";
const RESTORE = "M5 3h8v8M3 5h8v8H3z";
const EDGES: readonly ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

function storageKey(workspace: string | null, part: string): string {
  return `adcode.preview.${part}.${workspace ?? "no-workspace"}`;
}

function read(workspace: string | null, part: string): string | null {
  try {
    return localStorage.getItem(storageKey(workspace, part));
  } catch {
    return null;
  }
}

function write(workspace: string | null, part: string, value: string): void {
  try {
    localStorage.setItem(storageKey(workspace, part), value);
  } catch {
    // A full or disabled storage costs a remembered layout, nothing more.
  }
}

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function createPreviewPane(deps: PreviewPaneDeps): PreviewPane {
  const pane = document.createElement("div");
  pane.className = "preview-pane";
  pane.hidden = true;

  const bar = document.createElement("header");
  bar.className = "preview-bar";

  const engine = document.createElement("button");
  engine.type = "button";
  engine.className = "preview-engine";
  engine.hidden = true;

  const address = document.createElement("span");
  address.className = "preview-url";
  address.textContent = "Not running";

  const deviceButton = iconButton("Check other screen sizes", ICON.device);
  const inspectButton = iconButton("Inspect an element's size and spacing", ICON.inspect);
  const logButton = iconButton("Show output", ICON.output);
  const reloadButton = iconButton("Reload preview", ICON.reload);
  const maximiseButton = iconButton("Maximise preview", MAXIMISE);
  const externalButton = iconButton("Open in browser", ICON.external);
  const closeButton = iconButton("Close preview", ICON.close);

  bar.append(
    engine,
    address,
    deviceButton,
    inspectButton,
    logButton,
    reloadButton,
    maximiseButton,
    externalButton,
    closeButton,
  );

  const frame = document.createElement("iframe");
  frame.className = "preview-frame";
  frame.title = "Live preview";
  /*
   * `allow-same-origin` is what lets the injected reload script open an `EventSource` back
   * to the server that served the page - without it the frame gets an opaque origin and
   * the connection is refused, so the preview loads once and never updates again.
   *
   * It does not weaken the boundary that matters. The frame's origin is the loopback
   * server, not the workbench, so "same origin" means same as itself. `allow-top-
   * navigation` is deliberately absent: a page must not navigate the window previewing it.
   */
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");

  const output = document.createElement("pre");
  output.className = "preview-output";
  output.hidden = true;

  /**
   * Resize handles on every edge, and the reason they are elements rather than
   * `resize: both`: CSS resize does not work on a flex container with an iframe inside it, and
   * it draws the platform's own grip, which belongs to no other control in this window.
   */
  const edges = EDGES.map((edge) => {
    const handle = document.createElement("div");
    handle.className = "preview-edge";
    handle.dataset["edge"] = edge;
    handle.setAttribute("aria-hidden", "true");
    return handle;
  });

  /*
   * The frame's home.
   *
   * Built here, once, with the iframe placed inside it before the iframe has ever loaded
   * anything - which is the only moment it can be done. Moving the iframe later would
   * destroy its document and reload the user's page, which is the trap this file's header
   * describes and which device sizing would otherwise hit on every layout change.
   *
   * The stage scrolls, so a viewport larger than the pane at 100% can still be inspected.
   */
  const stage = document.createElement("div");
  stage.className = "preview-stage";
  stage.dataset["device"] = "off";
  stage.append(frame);

  const deviceToolbar: DeviceToolbar = createDeviceToolbar({
    frame,
    stage,
    persist: (viewport) =>
      write(workspace, "device", viewport === null ? "" : formatViewport(viewport)),
  });

  const inspector: ElementInspector = createElementInspector({
    frame,
    ...(deps.onFixElement === undefined ? {} : { onFix: (box: InspectedBox) => deps.onFixElement?.(box, currentUrl) }),
  });

  pane.append(bar, deviceToolbar.element, stage, inspector.element, output, ...edges);
  deps.host.append(pane);

  /*
   * Refit on any change to the stage's size, whatever caused it: the docked splitter, a
   * floating drag, the window resizing, the output drawer opening. Observing the element is
   * the only way to catch all four without a call at each site, and a missed one shows up
   * as a frame that stays scaled for the wrong pane width.
   */
  new ResizeObserver(() => deviceToolbar.refit()).observe(stage);

  let open = false;
  let currentUrl: string | null = null;
  let mode: PreviewMode = "static";
  let projectLabel: string | null = null;
  let logShown = false;

  let workspace: string | null = null;
  let placement: PreviewPlacement = "floating";
  let position: Point = { x: 0, y: 0 };
  let size: Size = { width: 560, height: 420 };
  let maximised = false;
  let positioned = false;

  /* ── Geometry ───────────────────────────────────────────────────────────── */

  /** Fit: fully on screen when it fits (open, window resize). Otherwise the looser drag clamp. */
  function applyGeometry(fit = false): void {
    const bounds = viewport();
    // First open in this folder: no remembered position, so centre it rather than dropping
    // it at the origin under the title bar.
    if (!positioned) {
      position = centreIn(clampSize(size, bounds), bounds);
      positioned = true;
    }
    // Clamped on the way in, every time. A card that was reachable at 1440px is not
    // necessarily reachable after the window is dragged down to 900.
    const current = maximised ? maximisedIn(bounds) : { position, size };
    const nextSize = clampSize(current.size, bounds);
    const nextPosition = fit ? fitInViewport(current.position, nextSize, bounds) : clampToViewport(current.position, nextSize, bounds);
    if (!maximised) {
      size = nextSize;
      position = nextPosition;
    }
    pane.style.width = `${nextSize.width}px`;
    pane.style.height = `${nextSize.height}px`;
    pane.style.transform = `translate(${nextPosition.x}px, ${nextPosition.y}px)`;
  }

  /** The attribute and the button; nothing here relayouts the editor. */
  function applyPlacementChrome(): void {
    pane.dataset["placement"] = placement;
    pane.dataset["maximised"] = String(maximised);
    maximiseButton.title = maximised ? "Restore preview size" : "Maximise preview";
    maximiseButton.setAttribute("aria-label", maximiseButton.title);
    maximiseButton.replaceChildren(createIcon(maximised ? RESTORE : MAXIMISE));
  }

  function applyPlacement(): void {
    applyPlacementChrome();
    applyGeometry(true);
    // Nothing reserves a column for the preview any more; the editor keeps its full width.
    deps.host.style.setProperty("--preview-width", "0px");
  }

  function toggleMaximised(): void {
    maximised = !maximised;
    write(workspace, "maximised", String(maximised));
    if (open) applyPlacement();
    else applyPlacementChrome();
  }

  function showLog(show: boolean): void {
    logShown = show;
    output.hidden = !show;
    pane.dataset["log"] = show ? "shown" : "hidden";
    logButton.title = show ? "Hide output" : "Show output";
  }

  function apply(status: PreviewStatus): void {
    currentUrl = status.url;
    mode = status.mode;

    engine.hidden = projectLabel === null;
    engine.textContent = status.mode === "project" ? "Project" : "Files";
    engine.title =
      status.mode === "project"
        ? `Running ${status.label ?? "this project"} — click to serve the folder as plain files instead`
        : `Serving the folder as plain files — click to run ${projectLabel ?? "the project"} instead`;

    if (status.error !== null) {
      address.textContent = status.error;
      address.dataset["tone"] = "error";
      deps.reportProblem(status.error);

      // Opened without being asked. The error is one line; the reason is in the output,
      // and making someone hunt for a button to see it is the whole failure being repeated.
      if (!logShown) showLog(true);
      return;
    }

    delete address.dataset["tone"];
    deps.reportProblem(null);

    if (status.starting) {
      address.textContent = `Starting ${status.label ?? "the preview"}…`;
      address.dataset["tone"] = "pending";
      return;
    }

    if (status.url === null) {
      address.textContent = "Not running";
      frame.removeAttribute("src");
      return;
    }

    address.textContent = status.url;
    // Only reassign when it actually changed: setting `src` to its current value reloads
    // the frame, and a status broadcast arriving mid-edit would throw away the user's
    // scroll position and any state their page was holding.
    if (frame.getAttribute("src") !== status.url) frame.src = status.url;
  }

  // The preview can change without the renderer asking: a dev server announces its address
  // a minute after starting, crashes on a syntax error, or is stopped because the folder
  // was closed. A bar that only updated on click would be wrong most of the time.
  window.adcode.preview.onChange((status) => {
    apply(status);
    if (!status.running && open && !status.starting) void api.close();
  });

  window.adcode.preview.onOutput((chunk) => {
    output.textContent = `${output.textContent ?? ""}${chunk}`.slice(-LOG_LIMIT);
    output.scrollTop = output.scrollHeight;
  });

  /*
   * The inspector bridge.
   *
   * The page posts `adcode-inspect` messages out; only loopback origins are
   * honoured, so a stray page elsewhere cannot draw into this panel. Reloading
   * the frame drops the page's enabled flag, so every load re-asserts it.
   */
  window.addEventListener("message", (event) => {
    if (typeof event.origin !== "string") return;
    if (
      event.origin !== "null" &&
      !event.origin.startsWith("http://127.0.0.1") &&
      !event.origin.startsWith("http://localhost")
    ) {
      return;
    }
    inspector.handleMessage(event.data);
  });

  frame.addEventListener("load", () => {
    if (!inspector.isActive()) return;
    try {
      frame.contentWindow?.postMessage(
        { source: "adcode-preview", kind: "inspect-enable", enabled: true },
        "*",
      );
    } catch {
      // No document yet; the next load retries.
    }
  });

  /* ── Dragging, resizing and maximising ─────────────────────────────────── */

  bar.addEventListener("pointerdown", (event) => {
    if (maximised || event.button !== 0) return;
    // The bar is also the toolbar. Dragging from a button would mean the pointer never
    // reaches the click, so the buttons would stop working the moment the card floated.
    if ((event.target as HTMLElement).closest("button") !== null) return;

    const startX = event.clientX - position.x;
    const startY = event.clientY - position.y;
    bar.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      position = { x: moveEvent.clientX - startX, y: moveEvent.clientY - startY };
      applyGeometry();
    };

    const release = (): void => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", release);
      write(workspace, "position", JSON.stringify(position));
    };

    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", release);
  });

  // Every edge resizes; west and north edges move the origin too (see `resizeGeometry`).
  for (const handle of edges) {
    handle.addEventListener("pointerdown", (event) => {
      if (maximised || event.button !== 0) return;
      event.preventDefault();
      const start = { position, size };
      const startX = event.clientX;
      const startY = event.clientY;
      handle.setPointerCapture(event.pointerId);

      const move = (moveEvent: PointerEvent): void => {
        const next = resizeGeometry(start, handle.dataset["edge"] as ResizeEdge, moveEvent.clientX - startX, moveEvent.clientY - startY, viewport());
        position = next.position;
        size = next.size;
        applyGeometry();
      };

      const release = (): void => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", release);
        write(workspace, "size", JSON.stringify(size));
        write(workspace, "position", JSON.stringify(position));
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", release);
    });
  }

  bar.addEventListener("dblclick", (event) => {
    if ((event.target as HTMLElement).closest("button") !== null) return;
    toggleMaximised();
  });

  // A card that was reachable in a 1440px window is not necessarily reachable after the
  // window is dragged smaller, so the clamp runs again on every resize.
  window.addEventListener("resize", () => {
    if (open) applyGeometry(true);
  });

  deviceButton.addEventListener("click", () => {
    deviceToolbar.toggle();
    deviceButton.dataset["active"] = String(deviceToolbar.isActive());
  });
  inspectButton.addEventListener("click", () => api.toggleInspect());
  logButton.addEventListener("click", () => showLog(!logShown));
  reloadButton.addEventListener("click", () => api.reload());
  maximiseButton.addEventListener("click", () => toggleMaximised());
  externalButton.addEventListener("click", () => void window.adcode.preview.openExternal());
  closeButton.addEventListener("click", () => void api.close());
  engine.addEventListener("click", () => void api.switchMode());

  async function start(requested?: PreviewMode): Promise<boolean> {
    const status = await window.adcode.preview.start(requested);
    apply(status);
    return status.running;
  }

  const api: PreviewPane = {
    async open(): Promise<void> {
      // Asked before starting, so the bar can offer the switch even when the automatic
      // choice was the static server.
      projectLabel = (await window.adcode.preview.detect())?.label ?? null;

      output.textContent = "";
      showLog(false);

      if (!(await start())) return;

      open = true;
      pane.hidden = false;
      applyPlacement();
    },

    async close(): Promise<void> {
      open = false;
      pane.hidden = true;

      // Drop the frame before stopping the server, or Chromium logs a failed request for a
      // socket that went away mid-load - and `npm run smoke` fails on any console error.
      frame.removeAttribute("src");
      await window.adcode.preview.stop();
    },

    async toggle(): Promise<void> {
      if (open) await api.close();
      else await api.open();
    },

    isOpen: () => open,

    reload(): void {
      if (currentUrl === null) return;

      // `contentWindow.location.reload()` is a cross-origin call and throws. Re-assigning
      // `src` is the same reload from the outside.
      frame.removeAttribute("src");
      frame.src = currentUrl;
    },

    async switchMode(): Promise<void> {
      if (projectLabel === null) {
        deps.notify("No dev script in this folder, so there is only one way to preview it.");
        return;
      }

      const next: PreviewMode = mode === "project" ? "static" : "project";

      output.textContent = "";
      frame.removeAttribute("src");

      if (!(await start(next))) return;

      open = true;
      pane.hidden = false;
      applyPlacement();
    },

    toggleMaximised,

    isMaximised: () => maximised,

    resetGeometry(): void {
      maximised = false;
      positioned = false;
      size = { width: 560, height: 420 };
      for (const part of ["position", "size", "maximised"]) {
        try { localStorage.removeItem(storageKey(workspace, part)); } catch { /* Optional storage. */ }
      }
      applyPlacementChrome();
      if (open) applyGeometry();
    },

    placement: () => placement,

    toggleDevice(): void {
      deviceToolbar.toggle();
      deviceButton.dataset["active"] = String(deviceToolbar.isActive());
    },

    toggleInspect(): void {
      if (mode === "project") {
        deps.notify(
          "Inspect works on the Files preview, where ADCode serves the page itself. Switch back from the Project preview to use it.",
        );
        return;
      }
      inspector.toggle();
      inspectButton.dataset["active"] = String(inspector.isActive());
    },

    isInspecting: () => inspector.isActive(),

    setWorkspace(root: string | null): void {
      workspace = root;

      // Whatever this folder last used. A remembered geometry is clamped by `applyGeometry`
      // on the way in, never trusted as written - see `floatingLayout.ts` for why.
      placement = "floating";
      const remembered = parsePoint(read(root, "position"));
      positioned = remembered !== null;
      position = remembered ?? position;
      size = parseSize(read(root, "size")) ?? size;
      maximised = read(root, "maximised") === "true";

      // The device viewport is remembered per folder too: a project you were checking at
      // 390 wide is one you are probably still checking at 390 wide.
      deviceToolbar.restore(parseViewport(read(root, "device")));
      deviceButton.dataset["active"] = String(deviceToolbar.isActive());

      // Chrome always, layout only when there is something on screen to lay out. Without the
      // first call the maximise button keeps the previous folder's icon until it reopens.
      applyPlacementChrome();
      if (open) applyPlacement();
    },
  };

  applyPlacementChrome();

  return api;
}
