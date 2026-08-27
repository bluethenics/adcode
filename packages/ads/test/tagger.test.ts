import { describe, it, expect } from "vitest";
import { tag } from "../src/tagger.ts";
import { MAX_TAGS, TAG_VOCABULARY } from "../src/types.ts";

describe("tagger - detection", () => {
  it("maps language IDs into the vocabulary", () => {
    expect(tag({ languageIds: ["typescript"], filenames: [] })).toContain("lang:typescript");
    expect(tag({ languageIds: ["python"], filenames: [] })).toContain("lang:python");
  });

  it("maps framework markers by filename", () => {
    expect(tag({ languageIds: [], filenames: ["next.config.js"] })).toContain("fw:next");
    expect(tag({ languageIds: [], filenames: ["Cargo.toml"] })).toContain("tool:cargo");
    expect(tag({ languageIds: [], filenames: ["Dockerfile"] })).toContain("tool:docker");
    expect(tag({ languageIds: [], filenames: ["vite.config.ts"] })).toContain("tool:vite");
  });

  it("is case-insensitive on filenames", () => {
    expect(tag({ languageIds: [], filenames: ["DOCKERFILE"] })).toContain("tool:docker");
    expect(tag({ languageIds: [], filenames: ["cargo.TOML"] })).toContain("tool:cargo");
  });

  it("returns sorted, de-duplicated output for stable request bodies", () => {
    const out = tag({
      languageIds: ["typescript", "typescript", "python"],
      filenames: ["Dockerfile", "Dockerfile"],
    });
    expect(out).toEqual([...out].sort());
    expect(new Set(out).size).toBe(out.length);
  });

  it("returns nothing for input it does not recognise", () => {
    expect(tag({ languageIds: ["brainfuck"], filenames: ["notes.xyz"] })).toEqual([]);
  });
});

describe("tagger - privacy", () => {
  // Brief §1: the tagger "may never emit file contents, file paths, directory names,
  // workspace names, git remotes, branch names, dependency lists, or environment
  // variables." §8.2: "Reduce every input to its basename before matching, so a path
  // arriving where a filename was expected cannot leak a directory name."
  it("reduces a POSIX path to its basename", () => {
    const out = tag({ languageIds: [], filenames: ["/home/secret-client/app/next.config.js"] });
    expect(out).toEqual(["fw:next"]);
    expect(out.join(" ")).not.toMatch(/secret-client/);
  });

  it("reduces a Windows path to its basename", () => {
    const out = tag({ languageIds: [], filenames: ["C:\\Users\\alice\\acme-merger\\Dockerfile"] });
    expect(out).toEqual(["tool:docker"]);
    expect(out.join(" ")).not.toMatch(/acme-merger|alice/);
  });

  it("reduces a mixed-separator path", () => {
    const out = tag({ languageIds: [], filenames: ["C:/repos\\project-x/Cargo.toml"] });
    expect(out).toEqual(["tool:cargo"]);
    expect(out.join(" ")).not.toMatch(/project-x/);
  });

  it("never emits a directory that happens to share a marker name", () => {
    // A directory called `Dockerfile` is not a Dockerfile.
    const out = tag({ languageIds: [], filenames: ["Dockerfile/readme.md"] });
    expect(out).not.toContain("tool:docker");
  });

  it("emits only tags compiled into the vocabulary", () => {
    const out = tag({
      languageIds: ["typescript", "python", "rust", "go", "java"],
      filenames: ["Dockerfile", "Cargo.toml", "next.config.js", "vite.config.ts"],
    });
    for (const t of out) expect(TAG_VOCABULARY).toContain(t);
  });

  it("caps output at MAX_TAGS even when far more match", () => {
    const out = tag({
      languageIds: ["typescript", "javascript", "python", "rust", "go", "java", "ruby", "php", "swift", "kotlin"],
      filenames: ["Dockerfile", "Cargo.toml", "next.config.js", "vite.config.ts", "webpack.config.js"],
    });
    expect(out.length).toBeLessThanOrEqual(MAX_TAGS);
  });
});
