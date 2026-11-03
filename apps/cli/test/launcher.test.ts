import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// The launcher is JavaScript because it must run before TypeScript is loaded.
// @ts-expect-error The executable module intentionally has no declaration file.
import { createLaunchPlan } from "../../../scripts/cli-launcher.mjs";
import { tempDir, removeDir } from "./helpers.ts";

const directory = tempDir();
afterAll(() => removeDir(directory));

describe("one command for terminal and desktop", () => {
  it("routes bare adcode and terminal options to the terminal app", () => {
    expect(createLaunchPlan([], { cwd: directory })).toMatchObject({ kind: "terminal", cwd: directory });
    expect(createLaunchPlan(["--theme", "paper", "models"]).kind).toBe("terminal");
  });

  it.each(["app", "open"])("%s defaults to the caller's folder", (command) => {
    const plan = createLaunchPlan([command, "--dry-run"], { cwd: directory });
    expect(plan).toMatchObject({ kind: "desktop", target: directory, preview: true });
    expect(plan.args.at(-1)).toBe(directory);
  });

  it("preserves spaces, shell characters, percent signs and Unicode as one path argument", () => {
    const name = "project & 100% (你好)";
    mkdirSync(join(directory, name));
    const plan = createLaunchPlan(["app", name, "--force", "--json"], { cwd: directory });
    expect(plan.target).toBe(join(directory, name));
    expect(plan.args.slice(1)).toEqual(["--force", join(directory, name)]);
  });

  it("validates paths and options before launching", () => {
    expect(() => createLaunchPlan(["app", "missing"], { cwd: directory })).toThrow("does not exist");
    expect(() => createLaunchPlan(["app", ".", "."], { cwd: directory })).toThrow("one file or folder");
    expect(() => createLaunchPlan(["app", "--frobnicate"], { cwd: directory })).toThrow("Unknown app option");
  });

  it("treats everything after -- as a literal path", () => {
    mkdirSync(join(directory, "--json"));
    const plan = createLaunchPlan(["app", "--", "--json"], { cwd: directory });
    expect(plan.target).toBe(join(directory, "--json"));
    expect(plan.preview).toBe(false);
    mkdirSync(join(directory, "--help"));
    expect(createLaunchPlan(["app", "--", "--help"], { cwd: directory }).kind).toBe("desktop");
  });

  it("routes app and developer help to the reference", () => {
    expect(createLaunchPlan(["app", "--help"]).kind).toBe("terminal");
    expect(createLaunchPlan(["test", "--help"]).kind).toBe("terminal");
  });

  it("keeps developer arguments out of a shell", () => {
    const plan = createLaunchPlan(["test", "apps/cli", "--run", "--dry-run"]);
    expect(plan.kind).toBe("developer");
    expect(plan.executable).toBe(process.execPath);
    expect(plan.args.slice(1)).toEqual(["run", "test", "--", "apps/cli", "--run"]);
  });
});
