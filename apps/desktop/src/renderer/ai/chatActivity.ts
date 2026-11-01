/**
 * What the chat says about a tool call, and the rich result card.
 *
 * Presentation only: no Electron, no IPC, no storage, no network. The turn itself - its
 * heading, thinking rows, grouped tool rows and the fold - is `chatTimeline.ts`; this module
 * keeps the pieces both it and the "is writing" row use: a tool input in one line, the
 * step a tool call is ("Reading files"), and the result image card with its source check.
 */

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
  // delegate_task: the helpers' titles, "Map the auth flow · Write the tests".
  if (Array.isArray(record["tasks"])) {
    const titles = record["tasks"].map((task) => typeof task === "object" && task !== null && typeof (task as Record<string, unknown>)["title"] === "string" ? String((task as Record<string, unknown>)["title"]).trim() : "").filter((title) => title.length > 0);
    if (titles.length > 0) return titles.join(" · ").slice(0, 96);
  }
  if (typeof record["server"] === "string" && typeof record["tool"] === "string") return `${record["server"]} / ${record["tool"]}`.slice(0, 96);
  // ask_user: the question itself, and how many more came with it.
  if (Array.isArray(record["questions"])) {
    const asked = record["questions"]
      .map((item) => typeof item === "object" && item !== null && typeof (item as Record<string, unknown>)["question"] === "string" ? String((item as Record<string, unknown>)["question"]).trim() : "")
      .filter((text) => text.length > 0);
    if (asked.length > 0) return `${asked[0]}${asked.length > 1 ? ` (+${String(asked.length - 1)} more)` : ""}`.slice(0, 96);
  }
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
  if (clean === "delegate_task") return "Working with helpers";
  if (clean === "fork_chats") return "Starting fork chats";
  if (clean === "send_chat_message") return "Messaging a chat";
  if (clean === "read_chat_messages") return "Reading chat messages";
  if (clean === "wait_for_chat_forks") return "Waiting for fork chats";
  if (clean === "list_chat_forks") return "Listing fork chats";
  if (clean === "stop_chat") return "Stopping a chat";
  if (clean === "discover_capabilities") return "Finding tools and skills";
  if (clean === "load_skill") return "Reading skill instructions";
  if (clean === "load_builtin_skill") return "Reading product guidance";
  if (clean === "inspect_project") return "Finding project checks";
  if (clean === "run_project_checks") return "Checking the project";
  if (clean === "audit_page") return "Checking layout and accessibility";
  if (clean === "call_mcp") return "Using an MCP tool";
  if (clean === "adcode_features") return "Checking what ADCode can do";
  if (clean === "adcode_action") return "Using ADCode";
  if (clean === "adcode_connectors") return "Setting up a connector";
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
  if (clean === "ask_user") return "Asking you a question";
  if (clean === "delete_file") return "Deleting a file";
  if (clean === "move_file") return "Moving files";
  if (clean === "command_output") return "Checking a command";
  if (clean === "stop_command") return "Stopping a command";
  if (/fetch|url/i.test(clean)) return "Reading the web";
  if (/run|exec|bash|terminal|command/i.test(clean)) return "Running a command";
  if (/preview|image|generate/i.test(clean)) return "Creating a preview";
  return `Using ${clean}`;
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
