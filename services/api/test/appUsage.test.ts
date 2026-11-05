import { describe, expect, it } from "vitest";
import { parseAppUsage, summarizeAppUsage, utcDay } from "../src/appUsage.ts";

const NOW = Date.UTC(2026, 10, 5, 12);

describe("desktop feature use reports", () => {
  it("accepts a day of counts with fixed names", () => {
    expect(parseAppUsage({ day: "2026-11-05", counts: { "cmd:ai.showUsage": 3, "page:plugins": 1, "event:plugin_installed": 2, "addon:usage-meter": 9 } }, NOW))
      .toEqual({ day: "2026-11-05", counts: { "cmd:ai.showUsage": 3, "page:plugins": 1, "event:plugin_installed": 2, "addon:usage-meter": 9 } });
  });

  it("refuses anything that could carry content or an identity", () => {
    expect(parseAppUsage({ day: "2026-11-05", counts: { "cmd:ai.showUsage": 1 }, uid: "x" }, NOW)).toBeNull();
    expect(parseAppUsage({ day: "2026-11-05", counts: { "file:C:/Users/ana/secret.txt": 1 } }, NOW)).toBeNull();
    expect(parseAppUsage({ day: "2026-11-05", counts: { "cmd:hello world": 1 } }, NOW)).toBeNull();
    expect(parseAppUsage({ day: "2026-11-05", counts: { "cmd:ok": 1.5 } }, NOW)).toBeNull();
    expect(parseAppUsage({ day: "2026-11-05", counts: {} }, NOW)).toBeNull();
  });

  it("refuses days in the future or long past", () => {
    expect(parseAppUsage({ day: "2026-11-07", counts: { "cmd:ok": 1 } }, NOW)).toBeNull();
    expect(parseAppUsage({ day: "2026-10-20", counts: { "cmd:ok": 1 } }, NOW)).toBeNull();
    expect(utcDay(NOW)).toBe("2026-11-05");
  });

  it("summarizes the most used, the barely used and the trend", () => {
    const rows = [
      { day: "2026-11-01", name: "cmd:file.saveAll", uses: 50, clients: 10 },
      { day: "2026-11-04", name: "cmd:file.saveAll", uses: 100, clients: 12 },
      { day: "2026-11-04", name: "cmd:community.studio", uses: 2, clients: 1 },
      { day: "2026-11-04", name: "page:plugins", uses: 7, clients: 5 },
    ];
    const summary = summarizeAppUsage(rows, "2026-10-30", "2026-11-05");
    expect(summary.totalUses).toBe(159);
    expect(summary.top[0]).toMatchObject({ name: "cmd:file.saveAll", uses: 150, clientDays: 22, trend: 100 });
    expect(summary.rare[0]!.name).toBe("cmd:community.studio");
    expect(summary.byKind).toEqual({ cmd: 152, page: 7, event: 0, addon: 0 });
  });
});
