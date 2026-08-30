import { describe, expect, it } from "vitest";
import {
  CHECKS,
  conflictFindings,
  outcomeFor,
  type CheckFinding,
} from "../src/renderer/checks/checkReport.ts";

const finding = (path: string, message: string): CheckFinding => ({
  path,
  line: 1,
  column: 1,
  message,
});

describe("check outcomes", () => {
  /*
   * The reason this module exists. A check that finds nothing used to do nothing visible,
   * which is indistinguishable from a check that is broken.
   */
  it("answers when a check finds nothing", () => {
    expect(outcomeFor(CHECKS.conflicts, []).message).toBe(
      "No merge conflicts - nothing to resolve.",
    );
    expect(outcomeFor(CHECKS.todos, []).message).toBe("No TODO or FIXME comments here.");
    expect(outcomeFor(CHECKS.spelling, []).message).toBe("No misspellings in comments.");
    expect(outcomeFor(CHECKS.unusedCss, []).message).toBe("Every rule matches something.");
    expect(outcomeFor(CHECKS.missingClasses, []).message).toBe("Every class is defined.");
    expect(outcomeFor(CHECKS.localHistory, []).message).toBe(
      "No local versions of this file yet.",
    );
    expect(outcomeFor(CHECKS.timeline, []).message).toBe("No commits touch this file yet.");
    expect(outcomeFor(CHECKS.recover, []).message).toBe(
      "Nothing to recover - every file is saved.",
    );
  });

  it("counts in words a reader can act on", () => {
    expect(outcomeFor(CHECKS.conflicts, [finding("a.ts", "x")]).message).toBe(
      "1 file has merge conflicts.",
    );
    expect(
      outcomeFor(CHECKS.conflicts, [finding("a.ts", "x"), finding("b.ts", "y")]).message,
    ).toBe("2 files have merge conflicts.");
    expect(outcomeFor(CHECKS.todos, [finding("a.ts", "TODO")]).message).toBe("1 TODO or FIXME.");
  });

  it("hands back the findings it was given, so a panel can draw them", () => {
    const found = [finding("a.ts", "x")];
    expect(outcomeFor(CHECKS.conflicts, found).findings).toEqual(found);
  });

  it("gives every check an empty answer and a plural form", () => {
    for (const [id, spec] of Object.entries(CHECKS)) {
      expect(spec.empty.trim(), id).not.toBe("");
      expect(spec.one.trim(), id).not.toBe("");
      expect(spec.many(3).trim(), id).not.toBe("");
      expect(spec.many(3), id).toContain("3");
    }
  });
});

describe("conflict findings", () => {
  it("names only the conflicted files", () => {
    const entries = [
      { path: "src/a.ts", staged: "U", worktree: "U", isConflicted: true },
      { path: "src/b.ts", staged: "M", worktree: " ", isConflicted: false },
      { path: "src/c.ts", staged: "A", worktree: "A", isConflicted: true },
    ];

    expect(conflictFindings(entries).map((one) => one.path)).toEqual(["src/a.ts", "src/c.ts"]);
  });

  it("says what a conflicted file needs, not what git called it", () => {
    const entries = [{ path: "src/a.ts", staged: "U", worktree: "U", isConflicted: true }];

    expect(conflictFindings(entries)[0]?.message).toBe(
      "Both sides changed this file. Open it to keep yours, keep theirs, or keep both.",
    );
  });

  it("finds nothing in a clean tree", () => {
    expect(conflictFindings([])).toEqual([]);
  });
});
