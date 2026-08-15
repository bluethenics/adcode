import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Brief §1: `packages/ads` may not import from `packages/memory`. §11: this test
 * failing is a release blocker.
 *
 * Two assertions, not one. Checking only that the rule passes on the real tree tells
 * you nothing about whether the rule works — a rule with a typo in its path regex also
 * passes. So the second test plants a real violation and requires the rule to fire.
 * A guard that has never been seen to fire is not known to work.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CRUISER = fileURLToPath(
  new URL("../../../node_modules/dependency-cruiser/bin/dependency-cruise.mjs", import.meta.url),
);

// Invoke the binary through node directly. Going via `npx` re-resolves the package on
// every call, which on this volume costs more than the whole cruise.
function depcruise(config: string, targets: string[]): string {
  return execFileSync(
    process.execPath,
    [CRUISER, "--config", config, "--no-progress", ...targets],
    { encoding: "utf8", cwd: ROOT, stdio: "pipe" },
  );
}

describe("the ads <-> memory firewall", { timeout: 120_000 }, () => {
  it("passes on the real source tree", () => {
    expect(() => depcruise(".dependency-cruiser.cjs", ["packages", "mock-server"])).not.toThrow();
  });

  it("fires on a planted violation", () => {
    let output = "";
    let threw = false;

    try {
      depcruise(".dependency-cruiser.fixture.cjs", ["packages/ads/test/__fixtures__/violator"]);
    } catch (error: unknown) {
      threw = true;
      const e = error as { stdout?: string; stderr?: string; message?: string };
      output = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
    }

    expect(threw, "a violating import must fail the cruise").toBe(true);
    expect(output).toMatch(/ads-must-not-import-memory/);
  });
});
