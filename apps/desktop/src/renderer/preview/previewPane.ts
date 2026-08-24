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
 * **Docked or floating, and why the iframe never moves.** The preview lives in a column
 * beside the editor, or in a card floating over it, chosen with one button. The naive way to
 * build that is to append the iframe into whichever container is currently wanted - and it
 * is wrong, because reparenting an iframe destroys its document and loads it again from
 * scratch. Undocking would silently reload the user's page: scroll position gone, form state
 * gone, whatever their JS was holding gone. For a surface whose entire purpose is showing
 * the effect of the last edit, throwing away the page on a layout change is a bad trade.
 *
 * So the pane stays exactly where it is in the DOM and only its *positioning* changes, via
 * `data-placement`. Docked, it sits in the layout and `--preview-width` drives its width.
 * Floating, it is `position: fixed` with a translate. The iframe is untouched either way, so
 * undocking costs nothing and the page keeps running.
 */
import type { PreviewMode, PreviewStatus } from "../../shared/api.ts";
import { createDeviceToolbar, type DeviceToolbar } from "./deviceToolbar.ts";
import { formatViewport, parseViewport } from "./deviceSizes.ts";
import { ICON, createIcon, iconButton } from "../workbench/icons.ts";
import {
  MIN_FLOAT_HEIGHT,
  MIN_FLOAT_WIDTH,
  centreIn,
  clampSize,
  clampToViewport,
  parsePoint,
  parseSize,
  type Point,
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
}

/**
 * Where the preview sits.
 *
 * Deliberately not called `PreviewMode`: that name is already taken, by the choice between
 * the static file server and the project's dev script. Two unrelated "modes" sharing one
 * type name is how a status update ends up setting a layout.
 */
export type PreviewPlacement = "docked" | "floating";

export interface PreviewPane {
  open(): Promise<void>;
  close(): Promise<void>;
  toggle(): Promise<void>;
  isOpen(): boolean;
  reload(): void;
  /** Restart under the other engine. Ignored when no dev script was detected. */
  switchMode(): Promise<void>;
  /** Move between the docked column and the floating card. */
  setPlacement(placement: PreviewPlacement): void;
  togglePlacement(): void;
  placement(): PreviewPlacement;
  /**
   * Turn device-size preview on or off.
   *
   * Checking a layout at a phone width without leaving the editor. Resizing never reloads
   * the page - see `deviceToolbar.ts` for why that is the whole design.
   */
  toggleDevice(): void;
  /** Placement, position and size are remembered per folder, as the chat card is. */
  setWorkspace(root: string | null): void;
}

/** Enough to read a stack trace without letting a chatty watcher grow without bound. */
const LOG_LIMIT = 40_000;

/** The docked column's share of the window. */
const DOCKED_WIDTH = "42%";

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
  const logButton = iconButton("Show output", ICON.output);
  const reloadButton = iconButton("Reload preview", ICON.reload);
  const dockButton = iconButton("Undock preview", ICON.undock);
  const externalButton = iconButton("Open in browser", ICON.external);
  const closeButton = iconButton("Close preview", ICON.close);

  bar.append(
    engine,
    address,
    deviceButton,
    logButton,
    reloadButton,
    dockButton,
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
   * The resize corner, and the reason it is an element rather than `resize: both`.
   *
   * CSS resize does not work on a flex container with an iframe inside it, and it draws the
   * platform's own grip - which on Windows is a set of grey diagonal lines that belong to no
   * other control in this window.
   */
  const resizeGrip = document.createElement("div");
  resizeGrip.className = "preview-grip";
  resizeGrip.setAttribute("aria-hidden", "true");

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

  pane.append(bar, deviceToolbar.element, stage, output, resizeGrip);
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
  let placement: PreviewPlacement = "docked";
  let position: Point = { x: 0, y: 0 };
  let size: Size = { width: 560, height: 420 };

  function setWidth(width: string): void {
    deps.host.style.setProperty("--preview-width", width);
    deps.onLayoutChange();
  }

  /* ── Placement ──────────────────────────────────────────────────────────── */

  function applyGeometry(): void {
    if (placement !== "floating") return;

    // Clamped on the way in, every time. The window can be resized while the card is
    // floating, and a card that was reachable at 1440px is not necessarily reachable at 900.
    const bounds = viewport();
    size = clampSize(size, bounds);
    position = clampToViewport(position, size, bounds);

    pane.style.width = `${size.width}px`;
    pane.style.height = `${size.height}px`;
    pane.style.transform = `translate(${position.x}px, ${position.y}px)`;
  }

  /**
   * The half of placement that touches no layout.
   *
   * Split out so construction can set the button and the attribute without calling
   * `onLayoutChange`, which reaches into the editor and the run button - neither of which
   * wants a relayout before the window has drawn once.
   */
  function applyPlacementChrome(): void {
    pane.dataset["placement"] = placement;

    dockButton.title = placement === "floating" ? "Dock preview" : "Undock preview";
    dockButton.setAttribute("aria-label", dockButton.title);
    dockButton.replaceChildren(createIcon(placement === "floating" ? ICON.dock : ICON.undock));
  }

  function applyPlacement(): void {
    applyPlacementChrome();

    if (placement === "floating") {
      applyGeometry();
      // The column collapses so the editor takes the full width back. The card is over the
      // top of it, not beside it, so leaving 42% reserved would strand empty space.
      setWidth("0px");
      return;
    }

    // Docked: hand width back to the stylesheet rather than leaving inline pixels behind,
    // or the column keeps whatever size the floating card happened to have.
    pane.style.removeProperty("width");
    pane.style.removeProperty("height");
    pane.style.removeProperty("transform");
    setWidth(open ? DOCKED_WIDTH : "0px");
  }

  function persistPlacement(): void {
    write(workspace, "placement", placement);
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

  /* ── Dragging and resizing, only while floating ─────────────────────────── */

  bar.addEventListener("pointerdown", (event) => {
    if (placement !== "floating") return;
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

  resizeGrip.addEventListener("pointerdown", (event) => {
    if (placement !== "floating") return;
    event.preventDefault();

    const startWidth = size.width;
    const startHeight = size.height;
    const startX = event.clientX;
    const startY = event.clientY;
    resizeGrip.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      size = {
        width: Math.max(MIN_FLOAT_WIDTH, startWidth + (moveEvent.clientX - startX)),
        height: Math.max(MIN_FLOAT_HEIGHT, startHeight + (moveEvent.clientY - startY)),
      };
      applyGeometry();
    };

    const release = (): void => {
      resizeGrip.removeEventListener("pointermove", move);
      resizeGrip.removeEventListener("pointerup", release);
      write(workspace, "size", JSON.stringify(size));
    };

    resizeGrip.addEventListener("pointermove", move);
    resizeGrip.addEventListener("pointerup", release);
  });

  // A floating card that was reachable in a 1440px window is not necessarily reachable after
  // the window is dragged smaller, so the clamp runs again on every resize.
  window.addEventListener("resize", () => {
    if (placement === "floating" && open) applyGeometry();
  });

  deviceButton.addEventListener("click", () => {
    deviceToolbar.toggle();
    deviceButton.dataset["active"] = String(deviceToolbar.isActive());
  });
  logButton.addEventListener("click", () => showLog(!logShown));
  reloadButton.addEventListener("click", () => api.reload());
  dockButton.addEventListener("click", () => api.togglePlacement());
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
      setWidth("0px");

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

    setPlacement(next: PreviewPlacement): void {
      if (next === placement) return;

      // First float in this folder: no remembered position, so centre it rather than
      // dropping it at the origin under the title bar.
      if (next === "floating" && read(workspace, "position") === null) {
        position = centreIn(size, viewport());
      }

      placement = next;
      applyPlacement();
      persistPlacement();

      // Monaco has to relayout either way: undocking gives the editor the column back, and
      // docking takes it away again.
      deps.onLayoutChange();
    },

    togglePlacement(): void {
      api.setPlacement(placement === "floating" ? "docked" : "floating");
    },

    placement: () => placement,

    toggleDevice(): void {
      deviceToolbar.toggle();
      deviceButton.dataset["active"] = String(deviceToolbar.isActive());
    },

    setWorkspace(root: string | null): void {
      workspace = root;

      // Whatever this folder last used. A remembered geometry is clamped by `applyGeometry`
      // on the way in, never trusted as written - see `floatingLayout.ts` for why.
      placement = read(root, "placement") === "floating" ? "floating" : "docked";
      position = parsePoint(read(root, "position")) ?? position;
      size = parseSize(read(root, "size")) ?? size;

      // The device viewport is remembered per folder too: a project you were checking at
      // 390 wide is one you are probably still checking at 390 wide.
      deviceToolbar.restore(parseViewport(read(root, "device")));
      deviceButton.dataset["active"] = String(deviceToolbar.isActive());

      // Chrome always, layout only when there is something on screen to lay out. Without the
      // first call the dock button keeps the previous folder's icon until the pane reopens.
      applyPlacementChrome();
      if (open) applyPlacement();
    },
  };

  applyPlacementChrome();

  return api;
}
