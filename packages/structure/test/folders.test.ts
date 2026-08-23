import { describe, expect, it } from "vitest";
import { describeEntry, projectKinds, whereToStart } from "@adcode/structure";

describe("describeEntry", () => {
  it("explains the folders every project has", () => {
    expect(describeEntry("src", true)?.title).toBe("Source code");
    expect(describeEntry("node_modules", true)?.title).toBe("Dependencies");
    expect(describeEntry("dist", true)?.title).toBe("Build output");
  });

  it("marks what was generated rather than written", () => {
    expect(describeEntry("node_modules", true)?.generated).toBe(true);
    expect(describeEntry("dist", true)?.generated).toBe(true);
    expect(describeEntry(".git", true)?.generated).toBe(true);

    // The half somebody wrote is not marked, which is the whole point of marking the other.
    expect(describeEntry("src", true)?.generated).toBeUndefined();
  });

  it("explains the files at a project's root", () => {
    expect(describeEntry("package.json", false)?.title).toBe("Project manifest");
    expect(describeEntry("Cargo.toml", false)?.title).toBe("Rust project");
    expect(describeEntry("README.md", false)?.title).toBe("Read this first");
  });

  it("does not confuse a file with a folder of the same name", () => {
    // `build` is a folder in the table and nothing as a file; answering for both would mean
    // a `build` script picking up a note about compiler output.
    expect(describeEntry("build", true)).not.toBeNull();
    expect(describeEntry("build", false)).toBeNull();
  });

  it("says nothing rather than guessing", () => {
    expect(describeEntry("widgets", true)).toBeNull();
    expect(describeEntry("thing.xyz", false)).toBeNull();
  });

  it("writes a real sentence, not a restatement of the name", () => {
    const note = describeEntry("node_modules", true);

    expect(note?.detail.length).toBeGreaterThan(40);
    expect(note?.detail).toContain("npm");
  });
});

describe("projectKinds", () => {
  it("names what the manifests say it is", () => {
    expect(projectKinds(["package.json"])).toEqual(["a Node.js or web project"]);
    expect(projectKinds(["Cargo.toml"])).toEqual(["a Rust project"]);
    expect(projectKinds(["go.mod"])).toEqual(["a Go project"]);
  });

  it("reports every one it finds, because a real repository is several", () => {
    const kinds = projectKinds(["package.json", "pyproject.toml", "Dockerfile"]);

    expect(kinds).toContain("a Node.js or web project");
    expect(kinds).toContain("a Python project");
    expect(kinds).toContain("packaged as a container");
  });

  it("recognises a .NET project by a file it cannot name in advance", () => {
    expect(projectKinds(["Widget.csproj"])).toEqual(["a .NET project"]);
  });

  it("calls a page with no manifest a plain website", () => {
    expect(projectKinds(["index.html"])).toEqual(["a plain website"]);
    // With a manifest it is a web project, not a plain one - the build step is the thing.
    expect(projectKinds(["index.html", "package.json"])).not.toContain("a plain website");
  });

  it("says nothing about a folder with no manifest at all", () => {
    expect(projectKinds(["notes.txt", "photo.png"])).toEqual([]);
  });
});

describe("whereToStart", () => {
  it("puts the README first, because it was written to answer this", () => {
    expect(whereToStart(["package.json", "README.md", "Makefile"])[0]).toBe("README.md");
  });

  it("offers only what is actually there", () => {
    expect(whereToStart(["package.json"])).toEqual(["package.json"]);
  });

  it("does not list the same file twice on a case-insensitive filesystem", () => {
    expect(whereToStart(["README.md", "readme.md"])).toEqual(["README.md"]);
  });

  it("is empty when there is no obvious way in", () => {
    expect(whereToStart(["a.txt"])).toEqual([]);
  });
});
