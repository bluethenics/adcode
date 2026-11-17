import { describe, expect, it } from "vitest";
import { looksLikePowerShell, shellFor } from "../src/main/aiCommands.ts";

describe("the shell an AI command runs in", () => {
  it("runs PowerShell the model wrote in PowerShell on Windows, instead of failing in cmd", () => {
    // The exact lines from 2026-10-27 reports.
    for (const line of ["Get-ChildItem -Recurse -Filter *.ts | Select-Object -First 5", "dir | ForEach-Object { $_.Name }", "$cat = (Invoke-WebRequest -UseBasicParsing https://example.com)", "echo $env:PATH", "Test-Path package.json"]) {
      expect(looksLikePowerShell(line), line).toBe(true);
      expect(shellFor(line, "win32").file).toMatch(/powershell\.exe$/);
      expect(shellFor(line, "win32").args.slice(-2)).toEqual(["-Command", line]);
    }
  });
  it("keeps ordinary commands in cmd, exactly as before", () => {
    for (const line of ["npm test", "git status", "npx tsc --noEmit", "gradlew.bat build", "python -m http.server 8000", "node scripts/build-sub-project.mjs", "echo set-up done"]) {
      expect(looksLikePowerShell(line), line).toBe(false);
      expect(shellFor(line, "win32")).toMatchObject({ args: ["/d", "/s", "/c", `"${line}"`], verbatim: true });
    }
  });
  it("runs a `;` chain and a trailing head/tail in PowerShell, as the debug log showed models writing them", () => {
    expect(shellFor("git status --short; git log --oneline -3", "win32").args.at(-1)).toBe("git status --short; git log --oneline -3");
    expect(shellFor("git log --oneline | head -20", "win32").args.at(-1)).toBe("git log --oneline | Select-Object -First 20");
    expect(shellFor("npm test 2>&1 | tail -n 5", "win32").args.at(-1)).toContain("npm test 2>&1 | Select-Object -Last 5");
    // A `;` inside quotes, or with no space after it, is not a chain.
    for (const line of ['echo "a; b"', "set PATH=a;b", "cd web && npm test; echo done"]) expect(shellFor(line, "win32").args).toEqual(["/d", "/s", "/c", `"${line}"`]);
  });
  it("leaves other platforms on /bin/sh", () => {
    expect(shellFor("Get-ChildItem", "linux")).toEqual({ file: "/bin/sh", args: ["-c", "Get-ChildItem"], verbatim: false });
  });
});
