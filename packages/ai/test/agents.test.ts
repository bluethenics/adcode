import { describe, expect, it } from "vitest";
import { createCommandLineReader, detectAgent } from "@adcode/ai/agents";

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
