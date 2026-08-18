import { describe, it, expect } from "vitest";
import {
  markerCode,
  sourceFamily,
  toDiagnostic,
  toDiagnostics,
  workspaceRelative,
  type RawMarker,
} from "../src/renderer/diagnostics/markerAdapter.ts";

function marker(overrides: Partial<RawMarker> = {}): RawMarker {
  return {
    owner: "typescript",
    severity: 8,
    code: "2322",
    message: "Type 'string' is not assignable to type 'number'.",
    startLineNumber: 12,
    startColumn: 7,
    endLineNumber: 12,
    endColumn: 10,
    ...overrides,
  };
}

describe("sourceFamily", () => {
  it("collapses TypeScript and JavaScript into one family", () => {
    // They share a compiler and therefore an error-code space. Two families would mean
    // the same forty table entries written twice.
    expect(sourceFamily("typescript", undefined)).toBe("ts");
    expect(sourceFamily("javascript", undefined)).toBe("ts");
    expect(sourceFamily("typescriptreact", undefined)).toBe("ts");
  });

  it("collapses the CSS dialects, which share a language service", () => {
    expect(sourceFamily("scss", undefined)).toBe("css");
    expect(sourceFamily("less", undefined)).toBe("css");
  });

  it("falls back to the marker's own source when there is no owner", () => {
    expect(sourceFamily(undefined, "json")).toBe("json");
  });

  it("passes an unknown language through rather than guessing at a family", () => {
    expect(sourceFamily("rust", undefined)).toBe("rust");
  });

  it("lowercases, so a differently-cased owner still finds its table", () => {
    expect(sourceFamily("TypeScript", undefined)).toBe("ts");
  });

  it("yields an empty family when Monaco supplies neither", () => {
    expect(sourceFamily(undefined, undefined)).toBe("");
  });
});

describe("markerCode", () => {
  it("reads a bare code", () => {
    expect(markerCode("2322")).toBe("2322");
  });

  it("unwraps the form Monaco uses when a code carries a documentation link", () => {
    expect(markerCode({ value: "2322" })).toBe("2322");
  });

  it("reads a missing code as empty rather than as the string 'undefined'", () => {
    expect(markerCode(undefined)).toBe("");
  });
});

describe("toDiagnostic", () => {
  it("carries the position across one-based, the way every compiler and the status bar do", () => {
    const result = toDiagnostic(marker(), "src/app.ts");

    expect(result).toEqual({
      file: "src/app.ts",
      line: 12,
      column: 7,
      endLine: 12,
      endColumn: 10,
      severity: "error",
      source: "ts",
      code: "2322",
      message: "Type 'string' is not assignable to type 'number'.",
    });
  });

  it("maps every severity Monaco actually emits", () => {
    expect(toDiagnostic(marker({ severity: 8 }), "a.ts")?.severity).toBe("error");
    expect(toDiagnostic(marker({ severity: 4 }), "a.ts")?.severity).toBe("warning");
    expect(toDiagnostic(marker({ severity: 2 }), "a.ts")?.severity).toBe("info");
    expect(toDiagnostic(marker({ severity: 1 }), "a.ts")?.severity).toBe("info");
  });

  it("drops a severity it does not recognise instead of ranking it wrongly", () => {
    // The panel's entire value is its order. A row with an invented rank sits in the wrong
    // place, which is worse than a row that is absent.
    expect(toDiagnostic(marker({ severity: 99 }), "a.ts")).toBeNull();
    expect(toDiagnostic(marker({ severity: 0 }), "a.ts")).toBeNull();
  });

  it("keeps the compiler's own message verbatim", () => {
    const raw = "Type 'string' is not assignable to type 'number'.";
    expect(toDiagnostic(marker({ message: raw }), "a.ts")?.message).toBe(raw);
  });
});

describe("workspaceRelative", () => {
  it("strips the root and forward-slashes the rest", () => {
    expect(workspaceRelative("E:\\work\\app", "E:\\work\\app\\src\\main.ts")).toBe("src/main.ts");
    expect(workspaceRelative("/home/dev/app", "/home/dev/app/src/main.ts")).toBe("src/main.ts");
  });

  it("survives Monaco lower-casing the drive letter in fsPath", () => {
    // The bug this function exists for. `Uri.fsPath` lower-cases a Windows drive letter,
    // so a case-sensitive prefix test drops every marker in the workspace and the panel
    // shows an empty list with nothing anywhere explaining why.
    expect(workspaceRelative("E:\\work\\app", "e:\\work\\app\\src\\main.ts")).toBe("src/main.ts");
  });

  it("tolerates a trailing separator on the root", () => {
    expect(workspaceRelative("E:\\work\\app\\", "E:\\work\\app\\a.ts")).toBe("a.ts");
  });

  it("refuses a sibling whose name merely begins with the root", () => {
    // The path-shaped version of a hostname-suffix bug: `app-backup` is not inside `app`.
    expect(workspaceRelative("/home/dev/app", "/home/dev/app-backup/x.ts")).toBeNull();
  });

  it("refuses a path outside the workspace entirely", () => {
    expect(workspaceRelative("/home/dev/app", "/etc/passwd")).toBeNull();
  });

  it("refuses the root itself, which is a folder and cannot carry an error", () => {
    expect(workspaceRelative("/home/dev/app", "/home/dev/app")).toBeNull();
  });

  it("refuses everything when no folder is open", () => {
    expect(workspaceRelative(null, "/home/dev/app/a.ts")).toBeNull();
    expect(workspaceRelative("", "/home/dev/app/a.ts")).toBeNull();
  });
});

describe("toDiagnostics", () => {
  it("drops markers for models the workspace cannot place", () => {
    // A file opened from a git commit is read-only history, not a row the user can fix.
    const markers = [marker(), marker({ message: "from a commit" })];

    const result = toDiagnostics(markers, (m) =>
      m.message === "from a commit" ? null : "src/app.ts",
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.file).toBe("src/app.ts");
  });

  it("drops unrankable markers and keeps the rest in the same pass", () => {
    const result = toDiagnostics([marker({ severity: 99 }), marker()], () => "a.ts");

    expect(result).toHaveLength(1);
  });

  it("returns nothing for nothing", () => {
    expect(toDiagnostics([], () => "a.ts")).toEqual([]);
  });
});
