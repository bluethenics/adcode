import { describe, expect, it } from "vitest";
import { clip, formatReport, formatSummary, redact, type DebugEntry, type DebugEnvironment } from "../src/main/debugLogFormat.ts";

const env: DebugEnvironment = {
  appVersion: "2.0.0", electron: "43.0.0", chrome: "140", node: "24", os: "win32 10.0.26200 x64", locale: "en-US",
  provider: "groq", model: "qwen/qwen3-32b", effort: "auto", fileTools: true, projectOpen: true, windows: ["vibe", "ide"],
};
const entry = (level: DebugEntry["level"], message: string, at = Date.UTC(2026, 8, 27, 14, 0, 0)): DebugEntry => ({ at, level, source: "ai", message });

describe("debug log redaction", () => {
  it("removes provider keys, bearer tokens, key query strings and e-mail addresses", () => {
    const text = redact(
      "key gsk_abcdefghijklmnop and sk-ant-api03-ZZZZZZZZZZ, Bearer eyJhbGciOiJIUzI1NiJ9.x.y, https://x.dev/v1?key=AIzaSyA123&x=1 from me@example.com",
    );
    expect(text).not.toMatch(/gsk_|sk-ant|eyJhbG|AIzaSy|me@example/);
    expect(text).toContain("[redacted key]");
    expect(text).toContain("Bearer [redacted]");
    expect(text).toContain("key=[redacted]");
    expect(text).toContain("[email]");
  });

  it("hides the project and home paths whichever separator and case they arrive in", () => {
    const paths = [["E:\\Work\\Shop", "<project>"], ["C:\\Users\\Sinan", "~"]] as const;
    expect(redact("ENOENT: stat 'e:/work/shop/image_finder.py'", paths)).toBe("ENOENT: stat '<project>/image_finder.py'");
    expect(redact("at C:\\Users\\Sinan\\AppData\\x.js", paths)).toBe("at ~\\AppData\\x.js");
    // The longer, more specific path wins over the home directory that contains it.
    expect(redact("C:/Users/Sinan/proj/a.ts", [["C:\\Users\\Sinan", "~"], ["C:\\Users\\Sinan\\proj", "<project>"]])).toBe("<project>/a.ts");
  });

  it("keeps each line to one line of bounded length", () => {
    expect(clip("a\n  b\tc")).toBe("a b c");
    expect(clip("x".repeat(50), 10)).toHaveLength(10);
  });
});

describe("debug log formats", () => {
  it("writes the environment and every event for Save and Copy", () => {
    const text = formatReport(env, [entry("info", "Turn started: groq / qwen"), entry("error", "Groq returned HTTP 429")], Date.UTC(2026, 8, 27));
    expect(text).toContain("ADCode 2.0.0 · Electron 43.0.0");
    expect(text).toContain("AI: groq / qwen/qwen3-32b · effort auto · file tools on");
    expect(text).toContain("Project open: yes (name and path hidden)");
    expect(text).toContain("2026-09-27 14:00:00 ERROR ai: Groq returned HTTP 429");
  });

  it("summarises only problems, newest kept, within the report form's limit", () => {
    const many = Array.from({ length: 80 }, (_, i) => entry("error", `failure number ${i} ${"detail ".repeat(20)}`, Date.UTC(2026, 8, 27, 14, 0, i)));
    const summary = formatSummary(env, [entry("info", "noise"), ...many], 1500);
    expect(summary.length).toBeLessThanOrEqual(1500);
    expect(summary).not.toContain("noise");
    expect(summary).toContain("failure number 79");
    expect(summary).not.toContain("failure number 0 ");
    expect(summary).toMatch(/Recent problems \(latest \d+ of 80\)/);
  });

  it("says so when nothing has gone wrong", () => {
    expect(formatSummary(env, [entry("info", "fine")], 1500)).toContain("No recent errors recorded.");
  });
});
