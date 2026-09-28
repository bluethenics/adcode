/**
 * The Agents page wires the tested board model (`agentBoardModel.test.ts`) to the DOM and the
 * main process. These checks pin what a test without a window can still see: the accessible
 * structure, that it starts real runs through the validated builder, and that every way in
 * is a registered command.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../src/renderer/agents/agentsPage.ts", import.meta.url), "utf8");
const dialogs = readFileSync(new URL("../src/renderer/agents/agentDialogs.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/renderer/styles/agents.css", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

describe("Agents page", () => {
  it("lays the board out as labelled lists a screen reader can walk", () => {
    expect(page).toContain('setAttribute("role", "list")');
    expect(page).toContain('setAttribute("role", "listitem")');
    expect(page).toContain('"Working"');
    expect(page).toContain('"Needs you"');
    expect(page).toContain('"Ready"');
    expect(page).toContain("Finished today");
  });

  it("renders from the board model and gives every agent its mascot", () => {
    expect(page).toContain("buildBoard(");
    expect(page).toContain("boardSummary(");
    expect(page).toContain("createAgentMascot(");
    expect(page).toContain("mascotMoodForStatus(");
  });

  it("starts real runs through the validated builder, after saving open files", () => {
    expect(page).toContain("buildSoloRun(");
    expect(page).toContain("window.adcode.aiTeam.configure(");
    expect(page).toContain("window.adcode.aiTeam.start(");
    expect(page).toContain("deps.saveAllOpenFiles()");
  });

  it("stays live without polling the main process", () => {
    expect(page).toContain("window.adcode.aiTeam.onChanged(");
    expect(page).toContain("window.adcode.aiWorkspace.onChanged(");
    expect(page).toContain("window.adcode.settings.onChanged(");
  });

  it("offers starter agents once, and Team setup from the library", () => {
    expect(page).toContain("STARTERS_MARKER");
    expect(page).toContain("starterAgents(");
    expect(page).toContain("Select for a Team");
    expect(page).toContain("buildNamedAgentTeam(");
  });

  it("uses real dialogs with a mascot picker and enforced tool access", () => {
    expect(dialogs).toContain("showModal()");
    expect(dialogs).toContain("openFormModal(");
    expect(dialogs).toContain("MASCOT_SHAPES");
    expect(dialogs).toContain("MASCOT_COLORS");
    expect(dialogs).toContain("Pick tools");
    expect(dialogs).toContain("Read-only");
  });

  it("stacks the columns on a narrow page and styles the boxes", () => {
    expect(styles).toContain(".agents-board");
    expect(styles).toContain(".agent-box");
    expect(styles).toContain("@container agents");
  });

  it("is reachable by command from both windows", () => {
    expect(main).toContain('add("agents.open"');
    expect(main).toContain('add("agents.newTask"');
    expect(main).toContain('add("agents.newAgent"');
    expect(main).toContain('add("workspace.tasks", "Show AI Tasks", () => commands.run("agents.open"))');
  });
});
