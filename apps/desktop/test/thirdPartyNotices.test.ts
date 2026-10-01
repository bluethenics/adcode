import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bareImports,
  collectPackages,
  copiedNotices,
  licenceOf,
  packageNameOf,
  renderNotices,
} from "../../../scripts/third-party-notices.mjs";

const ROOT = join(import.meta.dirname, "..", "..", "..");

describe("packageNameOf", () => {
  it("reduces a deep path or a query to the package", () => {
    expect(packageNameOf("monaco-editor")).toBe("monaco-editor");
    expect(packageNameOf("monaco-editor/esm/vs/editor/editor.worker?worker")).toBe("monaco-editor");
    expect(packageNameOf("@xterm/xterm/css/xterm.css")).toBe("@xterm/xterm");
    expect(packageNameOf("@xterm/addon-fit")).toBe("@xterm/addon-fit");
  });

  it("ignores everything that is not a third-party package", () => {
    expect(packageNameOf("./local.ts")).toBeNull();
    expect(packageNameOf("../shared/api.ts")).toBeNull();
    expect(packageNameOf("/absolute.ts")).toBeNull();
    expect(packageNameOf("node:fs")).toBeNull();
    expect(packageNameOf("fs/promises")).toBeNull();
    expect(packageNameOf("@adcode/ai/connections")).toBeNull();
    // Electron and Chromium ship their own notices through electron-builder.
    expect(packageNameOf("electron")).toBeNull();
    expect(packageNameOf("@")).toBeNull();
  });
});

describe("bareImports", () => {
  it("finds static, dynamic, side-effect and re-export specifiers", () => {
    const source = [
      'import { a } from "pkg-a";',
      "import b from 'pkg-b/deep';",
      'import "pkg-c/style.css";',
      'const d = await import("pkg-d");',
      'export { e } from "pkg-e";',
      'const f = require("pkg-f");',
    ].join("\n");
    expect(bareImports(source).sort()).toEqual([
      "pkg-a", "pkg-b/deep", "pkg-c/style.css", "pkg-d", "pkg-e", "pkg-f",
    ]);
  });

  it("reads an import that spans several lines", () => {
    const source = 'import {\n  one,\n  two,\n} from "pkg-multi";';
    expect(bareImports(source)).toEqual(["pkg-multi"]);
  });

  it("skips type-only imports, which bundle nothing", () => {
    const source = 'import type { T } from "types-only";\nexport type { U } from "also-types";';
    expect(bareImports(source)).toEqual([]);
  });
});

describe("licenceOf", () => {
  it("reads every shape a manifest uses", () => {
    expect(licenceOf({ license: "MIT" })).toBe("MIT");
    expect(licenceOf({ license: { type: "ISC" } })).toBe("ISC");
    expect(licenceOf({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] })).toBe("MIT OR Apache-2.0");
    expect(licenceOf({})).toBe("UNKNOWN");
  });
});

describe("renderNotices", () => {
  it("lists packages in name order, with text where there is any", () => {
    const text = renderNotices([
      { name: "zeta", version: "1.0.0", licence: "MIT", text: "Zeta licence text" },
      { name: "alpha", version: "2.0.0", licence: "ISC", text: null },
    ]);
    expect(text.indexOf("alpha@2.0.0")).toBeLessThan(text.indexOf("zeta@1.0.0"));
    expect(text).toContain("Zeta licence text");
    // A package with no licence file is still listed, with what it declares.
    expect(text).toContain("alpha@2.0.0");
    expect(text).toContain("Licence: ISC");
    expect(text).toContain("no licence file");
  });
});

describe("collectPackages", () => {
  const names = collectPackages(ROOT).map((one) => one.name);

  it("finds what the desktop app really bundles", () => {
    expect(names).toContain("monaco-editor");
    expect(names).toContain("node-pty");
  });

  it("leaves out our own packages and Electron", () => {
    expect(names.filter((name) => name.startsWith("@adcode/"))).toEqual([]);
    expect(names).not.toContain("electron");
  });

  it("names each package once", () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it("includes what is copied into the installer rather than imported", () => {
    // scripts/grammars.mjs copies grammar .wasm files out of tree-sitter-wasms; no source
    // file imports it, so scanning imports alone never finds it.
    expect(names).toContain("tree-sitter-wasms");
  });

  it("carries a package's own third-party notices, not only its licence", () => {
    // monaco-editor compiles TypeScript (Apache-2.0), marked and others into the files that
    // ship, and credits them in ThirdPartyNotices.txt beside its LICENSE.
    const monaco = collectPackages(ROOT).find((one) => one.name === "monaco-editor");
    expect(monaco?.text).toContain("ThirdPartyNotices.txt");
    expect(monaco?.text).toContain("typescript version");
  });
});

describe("copiedNotices", () => {
  const grammarsSource = readFileSync(join(ROOT, "scripts", "grammars.mjs"), "utf8");
  const shipped = [...(/const LANGUAGES = \[([\s\S]*?)\];/.exec(grammarsSource)?.[1] ?? "").matchAll(/"([^"]+)"/g)]
    .map((match) => match[1]!);
  const text = copiedNotices(ROOT).join("\n");

  it("reads the list of shipped grammars", () => {
    expect(shipped.length).toBeGreaterThan(5);
  });

  it("credits the upstream grammar of every language the installer ships", () => {
    // tsx is compiled from the tree-sitter-typescript repository.
    const repos = new Set(shipped.map((language) => (language === "tsx" ? "typescript" : language)));
    const missing = [...repos].filter((repo) => !text.includes(`tree-sitter-${repo} (https://github.com/tree-sitter/tree-sitter-${repo})`));
    expect(missing).toEqual([]);
    expect(text).toContain("Permission is hereby granted");
  });
});
