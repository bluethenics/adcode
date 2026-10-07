import { describe, expect, it } from "vitest";
import { isBinaryByName } from "../src/binary.ts";

/**
 * Which files a text search never opens, decided by name alone.
 *
 * Telling binary from text otherwise means reading the file first. For formats that are
 * never text that read is pure cost, and a project with a few hundred screenshots spent
 * most of every search on it.
 */
describe("isBinaryByName", () => {
  it("knows images, video, audio, archives, fonts and compiled code", () => {
    for (const path of ["shot.png", "photo.jpeg", "clip.mp4", "voice.mp3", "release.zip", "dist.tar.gz", "font.woff2", "app.exe", "module.wasm", "doc.pdf"]) {
      expect(isBinaryByName(path), path).toBe(true);
    }
  });

  it("ignores the case of the extension", () => {
    expect(isBinaryByName("marketing/Hero.PNG")).toBe(true);
  });

  it("leaves text formats alone, including the ones that look like media", () => {
    for (const path of ["icon.svg", "src/app.ts", "README", "notes.md", "data.json", "server.key", "model.obj", "stream.ts"]) {
      expect(isBinaryByName(path), path).toBe(false);
    }
  });

  it("reads the extension of the file, not of a folder it sits in", () => {
    expect(isBinaryByName("assets.png/readme.md")).toBe(false);
    expect(isBinaryByName("v1.2/notes")).toBe(false);
  });
});
