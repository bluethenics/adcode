import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("packaged smoke safety", () => {
  it("re-resolves its scratch folder before destructive Explorer checks", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../../scripts/smoke.mjs"), "utf8");
    const start = source.indexOf("// Delete, through however many confirmations");
    const end = source.indexOf("The Problems panel, end to end", start);
    const deletion = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(deletion).toContain("const deletePoint = await evaluate");
    expect(deletion).not.toContain("rightClickAt(folderPoint.x, folderPoint.y)");
    expect(source).toContain("checks.createFolder = await waitForTreePath(SCRATCH)");
  });

  it("resolves packaged ad smoke artifacts through the shared release policy", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../../scripts/smoke-ads.mjs"), "utf8");
    expect(source).toContain('import { releaseDirectory } from "./release-directory.mjs"');
    expect(source).toContain('join(releaseDirectory(REPO), "win-unpacked", "ADCode.exe")');
  });
});
