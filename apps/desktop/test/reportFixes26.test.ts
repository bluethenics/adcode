/**
 * Fixes for problems people reported against 2.5.1 and earlier, each pinned by the input
 * that caused it.
 */
import { describe, expect, it } from "vitest";
import { powerShellLine, shellFor } from "../src/main/aiCommands.ts";
import { base64ImageSize, imageSize, tooSmallForModels } from "../src/main/imageSize.ts";
import { describeAiFailure } from "../src/renderer/ai/aiFailure.ts";
import { shouldChime } from "../src/renderer/ai/doneSound.ts";

/** A PNG header for a picture of the given size: signature, IHDR length and type, width, height. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

describe("a picture too small for a model (reported: 90x30 refused, task ended)", () => {
  it("reads the size of each format from its header", () => {
    expect(imageSize(pngHeader(90, 30))).toEqual({ width: 90, height: 30 });
    expect(imageSize(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 16, 0, 32, 0]))).toEqual({ width: 16, height: 32 });
    // JPEG: SOI, an APP0 segment to skip, then SOF0 with height 0x0040 and width 0x0100.
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xc0, 0, 11, 8, 0, 0x40, 1, 0, 3, 0, 0]))).toEqual({ width: 256, height: 64 });
    const webp = new Uint8Array(30);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    webp.set([99, 0, 0, 49, 0, 0], 24);
    expect(imageSize(webp)).toEqual({ width: 100, height: 50 });
  });

  it("says why a small picture is left out, and lets a large or unreadable one through", () => {
    expect(tooSmallForModels({ width: 90, height: 30 })).toBe("90x30 pixels, and models only look at pictures at least 64x64");
    expect(tooSmallForModels({ width: 64, height: 64 })).toBeNull();
    expect(tooSmallForModels({ width: 2000, height: 63 })).not.toBeNull();
    expect(tooSmallForModels(null)).toBeNull();
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(base64ImageSize(Buffer.from(pngHeader(90, 30)).toString("base64"))).toEqual({ width: 90, height: 30 });
    expect(base64ImageSize("not base64 at all !!")).toBeNull();
  });
});

describe("PowerShell and redirected stderr (reported: cargo check passed, task stopped with exit 1)", () => {
  it("ends a line that redirects stderr with the program's own exit code", () => {
    const line = "cargo check --message-format short 2>&1 | Out-String";
    expect(powerShellLine(line)).toBe(`${line}\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }`);
    expect(shellFor(line, "win32").args.at(-1)).toContain("exit $LASTEXITCODE");
    expect(powerShellLine("npm test *>&1 | Select-Object -Last 20")).toContain("exit $LASTEXITCODE");
  });

  it("passes every other line through untouched", () => {
    for (const line of ["Get-ChildItem -Recurse", "Get-Content a.txt | Select-Object -First 3", "$env:PATH"]) expect(powerShellLine(line)).toBe(line);
  });
});

describe("no folder open (reported: three refused list_files calls, then 'stopped with an error')", () => {
  it("offers to open a folder instead of a bare error", () => {
    const failure = describeAiFailure("Stopped after three identical failed calls to list_files.\nOpen a folder before using AI file tools.");
    expect(failure.title).toBe("Open a folder to work on");
    expect(failure.actions[0]).toBe("open-folder");
    expect(failure.explanation).toContain("You can still chat without a folder");
  });
});

describe("the sound when the assistant finishes (asked for in a report)", () => {
  const base = { enabled: true, elapsedMs: 30_000, windowFocused: true, failed: false };

  it("plays for a long task, or one that ends while the person is elsewhere", () => {
    expect(shouldChime(base)).toBe(true);
    expect(shouldChime({ ...base, elapsedMs: 2_000, windowFocused: false })).toBe(true);
  });

  it("stays silent when off, for a quick answer being watched, and for a failure", () => {
    expect(shouldChime({ ...base, enabled: false })).toBe(false);
    expect(shouldChime({ ...base, elapsedMs: 2_000 })).toBe(false);
    expect(shouldChime({ ...base, failed: true })).toBe(false);
  });
});
