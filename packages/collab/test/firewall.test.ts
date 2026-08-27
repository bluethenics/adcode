/**
 * The collaboration firewall: `packages/collab` and `packages/ads` may never touch.
 *
 * The same two-assertion shape as `packages/ads/test/firewall.test.ts`, and for the same
 * reason. Checking that the rule passes on the real tree proves nothing about the rule - a
 * typo in its path regex also passes - so the second test plants a real violation and requires
 * the cruise to fail. A guard that has never been seen to fire is not known to work.
 *
 * What this rule is protecting is worth restating, because it is newer than the others and
 * cuts the sharpest: `packages/collab` is a transport whose entire purpose is sending the
 * user's source code to another computer. `packages/ads` carries a promise that nothing from
 * the user's code leaves the machine through an ad request. Those two things being reachable
 * from one another is the failure this rule exists to make impossible.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CRUISER = fileURLToPath(
  new URL("../../../node_modules/dependency-cruiser/bin/dependency-cruise.mjs", import.meta.url),
);

function depcruise(config: string, targets: string[]): string {
  return execFileSync(
    process.execPath,
    [CRUISER, "--config", config, "--no-progress", ...targets],
    { encoding: "utf8", cwd: ROOT, stdio: "pipe" },
  );
}

describe("the collab <-> ads firewall", { timeout: 120_000 }, () => {
  it("passes on the real source tree", () => {
    expect(() =>
      depcruise(".dependency-cruiser.cjs", ["packages", "mock-server", "apps"]),
    ).not.toThrow();
  });

  it("fires on a planted violation", () => {
    let output = "";
    let threw = false;

    try {
      depcruise(".dependency-cruiser.fixture.cjs", [
        "packages/collab/test/__fixtures__/violator",
      ]);
    } catch (error: unknown) {
      threw = true;
      const e = error as { stdout?: string; stderr?: string; message?: string };
      output = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
    }

    expect(threw, "a violating import must fail the cruise").toBe(true);
    expect(output).toMatch(/collab-must-not-import-ads/);
  });
});
