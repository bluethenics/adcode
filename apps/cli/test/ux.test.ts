import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closest, didYouMean, editDistance } from "../src/util/suggest.ts";
import { combinePrompt, readPipedInput } from "../src/util/stdin.ts";
import { completionCandidates, type CompletionData } from "../src/completion/complete.ts";
import { completionScript } from "../src/completion/scripts.ts";
import { detectShell } from "../src/commands/completion.ts";
import { createSession, findSession, saveSession, withMessage } from "../src/ai/sessions.ts";
import { KNOWN_FLAGS, parseFlags } from "../src/context.ts";
import { stripAnsi, visibleWidth } from "../src/tui/ansi.ts";
import { REPOSITORY_ROOT } from "../src/util/paths.ts";
// @ts-expect-error The executable module intentionally has no declaration file.
import { createLaunchPlan } from "../../../scripts/cli-launcher.mjs";
import { removeDir, seedTagflow, tempDir } from "./helpers.ts";

/**
 * The small things that decide whether a CLI feels finished: a typo gets a real
 * suggestion, piped text reaches the model, Tab completes, and a session can be named
 * the way a person remembers it.
 */

describe("did you mean", () => {
  it("counts a swapped pair as one edit", () => {
    expect(editDistance("chta", "chat")).toBe(1);
    expect(editDistance("staus", "status")).toBe(1);
    expect(editDistance("same", "SAME")).toBe(0);
  });

  it("offers the close command, not everything sharing a first letter", () => {
    const commands = ["sessions", "status", "site", "smoke", "ship", "chat", "check"];
    expect(closest("staus", commands)).toEqual(["status"]);
    expect(closest("chta", commands)).toEqual(["chat"]);
    expect(closest("zzzz", commands)).toEqual([]);
    expect(didYouMean("--jsno", KNOWN_FLAGS)).toBe("Did you mean --json?");
  });

  it("names the near flag in the usage error", () => {
    expect(() => parseFlags(["--jsno"])).toThrow(/Did you mean --json\?/);
  });
});

describe("piped input", () => {
  it("fences piped text under the typed question, with a fence the text cannot close", () => {
    const prompt = combinePrompt("review this", { text: "a\n```\nb", truncated: false });
    expect(prompt.startsWith("review this\n\n````\n")).toBe(true);
    expect(prompt.endsWith("\n````")).toBe(true);
    expect(combinePrompt("", { text: "just a question", truncated: false })).toBe("just a question");
    expect(combinePrompt("typed", null)).toBe("typed");
  });

  it("reads a pipe to the end and ignores a terminal", async () => {
    const pipe = new PassThrough() as unknown as NodeJS.ReadStream;
    const reading = readPipedInput(pipe, { idleMs: 500 });
    (pipe as unknown as PassThrough).end("one\r\ntwo\n\n");
    expect(await reading).toEqual({ text: "one\ntwo", truncated: false });

    const tty = Object.assign(new PassThrough(), { isTTY: true }) as unknown as NodeJS.ReadStream;
    expect(await readPipedInput(tty)).toBeNull();
  });

  it("gives up on a pipe that never sends anything", async () => {
    const silent = new PassThrough() as unknown as NodeJS.ReadStream;
    expect(await readPipedInput(silent, { idleMs: 30 })).toBeNull();
  });
});

describe("Tab completion", () => {
  const data: CompletionData = {
    commands: ["chat", "models", "sessions", "theme", "help", "completion", "app"],
    themes: ["midnight", "paper"],
    models: ["test-default", "test-fast"],
    providers: ["tagflow", "ollama"],
    sessions: ["s-abc123-1-xxxxx"],
  };

  it("completes commands, actions, flags and their values", () => {
    expect(completionCandidates([], "se", data)).toEqual(["sessions"]);
    expect(completionCandidates(["sessions"], "", data)).toContain("show");
    expect(completionCandidates(["sessions", "show"], "", data)).toEqual(["latest", "s-abc123-1-xxxxx"]);
    expect(completionCandidates(["models", "use"], "test-f", data)).toEqual(["test-fast"]);
    expect(completionCandidates(["chat", "--model"], "", data)).toEqual(["test-default", "test-fast"]);
    expect(completionCandidates(["--theme"], "p", data)).toEqual(["paper"]);
    expect(completionCandidates(["chat"], "--mo", data)).toEqual(["--model"]);
    expect(completionCandidates(["help"], "mo", data)).toEqual(["models"]);
  });

  it("skips flag values when finding the command, and leaves paths to the shell", () => {
    expect(completionCandidates(["--theme", "paper", "theme"], "", data)).toEqual(["list", "set", "show"]);
    expect(completionCandidates(["app"], "", data)).toEqual([]);
  });

  it("sends the current word last with an @, so PowerShell cannot drop it", () => {
    for (const shell of ["bash", "zsh", "fish", "powershell"] as const) {
      expect(completionScript(shell)).toContain("__complete");
      expect(completionScript(shell)).toContain("@");
    }
  });

  it("guesses the shell from the environment", () => {
    expect(detectShell({ SHELL: "/bin/zsh" }, "linux")).toBe("zsh");
    expect(detectShell({ SHELL: "/usr/bin/bash" }, "win32")).toBe("bash");
    expect(detectShell({}, "win32")).toBe("powershell");
    expect(detectShell({}, "linux")).toBe("bash");
  });

  it("routes __complete to the small entry point", () => {
    const plan = createLaunchPlan(["__complete", "--help", "@"]);
    expect(plan.kind).toBe("terminal");
    expect(plan.args[0]).toMatch(/complete\.ts$/);
    expect(plan.args.slice(1)).toEqual(["--help", "@"]);
  });
});

describe("naming a saved conversation", () => {
  let dataDir = "";
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env["ADCODE_CLI_DATA_DIR"];
    dataDir = tempDir();
    process.env["ADCODE_CLI_DATA_DIR"] = dataDir;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env["ADCODE_CLI_DATA_DIR"];
    else process.env["ADCODE_CLI_DATA_DIR"] = previous;
    removeDir(dataDir);
  });

  function saved(title: string, at: number) {
    const session = withMessage(createSession("tagflow", "test-default"), { role: "user", text: title, at });
    return saveSession({ ...session, updatedAt: at });
  }

  it("accepts latest, a list number, a full id or a unique prefix", () => {
    const older = saved("older", 1_000);
    const newer = saved("newer", 2_000);
    expect(findSession("latest")).toEqual({ session: expect.objectContaining({ id: newer.id }) });
    expect(findSession("2")).toEqual({ session: expect.objectContaining({ id: older.id }) });
    expect(findSession(older.id)).toEqual({ session: expect.objectContaining({ id: older.id }) });
    expect(findSession(newer.id.slice(0, newer.id.length - 2))).toEqual({ session: expect.objectContaining({ id: newer.id }) });
  });

  it("says when a reference is ambiguous or matches nothing", () => {
    saved("a", 1_000);
    saved("b", 2_000);
    const result = findSession("s-");
    expect("error" in result && result.error).toBe("missing");
    expect(findSession("9")).toEqual({ error: "missing", matches: [] });
    const both = findSession("s-m");
    if ("session" in both) throw new Error("expected no single match");
  });
});

describe("through a real process", () => {
  const CLI = join(REPOSITORY_ROOT, "apps", "cli", "src", "index.ts");
  let dataDir = "";
  let desktopDir = "";
  let homeDir = "";
  let env: NodeJS.ProcessEnv = {};

  beforeAll(() => {
    dataDir = tempDir();
    desktopDir = tempDir();
    homeDir = tempDir();
    seedTagflow(dataDir);
    env = {
      ...process.env,
      ADCODE_CLI_DATA_DIR: dataDir,
      ADCODE_DESKTOP_DATA_DIR: desktopDir,
      ADCODE_SHELL_PROFILE: join(homeDir, ".bashrc"),
      NO_COLOR: "1",
      ADCODE_CLI_ASCII: "1",
    };
  });
  afterAll(() => {
    removeDir(dataDir);
    removeDir(desktopDir);
    removeDir(homeDir);
  });

  const run = (args: readonly string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: REPOSITORY_ROOT, env, encoding: "utf8", timeout: 20_000 });

  it("keeps every help line inside the width, with descriptions in their own column", () => {
    for (const width of [60, 80, 120]) {
      const result = run(["help", "--width", String(width)]);
      expect(result.status, result.stderr).toBe(0);
      for (const line of result.stdout.split(/\r?\n/)) expect(visibleWidth(stripAnsi(line))).toBeLessThanOrEqual(width);
    }
    const result = run(["help", "--width", "80"]);
    expect(result.stdout).toMatch(/\n {2}models {6}Browse the catalogue/);
  });

  it("installs completion once, however many times it is run", () => {
    const first = run(["completion", "install", "bash", "--json"]);
    expect(first.status, first.stderr).toBe(0);
    const report = JSON.parse(first.stdout) as { scriptFile: string; startupLineAdded: boolean };
    expect(report.startupLineAdded).toBe(true);
    expect(existsSync(report.scriptFile)).toBe(true);
    const second = JSON.parse(run(["completion", "install", "bash", "--json"]).stdout) as { startupLineAdded: boolean };
    expect(second.startupLineAdded).toBe(false);
    const rc = readFileSync(join(homeDir, ".bashrc"), "utf8");
    expect(rc.match(/# adcode completion/g)).toHaveLength(1);
  });

  it("prints the script when piped, and suggests the shell after a typo", () => {
    expect(run(["completion", "zsh"]).stdout).toContain("compdef _adcode adcode");
    const typo = run(["completion", "zhs"]);
    expect(typo.status).toBe(2);
    expect(typo.stderr).toContain("Did you mean zsh?");
  });
});
