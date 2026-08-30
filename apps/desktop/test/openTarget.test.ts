import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateOpenTarget } from "../../../scripts/openTarget.mjs";

describe("adcode open target validation", () => {
  it("accepts launches without a target", async () => {
    await expect(validateOpenTarget([], process.cwd())).resolves.toEqual({
      ok: true,
      target: null,
    });
  });

  it("resolves an existing target before launching", async () => {
    const root = await mkdtemp(join(tmpdir(), "adcode-open-target-"));

    await expect(validateOpenTarget([root], process.cwd())).resolves.toEqual({
      ok: true,
      target: root,
    });
  });

  it("returns a useful error for a missing explicit target", async () => {
    const missing = join(process.cwd(), "definitely-missing-open-target");

    await expect(validateOpenTarget([missing], process.cwd())).resolves.toEqual({
      ok: false,
      message: `ADCode could not open "${missing}" because it does not exist.`,
    });
  });
});
