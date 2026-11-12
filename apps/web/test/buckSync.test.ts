import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string): string => readFileSync(join(REPO, path), "utf8").replace(/\r\n/g, "\n");

describe("Buck on the website", () => {
  it("is the desktop's own drawing, unchanged (run node scripts/vendor-buck.mjs)", () => {
    expect(read("apps/web/src/components/buck/adcodeMascot.ts")).toBe(read("apps/desktop/src/renderer/mascot/adcodeMascot.ts"));
    expect(read("apps/web/src/components/buck/adcodeMascot.css")).toBe(read("apps/desktop/src/renderer/styles/adcodeMascot.css"));
  });
});
