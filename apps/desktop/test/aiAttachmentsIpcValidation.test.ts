import { describe, expect, it } from "vitest";
import { parseAiAttachments } from "../src/main/aiAttachmentsIpcValidation.ts";

const image = (overrides = {}) => ({
  name: "shot.png",
  kind: "image",
  mediaType: "image/png",
  data: "aGVsbG8=",
  ...overrides,
});

describe("assistant attachment validation", () => {
  it("accepts no attachments at all", () => {
    expect(parseAiAttachments(undefined)).toEqual([]);
    expect(parseAiAttachments([])).toEqual([]);
  });

  it("passes valid images and text through untouched", () => {
    const text = { name: "notes.md", kind: "text", mediaType: "text/markdown", data: "# hi" };
    expect(parseAiAttachments([image(), text])).toEqual([image(), text]);
  });

  it("rejects a renamed video, oversized images, and too many files", () => {
    expect(() => parseAiAttachments([{ ...image(), mediaType: "video/mp4" }])).toThrow();
    expect(() => parseAiAttachments([{ ...image(), data: "a".repeat(16_000_000) }])).toThrow();
    expect(() =>
      parseAiAttachments([image(), image(), image(), image(), image(), image()]),
    ).toThrow();
  });

  it("rejects malformed entries rather than half-reading them", () => {
    expect(() => parseAiAttachments("nope")).toThrow();
    expect(() => parseAiAttachments([{ name: "", kind: "image" }])).toThrow();
    expect(() => parseAiAttachments([{ ...image(), kind: "video" }])).toThrow();
  });
});
