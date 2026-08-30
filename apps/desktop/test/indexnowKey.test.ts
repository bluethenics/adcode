import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INDEXNOW_KEY,
  indexNowKeyLocation,
  isValidIndexNowKey,
} from "@adcode/release/indexnow";

const PUBLIC = join(import.meta.dirname, "..", "..", "web", "public");
const keyFile = join(PUBLIC, INDEXNOW_KEY + ".txt");

/*
 * Two files in different trees have to agree: `scripts/indexnow-key.mjs` and the file
 * served at `apps/web/public/<key>.txt`.
 *
 * IndexNow authenticates by fetching that URL and comparing its contents to the key in the
 * payload. When they disagree the API still answers 200 and the submission is discarded
 * afterwards, so the failure is invisible from the submitting end. These assertions make
 * it visible here instead.
 *
 * It lives beside `releaseAssets.test.ts` rather than under `apps/web/test` for the same
 * reason that one does: it reads the filesystem, and the website's tsconfig carries no
 * Node types.
 */
describe("the IndexNow key", () => {
  it("is served from the site under its own name", () => {
    expect(existsSync(keyFile), INDEXNOW_KEY + ".txt should exist in apps/web/public").toBe(true);
  });

  it("contains exactly the key and nothing else", () => {
    // Not trimmed before comparing: a trailing newline is the likeliest way this file ends
    // up subtly wrong, and validators are strict about it.
    expect(readFileSync(keyFile, "utf8")).toBe(INDEXNOW_KEY);
  });

  it("uses a key IndexNow will accept", () => {
    // 8 to 128 characters, hexadecimal. Anything else is rejected at submission.
    expect(isValidIndexNowKey(INDEXNOW_KEY)).toBe(true);
    expect(isValidIndexNowKey("nope")).toBe(false);
  });

  it("points the verification URL at the canonical host", () => {
    const location = indexNowKeyLocation("https://adcode.bluethenics.com");

    expect(location).toBe(`https://adcode.bluethenics.com/${INDEXNOW_KEY}.txt`);
    // A trailing slash on the origin would produce a double slash and a 404.
    expect(indexNowKeyLocation("https://adcode.bluethenics.com/")).toBe(location);
  });
});
