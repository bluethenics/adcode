import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@adcode/ai";
import { agentEventTrace, describeActivity } from "../src/main/aiEventTrace.ts";

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

describe("live activity lines for agent boxes", () => {
  const call = (name: string, input: Record<string, unknown>) => agentEventTrace({ kind: "tool-call", call: { id: "c1", name, input } } as AgentEvent)!;

  it("says what the agent is doing in plain words", () => {
    expect(describeActivity(call("read_file", { path: "src/app.ts" }))).toBe("Reading src/app.ts");
    expect(describeActivity(call("edit_file", { path: "src/app.ts" }))).toBe("Editing src/app.ts");
    expect(describeActivity(call("propose_edit", { path: "src/app.ts" }))).toBe("Editing src/app.ts");
    expect(describeActivity(call("run_command", { command: "npm test" }))).toBe("Running npm test");
    expect(describeActivity(call("search", { pattern: "login" }))).toBe("Searching for login");
    expect(describeActivity(call("glob_files", { pattern: "**/*.ts" }))).toBe("Finding **/*.ts");
    expect(describeActivity(call("list_files", { path: "src" }))).toBe("Looking in src");
    expect(describeActivity(call("fetch_url", { url: "https://example.com" }))).toBe("Fetching https://example.com");
    expect(describeActivity(call("get_outline", { path: "src/app.ts" }))).toBe("Outlining src/app.ts");
    expect(describeActivity(call("project_context", {}))).toBe("Reading the project overview");
    expect(describeActivity(call("mystery_tool", {}))).toBe("Using mystery_tool");
  });

  it("stays quiet for results and turn ends, which are not something to show", () => {
    expect(describeActivity(agentEventTrace({ kind: "tool-result", name: "read_file", isError: false } as AgentEvent)!)).toBeNull();
    expect(describeActivity(agentEventTrace({ kind: "turn-end", reason: "end-turn" } as AgentEvent)!)).toBeNull();
  });

  it("reports a failed tool so the box can say something went wrong", () => {
    expect(describeActivity(agentEventTrace({ kind: "tool-result", name: "run_command", isError: true } as AgentEvent)!)).toBe("run_command failed - trying again");
  });
});

describe("compaction in a run's trace", () => {
  it("records that earlier steps were compacted, without the summary text", () => {
    const trace = agentEventTrace({ kind: "compacted", summary: "SECRET-SUMMARY", before: 90_000, after: 20_000, keptMessages: 6 });
    expect(trace).toEqual({ kind: "state", summary: "Compacted earlier steps", detail: "", outcome: "ok" });
    expect(JSON.stringify(trace)).not.toContain("SECRET-SUMMARY");
  });

  it("keeps the live compaction signals out of the trace", () => {
    expect(agentEventTrace({ kind: "compacting" })).toBeNull();
    expect(agentEventTrace({ kind: "context", tokens: 1000, contextWindow: 200_000 })).toBeNull();
  });

  it("tells the box the agent is making room", () => {
    expect(describeActivity(agentEventTrace({ kind: "compacted", summary: "", before: 2, after: 1, keptMessages: 1 })!)).toBe("Compacted earlier steps to make room");
  });
});
