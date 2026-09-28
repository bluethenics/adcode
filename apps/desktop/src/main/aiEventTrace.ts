import type { AgentEvent, OperationalTrace } from "@adcode/ai";

export type AgentEventTrace = Pick<OperationalTrace, "kind" | "summary" | "detail" | "outcome">;

/** Convert live agent activity into bounded summaries; never persist text or tool payloads. */
export function agentEventTrace(event: AgentEvent): AgentEventTrace | null {
  switch (event.kind) {
    case "text":
    case "thinking":
    case "status":
      return null;
    case "tool-call": {
      const input = event.call.input;
      const detail =
        typeof input["path"] === "string"
          ? input["path"]
          : typeof input["pattern"] === "string"
            ? input["pattern"]
            : typeof input["command"] === "string"
              ? String(input["command"]).slice(0, 96)
              : typeof input["url"] === "string"
                ? input["url"]
                : "";
      return {
        kind: "tool-call",
        summary: `Called ${event.call.name}`,
        detail,
        outcome: "pending",
      };
    }
    case "tool-result":
      return {
        kind: "tool-result",
        summary: `${event.name} ${event.isError ? "failed" : "completed"}`,
        detail: "",
        outcome: event.isError ? "failed" : "ok",
      };
    case "turn-end":
      return {
        kind: "state",
        summary: `Assistant turn ended: ${event.reason}`,
        detail: "",
        outcome: event.reason === "end-turn" || event.reason === "tool-use" ? "ok" : "blocked",
      };
    case "refusal":
      return { kind: "error", summary: "Provider refused the turn", detail: "", outcome: "blocked" };
    case "error":
      return { kind: "error", summary: "Provider turn failed", detail: "", outcome: "failed" };
    case "cancelled":
      return { kind: "state", summary: "Assistant turn cancelled", detail: "", outcome: "blocked" };
  }
}

const DOING: Readonly<Record<string, (detail: string) => string>> = {
  read_file: (detail) => (detail ? `Reading ${detail}` : "Reading a file"),
  edit_file: (detail) => (detail ? `Editing ${detail}` : "Editing a file"),
  propose_edit: (detail) => (detail ? `Editing ${detail}` : "Editing a file"),
  run_command: (detail) => (detail ? `Running ${detail}` : "Running a command"),
  search: (detail) => (detail ? `Searching for ${detail}` : "Searching the project"),
  glob_files: (detail) => (detail ? `Finding ${detail}` : "Finding files"),
  list_files: (detail) => (detail ? `Looking in ${detail}` : "Looking through the project"),
  fetch_url: (detail) => (detail ? `Fetching ${detail}` : "Fetching a web page"),
  get_outline: (detail) => (detail ? `Outlining ${detail}` : "Outlining a file"),
  project_context: () => "Reading the project overview",
  memory_search: () => "Checking project memory",
  memory_write: () => "Writing to project memory",
};

/**
 * One line for an agent box's status: what the agent is doing right now, in plain words.
 *
 * Built from the bounded trace, never from tool payloads. Results and turn ends are not news
 * on their own - the next call says what happened - except a failure, which is.
 */
export function describeActivity(trace: AgentEventTrace): string | null {
  if (trace.kind === "tool-call") {
    const name = trace.summary.replace(/^Called /, "");
    return (DOING[name] ?? (() => `Using ${name}`))(trace.detail.trim());
  }
  if (trace.kind === "tool-result" && trace.outcome === "failed") {
    return `${trace.summary.replace(/ failed$/, "")} failed - trying again`;
  }
  return null;
}
