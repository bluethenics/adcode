/**
 * Agent Chat activity block ("thinking and working") and rich result card.
 *
 * Presentation layer only: no Electron, no IPC, no storage, no network. The
 * chat widget owns the backend events and feeds them in; this module owns the
 * DOM shape, the elapsed timer, and the collapse behaviour so both are
 * testable from the markup they produce.
 *
 * Visual contract (see `styles/ai.css`, section "Agent activity"):
 * - One block per run of work, placed in order with the text: work, text, work, text.
 * - Header: interactive mascot (replacing the old 3-dot loader), status
 *   label, elapsed timer, chevron. The mascot's eyes track the pointer,
 *   it blinks, and clicking it pops a rotating quip so long runs stay alive.
 * - Body: bordered rounded rows; text rows are muted thoughts, tool rows carry
 *   a spinner while running and a green check when done; new rows fade in.
 * - Finished: the mascot leaves and a small check (or "!") takes its place,
 *   label becomes "Worked for Ns", body collapses with a grid-template-rows
 *   transition; header click toggles it again.
 *
 * One mascot, the working one. A turn is several blocks - work, text, work,
 * text - and finished blocks used to keep their mascots, so a long
 * conversation filled with copies of the same face, each still tracking the
 * pointer and blinking on its own timers. The mascot is the assistant at
 * work; once a block's work is done it has nothing left to show.
 */

import { createMascot, type MascotHandle, type MascotMood } from "./mascot.ts";

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
  if (typeof record["from"] === "string" && typeof record["to"] === "string") return `${record["from"]} → ${record["to"]}`.slice(0, 96);
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
  if (clean === "load_builtin_skill") return "Reading the design guide";
  if (clean === "call_mcp") return "Using an MCP tool";
  if (clean === "read_file") return "Reading files";
  if (clean === "edit_file" || clean === "propose_edit") return "Editing files";
  if (clean === "project_context" || /^memory/i.test(clean)) return "Reading project notes";
  if (/^read/i.test(clean)) return "Reading files";
  if (/write|edit|apply|patch/i.test(clean)) return "Editing files";
  if (/search|grep|glob|find/i.test(clean)) return "Searching the project";
  if (/outline|symbol/i.test(clean)) return "Outlining a file";
  if (clean === "view_page") return "Looking at the page";
  if (clean === "open_preview") return "Opening the preview";
  if (clean === "update_plan") return "Updating the plan";
  if (clean === "delete_file") return "Deleting a file";
  if (clean === "move_file") return "Moving files";
  if (clean === "command_output") return "Checking a command";
  if (clean === "stop_command") return "Stopping a command";
  if (/fetch|url/i.test(clean)) return "Reading the web";
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

  const header = document.createElement("div");
  header.className = "chat-activity-header";
  header.setAttribute("aria-expanded", "true");

  // The mascot replaces the old three-dot wave. The wrapper keeps the
  // `chat-activity-loader` class so existing theme hooks and tests keep
  // holding; the three <i> dots are gone, the blob lives here instead.
  // Header is a div (not a button) so the mascot button inside it is valid
  // HTML — the inner toggle button owns the collapse behaviour.
  const loader = document.createElement("span");
  loader.className = "chat-activity-loader";
  const mascot: MascotHandle = createMascot({ mood: "thinking" });
  // The loader wrapper is presentational; the mascot button inside carries
  // its own accessible name.
  loader.setAttribute("aria-hidden", "false");
  // What replaces the mascot once the work is done: the label already says
  // how it went, so this is a mark, not a second announcement.
  const settled = document.createElement("span");
  settled.className = "chat-activity-settled";
  settled.setAttribute("aria-hidden", "true");
  settled.hidden = true;
  loader.append(mascot.element, settled);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "chat-activity-toggle";
  toggle.setAttribute("aria-expanded", "true");
  toggle.setAttribute("aria-label", "Toggle assistant activity details");

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

  toggle.append(label, timer, chevron);
  header.append(loader, toggle);

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
    toggle.setAttribute("aria-expanded", String(!collapsed));
  }

  toggle.addEventListener("click", () => {
    setCollapsed(element.dataset["collapsed"] !== "true");
  });
  // Poking the mascot must not collapse the block.
  mascot.element.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  function moodForLabel(text: string): MascotMood {
    if (/fail|error|declined|cancel/i.test(text)) return "error";
    if (/writing|streaming|reviewing/i.test(text)) return "streaming";
    if (/reading|editing|searching|running|using|working|planning|finding|creating|outlining/i.test(text)) {
      return "working";
    }
    return "thinking";
  }

  return {
    element,
    startedAt,
    setLabel(text: string): void {
      label.textContent = text;
      if (element.dataset["state"] !== "done") mascot.setMood(moodForLabel(text));
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
      if (element.dataset["state"] !== "done") {
        mascot.setMood(row.kind === "tool" ? "working" : "thinking");
      }
      return item;
    },
    completeRow(id: string, ok = true): void {
      const item = rowsById.get(id);
      if (!item) {
        if (!ok && element.dataset["state"] !== "done") mascot.setMood("error");
        return;
      }
      item.classList.remove("is-running");
      item.classList.add("is-done");
      if (!ok) item.classList.add("is-error");
      const icon = item.querySelector(".chat-activity-row-icon");
      if (icon) {
        icon.textContent = ok ? "✓" : "!";
        icon.setAttribute("aria-label", ok ? "Done" : "Failed");
      }
      if (!ok && element.dataset["state"] !== "done") mascot.setMood("error");
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
      const finalLabel = customLabel ?? formatWorkedLabel(elapsed);
      label.textContent = finalLabel;
      label.classList.add("is-final");
      const failed = /fail|error|declined|cancel/i.test(finalLabel);
      mascot.destroy();
      settled.textContent = failed ? "!" : "✓";
      settled.dataset["tone"] = failed ? "error" : "done";
      settled.hidden = false;
      setCollapsed(true);
    },
    destroy(): void {
      window.clearInterval(interval);
      mascot.destroy();
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
