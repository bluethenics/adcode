import { describe, expect, it } from "vitest";
import { isImagePath } from "../src/renderer/editor/imagePreview.ts";

describe("image preview routing", () => {
  it("previews the supported image types", () => {
    for (const name of [
      "photo.png",
      "photo.jpg",
      "photo.jpeg",
      "photo.gif",
      "photo.webp",
      "icon.svg",
      "icon.ico",
      "icon.bmp",
    ]) {
      expect(isImagePath(name), name).toBe(true);
    }
  });

  it("matches case-insensitively and on Windows paths", () => {
    expect(isImagePath("E:\\project\\assets\\Logo.PNG")).toBe(true);
    expect(isImagePath("assets/avatar.JpG")).toBe(true);
  });

  it("leaves text and code to Monaco", () => {
    for (const name of [
      "styles.css",
      "app.ts",
      "notes.txt",
      "data.json",
      "archive.zip",
      "no-extension",
      "photo.png.txt",
    ]) {
      expect(isImagePath(name), name).toBe(false);
    }
  });

  it("does not treat synthetic history tabs as images", () => {
    expect(isImagePath("adcode-revision:abc123:E:/project/photo.png")).toBe(false);
    expect(isImagePath("adcode-untitled:1")).toBe(false);
  });
});
