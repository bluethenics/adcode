import { describe, it, expect } from "vitest";
import { SERVERS, languagesWithServers, parseCustomServers, resolveServer, serverFor } from "../src/index.ts";

describe("the server registry", () => {
  it("gives every server an install hint", () => {
    // The field is required because it is the whole difference between "this editor has no
    // Python support" and "this editor needs one more install". A beginner cannot discover
    // that a separate program was meant to be running.
    for (const server of SERVERS) {
      expect(server.installHint.length, `${server.id} has no install hint`).toBeGreaterThan(0);
      expect(server.languages.length, `${server.id} serves no language`).toBeGreaterThan(0);
    }
  });

  it("uses a bare command name, leaving the lookup to the OS", () => {
    for (const server of SERVERS) {
      expect(server.command, `${server.id} hard-codes a path`).not.toMatch(/[\\/]/);
    }
  });

  it("has a unique id per server", () => {
    const ids = SERVERS.map((server) => server.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never claims a language twice", () => {
    // Two servers for one language means two diagnostics for every error, differing
    // slightly, in a panel whose value is that everything in it is worth acting on.
    const claimed = SERVERS.flatMap((server) => [...server.languages]);
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it("leaves TypeScript and JavaScript to Monaco's own worker", () => {
    expect(serverFor("typescript")).toBeNull();
    expect(serverFor("javascript")).toBeNull();
  });

  it("finds a server for the languages it does cover", () => {
    expect(serverFor("python")?.id).toBe("pyright");
    expect(serverFor("rust")?.id).toBe("rust-analyzer");
    expect(serverFor("cpp")?.id).toBe("clangd");
  });

  it("returns null for a language nobody bundled", () => {
    expect(serverFor("brainfuck")).toBeNull();
  });

  it("lists each language once", () => {
    const languages = languagesWithServers();
    expect(new Set(languages).size).toBe(languages.length);
    expect(languages).toContain("python");
  });
});

describe("parseCustomServers", () => {
  it("reads a language and a command with arguments", () => {
    expect(parseCustomServers("zig: zls --stdio")).toEqual([
      {
        id: "custom:zig",
        label: "zls (custom)",
        languages: ["zig"],
        command: "zls",
        args: ["--stdio"],
        installHint: "Check that `zls` is on your PATH",
      },
    ]);
  });

  it("reads several, separated by newlines or semicolons", () => {
    const parsed = parseCustomServers("zig: zls\nelm: elm-language-server; nim: nimlsp");

    expect(parsed.map((server) => server.command)).toEqual(["zls", "elm-language-server", "nimlsp"]);
  });

  it("ignores blank lines and comments", () => {
    expect(parseCustomServers("\n  \n# nothing here\nzig: zls")).toHaveLength(1);
  });

  it("ignores a line it cannot make sense of, rather than spawning something odd", () => {
    // This value is typed by hand into a settings box, so half-written lines are the normal
    // state of it. Every one of them would otherwise become a command to run.
    expect(parseCustomServers("no colon here")).toEqual([]);
    expect(parseCustomServers(": nothing before the colon")).toEqual([]);
    expect(parseCustomServers("zig:")).toEqual([]);
    expect(parseCustomServers("zig:    ")).toEqual([]);
  });

  it("lowercases the language id, since Monaco's are lowercase", () => {
    expect(parseCustomServers("Python: mypls")[0]?.languages).toEqual(["python"]);
  });

  it("returns nothing for an empty setting", () => {
    expect(parseCustomServers("")).toEqual([]);
  });
});

describe("resolveServer", () => {
  it("prefers a custom entry over the bundled default", () => {
    // Someone who wrote a line in settings expressed a preference about that language, and
    // a default that silently overrode it would be unfixable from the only place they have
    // to say anything.
    const custom = parseCustomServers("python: my-own-pyls");

    expect(resolveServer("python", custom)?.command).toBe("my-own-pyls");
  });

  it("falls back to the bundled default for languages the user said nothing about", () => {
    expect(resolveServer("rust", parseCustomServers("python: x"))?.id).toBe("rust-analyzer");
  });

  it("lets a custom entry add a language nobody bundled", () => {
    expect(resolveServer("zig", parseCustomServers("zig: zls"))?.command).toBe("zls");
  });

  it("returns null when neither has anything to offer", () => {
    expect(resolveServer("cobol", [])).toBeNull();
  });
});
