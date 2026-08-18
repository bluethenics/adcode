import { describe, it, expect } from "vitest";
import { delimiter, join } from "node:path";
import { launchFor, resolveExecutable } from "../src/main/executables.ts";

/**
 * A fake filesystem, so the search order can be asserted on a machine that has none of
 * these programs installed - which this one is, and which every CI runner will be too.
 *
 * Separator-agnostic: `join` uses the host's, and the point of these tests is the search
 * order rather than which slash the platform happens to prefer.
 */
const norm = (path: string): string => path.split("\\").join("/").toLowerCase();

function present(...paths: string[]): (candidate: string) => boolean {
  const set = new Set(paths.map(norm));
  return (candidate) => set.has(norm(candidate));
}

const PATH = ["/usr/local/bin", "/usr/bin"].join(delimiter);
const WIN_PATH = ["C:\\tools", "C:\\npm"].join(delimiter);
const PATHEXT = [".EXE", ".CMD", ".BAT"].join(delimiter);

describe("resolveExecutable", () => {
  it("finds a plain executable on PATH", () => {
    const found = resolveExecutable("gopls", PATH, "", present("/usr/bin/gopls"));

    expect(norm(found ?? "")).toBe(norm(join("/usr/bin", "gopls")));
  });

  it("takes the first directory on PATH that has it", () => {
    const found = resolveExecutable(
      "gopls",
      PATH,
      "",
      present("/usr/local/bin/gopls", "/usr/bin/gopls"),
    );

    expect(norm(found ?? "")).toBe(norm(join("/usr/local/bin", "gopls")));
  });

  it("finds a .cmd shim by consulting PATHEXT", () => {
    // The whole reason this function exists. npm installs its tools as `.cmd` shims, and
    // `spawn` without a shell does not consult PATHEXT - so an installed, working pyright
    // looks exactly like one that was never installed.
    const found = resolveExecutable(
      "pyright-langserver",
      WIN_PATH,
      PATHEXT,
      present("C:\\npm\\pyright-langserver.cmd"),
    );

    expect(norm(found ?? "")).toBe(norm(join("C:\\npm", "pyright-langserver.cmd")));
  });

  it("tries the extensions in the order PATHEXT gives them", () => {
    const found = resolveExecutable(
      "tool",
      WIN_PATH,
      PATHEXT,
      present("C:\\tools\\tool.cmd", "C:\\tools\\tool.exe"),
    );

    expect(norm(found ?? "")).toBe(norm(join("C:\\tools", "tool.exe")));
  });

  it("prefers an exact name over one with an extension appended", () => {
    // A command given with its extension must not become `zls.exe.exe`.
    const found = resolveExecutable(
      "zls.exe",
      WIN_PATH,
      PATHEXT,
      present("C:\\tools\\zls.exe", "C:\\tools\\zls.exe.exe"),
    );

    expect(norm(found ?? "")).toBe(norm(join("C:\\tools", "zls.exe")));
  });

  it("treats a command containing a separator as a path, not a name to look up", () => {
    // Searching PATH for `./my-server` would be wrong, and finding something would be
    // worse than finding nothing.
    expect(resolveExecutable("/opt/zls/zls", PATH, "", present("/opt/zls/zls"))).toBe("/opt/zls/zls");
    expect(resolveExecutable("/opt/zls/zls", PATH, "", present("/usr/bin/zls"))).toBeNull();
  });

  it("returns null when it is genuinely not installed", () => {
    expect(resolveExecutable("rust-analyzer", PATH, "", present())).toBeNull();
  });

  it("survives an empty or absent PATH", () => {
    expect(resolveExecutable("gopls", "", "", present("/usr/bin/gopls"))).toBeNull();
  });

  it("ignores empty entries in PATH rather than searching the current directory", () => {
    // An empty PATH entry means "here" to some shells, and resolving a language server out
    // of whatever folder the app happens to be in is not a lookup anybody asked for.
    const found = resolveExecutable(`gopls`, `${delimiter}${delimiter}/usr/bin`, "", present("/usr/bin/gopls"));

    expect(norm(found ?? "")).toBe(norm(join("/usr/bin", "gopls")));
  });
});

describe("launchFor", () => {
  it("runs a real executable directly", () => {
    expect(launchFor("/usr/bin/gopls", [], "linux")).toEqual({ file: "/usr/bin/gopls", args: [] });
  });

  it("runs a .cmd shim through the command interpreter", () => {
    // Node has refused to execute `.cmd` directly since CVE-2024-27980, so a shim spawned
    // as an image fails with EINVAL - which reads as "this program is broken".
    const launch = launchFor("C:\\npm\\pyright-langserver.cmd", ["--stdio"], "win32");

    expect(launch.file.toLowerCase()).toContain("cmd.exe");
    expect(launch.args).toEqual(["/d", "/s", "/c", "C:\\npm\\pyright-langserver.cmd", "--stdio"]);
  });

  it("keeps arguments as separate argv entries rather than a command string", () => {
    // The custom-server setting lets the user supply these. Pasted into one string they
    // would be re-parsed as shell syntax.
    const launch = launchFor("C:\\npm\\x.bat", ["a b", "&& echo hi"], "win32");

    expect(launch.args.slice(3)).toEqual(["C:\\npm\\x.bat", "a b", "&& echo hi"]);
  });

  it("does not route a .exe through the interpreter", () => {
    expect(launchFor("C:\\tools\\rust-analyzer.exe", [], "win32").file).toBe(
      "C:\\tools\\rust-analyzer.exe",
    );
  });

  it("is case-insensitive about the shim extension, as Windows is", () => {
    expect(launchFor("C:\\npm\\x.CMD", [], "win32").file.toLowerCase()).toContain("cmd.exe");
  });
});
