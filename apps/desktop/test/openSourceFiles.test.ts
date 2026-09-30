import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const json = (path: string): Record<string, unknown> =>
  JSON.parse(read(path)) as Record<string, unknown>;

/** Relative markdown link targets in a document, without anchors. */
export function relativeLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => match[1]!)
    .filter((target) => !/^(https?:|mailto:|#)/.test(target))
    .map((target) => target.split("#")[0]!)
    .filter((target) => target.length > 0);
}

/** Documents whose links must resolve. Later tasks append to this list. */
const LINKED_DOCUMENTS = ["TRADEMARKS.md", "CONTRIBUTING.md", "SECURITY.md"];

describe("open-source licensing", () => {
  it("ships the unmodified Apache-2.0 text", () => {
    const text = read("LICENSE");
    expect(text).toContain("Apache License");
    expect(text).toContain("Version 2.0, January 2004");
    expect(text).toContain("END OF TERMS AND CONDITIONS");
    // Unmodified: the appendix keeps its placeholders. Our copyright lives in NOTICE.
    expect(text).toContain("Copyright [yyyy] [name of copyright owner]");
  });

  it("names the copyright holder and the LGPL component in NOTICE", () => {
    const notice = read("NOTICE");
    expect(notice).toContain("Copyright 2026 Bluethenics");
    expect(notice).toContain("libvips");
    expect(notice).toContain("LGPL-3.0-or-later");
  });

  it("declares Apache-2.0 in every package manifest and keeps them private", () => {
    for (const path of ["package.json", "apps/desktop/package.json", "apps/web/package.json"]) {
      const manifest = json(path);
      expect(manifest["license"], path).toBe("Apache-2.0");
      expect(manifest["private"], path).toBe(true);
      expect(JSON.stringify(manifest["repository"]), path).toContain(
        "github.com/bluethenics/adcode",
      );
    }
  });

  it("says the name and logo are not covered by the licence", () => {
    const trademarks = read("TRADEMARKS.md");
    expect(trademarks).toContain("Apache License 2.0");
    expect(trademarks).toMatch(/name.*logo|logo.*name/is);
  });

  it("links only to files that exist in the repository", () => {
    const broken = LINKED_DOCUMENTS.flatMap((document) =>
      relativeLinks(read(document))
        .filter((target) => !existsSync(join(ROOT, dirname(document), target)))
        .map((target) => `${document} -> ${target}`),
    );
    expect(broken).toEqual([]);
  });
});

describe("contributor scaffolding", () => {
  it("tells a contributor how to verify a change", () => {
    const contributing = read("CONTRIBUTING.md");
    expect(contributing).toContain("npm run verify");
    expect(contributing).toContain("node scripts/docs-seed.mjs");
    expect(contributing).toContain("npm run mock-server");
  });

  it("routes security reports away from public issues", () => {
    expect(read("SECURITY.md")).toContain("security/advisories/new");
    expect(read(".github/ISSUE_TEMPLATE/config.yml")).toContain("blank_issues_enabled: false");
  });

  it("runs verify on pull requests without exposing secrets to forks", () => {
    const workflow = read(".github/workflows/verify.yml");
    expect(workflow).toContain("pull_request:");
    expect(workflow).not.toContain("pull_request_target");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(workflow).toContain("npm run verify");
  });
});
