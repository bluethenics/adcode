import { describe, expect, it } from "vitest";
import { parseFlags } from "../src/context.ts";

describe("parseFlags - the terminal app's grammar", () => {
  it("has no command and no rest when launched bare", () => {
    const parsed = parseFlags([]);
    expect(parsed.command).toBeNull();
    expect(parsed.rest).toEqual([]);
    expect(parsed.flags.json).toBe(false);
  });

  it("keeps a bare word as the command and the sentence as rest", () => {
    const parsed = parseFlags(["chat", "explain this repository", "--no-ads"]);
    expect(parsed.command).toBe("chat");
    expect(parsed.rest).toEqual(["explain this repository"]);
    expect(parsed.flags.noAds).toBe(true);
  });

  it("accepts a command after a leading global flag", () => {
    const parsed = parseFlags(["--theme", "paper", "status", "--json"]);
    expect(parsed.command).toBe("status");
    expect(parsed.flags.theme).toBe("paper");
    expect(parsed.flags.json).toBe(true);
  });

  it("accepts inline values", () => {
    const parsed = parseFlags([
      "chat",
      "--model=test-default",
      "--provider=tagflow",
      "--width=88",
      "--height=24",
      "--effort=high",
      "--session=s-abc123",
    ]);
    expect(parsed.flags.model).toBe("test-default");
    expect(parsed.flags.provider).toBe("tagflow");
    expect(parsed.flags.width).toBe(88);
    expect(parsed.flags.height).toBe(24);
    expect(parsed.flags.effort).toBe("high");
    expect(parsed.flags.session).toBe("s-abc123");
  });

  it("maps -c, -h and -v", () => {
    expect(parseFlags(["chat", "-c"]).flags.continueSession).toBe(true);
    expect(parseFlags(["-h"]).command).toBe("help");
    expect(parseFlags(["--help"]).command).toBe("help");
    expect(parseFlags(["-v"]).command).toBe("version");
    expect(parseFlags(["--version"]).command).toBe("version");
  });

  it("catches misspelled options before a command can make a request", () => {
    expect(() => parseFlags(["doctor", "--frobnicate"])).toThrow('Unknown option "--frobnicate"');
  });

  it("preserves literal messages after --", () => {
    const parsed = parseFlags(["chat", "--", "--help", "--model", "text"]);
    expect(parsed.command).toBe("chat");
    expect(parsed.flags.model).toBeNull();
    expect(parsed.rest).toEqual(["--help", "--model", "text"]);
  });

  it("routes help to the requested command regardless of flag order", () => {
    expect(parseFlags(["chat", "--help"]).rest).toEqual(["chat"]);
    expect(parseFlags(["--help", "models"]).rest).toEqual(["models"]);
    expect(parseFlags(["app", "--help"]).command).toBe("help");
  });

  it.each(["--model", "--provider", "--theme", "--session", "--effort", "--width", "--height"])("rejects %s without a value", (flag) => {
    expect(() => parseFlags([flag])).toThrow("needs a value");
    expect(() => parseFlags([flag, "--json"])).toThrow("needs a value");
  });

  it.each(["0", "-20", "Infinity", "80oops", "20.5", "10000000"])("rejects invalid terminal width %s", (value) => {
    expect(() => parseFlags(["--width", value])).toThrow("whole number");
  });

  it("rejects unknown themes, effort values and inline boolean values", () => {
    expect(() => parseFlags(["--theme", "missing"])).toThrow("Unknown theme");
    expect(() => parseFlags(["--effort", "missing"])).toThrow("--effort must be");
    expect(() => parseFlags(["--json=false"])).toThrow("does not accept a value");
  });

  it("all motion, colour and glyph switches are opt-outs", () => {
    const parsed = parseFlags(["--no-motion", "--no-color", "--ascii", "--snapshot"]);
    expect(parsed.flags.noMotion).toBe(true);
    expect(parsed.flags.noColor).toBe(true);
    expect(parsed.flags.ascii).toBe(true);
    expect(parsed.flags.snapshot).toBe(true);
  });
});
