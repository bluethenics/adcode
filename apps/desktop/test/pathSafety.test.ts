import { describe, it, expect } from "vitest";
import { isInsideWorkspace, normalizeForCompare } from "../src/main/pathSafety.ts";

/**
 * The renderer is treated as hostile (brief §1). Every path it sends must be confined to
 * the workspace the user actually opened, or a compromised renderer - or a malicious
 * model output that reaches an IPC call - reads whatever it likes off the disk.
 */
const ROOT = process.platform === "win32" ? "C:\\work\\project" : "/work/project";
const sep = process.platform === "win32" ? "\\" : "/";

describe("isInsideWorkspace", () => {
  it("accepts the root itself", () => {
    expect(isInsideWorkspace(ROOT, ROOT)).toBe(true);
  });

  it("accepts a file directly inside", () => {
    expect(isInsideWorkspace(ROOT, `${ROOT}${sep}index.ts`)).toBe(true);
  });

  it("accepts a nested file", () => {
    expect(isInsideWorkspace(ROOT, `${ROOT}${sep}src${sep}deep${sep}file.ts`)).toBe(true);
  });

  it("rejects a parent directory", () => {
    expect(isInsideWorkspace(ROOT, `${ROOT}${sep}..`)).toBe(false);
  });

  it("rejects traversal out of the root", () => {
    expect(isInsideWorkspace(ROOT, `${ROOT}${sep}..${sep}..${sep}secrets.txt`)).toBe(false);
    expect(isInsideWorkspace(ROOT, `${ROOT}${sep}src${sep}..${sep}..${sep}secrets.txt`)).toBe(false);
  });

  it("rejects a sibling whose name merely prefixes the root", () => {
    // The path equivalent of the hostname-suffix bug in the ad client: a plain
    // startsWith would accept `C:\work\project-evil`.
    expect(isInsideWorkspace(ROOT, `${ROOT}-evil${sep}file.ts`)).toBe(false);
  });

  it("rejects an unrelated absolute path", () => {
    const elsewhere = process.platform === "win32" ? "C:\\Windows\\System32" : "/etc/passwd";
    expect(isInsideWorkspace(ROOT, elsewhere)).toBe(false);
  });

  it("rejects when no workspace is open", () => {
    expect(isInsideWorkspace(null, `${ROOT}${sep}index.ts`)).toBe(false);
  });

  it("rejects a relative path outright", () => {
    expect(isInsideWorkspace(ROOT, "index.ts")).toBe(false);
    expect(isInsideWorkspace(ROOT, "../secrets.txt")).toBe(false);
  });

  it("rejects a path containing a NUL byte", () => {
    expect(isInsideWorkspace(ROOT, `${ROOT}${sep}ok.ts\u0000.png`)).toBe(false);
  });
});

describe("normalizeForCompare", () => {
  it("is case-insensitive only where the platform is", () => {
    const a = normalizeForCompare("C:\\Work\\Project");
    const b = normalizeForCompare("c:\\work\\project");
    expect(a === b).toBe(process.platform === "win32");
  });
});
