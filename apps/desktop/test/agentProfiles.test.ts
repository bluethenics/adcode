import { describe, expect, it } from "vitest";
import { parseAgentProfiles, saveAgentProfile, removeAgentProfile, buildNamedAgentTeam, buildSoloRun, continuationPrompt } from "../src/renderer/ai/agentProfiles.ts";
import { starterAgents } from "../src/renderer/agents/starterAgents.ts";
import { parseAiTeamConfigure } from "../src/main/aiTeamIpcValidation.ts";

const ada = { id: "agent-ada", name: "Ada", instructions: "Implement carefully.", provider: "connection-nim", model: "custom/model" };
const grace = { ...ada, id: "agent-grace", name: "Grace", instructions: "Review tests." };

describe("reusable named agents", () => {
  it("validates profiles, strips unknown fields and supports edit/delete without a four-profile library limit", () => {
    expect(parseAgentProfiles("broken")).toEqual([]);
    expect(parseAgentProfiles(JSON.stringify([{ ...ada, apiKey: "secret" }, { ...grace, name: " " }]))).toEqual([ada]);
    const many = Array.from({ length: 8 }, (_, i) => ({ ...ada, id: `agent-${i}` }));
    expect(saveAgentProfile(many, { ...ada, id: "agent-0", name: "Updated" })).toHaveLength(8);
    expect(removeAgentProfile(many, "agent-0")).toHaveLength(7);
    expect(() => saveAgentProfile([], { ...ada, model: "" })).toThrow();
  });
  it("maps selected profiles into executable roles with instructions and durable routes", () => {
    const input = buildNamedAgentTeam("Update the editor", [ada, grace]);
    expect(input.roles[0]).toMatchObject({ id: ada.id, label: "Ada", objective: ada.instructions, route: { provider: ada.provider, model: ada.model } });
    expect(input.nodes[0]?.objective).toContain("Update the editor");
    const parsed = parseAiTeamConfigure(input, "team-named");
    expect(parsed?.plan.roles[0]).toMatchObject({ objective: ada.instructions, route: { provider: ada.provider, model: ada.model } });
    expect(() => buildNamedAgentTeam("Task", [ada])).toThrow(/two|2/i);
    expect(() => buildNamedAgentTeam("Task", [ada, ada])).toThrow(/duplicate/i);
    expect(parseAiTeamConfigure({ ...input, roles: input.roles.map(r => ({ ...r, route: { provider: "", model: "x" } })) }, "team-bad")).toBeNull();
  });
  it("lets a reviewer wait for teammate handoffs and rejects teams with no starting agent", () => {
    const reviewer = { ...grace, runAfterTeammates: true };
    const input = buildNamedAgentTeam("Implement and verify", [ada, reviewer]);
    expect(input.nodes[0]?.dependsOn).toEqual([]);
    expect(input.nodes[1]?.dependsOn).toEqual([ada.id]);
    expect(parseAgentProfiles(JSON.stringify([reviewer]))[0]?.runAfterTeammates).toBe(true);
    expect(() => buildNamedAgentTeam("Task", [{ ...ada, runAfterTeammates: true }, reviewer])).toThrow(/start/i);
  });
});

describe("agent looks and tool access", () => {
  it("loads profiles saved before looks and tool access existed, unchanged", () => {
    expect(parseAgentProfiles(JSON.stringify([ada]))).toEqual([ada]);
  });

  it("keeps a saved look and tool access", () => {
    const reviewer = { ...grace, mascot: { shape: "egg", color: "teal" }, toolAccess: "read-only" };
    expect(parseAgentProfiles(JSON.stringify([reviewer]))).toEqual([reviewer]);
    const picky = { ...ada, toolAccess: ["read_file", "search"] };
    expect(parseAgentProfiles(JSON.stringify([picky]))[0]?.toolAccess).toEqual(["read_file", "search"]);
  });

  it("drops only the profile whose tool access is invalid", () => {
    const bad = { ...grace, toolAccess: "root" };
    expect(parseAgentProfiles(JSON.stringify([ada, bad]))).toEqual([ada]);
  });

  it("ignores an unknown look rather than losing the agent", () => {
    const odd = { ...ada, mascot: { shape: "dragon", color: "teal" } };
    expect(parseAgentProfiles(JSON.stringify([odd]))).toEqual([ada]);
  });
});

describe("board runs", () => {
  it("builds a one-agent run that main accepts", () => {
    const input = buildSoloRun("Fix the login button\nIt does nothing on Safari", { ...grace, toolAccess: "read-only" });
    expect(input.kind).toBe("solo");
    expect(input.roles).toHaveLength(1);
    expect(input.nodes).toHaveLength(1);
    expect(input.concurrency).toBe(1);
    expect(input.nodes[0]?.title).toBe("Fix the login button");
    expect(input.roles[0]).toMatchObject({ label: "Grace", objective: grace.instructions, route: { provider: grace.provider, model: grace.model }, toolAccess: "read-only" });
    const parsed = parseAiTeamConfigure(input, "run-solo");
    expect(parsed?.plan.kind).toBe("solo");
    expect(parsed?.plan.roles[0]?.toolAccess).toBe("read-only");
  });

  it("runs the default agent on the current model with every tool", () => {
    const input = buildSoloRun("Add a dark mode toggle", null);
    expect(input.roles[0]?.label).toBe("Default agent");
    expect(input.roles[0]?.route).toBeUndefined();
    expect(input.roles[0]?.toolAccess).toBeUndefined();
    expect(parseAiTeamConfigure(input, "run-default")).not.toBeNull();
  });

  it("turns a dollar cap into a hard cost limit, and leaves it effectively open without one", () => {
    expect(buildSoloRun("Task", null, { capDollars: 0.5 }).costMicrosLimit).toBe(500_000);
    expect(buildSoloRun("Task", null).costMicrosLimit).toBe(1_000_000_000_000);
    expect(buildSoloRun("Task", null).tokenLimit).toBe(2_000_000);
  });

  it("refuses an empty task", () => {
    expect(() => buildSoloRun("   ", null)).toThrow(/describe/i);
  });

  it("carries the previous run into a follow-up", () => {
    const prompt = continuationPrompt({ prompt: "Add login", summary: "Added a login form in src/login.ts", changedPaths: ["src/login.ts"] }, "Now add a logout button");
    expect(prompt.startsWith("Now add a logout button")).toBe(true);
    expect(prompt).toContain("Added a login form");
    expect(prompt).toContain("src/login.ts");
  });
});

describe("starter agents", () => {
  it("gives a new user five useful agents on their current model", () => {
    const starters = starterAgents({ provider: "anthropic", model: "claude-sonnet-5" });
    expect(starters.map((agent) => agent.name)).toEqual(["Reviewer", "Tester", "UI polish", "Bug fixer", "Docs writer"]);
    expect(new Set(starters.map((agent) => agent.id)).size).toBe(5);
    expect(starters.find((agent) => agent.name === "Reviewer")?.toolAccess).toBe("read-only");
    for (const agent of starters) {
      expect(saveAgentProfile([], agent)).toHaveLength(1);
      expect(agent.provider).toBe("anthropic");
    }
    expect(new Set(starters.map((agent) => agent.mascot?.shape)).size).toBe(5);
  });
});

describe("per-agent cost caps and races", () => {
  it("keeps a sensible cost cap and ignores a nonsensical one", () => {
    expect(parseAgentProfiles(JSON.stringify([{ ...ada, capDollars: 0.5 }]))[0]?.capDollars).toBe(0.5);
    for (const capDollars of [0, -1, 5_000, "2"]) {
      expect(parseAgentProfiles(JSON.stringify([{ ...ada, capDollars }]))[0], String(capDollars)).toEqual(ada);
    }
  });

  it("puts every lane of a race in one group", () => {
    const input = buildSoloRun("Add dark mode", ada, { group: "race-7f3a9c21" });
    expect(input.group).toBe("race-7f3a9c21");
    expect(parseAiTeamConfigure(input, "run-lane")?.plan.group).toBe("race-7f3a9c21");
    expect(buildSoloRun("Add dark mode", ada).group).toBeUndefined();
  });
});
