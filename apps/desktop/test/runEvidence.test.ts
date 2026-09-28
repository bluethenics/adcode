/**
 * Proof of work: what an agent actually ran, and what its change puts at risk.
 *
 * The evidence comes from the run's own traces and diff, never from the agent's summary -
 * "all tests pass" in prose proves nothing; a recorded `npm test` that completed does.
 */
import { describe, expect, it } from "vitest";
import { checksFromTraces, holdReason, riskFlags } from "../src/shared/runEvidence.ts";

let clock = 0;
const call = (command: string) => ({ kind: "tool-call", summary: "Called run_command", detail: command, outcome: "pending", at: ++clock });
const result = (ok: boolean) => ({ kind: "tool-result", summary: `run_command ${ok ? "completed" : "failed"}`, detail: "", outcome: ok ? "ok" : "failed", at: ++clock });
const other = (name: string, detail = "") => ({ kind: "tool-call", summary: `Called ${name}`, detail, outcome: "pending", at: ++clock });
const change = (path: string, added: readonly string[], removed: readonly string[] = [], isNew = false) => ({
  path, isNew, hunks: [{ id: "h0", startLine: 1, original: removed, replacement: added }],
});

describe("checks the agent ran", () => {
  it("pairs each check command with its result", () => {
    const checks = checksFromTraces([call("npm test"), result(true), call("npx tsc --noEmit"), result(false)]);
    expect(checks).toEqual([{ command: "npm test", ok: true }, { command: "npx tsc --noEmit", ok: false }]);
  });

  it("keeps the last run of a command, so a fixed failure reads as fixed", () => {
    expect(checksFromTraces([call("npm test"), result(false), call("npm test"), result(true)])).toEqual([{ command: "npm test", ok: true }]);
  });

  it("ignores commands that are not checks, and other tools", () => {
    expect(checksFromTraces([other("read_file", "src/a.ts"), call("ls -la"), result(true), call("git status"), result(true)])).toEqual([]);
  });

  it("recognises the common checkers across ecosystems", () => {
    for (const command of ["npm run lint", "pnpm typecheck", "npx vitest run", "pytest -q", "cargo test", "go test ./...", "ruff check .", "npm run build", "mypy app"]) {
      expect(checksFromTraces([call(command), result(true)]), command).toEqual([{ command, ok: true }]);
    }
  });

  it("does not claim a result for a command that never finished", () => {
    expect(checksFromTraces([call("npm test")])).toEqual([]);
  });

  it("orders by time even when traces arrive shuffled", () => {
    const traces = [call("npm test"), result(false)];
    expect(checksFromTraces([...traces].reverse())).toEqual([{ command: "npm test", ok: false }]);
  });
});

describe("ship-risk flags", () => {
  it("spots something that looks like a secret being added", () => {
    const flags = riskFlags([change("src/config.ts", ['const key = "sk-live-4f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c";'])]);
    expect(flags).toContainEqual({ kind: "secret", path: "src/config.ts", text: "Possible secret added in src/config.ts" });
    expect(riskFlags([change(".env", ["DATABASE_URL=postgres://u:p@host/db"], [], true)]).map((flag) => flag.kind)).toContain("secret");
    expect(riskFlags([change("id_rsa", ["-----BEGIN OPENSSH PRIVATE KEY-----"], [], true)]).map((flag) => flag.kind)).toContain("secret");
  });

  it("does not cry wolf at ordinary code", () => {
    expect(riskFlags([change("src/app.ts", ["const token = readToken(request);", "export const key = 'theme';"])])).toEqual([]);
  });

  it("marks changes to sign-in, payment and permission code", () => {
    expect(riskFlags([change("src/auth/login.ts", ["return user;"])])).toContainEqual({ kind: "sensitive", path: "src/auth/login.ts", text: "Touches sign-in, payment or permission code: src/auth/login.ts" });
    expect(riskFlags([change("app/billing/checkout.tsx", ["<Pay />"])]).map((flag) => flag.kind)).toContain("sensitive");
  });

  it("notices tests being removed", () => {
    const flags = riskFlags([change("src/app.test.ts", ["it('keeps one', () => {});"], ["it('checks login', () => {});", "it('checks logout', () => {});", "it('keeps one', () => {});"])]);
    expect(flags).toContainEqual({ kind: "tests-removed", path: "src/app.test.ts", text: "Removes tests from src/app.test.ts" });
  });

  it("notes dependency changes and very large changes once each", () => {
    expect(riskFlags([change("package.json", ['"left-pad": "^1.0.0",'])]).map((flag) => flag.kind)).toEqual(["dependencies"]);
    const many = Array.from({ length: 25 }, (_, index) => change(`src/file${index}.ts`, ["x"]));
    expect(riskFlags(many).filter((flag) => flag.kind === "large")).toEqual([{ kind: "large", path: null, text: "Large change: 25 files" }]);
  });
});

describe("holding a run for review", () => {
  it("holds for a failed check or a possible secret, and says which", () => {
    expect(holdReason([{ command: "npm test", ok: false }], [])).toBe("a check failed: npm test");
    expect(holdReason([], [{ kind: "secret", path: "src/config.ts", text: "Possible secret added in src/config.ts" }])).toBe("Possible secret added in src/config.ts");
  });

  it("lets everything else through", () => {
    expect(holdReason([{ command: "npm test", ok: true }], [{ kind: "sensitive", path: "src/auth.ts", text: "x" }, { kind: "large", path: null, text: "y" }])).toBeNull();
  });
});
