import { describe, it, expect } from "vitest";
import { badgeFor, countBySeverity, groupByFile, summarise } from "../src/index.ts";
import type { Diagnostic, Severity } from "../src/index.ts";

function at(file: string, line: number, severity: Severity = "error"): Diagnostic {
  return {
    file,
    line,
    column: 1,
    endLine: line,
    endColumn: 2,
    severity,
    source: "ts",
    code: "2322",
    message: "boom",
  };
}

describe("groupByFile", () => {
  it("puts the file that will not run above the file that merely complains", () => {
    const groups = groupByFile([at("z.ts", 1, "warning"), at("a.ts", 1, "error")]);

    expect(groups.map((g) => g.file)).toEqual(["a.ts", "z.ts"]);
  });

  it("breaks ties alphabetically, so the list does not reshuffle while typing", () => {
    const groups = groupByFile([at("c.ts", 1), at("a.ts", 1), at("b.ts", 1)]);

    expect(groups.map((g) => g.file)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("ranks one error above nine warnings", () => {
    const noisy = Array.from({ length: 9 }, (_, i) => at("noisy.ts", i + 1, "warning"));
    const groups = groupByFile([...noisy, at("broken.ts", 40)]);

    expect(groups[0]?.file).toBe("broken.ts");
  });

  it("orders within a file by severity, then line, then column", () => {
    const groups = groupByFile([
      at("app.ts", 90, "warning"),
      at("app.ts", 50),
      at("app.ts", 10, "info"),
      at("app.ts", 20),
    ]);

    expect(groups[0]?.diagnostics.map((d) => d.line)).toEqual([20, 50, 90, 10]);
  });

  it("does not mutate what it was handed", () => {
    const input = [at("b.ts", 2), at("a.ts", 1)];
    const copy = [...input];

    groupByFile(input);

    expect(input).toEqual(copy);
  });

  it("returns nothing for nothing", () => {
    expect(groupByFile([])).toEqual([]);
  });
});

describe("countBySeverity", () => {
  it("counts each severity separately", () => {
    const counts = countBySeverity([
      at("a.ts", 1),
      at("a.ts", 2),
      at("b.ts", 1, "warning"),
      at("b.ts", 2, "info"),
    ]);

    expect(counts).toEqual({ errors: 2, warnings: 1, infos: 1 });
  });
});

describe("badgeFor", () => {
  it("shows nothing at all when there is nothing wrong", () => {
    // Not a zero. A badge reading 0 is a badge that teaches the user to ignore badges.
    expect(badgeFor({ errors: 0, warnings: 0, infos: 0 })).toBeNull();
  });

  it("shows errors over warnings when both exist", () => {
    expect(badgeFor({ errors: 2, warnings: 7, infos: 0 })).toEqual({ text: "2", tone: "error" });
  });

  it("falls back to warnings when nothing is broken", () => {
    expect(badgeFor({ errors: 0, warnings: 7, infos: 0 })).toEqual({ text: "7", tone: "warning" });
  });

  it("ignores suggestions entirely - they are not worth interrupting for", () => {
    expect(badgeFor({ errors: 0, warnings: 0, infos: 12 })).toBeNull();
  });

  it("caps at 99+ rather than overflowing the badge", () => {
    expect(badgeFor({ errors: 1200, warnings: 0, infos: 0 })?.text).toBe("99+");
  });
});

describe("summarise", () => {
  it("says the encouraging thing when there is nothing to report", () => {
    expect(summarise({ errors: 0, warnings: 0, infos: 0 })).toBe("No problems");
  });

  it("pluralises each part independently", () => {
    expect(summarise({ errors: 1, warnings: 2, infos: 0 })).toBe("1 error, 2 warnings");
  });

  it("calls an info a suggestion, because that is what it is to the reader", () => {
    expect(summarise({ errors: 0, warnings: 0, infos: 1 })).toBe("1 suggestion");
  });
});
