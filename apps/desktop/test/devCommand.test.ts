import { describe, it, expect } from "vitest";
import {
  detectDevCommand,
  frameworkFor,
  packageManagerFor,
  parseServerUrl,
  shellInvocation,
  stripAnsi,
} from "../src/main/devCommand.ts";

describe("packageManagerFor", () => {
  it("reads the lockfile, because the wrong one resolves a different dependency tree", () => {
    expect(packageManagerFor(["pnpm-lock.yaml"])).toBe("pnpm");
    expect(packageManagerFor(["yarn.lock"])).toBe("yarn");
    expect(packageManagerFor(["bun.lockb"])).toBe("bun");
    expect(packageManagerFor(["package-lock.json"])).toBe("npm");
  });

  it("prefers pnpm when a stale npm lockfile is also lying around", () => {
    // Both files present is common after a migration. The pnpm one is the live truth.
    expect(packageManagerFor(["package-lock.json", "pnpm-lock.yaml"])).toBe("pnpm");
  });

  it("falls back to npm when no preference has been expressed", () => {
    expect(packageManagerFor(["package.json"])).toBe("npm");
    expect(packageManagerFor([])).toBe("npm");
  });
});

describe("frameworkFor", () => {
  it("recognises the config files people actually have", () => {
    expect(frameworkFor(["vite.config.ts"])).toBe("Vite");
    expect(frameworkFor(["next.config.mjs"])).toBe("Next.js");
    expect(frameworkFor(["svelte.config.js"])).toBe("SvelteKit");
    expect(frameworkFor(["angular.json"])).toBe("Angular");
  });

  it("is not fooled by a name that merely contains a marker", () => {
    expect(frameworkFor(["my-vite.config.ts"])).toBeNull();
    expect(frameworkFor(["vite.config.ts.bak"])).toBeNull();
  });

  it("returns null when nothing matches, rather than guessing", () => {
    expect(frameworkFor(["index.html", "style.css"])).toBeNull();
  });
});

describe("detectDevCommand", () => {
  const pkg = { scripts: { dev: "vite" } };

  it("finds the dev script and names what will run", () => {
    const command = detectDevCommand(["package.json", "vite.config.ts"], pkg);

    expect(command).toEqual({
      label: "Vite · npm run dev",
      packageManager: "npm",
      script: "dev",
      framework: "Vite",
    });
  });

  it("names the package manager it will actually use", () => {
    const command = detectDevCommand(["package.json", "pnpm-lock.yaml", "vite.config.ts"], pkg);

    expect(command?.label).toBe("Vite · pnpm run dev");
  });

  it("falls back through the script names in order of preference", () => {
    expect(detectDevCommand(["package.json"], { scripts: { start: "node ." } })?.script).toBe("start");
    expect(detectDevCommand(["package.json"], { scripts: { serve: "x" } })?.script).toBe("serve");
    expect(
      detectDevCommand(["package.json"], { scripts: { start: "a", dev: "b" } })?.script,
    ).toBe("dev");
  });

  it("labels a project with no recognised framework by its command alone", () => {
    expect(detectDevCommand(["package.json"], pkg)?.label).toBe("npm run dev");
  });

  it("reports whether a framework was recognised, which decides what starts on its own", () => {
    // The field the preview reads to choose between "run this" and "offer to run this".
    // ADCode's own `dev` script launches Electron and serves no page; running it because a
    // `dev` key existed would turn a preview button into an arbitrary command.
    expect(detectDevCommand(["package.json", "vite.config.ts"], pkg)?.framework).toBe("Vite");
    expect(detectDevCommand(["package.json"], pkg)?.framework).toBeNull();
  });

  it("returns null for a folder of plain HTML", () => {
    // Not a failure - it is how the preview knows the static server is the right answer.
    expect(detectDevCommand(["index.html", "style.css"], null)).toBeNull();
  });

  it("returns null when package.json has no script worth running", () => {
    expect(detectDevCommand(["package.json"], { scripts: { build: "tsc" } })).toBeNull();
    expect(detectDevCommand(["package.json"], { scripts: {} })).toBeNull();
    expect(detectDevCommand(["package.json"], {})).toBeNull();
  });

  it("survives a package.json that is not the shape it claims to be", () => {
    // It is a file on disk that anyone can edit, so every branch here is reachable.
    expect(detectDevCommand(["package.json"], "not an object")).toBeNull();
    expect(detectDevCommand(["package.json"], null)).toBeNull();
    expect(detectDevCommand(["package.json"], { scripts: "nope" })).toBeNull();
    expect(detectDevCommand(["package.json"], { scripts: { dev: 42 } })).toBeNull();
  });
});

describe("shellInvocation", () => {
  it("builds a fixed command line with nothing untrusted in it", () => {
    const command = { label: "x", packageManager: "pnpm", script: "dev", framework: null } as const;

    expect(shellInvocation(command, "linux")).toEqual({
      file: "/bin/sh",
      args: ["-c", "pnpm run dev"],
    });

    const windows = shellInvocation(command, "win32");
    expect(windows.file.toLowerCase()).toContain("cmd.exe");
    expect(windows.args.at(-1)).toBe("pnpm run dev");
  });
});

describe("stripAnsi", () => {
  it("removes the colour every dev server banner is wrapped in", () => {
    expect(stripAnsi("\u001B[32mready\u001B[39m")).toBe("ready");
    expect(stripAnsi("\u001B[1m\u001B[36mVITE\u001B[0m v5")).toBe("VITE v5");
  });

  it("removes an OSC hyperlink sequence, which Vite uses for its Local line", () => {
    expect(stripAnsi("\u001B]8;;http://x\u0007text\u001B]8;;\u0007")).toBe("text");
  });

  it("leaves ordinary text alone", () => {
    expect(stripAnsi("http://localhost:5173/")).toBe("http://localhost:5173/");
  });
});

describe("parseServerUrl", () => {
  it("takes the Local address over the Network one", () => {
    // The whole reason this is two passes. The network address is the machine's LAN IP,
    // which the preview frame may not reach and which is not what "my site" means.
    const banner = [
      "  VITE v5.0.0  ready in 320 ms",
      "",
      "  ➜  Local:   http://localhost:5173/",
      "  ➜  Network: http://192.168.1.20:5173/",
    ].join("\n");

    expect(parseServerUrl(banner)).toBe("http://localhost:5173/");
  });

  it("reads a Local line even when it arrives wrapped in colour", () => {
    const line = "  \u001B[32m➜\u001B[39m  \u001B[1mLocal\u001B[22m:   \u001B[36mhttp://localhost:3000/\u001B[39m";

    expect(parseServerUrl(line)).toBe("http://localhost:3000/");
  });

  it("falls back to any loopback URL when nothing says Local", () => {
    expect(parseServerUrl("Server running at http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080/");
  });

  it("adds a path so the frame is asking for a document", () => {
    expect(parseServerUrl("Local: http://localhost:4321")).toBe("http://localhost:4321/");
  });

  it("keeps a path the server actually announced", () => {
    expect(parseServerUrl("Local: http://localhost:4200/app/")).toBe("http://localhost:4200/app/");
  });

  it("drops punctuation that belonged to the sentence, not the URL", () => {
    expect(parseServerUrl("Listening on http://localhost:9000.")).toBe("http://localhost:9000/");
    expect(parseServerUrl("Open (http://localhost:9000)")).toBe("http://localhost:9000/");
  });

  it("ignores a LAN address entirely when it is the only one offered", () => {
    // We cannot promise the frame can reach it, and a preview pointed somewhere it cannot
    // load is worse than one that admits it never found an address.
    expect(parseServerUrl("Network: http://192.168.1.20:5173/")).toBeNull();
  });

  it("returns null for output with no address in it yet", () => {
    expect(parseServerUrl("installing dependencies...")).toBeNull();
    expect(parseServerUrl("")).toBeNull();
  });
});
