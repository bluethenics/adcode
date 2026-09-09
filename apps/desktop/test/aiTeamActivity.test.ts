import { describe, expect, it } from "vitest";
import { toAiTeamActivityView } from "../src/main/aiTeamViews.ts";

describe("named agent activity", () => {
  it("attributes tool calls to the correct agent without exposing private roots or credentials", () => {
    const result = toAiTeamActivityView({
      id: "trace-one", taskId: "task-one", at: 12,
      kind: "tool-call", summary: "Called read_file",
      detail: "C:/private/sandbox/src/index.ts api_key=secret",
      outcome: "pending",
    }, "agent-builder", ["C:/private/sandbox"]);
    expect(result).toMatchObject({ nodeId: null, roleId: "agent-builder", kind: "tool-call", outcome: "pending" });
    expect(result.detail).toContain("src/index.ts");
    expect(result.detail).not.toContain("C:/private");
    expect(result.detail).not.toContain("=secret");
  });
});
