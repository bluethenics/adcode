import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stripAnsi, visibleWidth } from "../src/tui/ansi.ts";
import { REPOSITORY_ROOT } from "../src/util/paths.ts";
import { removeDir, seedTagflow, tempDir } from "./helpers.ts";

/**
 * End-to-end checks through a real child process.
 *
 * Everything is seeded into temporary directories: no desktop profile, no identity, no
 * cached models.dev response, and a fake Included AI catalogue. The CLI therefore cannot
 * quietly reach the network or the machine's real account during a test run.
 */

const CLI = join(REPOSITORY_ROOT, "apps", "cli", "src", "index.ts");
const DISPATCHER = join(REPOSITORY_ROOT, "scripts", "adcode.mjs");

let dataDir = "";
let desktopDir = "";
let env: NodeJS.ProcessEnv = {};

beforeAll(() => {
  dataDir = tempDir();
  desktopDir = tempDir();
  seedTagflow(dataDir);
  env = {
    ...process.env,
    ADCODE_CLI_DATA_DIR: dataDir,
    ADCODE_DESKTOP_DATA_DIR: desktopDir,
    NO_COLOR: "1",
    ADCODE_CLI_ASCII: "1",
  };
});

afterAll(() => {
  removeDir(dataDir);
  removeDir(desktopDir);
});

function runCli(args: readonly string[], options: { cwd?: string } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd ?? REPOSITORY_ROOT,
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
}

function assertFits(stdout: string, width: number): void {
  for (const raw of stdout.split(/\r?\n/)) {
    expect(visibleWidth(stripAnsi(raw))).toBeLessThanOrEqual(width);
  }
}

describe("a terminal that cannot animate still gets the app", () => {
  it("prints a still deck when stdout is a pipe", () => {
    const result = runCli(["--no-ads", "--width", "44", "--height", "22"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("ADCODE");
    expect(result.stdout).toContain("Chat");
    expect(result.stdout).not.toContain("\x1b[?1049h");
    assertFits(result.stdout, 44);
  });

  it("honours --snapshot at a still narrower width", () => {
    const result = runCli(["--snapshot", "--no-ads", "--width", "32", "--height", "16"]);
    expect(result.status, result.stderr).toBe(0);
    assertFits(result.stdout, 32);
    expect(result.stdout).toContain("ADCODE");
  });

  it("keeps the model line when the terminal is short", () => {
    const result = runCli(["--snapshot", "--no-ads", "--width", "100", "--height", "12"]);
    expect(result.status, result.stderr).toBe(0);
    assertFits(result.stdout, 100);
    expect(result.stdout).toContain("ADCODE");
    expect(result.stdout).toContain("Included AI");
    expect(result.stdout).toContain("Ask ADCode anything");
  });
});

describe("JSON is a first-class output", () => {
  it("describes the deck without opening it", () => {
    const result = runCli(["--json", "--no-ads"]);
    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      command: string;
      interactive: boolean;
      model: { provider: string; id: string; ready: boolean };
      catalogue: { ready: number };
      commands: unknown[];
    };
    expect(payload.command).toBe("deck");
    expect(payload.interactive).toBe(false);
    expect(payload.model.provider).toBe("tagflow");
    expect(payload.model.id).toBe("test-default");
    expect(payload.model.ready).toBe(true);
    expect(payload.catalogue.ready).toBeGreaterThan(0);
    expect(payload.commands).toEqual(expect.arrayContaining([expect.objectContaining({ id: "app", command: "app" })]));
  });

  it("lists Included AI first and marks the current model", () => {
    const result = runCli(["models", "list", "--json", "--no-ads", "--width", "80"]);
    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      current: { provider: string; model: string; ready: boolean };
      providers: Array<{ id: string; ready: boolean; included: boolean; models: Array<{ id: string; current: boolean }> }>;
      tagflow: { available: boolean; defaultModel: string } | null;
    };
    expect(payload.current).toMatchObject({ provider: "tagflow", model: "test-default", ready: true });
    expect(payload.tagflow?.available).toBe(true);
    expect(payload.tagflow?.defaultModel).toBe("test-default");
    const included = payload.providers[0];
    expect(included?.id).toBe("tagflow");
    expect(included?.included).toBe(true);
    expect(included?.ready).toBe(true);
    expect(included?.models.find((model) => model.id === "test-default")?.current).toBe(true);
  });

  it("shows a model override on the opening screen without saving it", () => {
    const result = runCli(["--json", "--model", "test-fast", "--no-ads"]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).model.id).toBe("test-fast");
    const next = runCli(["--json", "--no-ads"]);
    expect(JSON.parse(next.stdout).model.id).toBe("test-default");
  });

  it("returns the whole help reference, app commands beside developer commands", () => {
    const result = runCli(["help", "--json"]);
    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      command: string;
      commands: Array<{ name: string; group: string }>;
    };
    expect(payload.command).toBe("help");
    expect(payload.commands.some((entry) => entry.name === "chat" && entry.group === "app")).toBe(true);
    expect(payload.commands.some((entry) => entry.name === "open" && entry.group === "developer")).toBe(true);
    expect(payload.commands.some((entry) => entry.name === "check" && entry.group === "developer")).toBe(true);
  });

  it("reports an unknown command as JSON and exits 2", () => {
    const result = runCli(["--json", "frobnicate"]);
    expect(result.status).toBe(2);
    const payload = JSON.parse(result.stdout) as { error: { message: string } };
    expect(payload.error.message).toContain("frobnicate");
  });
});

describe("choosing a model", () => {
  it("saves the next model and status reports it", () => {
    const ownData = tempDir();
    const ownDesktop = tempDir();
    seedTagflow(ownData);
    const scoped = { ...env, ADCODE_CLI_DATA_DIR: ownData, ADCODE_DESKTOP_DATA_DIR: ownDesktop };
    const run = (args: readonly string[]) => spawnSync(process.execPath, [CLI, ...args], {
      cwd: REPOSITORY_ROOT,
      env: scoped,
      encoding: "utf8",
      timeout: 20_000,
    });

    try {
      const use = run(["models", "use", "test-fast", "--no-ads"]);
      expect(use.status, use.stderr).toBe(0);
      expect(use.stdout).toContain("MODEL SAVED");
      expect(use.stdout).toContain("Test Fast");

      const status = run(["status", "--json", "--no-ads"]);
      expect(status.status, status.stderr).toBe(0);
      const payload = JSON.parse(status.stdout) as {
        model: { provider: string; id: string; ready: boolean; savedChoice: { provider: string; model: string } | null };
      };
      expect(payload.model).toMatchObject({
        provider: "tagflow",
        id: "test-fast",
        ready: true,
        savedChoice: { provider: "tagflow", model: "test-fast" },
      });

      const unknown = run(["models", "use", "not-a-model", "--no-ads"]);
      expect(unknown.status).toBe(2);
      expect(unknown.stderr).toContain("not in the catalogue");
    } finally {
      removeDir(ownData);
      removeDir(ownDesktop);
    }
  }, 30_000);
});

describe("the adcode dispatcher routes both faces of the product", () => {
  function runDispatcher(args: readonly string[]) {
    return spawnSync(process.execPath, [DISPATCHER, ...args], {
      cwd: REPOSITORY_ROOT,
      env,
      encoding: "utf8",
      timeout: 20_000,
    });
  }

  it("sends a bare flag to the terminal app", () => {
    const result = runDispatcher(["--version"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("sends no command to the deck, not to the old npm help", () => {
    const result = runDispatcher(["--snapshot", "--no-ads", "--width", "36", "--height", "18"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("ADCODE");
    assertFits(result.stdout, 36);
  });

  it("keeps the old typo behaviour for an unknown command", () => {
    const result = runDispatcher(["opne"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('there is no "opne" command');
    expect(result.stderr).toContain("Did you mean adcode open?");
  });

  it("opens the desktop from the caller's folder, with an inspectable plan", () => {
    const result = spawnSync(process.execPath, [DISPATCHER, "app", ".", "--json"], {
      cwd: desktopDir, env, encoding: "utf8", timeout: 10_000,
    });
    expect(result.status, result.stderr).toBe(0);
    const plan = JSON.parse(result.stdout);
    expect(plan.kind).toBe("desktop");
    expect(plan.target).toBe(desktopDir);
    expect(plan.args.at(-1)).toBe(desktopDir);
    expect(plan.cwd).toBe(REPOSITORY_ROOT);
  });

  it("gives app-specific help without launching a desktop window", () => {
    const result = runDispatcher(["app", "--help"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("adcode app [path]");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).not.toContain("Starting ADCode");
  });

  it("rejects a missing option value with a JSON usage error", () => {
    const result = runDispatcher(["--json", "--model"]);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).error.message).toContain("--model needs a value");
  });

  it("resumes directly from the opening command", () => {
    const result = runDispatcher(["--continue", "--json", "--no-ads"]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).command).toBe("chat");
  });
});
