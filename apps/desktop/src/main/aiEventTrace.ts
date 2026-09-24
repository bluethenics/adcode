import type { AgentEvent, OperationalTrace } from "@adcode/ai";

export type AgentEventTrace = Pick<OperationalTrace, "kind" | "summary" | "detail" | "outcome">;

/** Convert live agent activity into bounded summaries; never persist text or tool payloads. */
export function agentEventTrace(event: AgentEvent): AgentEventTrace | null {
  switch (event.kind) {
    case "text":
    case "thinking":
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
