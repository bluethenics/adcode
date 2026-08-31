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

  /*
   * One name for the window, the desktop entry and the dock.
   *
   * GNOME links a running window to its `.desktop` entry by matching the window's `app_id`
   * against `StartupWMClass`. Electron takes `app_id` from `desktopName` in the app's
   * package.json at startup - before `main/index.ts` calls `app.setName` - while
   * electron-builder names the installed file from `linux.executableName` and writes
   * `StartupWMClass` from `desktopName` only when `syncDesktopName` is on.
   *
   * Left to the defaults those disagree: `@adcode/desktop` against `ADCode`. The symptom
   * is a dock holding two icons for one editor, and it is worth a test because
   * `main/pinPrompt.ts` offers to put the first of them there.
   */
  it("gives Linux one name for the window, the desktop entry and the dock", () => {
    const config = readFileSync(resolve(repo, "electron-builder.yml"), "utf8");
    const manifest = JSON.parse(
      readFileSync(resolve(repo, "apps/desktop/package.json"), "utf8"),
    ) as { desktopName?: string };

    expect(manifest.desktopName).toBe("ADCode.desktop");
    expect(config).toMatch(/^\s*syncDesktopName:\s*true\s*$/m);
    expect(config).toMatch(/^\s*executableName:\s*ADCode\s*$/m);
  });
});
