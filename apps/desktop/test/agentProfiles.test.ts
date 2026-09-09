import { describe, expect, it } from "vitest";
import { parseAgentProfiles, saveAgentProfile, removeAgentProfile, buildNamedAgentTeam } from "../src/renderer/ai/agentProfiles.ts";
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
