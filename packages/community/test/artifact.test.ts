import { describe, expect, it } from "vitest";
import {
  applyChanges, artifactFileVerdict, changeStats, checkChanges, checkSnapshot, diffSnapshots, findSecrets,
  isSafeArtifactPath, lineDiff, parseRemixRecord, remixFolderName,
} from "@adcode/community";

describe("which files an artifact may hold", () => {
  it("keeps source and drops generated, private, binary and lock files", () => {
    expect(artifactFileVerdict("src/app.ts", 100).include).toBe(true);
    expect(artifactFileVerdict("README.md", 100).include).toBe(true);
    expect(artifactFileVerdict("Dockerfile", 100).include).toBe(true);
    expect(artifactFileVerdict(".gitignore", 100).include).toBe(true);
    expect(artifactFileVerdict("node_modules/x/index.js", 100)).toEqual({ include: false, reason: "folder" });
    expect(artifactFileVerdict(".env.local", 100)).toEqual({ include: false, reason: "private" });
    expect(artifactFileVerdict("keys/server.pem", 100)).toEqual({ include: false, reason: "private" });
    expect(artifactFileVerdict("logo.png", 100)).toEqual({ include: false, reason: "binary" });
    expect(artifactFileVerdict("package-lock.json", 100)).toEqual({ include: false, reason: "lockfile" });
    expect(artifactFileVerdict("big.json", 300_000)).toEqual({ include: false, reason: "large" });
  });

  it("refuses paths that could escape the folder", () => {
    for (const path of ["../x", "/etc/passwd", "a/../../b", "C:/x", "a\\b", "a//b", "con.txt", "a/b.", ""]) expect(isSafeArtifactPath(path)).toBe(false);
    expect(isSafeArtifactPath("src/components/Button.tsx")).toBe(true);
  });
});

describe("secrets", () => {
  it("finds keys before they are published", () => {
    const findings = findSecrets([
      { path: "a.ts", content: "const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';" },
      { path: "b.ts", content: "ok\nconst db = 'postgres://admin:hunter2pass@db.example.com/app'" },
      { path: "c.ts", content: "const nothing = process.env.KEY;" },
    ]);
    expect(findings.map((finding) => `${finding.path}:${finding.line}`)).toEqual(["a.ts:1", "b.ts:2"]);
  });

  it("blocks a snapshot that carries one", () => {
    const check = checkSnapshot([{ path: "a.ts", content: "AKIAABCDEFGHIJKLMNOP" }]);
    expect(check.problems.join(" ")).toMatch(/AWS access key/);
  });
});

describe("snapshots, diffs and merging", () => {
  const base = [{ path: "a.txt", content: "one\ntwo\nthree" }, { path: "b.txt", content: "keep" }, { path: "gone.txt", content: "bye" }];
  const next = [{ path: "a.txt", content: "one\n2\nthree" }, { path: "b.txt", content: "keep" }, { path: "new.txt", content: "hi" }];

  it("sorts and validates snapshots", () => {
    const check = checkSnapshot([{ path: "z.ts", content: "z" }, { path: "a.ts", content: "a" }]);
    expect(check.problems).toEqual([]);
    expect(check.files.map((file) => file.path)).toEqual(["a.ts", "z.ts"]);
    expect(checkSnapshot([{ path: "a.ts", content: "1" }, { path: "A.ts", content: "2" }]).problems.join()).toMatch(/twice/);
    expect(checkSnapshot([]).problems.length).toBe(1);
  });

  it("lists what changed", () => {
    expect(diffSnapshots(base, next).map((change) => `${change.kind}:${change.path}`)).toEqual(["modified:a.txt", "deleted:gone.txt", "added:new.txt"]);
  });

  it("applies cleanly to the version it was made against", () => {
    const result = applyChanges(base, diffSnapshots(base, next));
    expect(result.conflicts).toEqual([]);
    expect(result.files).toEqual([...next].sort((a, b) => a.path.localeCompare(b.path)));
  });

  it("reports a conflict when the owner changed the same file since, and resolves it on request", () => {
    const moved = [{ path: "a.txt", content: "one\nTWO\nthree" }, ...base.slice(1)];
    const changes = diffSnapshots(base, next);
    const result = applyChanges(moved, changes);
    expect(result.conflicts).toEqual(["a.txt"]);
    expect(result.files.find((file) => file.path === "a.txt")!.content).toBe("one\nTWO\nthree");
    expect(applyChanges(moved, changes, true).files.find((file) => file.path === "a.txt")!.content).toBe("one\n2\nthree");
  });

  it("does not call the same fix made twice a conflict", () => {
    const changes = diffSnapshots(base, next);
    expect(applyChanges(next, changes).conflicts).toEqual([]);
  });

  it("validates incoming change sets", () => {
    expect(checkChanges(diffSnapshots(base, next)).problems).toEqual([]);
    expect(checkChanges([{ path: "../x", kind: "added", before: null, after: "x" }]).problems.length).toBe(1);
    expect(checkChanges([{ path: ".env", kind: "added", before: null, after: "X=1" }]).problems.length).toBe(1);
    expect(checkChanges([{ path: "a.ts", kind: "modified", before: null, after: "x" }]).problems.length).toBe(1);
    expect(checkChanges([]).problems.length).toBe(1);
  });

  it("shows a readable line diff with folded context", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 10", "line ten");
    const diff = lineDiff(before, after);
    expect(diff.filter((line) => line.kind === "add").map((line) => line.text)).toEqual(["line ten"]);
    expect(diff.filter((line) => line.kind === "remove").map((line) => line.text)).toEqual(["line 10"]);
    expect(diff[0]).toEqual({ kind: "skip", text: "7 unchanged lines" });
    expect(changeStats({ path: "x", kind: "modified", before, after })).toEqual({ added: 1, removed: 1 });
    expect(lineDiff(null, "a\nb").map((line) => line.kind)).toEqual(["add", "add"]);
  });
});

describe("remix records", () => {
  it("reads only well-formed records", () => {
    expect(parseRemixRecord(JSON.stringify({ artifactId: "abc123def456", title: "T", version: 2, remixedAt: 1 }))).toEqual({ artifactId: "abc123def456", title: "T", version: 2, remixedAt: 1, role: "remix" });
    expect(parseRemixRecord("{}")).toBeNull();
    expect(parseRemixRecord("nope")).toBeNull();
  });

  it("names remix folders safely", () => {
    expect(remixFolderName('My: "App"?')).toBe("My App (remix)");
    expect(remixFolderName("...")).toBe("Artifact (remix)");
  });
});
