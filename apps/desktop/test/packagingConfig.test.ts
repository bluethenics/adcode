import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "../../..");

describe("desktop packaging dependency boundary", () => {
  it("uses the desktop manifest and ships only node-pty", () => {
    const config = readFileSync(resolve(repo, "electron-builder.yml"), "utf8");
    const manifest = JSON.parse(readFileSync(resolve(repo, "apps/desktop/package.json"), "utf8")) as {
      author?: string;
      license?: string;
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };

    expect(config).toMatch(/^\s*app:\s*apps\/desktop\s*$/m);
    expect(config).toMatch(/^\s*main:\s*out\/main\/index\.js\s*$/m);
    expect(config).toMatch(/^beforeBuild:\s*\.\/scripts\/electron-builder-before-build\.mjs\s*$/m);
    expect(config).not.toMatch(/^npmRebuild:\s*false\s*$/m);
    expect(config).toMatch(/^\s*- from:\s*\.\.\/\.\.\/node_modules\/node-pty\s*$/m);
    expect(config).toMatch(/^\s*- from:\s*\.\.\/\.\.\/node_modules\/node-addon-api\s*$/m);
    expect(manifest.dependencies).toEqual({ "node-pty": "^1.1.0" });
    expect(manifest.optionalDependencies ?? {}).toEqual({});
    expect(manifest.author).toBe("ADCode");
    expect(manifest.license).toBe("UNLICENSED");
  });
});
