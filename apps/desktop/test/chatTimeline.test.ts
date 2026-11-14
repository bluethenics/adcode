import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatTurnDuration,
  helperTasksFrom,
  joinsToolGroup,
  matchHelperStatus,
  parseHelperReports,
  thinkingSummary,
  toolGroupCount,
  toolStepIcon,
  toolStepLabel,
  turnHeading,
} from "../src/renderer/ai/chatTimeline.ts";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const timelineSource = read("../src/renderer/ai/chatTimeline.ts");
const widgetSource = read("../src/renderer/ai/chatWidget.ts");
const styles = read("../src/renderer/styles/conversation.css");

describe("the turn's heading", () => {
  it("counts seconds, then minutes and seconds, then hours", () => {
    expect(formatTurnDuration(0.2)).toBe("1s");
    expect(formatTurnDuration(54.4)).toBe("54s");
    expect(formatTurnDuration(151)).toBe("2m 31s");
    expect(formatTurnDuration(180)).toBe("3m");
    expect(formatTurnDuration(3_725)).toBe("1h 2m");
  });

  it("says what the turn is doing, then what it did", () => {
    expect(turnHeading("running", 54)).toEqual({ lead: "Working", rest: "for 54s" });
    expect(turnHeading("worked", 151)).toEqual({ lead: "Worked", rest: "for 2m 31s" });
    // Thinking and an answer, no tools: it thought, it did not work.
    expect(turnHeading("thought", 5)).toEqual({ lead: "Thought", rest: "for 5s" });
    // A failed or stopped turn never claims it worked.
    expect(turnHeading("failed", 31)).toEqual({ lead: "Failed", rest: "after 31s" });
    expect(turnHeading("stopped", 12)).toEqual({ lead: "Stopped", rest: "after 12s" });
    expect(turnHeading("declined", 3)).toEqual({ lead: "Declined", rest: "" });
  });
});

describe("thinking rows", () => {
  it("summarise to the first line, without markdown markers", () => {
    expect(thinkingSummary("**Researching current date systems** I need to dig into...")).toBe("Researching current date systems I need to dig into...");
    expect(thinkingSummary("\n\n  ## Planning the page\nFirst the hero, then the pricing table.")).toBe("Planning the page");
    expect(thinkingSummary("   ")).toBe("");
    expect(thinkingSummary("x".repeat(400)).length).toBeLessThanOrEqual(160);
  });
});

describe("tool rows", () => {
  it("name a step the way a person would", () => {
    expect(toolStepLabel("read_file")).toBe("Read file");
    expect(toolStepLabel("search")).toBe("Search project");
    expect(toolStepLabel("glob_files")).toBe("Find files");
    expect(toolStepLabel("edit_file")).toBe("Edit file");
    expect(toolStepLabel("propose_edit")).toBe("Edit file");
    expect(toolStepLabel("run_command")).toBe("Run command");
    expect(toolStepLabel("fetch_url")).toBe("Read URL");
    expect(toolStepLabel("view_page")).toBe("View page");
    expect(toolStepLabel("update_plan")).toBe("Update plan");
    expect(toolStepLabel("ask_user")).toBe("Ask the user");
    expect(toolStepLabel("memory_write")).toBe("Project memory");
    expect(toolStepLabel("call_mcp")).toBe("Use MCP tool");
    // An unknown tool still reads as words, not as an identifier.
    expect(toolStepLabel("make_thumbnail")).toBe("Make thumbnail");
    expect(toolStepLabel("")).toBe("Use a tool");
  });

  it("pick an icon by what the tool does", () => {
    expect(toolStepIcon("search")).toBe("search");
    expect(toolStepIcon("glob_files")).toBe("search");
    expect(toolStepIcon("fetch_url")).toBe("globe");
    expect(toolStepIcon("read_file")).toBe("file");
    expect(toolStepIcon("edit_file")).toBe("edit");
    expect(toolStepIcon("run_command")).toBe("terminal");
    expect(toolStepIcon("view_page")).toBe("eye");
    expect(toolStepIcon("update_plan")).toBe("checklist");
    expect(toolStepIcon("call_mcp")).toBe("plug");
    expect(toolStepIcon("make_thumbnail")).toBe("tool");
  });

  it("group a run of the same tool into one row with a count", () => {
    expect(toolGroupCount(1)).toBe("");
    expect(toolGroupCount(11)).toBe("11 calls");
    const group = { kind: "tools", name: "search" } as const;
    expect(joinsToolGroup(group, "search")).toBe(true);
    expect(joinsToolGroup(group, "read_file")).toBe(false);
    // Thinking or text between two searches starts a new row: the timeline reads in order.
    expect(joinsToolGroup({ kind: "thinking" }, "search")).toBe(false);
    expect(joinsToolGroup(null, "search")).toBe(false);
  });
});

describe("sub-agent rows", () => {
  it("read the helpers out of a delegate_task call, exactly as the main process will run them", () => {
    expect(helperTasksFrom({ tasks: [{ title: " Map auth ", instructions: "Find the login flow" }] })).toEqual([{ title: "Map auth", mode: "explore" }]);
    expect(helperTasksFrom({ tasks: [{ title: "Tests", instructions: "Write them", mode: "build" }] })).toEqual([{ title: "Tests", mode: "build" }]);
    // A long title is cut the same way parseDelegation cuts it, or status lines stop matching.
    expect(helperTasksFrom({ tasks: [{ title: "x".repeat(120), instructions: "y" }] })[0]?.title.length).toBe(80);
    // Calls the main process refuses draw no rows: this one would not run.
    expect(helperTasksFrom({ tasks: [] })).toEqual([]);
    expect(helperTasksFrom({ tasks: Array.from({ length: 5 }, () => ({ title: "x", instructions: "y" })) })).toEqual([]);
    expect(helperTasksFrom({ tasks: [{ title: "", instructions: "y" }] })).toEqual([]);
    expect(helperTasksFrom({ tasks: [{ title: "x", instructions: "" }] })).toEqual([]);
    expect(helperTasksFrom({ tasks: [{ title: "x", instructions: "y", mode: "admin" }] })).toEqual([]);
    expect(helperTasksFrom("everything")).toEqual([]);
  });

  it("attaches a live status line to the helper its title names", () => {
    const tasks = [{ title: "Map auth", mode: "explore" }, { title: "Tests: cart", mode: "build" }] as const;
    expect(matchHelperStatus("Helper 2 of 2 · Tests: cart: reading src/cart.ts", tasks)).toEqual({ index: 1, title: "Tests: cart", detail: "reading src/cart.ts", state: "running" });
    expect(matchHelperStatus("Helper 1 of 2 · Map auth: starting", tasks)).toMatchObject({ index: 0, state: "running" });
    expect(matchHelperStatus("Helper 2 of 2 · Tests: cart: finished", tasks)).toMatchObject({ index: 1, detail: "finished", state: "done" });
    expect(matchHelperStatus("Helper 1 of 2 · Map auth: stopped", tasks)).toMatchObject({ state: "stopped" });
    expect(matchHelperStatus("Helper 1 of 2 · Map auth: failed", tasks)).toMatchObject({ state: "error" });
    // A lone helper has no count in its line.
    expect(matchHelperStatus("Helper · Map auth: finished", [{ title: "Map auth", mode: "explore" }])).toEqual({ index: 0, title: "Map auth", detail: "finished", state: "done" });
    // Anything that is not one of these helpers' own lines is not consumed.
    expect(matchHelperStatus("Waiting 21s for Groq's rate limit", tasks)).toBeNull();
    expect(matchHelperStatus("Helper 1 of 2 · Some other task: starting", tasks)).toBeNull();
    expect(matchHelperStatus("Helper 3 of 2 · Map auth: starting", tasks)).toBeNull();
  });

  it("splits a delegate_task result into each helper's ending, calls and report", () => {
    const content = [
      "2 of 3 sub-agents finished.",
      "",
      "## 1. Map auth (explore) - done, 3 tool calls",
      "The login flow starts in src/auth.ts.",
      "",
      "## Notes",
      "Not a helper heading - a report's own words stay whole.",
      "",
      "## 2. Tests (build) - stopped, 1 tool call",
      "(no report)",
      "",
      "## 3. Styles (build) - failed: the model declined, 0 tool calls",
      "",
    ].join("\n");
    const outcomes = parseHelperReports(content);
    expect(outcomes).toHaveLength(3);
    expect(outcomes[0]).toEqual({ index: 0, ended: "done", calls: 3, report: "The login flow starts in src/auth.ts.\n\n## Notes\nNot a helper heading - a report's own words stay whole." });
    expect(outcomes[1]).toEqual({ index: 1, ended: "stopped", calls: 1, report: "" });
    expect(outcomes[2]).toMatchObject({ index: 2, ended: "failed", calls: 0, report: "" });
    expect(parseHelperReports("At most 4 sub-agents per call.")).toEqual([]);
    // A helper on a task agent says which model ran it and what it spent.
    expect(parseHelperReports("## 1. Tests (build) - done, 4 tool calls · on deepseek-chat as DeepSeek coder, 12k in / 2.1k out tokens\nAdded 3 tests.")[0])
      .toEqual({ index: 0, ended: "done", calls: 4, ranOn: "on deepseek-chat as DeepSeek coder, 12k in / 2.1k out tokens", report: "Added 3 tests." });
  });

  it("draws helpers as their own rows, fed by status lines and the closing result", () => {
    expect(timelineSource).toContain("matchHelperStatus(");
    expect(timelineSource).toContain("parseHelperReports(");
    expect(timelineSource).toContain("chat-step-helpers");
    expect(timelineSource).toContain("chat-helper-mode");
    // The widget hands the call input through and routes helper statuses and results apart.
    expect(widgetSource).toContain("input: call.input");
    expect(widgetSource).toContain("timeline?.helperStatus(");
    expect(widgetSource).toContain("helperResult(");
    expect(styles).toContain(".chat-helper");
    expect(styles).toContain(".chat-helper-collapse");
  });
});

describe("chats that keep working", () => {
  it("follows each chat's own events, and replays a working chat when it is opened", () => {
    expect(widgetSource).toContain("if (!eventIsShown(eventSession)) return;");
    expect(widgetSource).toContain("window.adcode.ai.liveTurn(id)");
    expect(widgetSource).toContain("handleAgentEvent(event, true)");
    // Opening another chat leaves the working one working: no cancel on the way out.
    const leave = widgetSource.slice(widgetSource.indexOf("function leaveShownChat(): void {"), widgetSource.indexOf("function sendParkedFollowUp("));
    expect(leave).not.toContain("ai.cancel");
    expect(leave).toContain("parkedFollowUps.set(");
  });

  it("leaves keeping going to the main process, and shows its Continue as a note when reopened", () => {
    expect(widgetSource).not.toContain("KEEP_GOING_LIMIT");
    expect(widgetSource).toContain('case "continuing":');
    expect(widgetSource).toContain('message.text.trim() === CONTINUE_PROMPT');
  });
});

describe("the timeline in the chat", () => {
  it("is one timeline per turn, with text inside it and the answer left outside when it ends", () => {
    expect(widgetSource).toContain("createTurnTimeline(");
    expect(widgetSource).not.toContain("createActivityBlock(");
    expect(timelineSource).toContain("releaseAnswer");
    // The streamed text joins the timeline, in order with the steps around it.
    expect(widgetSource).toContain("timeline.appendText(");
    // A heading over nothing but text is a placeholder: the text replaces it.
    expect(widgetSource).toContain("if (!timeline.hasSteps())");
  });

  it("shows thinking, with the full text a click away", () => {
    const thinking = widgetSource.slice(widgetSource.indexOf('case "thinking":'), widgetSource.indexOf('case "tool-call":'));
    expect(thinking).toContain('.thinking(String(event["text"] ?? ""))');
    expect(timelineSource).toContain("chat-step-detail");
    expect(timelineSource).toContain('aria-expanded');
  });

  it("keeps one face at work: the mascot in the heading, pixel spinners on live rows", () => {
    // The face is Buck now (mascot/adcodeMascot.ts), behind the same small handle.
    expect(timelineSource).toContain("createAdcodeMascot(");
    expect(timelineSource).toContain("const mascot = buckForTurn();");
    expect(timelineSource).toContain("createPixelSpinner(");
    const finish = timelineSource.slice(timelineSource.indexOf("finish(outcome"), timelineSource.indexOf("destroy(): void {"));
    expect(finish).toContain("mascot.destroy()");
    expect(widgetSource).toContain("createPixelSpinner(");
  });

  it("moves smoothly, and not at all when asked not to", () => {
    expect(styles).toContain(".chat-turn-collapse");
    expect(styles).toContain("grid-template-rows");
    expect(styles).toContain("@keyframes chat-pixel");
    expect(styles).toContain("@keyframes chat-step-in");
    expect(styles).toContain("prefers-reduced-motion");
    expect(styles).toContain(':root[data-reduced-motion="true"] .chat-turn');
  });
});
