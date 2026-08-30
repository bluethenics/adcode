import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@adcode/ai";
import { agentEventTrace } from "../src/main/aiEventTrace.ts";

describe("durable AI event trace summaries", () => {
  it("records tool identity and path without persisting model-visible file contents", () => {
    const event: AgentEvent = {
      kind: "tool-call",
      call: {
        type: "tool-call",
        id: "call-one",
        name: "propose_edit",
        input: { path: "src/main.ts", contents: "password=do-not-store" },
      },
    };

    const trace = agentEventTrace(event);
    expect(trace).toMatchObject({
      kind: "tool-call",
      summary: "Called propose_edit",
      detail: "src/main.ts",
      outcome: "pending",
    });
    expect(JSON.stringify(trace)).not.toContain("do-not-store");
  });

  it("records tool outcomes and provider refusals without full tool results", () => {
    const result = agentEventTrace({
      kind: "tool-result",
      toolCallId: "call-one",
      name: "read_file",
      content: "secret file contents",
      isError: false,
    });
    const refusal = agentEventTrace({
      kind: "refusal",
      detail: "Policy declined source=private-file and authorization=Bearer secret-token",
    });

    expect(result).toEqual({
      kind: "tool-result",
      summary: "read_file completed",
      detail: "",
      outcome: "ok",
    });
    expect(JSON.stringify(result)).not.toContain("secret file contents");
    expect(refusal).toEqual({
      kind: "error",
      summary: "Provider refused the turn",
      detail: "",
      outcome: "blocked",
    });
    expect(JSON.stringify(refusal)).not.toContain("private-file");
  });

  it("does not persist arbitrary provider error payloads", () => {
    const failure = agentEventTrace({
      kind: "error",
      detail: "upstream echoed password=hunter2 and the entire prompt",
    });

    expect(failure).toEqual({
      kind: "error",
      summary: "Provider turn failed",
      detail: "",
      outcome: "failed",
    });
  });
});
