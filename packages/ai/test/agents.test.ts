import { describe, expect, it } from "vitest";
import { agentCommand, createCommandLineReader, detectAgent, knownAgents } from "@adcode/ai/agents";

describe("detectAgent", () => {
  it("recognises an agent started by name", () => {
    expect(detectAgent("claude")?.name).toBe("Claude Code");
    expect(detectAgent("aider")?.name).toBe("Aider");
    expect(detectAgent("opencode")?.name).toBe("OpenCode");
  });

  it("recognises one with arguments", () => {
    expect(detectAgent("claude --resume")?.id).toBe("claude");
  });

  it("sees through a runner", () => {
    expect(detectAgent("npx claude")?.id).toBe("claude");
    expect(detectAgent("uvx aider")?.id).toBe("aider");
    expect(detectAgent("sudo npx codex")?.id).toBe("codex");
  });

  it("sees through a path to the binary", () => {
    expect(detectAgent("./node_modules/.bin/claude")?.id).toBe("claude");
    expect(detectAgent("C:\\tools\\claude.exe")?.id).toBe("claude");
  });

  it("ignores leading environment assignments", () => {
    expect(detectAgent("ANTHROPIC_API_KEY=sk-x claude")?.id).toBe("claude");
  });

  /*
   * The test this module exists to satisfy. A substring match fires on somebody *talking*
   * about an agent, and an offer that appears when you mention a word gets switched off
   * within a day.
   */
  it("does not fire on the word appearing in an argument", () => {
    expect(detectAgent('git commit -m "ask claude about this"')).toBeNull();
    expect(detectAgent("echo claude")).toBeNull();
    expect(detectAgent("grep -r aider .")).toBeNull();
  });

  it("only considers the first command in a chain", () => {
    expect(detectAgent("echo hi && claude")).toBeNull();
    expect(detectAgent("claude && echo hi")?.id).toBe("claude");
  });

  it("ignores an unrelated command", () => {
    expect(detectAgent("npm run build")).toBeNull();
    expect(detectAgent("ls -la")).toBeNull();
    expect(detectAgent("")).toBeNull();
  });

  /*
   * Detection is what gates every terminal AI feature: an undetected CLI gets no automatic
   * continuation, cannot be a scheduled message's target, and cannot take a Team role. So
   * each recognised name is worth a line here rather than trusting the map by inspection.
   */
  it("recognises the other agent CLIs people run", () => {
    expect(detectAgent("grok")?.name).toBe("Grok CLI");
    expect(detectAgent("kimi")?.name).toBe("Kimi CLI");
    expect(detectAgent("qwen")?.name).toBe("Qwen Code");
    expect(detectAgent("amp")?.name).toBe("Amp");
    expect(detectAgent("goose session")?.name).toBe("Goose");
    expect(detectAgent("crush")?.name).toBe("Crush");
    expect(detectAgent("droid")?.name).toBe("Factory Droid");
    expect(detectAgent("cn")?.name).toBe("Continue CLI");
    expect(detectAgent("cursor-agent")?.name).toBe("Cursor Agent");
  });

  /* `cursor` alone opens the editor, not the agent, and must not be mistaken for it. */
  it("does not treat the Cursor editor as the Cursor agent", () => {
    expect(detectAgent("cursor .")).toBeNull();
  });

  it("sees the newer ones through a runner and a path too", () => {
    expect(detectAgent("npx grok")?.id).toBe("grok");
    expect(detectAgent("XAI_API_KEY=sk-x grok --resume")?.id).toBe("grok");
    expect(detectAgent("./node_modules/.bin/kimi")?.id).toBe("kimi");
  });
});

describe("knownAgents", () => {
  it("lists every recognised agent once, sorted for a menu", () => {
    const names = knownAgents().map((agent) => agent.name);
    expect(names).toContain("Grok CLI");
    expect(names).toContain("Kimi CLI");
    expect(names).toContain("Claude Code");
    expect(new Set(names).size).toBe(names.length);
    expect([...names]).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  /* Team launches a CLI by typing its name, so every listed agent needs one that works. */
  it("gives a command that detection recognises back", () => {
    for (const agent of knownAgents()) {
      expect(detectAgent(agentCommand(agent.id))?.id).toBe(agent.id);
    }
  });
});

describe("createCommandLineReader", () => {
  it("returns a line when it is submitted", () => {
    const reader = createCommandLineReader();
    expect(reader.push("claude")).toBeNull();
    expect(reader.push("\r")).toBe("claude");
  });

  it("starts again after a line", () => {
    const reader = createCommandLineReader();
    reader.push("claude\r");
    expect(reader.push("ls\r")).toBe("ls");
  });

  it("handles backspace", () => {
    const reader = createCommandLineReader();
    reader.push("claudx");
    reader.push("\u007f");
    expect(reader.push("e\r")).toBe("claude");
  });

  it("abandons the line on Ctrl+C", () => {
    const reader = createCommandLineReader();
    reader.push("claude");
    reader.push("\u0003");
    expect(reader.push("\r")).toBe("");
  });

  /*
   * Escape sequences corrupt the line, deliberately.
   *
   * An arrow key arrives as ESC [ D. The ESC is dropped as a control character and the
   * `[D` survives as ordinary text, so a line edited with arrow keys comes out mangled and
   * fails to match an agent. That is the safe direction to be wrong in: it costs an offer
   * nobody was promised, and it can never produce a false one.
   */
  it("mangles a line edited with arrow keys rather than guessing at it", () => {
    const reader = createCommandLineReader();
    const line = reader.push("cla\u001b[Dude" + String.fromCharCode(13));

    expect(line).toBe("cla[Dude");
    expect(detectAgent(line ?? "")).toBeNull();
  });

  it("handles a whole line arriving at once, as a paste does", () => {
    const reader = createCommandLineReader();
    expect(reader.push("npx claude --resume\r")).toBe("npx claude --resume");
  });

  it("resets on demand", () => {
    const reader = createCommandLineReader();
    reader.push("clau");
    reader.reset();
    expect(reader.push("\r")).toBe("");
  });
});
