/**
 * Tab titles, which are the only place the tab strip says which shell a terminal is.
 */
import { describe, expect, it } from "vitest";
import { uniqueTerminalTitle } from "../src/renderer/terminal/terminalTitles.ts";

describe("uniqueTerminalTitle", () => {
  it("uses the shell's own name when nothing else has it", () => {
    expect(uniqueTerminalTitle("Command Prompt", [])).toBe("Command Prompt");
  });

  it("numbers the second of the same shell", () => {
    expect(uniqueTerminalTitle("cmd", ["cmd"])).toBe("cmd (2)");
  });

  it("keeps counting past the second", () => {
    expect(uniqueTerminalTitle("cmd", ["cmd", "cmd (2)"])).toBe("cmd (3)");
  });

  it("does not number a different shell", () => {
    expect(uniqueTerminalTitle("Git Bash", ["cmd", "cmd (2)"])).toBe("Git Bash");
  });

  it("fills the gap a closed tab leaves", () => {
    // Closing "cmd (2)" and opening another cmd should reuse the gap. Numbering from the
    // count instead would produce "cmd (3)" beside "cmd", which reads as a lost tab.
    expect(uniqueTerminalTitle("cmd", ["cmd", "cmd (3)"])).toBe("cmd (2)");
  });

  it("leaves a label that already ends in a number alone", () => {
    expect(uniqueTerminalTitle("PowerShell 7", [])).toBe("PowerShell 7");
    expect(uniqueTerminalTitle("PowerShell 7", ["PowerShell 7"])).toBe("PowerShell 7 (2)");
  });
});
