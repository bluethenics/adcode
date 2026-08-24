/**
 * The Ports tab.
 *
 * This exists for one question that every beginner hits and no part of the editor could
 * previously answer: "something is already using 3000 - what?" The only answer available
 * before was whatever error the thing that failed to start happened to print, which names
 * the port and never the process holding it.
 *
 * **It polls only while it is visible.** `onShow` starts the timer and `onHide` stops it,
 * because enumerating sockets shells out to `netstat` or `lsof` and on a loaded Windows box
 * that takes seconds, not milliseconds. A hidden tab that kept polling would be a
 * permanent background cost for a table nobody is looking at.
 *
 * **The rows are rebuilt only when they change.** A table that re-renders every three
 * seconds throws away the user's text selection each time, which makes copying a pid
 * impossible - you get about half a second between repaints.
 */
import type { ListeningPort } from "../../shared/api.ts";

export interface PortsPanelDeps {
  readonly list: () => Promise<ListeningPort[]>;
  readonly stop: (pid: number) => Promise<{ ok: boolean; error?: string }>;
  readonly open: (port: number) => Promise<void>;
  readonly copy: (text: string) => void;
  readonly notify: (message: string) => void;
  /**
   * Confirm stopping a process ADCode did not start.
   *
   * Killing a pid cannot be undone, and the row might be the user's database.
   */
  readonly confirm: (message: string) => Promise<boolean>;
}

export interface PortsPanel {
  readonly element: HTMLElement;
  /** Start polling. */
  start(): void;
  /** Stop polling. */
  stop(): void;
  /** Read the ports now, regardless of the timer. */
  refresh(): Promise<void>;
}

/**
 * How often to re-read.
 *
 * Three seconds is fast enough that starting a dev server and looking at this tab shows
 * the new port without the user wondering, and slow enough not to matter.
 */
const POLL_MS = 3_000;

export function createPortsPanel(deps: PortsPanelDeps): PortsPanel {
  const element = document.createElement("div");
  element.className = "ports-panel";

  const empty = document.createElement("p");
  empty.className = "empty-hint";
  empty.textContent = "Nothing is listening.";

  const table = document.createElement("table");
  table.className = "ports-table";
  table.hidden = true;

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const title of ["Port", "Process", "PID", "Address", ""]) {
    const cell = document.createElement("th");
    cell.textContent = title;
    if (title === "") cell.ariaLabel = "Actions";
    headRow.append(cell);
  }
  head.append(headRow);

  const body = document.createElement("tbody");
  table.append(head, body);
  element.append(empty, table);

  let timer: ReturnType<typeof setInterval> | null = null;
  /** The last rendered shape, so an unchanged poll costs no DOM work. */
  let signature = "";
  /** Guards against a slow poll overlapping the next one on a busy machine. */
  let reading = false;

  const describe = (ports: readonly ListeningPort[]): string =>
    ports.map((p) => `${p.port}|${p.pid ?? ""}|${p.process ?? ""}|${p.address}|${p.label ?? ""}`).join(";");

  function actionButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button ports-action";
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", onClick);
    return button;
  }

  async function stopRow(port: ListeningPort): Promise<void> {
    if (port.pid === null) {
      deps.notify("No process id for that port.");
      return;
    }

    // Ours is routine; anything else is somebody's running work.
    if (!port.own) {
      const name = port.process ?? `pid ${port.pid}`;
      const agreed = await deps.confirm(`Stop ${name} on port ${port.port}? This cannot be undone.`);
      if (!agreed) return;
    }

    const result = await deps.stop(port.pid);
    if (!result.ok) {
      deps.notify(result.error ?? "Could not stop it.");
      return;
    }

    deps.notify(`Stopped port ${port.port}.`);
    await refresh();
  }

  function render(ports: readonly ListeningPort[]): void {
    const next = describe(ports);
    if (next === signature) return;
    signature = next;

    body.replaceChildren();

    for (const port of ports) {
      const row = document.createElement("tr");

      const portCell = document.createElement("td");
      portCell.className = "ports-port";
      portCell.textContent = String(port.port);
      if (port.label !== null) {
        // The one piece of information the OS cannot give: that this is ours.
        const tag = document.createElement("span");
        tag.className = "ports-label";
        tag.textContent = port.label;
        portCell.append(tag);
      }

      const processCell = document.createElement("td");
      processCell.textContent = port.process ?? "Unknown";
      if (port.process === null) processCell.className = "ports-unknown";

      const pidCell = document.createElement("td");
      pidCell.textContent = port.pid === null ? "—" : String(port.pid);

      const addressCell = document.createElement("td");
      addressCell.textContent = port.address;

      const actions = document.createElement("td");
      actions.className = "ports-actions";
      actions.append(
        actionButton("Open", `Open ${port.url} in your browser`, () => void deps.open(port.port)),
        actionButton("Copy", `Copy ${port.url}`, () => {
          deps.copy(port.url);
          deps.notify("URL copied.");
        }),
        actionButton("Stop", `Stop whatever is holding port ${port.port}`, () => void stopRow(port)),
      );

      row.append(portCell, processCell, pidCell, addressCell, actions);
      body.append(row);
    }

    table.hidden = ports.length === 0;
    empty.hidden = ports.length > 0;
  }

  async function refresh(): Promise<void> {
    if (reading) return;
    reading = true;
    try {
      render(await deps.list());
    } catch {
      // A machine that cannot enumerate its sockets reports nothing rather than breaking
      // the panel it is drawn in.
      render([]);
    } finally {
      reading = false;
    }
  }

  return {
    element,
    start() {
      void refresh();
      timer ??= setInterval(() => void refresh(), POLL_MS);
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    refresh,
  };
}
