/**
 * Agent Chat activity block ("thinking and working") and rich result card.
 *
 * Presentation layer only: no Electron, no IPC, no storage, no network. The
 * chat widget owns the backend events and feeds them in; this module owns the
 * DOM shape, the elapsed timer, and the collapse behaviour so both are
 * testable from the markup they produce.
 *
 * Visual contract (see `styles/ai.css`, section "Agent activity"):
 * - One block per assistant turn, above the final answer.
 * - Header: animated 3-dot loader, status label, elapsed timer, chevron.
 * - Body: bordered rounded rows; text rows are muted thoughts, tool rows carry
 *   a spinner while running and a green check when done; new rows fade in.
 * - Finished: loader hides, label becomes "Worked for Ns", body collapses
 *   with a grid-template-rows transition; header click toggles it again.
 */

export type ActivityRowKind = "text" | "tool";
export type ActivityRowStatus = "running" | "done";

export interface ActivityRowInput {
  readonly kind: ActivityRowKind;
  readonly text: string;
  readonly status?: ActivityRowStatus;
  /** Stable id for tool rows, so a later tool-result can complete the row. */
  readonly id?: string;
  /** Short detail shown under the label (input summary, file path, ...). */
  readonly detail?: string;
}

export interface ActivityBlockHandle {
  readonly element: HTMLElement;
  readonly startedAt: number;
  setLabel(text: string): void;
  addRow(row: ActivityRowInput): HTMLElement;
  completeRow(id: string, ok?: boolean): void;
  finalize(totalSeconds?: number, label?: string): void;
  destroy(): void;
}

/** "Worked for 7s" — the collapsed label, seconds rounded, floor of 1s. */
export function formatWorkedLabel(totalSeconds: number): string {
  const seconds = Math.max(1, Math.round(totalSeconds));
  return `Worked for ${String(seconds)}s`;
}

/** "Failed after 7s" — a collapsed errored turn never claims it worked. */
export function formatFailedLabel(totalSeconds: number): string {
  const seconds = Math.max(1, Math.round(totalSeconds));
  return `Failed after ${String(seconds)}s`;
}

/** Live timer text, updated ~4x per second: "0.0s", "2.5s", "12.8s". */
export function formatElapsedLabel(elapsedSeconds: number): string {
  const clamped = Math.max(0, elapsedSeconds);
  return `${clamped.toFixed(1)}s`;
}

/**
 * One-line summary of a tool call's input for the row label.
 *
 * Tool inputs are free-form JSON; surfacing the whole object in a narrow row
 * is noise. The first recognisable string field (path, file, pattern, command,
 * query, url) is what a reader scans for, truncated to stay one line.
 */
export function summarizeToolInput(input: unknown): string {
  if (typeof input === "string") return input.slice(0, 96);
  if (typeof input !== "object" || input === null) return "";
  const record = input as Record<string, unknown>;
  if (typeof record["server"] === "string" && typeof record["tool"] === "string") return `${record["server"]} / ${record["tool"]}`.slice(0, 96);
  for (const key of ["path", "file", "pattern", "command", "query", "url", "prompt", "id"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      const singleLine = value.trim().split("\n")[0] ?? "";
      return singleLine.slice(0, 96);
    }
  }
  return "";
}

/** Friendly header label for the tool currently running. */
export function toolHeaderLabel(toolName: string): string {
  const clean = toolName.trim();
  if (clean.length === 0) return "Working";
  if (clean === "discover_capabilities") return "Finding tools and skills";
  if (clean === "load_skill") return "Reading skill instructions";
  if (clean === "call_mcp") return "Using an MCP tool";
  if (/^read/i.test(clean)) return "Reading project notes";
  if (/write|edit|apply|patch/i.test(clean)) return "Editing files";
  if (/search|grep|glob|find/i.test(clean)) return "Searching the project";
  if (/run|exec|bash|terminal|command/i.test(clean)) return "Running a command";
  if (/preview|image|generate/i.test(clean)) return "Creating a preview";
  return `Using ${clean}`;
}

export function createActivityBlock(options?: {
  readonly label?: string;
  readonly startedAt?: number;
}): ActivityBlockHandle {
  const startedAt = options?.startedAt ?? Date.now();

  const element = document.createElement("div");
  element.className = "chat-activity";
  element.dataset["state"] = "running";
  element.dataset["collapsed"] = "false";
  // The block replaces the legacy working indicator for live turns, so it
  // carries the polite live region instead — header label and timer updates
  // are announced without the duplicate "Thinking" row.
  element.setAttribute("role", "status");

  const header = document.createElement("button");
  header.type = "button";
  header.className = "chat-activity-header";
  header.setAttribute("aria-expanded", "true");
  header.setAttribute("aria-label", "Toggle assistant activity details");

  const loader = document.createElement("span");
  loader.className = "chat-activity-loader";
  loader.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 3; index++) {
    loader.append(document.createElement("i"));
  }

  const label = document.createElement("span");
  label.className = "chat-activity-label";
  label.textContent = options?.label ?? "Thinking";

  const timer = document.createElement("span");
  timer.className = "chat-activity-timer";
  timer.setAttribute("aria-label", "Elapsed time");
  timer.textContent = formatElapsedLabel(0);

  const chevron = document.createElement("span");
  chevron.className = "chat-activity-chevron";
  chevron.setAttribute("aria-hidden", "true");

  header.append(loader, label, timer, chevron);

  const collapse = document.createElement("div");
  collapse.className = "chat-activity-collapse";

  const body = document.createElement("div");
  body.className = "chat-activity-body";
  body.setAttribute("role", "group");
  body.setAttribute("aria-label", "Assistant activity");
  collapse.append(body);

  element.append(header, collapse);

  const tick = (): void => {
    if (element.dataset["state"] === "done") return;
    timer.textContent = formatElapsedLabel((Date.now() - startedAt) / 1000);
  };
  const interval = window.setInterval(tick, 250);
  tick();

  const rowsById = new Map<string, HTMLElement>();

  function setCollapsed(collapsed: boolean): void {
    element.dataset["collapsed"] = String(collapsed);
    header.setAttribute("aria-expanded", String(!collapsed));
  }

  header.addEventListener("click", () => {
    setCollapsed(element.dataset["collapsed"] !== "true");
  });

  return {
    element,
    startedAt,
    setLabel(text: string): void {
      label.textContent = text;
    },
    addRow(row: ActivityRowInput): HTMLElement {
      const status: ActivityRowStatus = row.status ?? "running";
      const item = document.createElement("div");
      item.className = `chat-activity-row is-${row.kind} is-${status}`;
      if (row.id !== undefined) {
        item.dataset["toolId"] = row.id;
        rowsById.set(row.id, item);
      }

      const text = document.createElement("span");
      text.className = "chat-activity-row-text";
      text.textContent = row.text;
      if (row.detail !== undefined && row.detail.length > 0) text.title = row.detail;
      item.append(text);

      if (row.kind === "tool") {
        const icon = document.createElement("span");
        icon.className = "chat-activity-row-icon";
        icon.setAttribute("aria-hidden", "true");
        if (status === "done") icon.textContent = "✓";
        item.append(icon);
        const chevronIcon = document.createElement("span");
        chevronIcon.className = "chat-activity-row-chevron";
        chevronIcon.setAttribute("aria-hidden", "true");
        item.append(chevronIcon);
      }

      body.append(item);
      return item;
    },
    completeRow(id: string, ok = true): void {
      const item = rowsById.get(id);
      if (!item) return;
      item.classList.remove("is-running");
      item.classList.add("is-done");
      if (!ok) item.classList.add("is-error");
      const icon = item.querySelector(".chat-activity-row-icon");
      if (icon) {
        icon.textContent = ok ? "✓" : "!";
        icon.setAttribute("aria-label", ok ? "Done" : "Failed");
      }
    },
    finalize(totalSeconds?: number, customLabel?: string): void {
      const elapsed = totalSeconds ?? (Date.now() - startedAt) / 1000;
      window.clearInterval(interval);
      // The label carries the total ("Worked for 7s") — a timer beside it
      // would read the same number twice.
      timer.textContent = "";
      element.dataset["state"] = "done";
      // Every running row settles: a turn that ends with a spinner still
      // spinning reads as hung, which is worse than a quiet approximation.
      for (const item of body.querySelectorAll(".chat-activity-row.is-running")) {
        item.classList.remove("is-running");
        item.classList.add("is-done");
        const icon = item.querySelector(".chat-activity-row-icon");
        if (icon && icon.textContent === "") icon.textContent = "✓";
      }
      label.textContent = customLabel ?? formatWorkedLabel(elapsed);
      label.classList.add("is-final");
      setCollapsed(true);
    },
    destroy(): void {
      window.clearInterval(interval);
      element.remove();
      rowsById.clear();
    },
  };
}

/* ── Rich result (images) ─────────────────────────────────────────────── */

export interface ResultImageInput {
  readonly src: string;
  readonly alt?: string;
  readonly note?: string;
  readonly summary?: string;
}

/**
 * Only images the assistant itself produced may render: remote https, local
 * loopback http, or image data URLs. Anything else (javascript:, blob: from
 * elsewhere, file:) renders nothing — a model must never inject a source.
 */
export function isSafeImageSrc(src: string): boolean {
  const value = src.trim();
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value)) return true;
  if (/^https:\/\//i.test(value)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i.test(value)) return true;
  return false;
}

/**
 * Rounded result card, max ~420px, soft reveal (fade, scale from 0.98, blur
 * to sharp over 0.6s — see CSS). Preceded by a muted note line, followed by
 * an optional bold Summary heading and paragraph.
 */
export function createResultImage(input: ResultImageInput): HTMLElement | null {
  if (!isSafeImageSrc(input.src)) return null;
  const figure = document.createElement("figure");
  figure.className = "chat-result";

  if (input.note !== undefined && input.note.length > 0) {
    const note = document.createElement("figcaption");
    note.className = "chat-result-note";
    note.textContent = input.note;
    figure.append(note);
  }

  const media = document.createElement("div");
  media.className = "chat-result-media";
  const image = document.createElement("img");
  image.className = "chat-result-image";
  image.src = input.src;
  image.alt = input.alt ?? "Generated preview";
  image.loading = "lazy";
  media.append(image);
  figure.append(media);

  if (input.summary !== undefined && input.summary.length > 0) {
    const wrap = document.createElement("div");
    wrap.className = "chat-result-summary";
    const heading = document.createElement("p");
    heading.className = "chat-result-summary-title";
    heading.textContent = "Summary";
    const text = document.createElement("p");
    text.className = "chat-result-summary-text";
    text.textContent = input.summary;
    wrap.append(heading, text);
    figure.append(wrap);
  }

  return figure;
}
