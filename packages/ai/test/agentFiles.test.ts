import { describe, expect, it } from "vitest";
import { parseAgentFile, readAgentFiles, splitFrontMatter, toolsFromList, withFileAgents } from "../src/agentFiles.ts";
import { readTaskAgents, rosterContext } from "../src/taskAgents.ts";

// The shape Claude Code writes with /agents.
const CLAUDE_AGENT = `---
name: code-reviewer
description: Reviews changed code for bugs and missing tests. Use after any edit.
tools: Read, Grep, Glob, Bash
model: sonnet
---

You are a careful reviewer. Read the diff, then report problems by file and line.
`;

describe("agent files", () => {
  it("reads a Claude Code subagent as an ADCode task agent on the chat's model", () => {
    const agent = parseAgentFile(".claude/agents/code-reviewer.md", CLAUDE_AGENT, "project");
    expect(agent).toMatchObject({
      id: "code-reviewer",
      useCurrentModel: true,
      provider: "",
      description: "Reviews changed code for bugs and missing tests. Use after any edit.",
      toolAccess: ["read_file", "search", "glob_files", "run_command", "command_output", "stop_command"],
      origin: ".claude/agents/code-reviewer.md",
    });
    expect(typeof agent !== "string" && agent.instructions.startsWith("You are a careful reviewer.")).toBe(true);
  });

  it("lets only the person's own files choose a model", () => {
    const text = "---\nname: cheap-coder\nmodel: deepseek/deepseek-chat\nhelper-for: build\n---\nWrite the code.";
    expect(parseAgentFile("~/.adcode/agents/cheap-coder.md", text, "user")).toMatchObject({ provider: "deepseek", model: "deepseek-chat", useCurrentModel: false, helperFor: ["build"] });
    expect(parseAgentFile(".adcode/agents/cheap-coder.md", text, "project")).toMatchObject({ provider: "", model: "", useCurrentModel: true });
  });

  it("names the problem with a file it cannot use, and keeps the first of two with one name", () => {
    expect(parseAgentFile("a.md", "no front matter", "project")).toContain("no front matter");
    expect(parseAgentFile("a.md", "---\nname: ok-agent\n---\n", "project")).toContain("no instructions");
    expect(parseAgentFile("a.md", "---\nname: x\n---\nhi", "project")).toContain("cannot be an agent's name");
    expect(parseAgentFile("a.md", "---\nname: tool-less\ntools: Teleport\n---\nhi", "project")).toContain("none of its tools");
    const { agents, problems } = readAgentFiles([
      { origin: ".adcode/agents/code-reviewer.md", text: CLAUDE_AGENT.replace("Use after any edit.", "Ours."), scope: "project" },
      { origin: ".claude/agents/code-reviewer.md", text: CLAUDE_AGENT, scope: "project" },
    ]);
    expect(agents.map((agent) => agent.description)).toEqual(["Reviews changed code for bugs and missing tests. Ours."]);
    expect(problems[0]).toContain("already defined");
  });

  it("reads tool lists written as YAML lists, brackets or ADCode names", () => {
    expect(splitFrontMatter("---\nname: a-b-c\ntools:\n  - Read\n  - Edit\n---\nbody")?.fields["tools"]).toBe("Read, Edit");
    expect(toolsFromList("[Read, edit_file]")).toEqual(["read_file", "edit_file"]);
    expect(toolsFromList("*")).toBe("all");
    expect(toolsFromList("Bash(npm test:*)")).toEqual(["run_command", "command_output", "stop_command"]);
  });

  it("puts saved agents first and shows a file agent's description in the roster", () => {
    const saved = readTaskAgents([{ id: "code-reviewer", name: "Mine", instructions: "Saved one", useCurrentModel: true }]);
    const file = parseAgentFile(".claude/agents/test-writer.md", CLAUDE_AGENT.replace("code-reviewer", "test-writer"), "project");
    const reviewer = parseAgentFile(".claude/agents/code-reviewer.md", CLAUDE_AGENT, "project");
    if (typeof file === "string" || typeof reviewer === "string") throw new Error(String(file));
    const all = withFileAgents(saved, [reviewer, file]);
    expect(all.map((agent) => `${agent.id}:${agent.name}`)).toEqual(["code-reviewer:Mine", "test-writer:test-writer"]);
    expect(rosterContext(all, { provider: "anthropic", model: "claude" })).toContain("Reviews changed code");
  });
});
