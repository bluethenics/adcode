import { describe, expect, it } from "vitest";
import { createOverlapTracker, createTeamMailbox, formatInbox, recipientProblem } from "../src/teamMailbox.ts";
import { MESSAGE_TEAMMATE, READ_MESSAGES, TEAM_TOOLS } from "../src/tools.ts";

describe("team mailbox", () => {
  it("delivers a direct message once, to its recipient only", () => {
    const box = createTeamMailbox();
    box.post("t1", "build", "check", "API done", 10);
    expect(box.take("t1", "review")).toEqual([]);
    expect(box.take("t1", "check")).toMatchObject([{ from: "build", to: "check", text: "API done", at: 10 }]);
    expect(box.take("t1", "check")).toEqual([]);
  });

  it("delivers 'all' to everyone except the sender", () => {
    const box = createTeamMailbox();
    box.post("t1", "build", "all", "renamed User to Account", 1);
    expect(box.take("t1", "build")).toEqual([]);
    expect(box.take("t1", "check")).toHaveLength(1);
    expect(box.take("t1", "docs")).toHaveLength(1);
  });

  it("keeps teams apart and forgets a cleared team", () => {
    const box = createTeamMailbox();
    box.post("t1", "build", "check", "one", 1);
    box.post("t2", "build", "check", "two", 1);
    box.clear("t1");
    expect(box.take("t1", "check")).toEqual([]);
    expect(box.take("t2", "check")).toMatchObject([{ text: "two" }]);
  });

  it("trims and bounds a message", () => {
    const box = createTeamMailbox();
    const message = box.post("t1", "build", "check", `  ${"x".repeat(3000)}  `, 1);
    expect(message.text).toHaveLength(2000);
  });

  it("formats an inbox with each sender's label", () => {
    const text = formatInbox([{ id: 1, from: "build", to: "check", text: "API done", at: 1 }], (role) => (role === "build" ? "Build" : role));
    expect(text).toContain("Build: API done");
  });
});

describe("recipientProblem", () => {
  const roster = ["build", "check", "review"];
  it("accepts a teammate or all", () => {
    expect(recipientProblem("check", "build", roster)).toBeNull();
    expect(recipientProblem("all", "build", roster)).toBeNull();
  });
  it("names the valid roles for an unknown one", () => {
    expect(recipientProblem("tester", "build", roster)).toMatch(/check, review/);
  });
  it("refuses a message to yourself", () => {
    expect(recipientProblem("build", "build", roster)).toMatch(/yourself/);
  });
});

describe("overlap tracker", () => {
  it("names the first other node to edit a path, once per node and path", () => {
    const overlap = createOverlapTracker();
    expect(overlap.touch("t1", "build", "src/a.ts")).toBeNull();
    expect(overlap.touch("t1", "build", "src/a.ts")).toBeNull();
    expect(overlap.touch("t1", "check", "src/a.ts")).toBe("build");
    expect(overlap.touch("t1", "check", "src/a.ts")).toBeNull();
    expect(overlap.touch("t2", "check", "src/a.ts")).toBeNull();
  });
});

describe("team tools", () => {
  it("defines message_teammate and read_messages, neither of which writes files", () => {
    expect(TEAM_TOOLS.map((tool) => tool.name)).toEqual(["message_teammate", "read_messages"]);
    expect(MESSAGE_TEAMMATE.mutating).toBe(false);
    expect(READ_MESSAGES.mutating).toBe(false);
    expect(MESSAGE_TEAMMATE.inputSchema["required"]).toEqual(["to", "text"]);
  });
});
