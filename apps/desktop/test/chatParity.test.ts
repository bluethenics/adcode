import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { featureFor } from "@adcode/help";
import { DEDICATED_ROUTES, parityMarkdown, parityRows } from "../src/main/chatParity.ts";
import { ADCODE_APP_TOOLS, ARG_COMMANDS, chatCanRunCommand, chatSettingRoute } from "../src/main/adcodeAppTools.ts";

const DOC = join(import.meta.dirname, "../../../docs/chat-agent-parity.md");
const MAIN = readFileSync(join(import.meta.dirname, "../src/renderer/main.ts"), "utf8");

describe("chat parity audit", () => {
  it("docs/chat-agent-parity.md is the generated table", () => {
    const fresh = parityMarkdown();
    if (process.env["ADCODE_WRITE_PARITY"] === "1") writeFileSync(DOC, fresh);
    expect(readFileSync(DOC, "utf8").replace(/\r\n/g, "\n")).toBe(fresh);
  });

  it("names only real features as having a dedicated route", () => {
    expect(Object.keys(DEDICATED_ROUTES).filter((id) => featureFor(id) === undefined)).toEqual([]);
  });

  it("gives the features the chat was asked to reach a route", () => {
    const rows = new Map(parityRows().map((row) => [row.id, row]));
    for (const id of ["workbench.agentFlow", "workbench.mods", "ai.taskAgents", "workbench.toolsPage", "workbench.projectWindows", "workbench.soloTeam", "workbench.agentsBoard", "workbench.preview", "workbench.terminal", "adcode.git.stageCommitUi", "ai.usage", "account.earnings", "ads.convertEarnings"]) {
      expect(rows.get(id)?.access, id).not.toBe("explained only");
    }
    expect(rows.get("adcode.ai.fullAccess")?.access).toBe("refused");
  });

  it("keeps the guard rails: Full access refused, money and edit policy ask first", () => {
    expect(chatCanRunCommand("ai.fullAccess")).toBe(false);
    expect(chatSettingRoute("adcode.ai.fullAccess")).toBe("refused");
    for (const id of ["adcode.ai.editPolicy", "adcode.ai.provider", "adcode.ai.connections", "adcode.ads.enabled", "adcode.updates.auto", "adcode.ai.agentFlows", "adcode.ai.agentProfiles"]) {
      expect(chatSettingRoute(id), id).toBe("asks");
    }
    expect(chatSettingRoute("adcode.appearance.theme")).toBe("direct");
  });

  it("only passes arguments to commands the window reads one for", () => {
    for (const command of Object.keys(ARG_COMMANDS)) {
      expect(chatCanRunCommand(command), command).toBe(true);
      expect(MAIN).toMatch(new RegExp(`add\\("${command.replace(/\./g, "\\.")}", "[^"]+", (async )?\\(?[a-z]\\w*\\)? =>`));
    }
  });

  it("keeps adcode_action small enough to send with every request", () => {
    const action = ADCODE_APP_TOOLS.find((tool) => tool.name === "adcode_action")!;
    expect(JSON.stringify(action).length).toBeLessThan(2_600);
  });
});
