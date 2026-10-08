import { describe, expect, it } from "vitest";
import { createOverlapTracker, createTeamMailbox, type ToolCallBlock, type ToolRunner } from "@adcode/ai";
import { createTeamRoleRunner } from "../src/main/teamRoleRunner.ts";
import type { LiveEventView } from "../src/shared/liveAgents.ts";

const call = (name: string, input: Record<string, unknown> = {}, id = "c1"): ToolCallBlock => ({ type: "tool-call", id, name, input });
const signal = new AbortController().signal;

function setup(options: { teamTools?: boolean; roleId?: string } = {}) {
  const mailbox = createTeamMailbox();
  const overlaps = createOverlapTracker();
  const live: LiveEventView[] = [];
  const ran: string[] = [];
  const inner: ToolRunner = {
    async run(toolCall) {
      ran.push(toolCall.name);
      return { content: `ran ${toolCall.name}`, isError: toolCall.name === "broken" };
    },
  };
  const runnerFor = (roleId: string) => createTeamRoleRunner({
    inner,
    teamId: "t1",
    roleId,
    roster: ["build", "check", "review"],
    labelFor: (role) => role[0]!.toUpperCase() + role.slice(1),
    mailbox,
    overlaps,
    teamTools: options.teamTools ?? true,
    now: () => 5,
    onLive: (event) => live.push(event),
  });
  return { mailbox, live, ran, runner: runnerFor(options.roleId ?? "build"), runnerFor };
}

describe("a Team role's tool runner", () => {
  it("sends a message to a teammate and shows it live", async () => {
    const { runner, mailbox, live, ran } = setup();
    const result = await runner.run(call("message_teammate", { to: "check", text: "API done in src/api.ts" }), signal);
    expect(result).toEqual({ content: "Sent to Check.", isError: false });
    expect(live).toEqual([{ kind: "message", to: "check", text: "API done in src/api.ts" }]);
    expect(mailbox.take("t1", "check")).toMatchObject([{ from: "build", text: "API done in src/api.ts" }]);
    expect(ran).toEqual([]);
  });

  it("refuses an unknown recipient, an empty message, and sends nothing", async () => {
    const { runner, live } = setup();
    expect((await runner.run(call("message_teammate", { to: "tester", text: "hi" }), signal)).isError).toBe(true);
    expect((await runner.run(call("message_teammate", { to: "check", text: "  " }), signal)).isError).toBe(true);
    expect(live).toEqual([]);
  });

  it("reads unread messages on request", async () => {
    const { runner, runnerFor } = setup();
    await runnerFor("check").run(call("message_teammate", { to: "build", text: "use v2 endpoint" }), signal);
    const read = await runner.run(call("read_messages"), signal);
    expect(read.content).toContain("Check: use v2 endpoint");
  });

  it("delivers unread messages with the result of the next tool", async () => {
    const { runner, runnerFor } = setup();
    await runnerFor("check").run(call("message_teammate", { to: "all", text: "renamed User to Account" }), signal);
    const result = await runner.run(call("read_file", { path: "a.ts" }), signal);
    expect(result.content).toContain("ran read_file");
    expect(result.content).toContain("Check: renamed User to Account");
    expect((await runner.run(call("read_file", { path: "a.ts" }), signal)).content).toBe("ran read_file");
  });

  it("warns when a teammate already edited the same file", async () => {
    const { runnerFor, live } = setup();
    await runnerFor("check").run(call("edit_file", { path: "src/a.ts", old_string: "a", new_string: "b" }), signal);
    const result = await runnerFor("build").run(call("propose_edit", { path: "src/a.ts", contents: "x" }), signal);
    expect(result.content).toMatch(/Check also edited src\/a\.ts/);
    expect(live).toContainEqual({ kind: "overlap", withRole: "check", path: "src/a.ts" });
  });

  it("does not count a failed edit as touching the file", async () => {
    const { runnerFor, live } = setup();
    await runnerFor("check").run(call("broken", { path: "src/a.ts" }), signal);
    await runnerFor("build").run(call("edit_file", { path: "src/a.ts", old_string: "a", new_string: "b" }), signal);
    expect(live.some((event) => event.kind === "overlap")).toBe(false);
  });

  it("is a plain pass-through without team tools", async () => {
    const { runner } = setup({ teamTools: false });
    expect((await runner.run(call("message_teammate", { to: "check", text: "hi" }), signal)).isError).toBe(true);
    expect((await runner.run(call("read_file"), signal)).content).toBe("ran read_file");
  });
});
