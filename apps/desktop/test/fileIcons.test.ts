import { describe, expect, it } from "vitest";
import { fileIconSpecFor } from "../src/renderer/workbench/fileIcons.ts";

describe("file icon presentation", () => {
  it("gives common source types distinct VS Code-style marks", () => {
    expect(fileIconSpecFor("app.tsx")).toMatchObject({ mark: "TS", tone: "typescript" });
    expect(fileIconSpecFor("app.jsx")).toMatchObject({ mark: "JS", tone: "javascript" });
    expect(fileIconSpecFor("styles.css")).toMatchObject({ mark: "#", tone: "css" });
    expect(fileIconSpecFor("main.py")).toMatchObject({ mark: "Py", tone: "python" });
    expect(fileIconSpecFor("main.rs")).toMatchObject({ mark: "Rs", tone: "rust" });
  });

  it("recognises framework, configuration, and exact-name files", () => {
    expect(fileIconSpecFor("Widget.vue")).toMatchObject({ mark: "V", tone: "vue" });
    expect(fileIconSpecFor("Widget.svelte")).toMatchObject({ mark: "S", tone: "svelte" });
    expect(fileIconSpecFor("astro.config.mjs")).toMatchObject({ mark: "A", tone: "astro" });
    expect(fileIconSpecFor("Dockerfile")).toMatchObject({ mark: "D", tone: "docker" });
    expect(fileIconSpecFor("package.json")).toMatchObject({ mark: "npm", tone: "npm" });
  });

  it("keeps unknown files legible instead of assigning a misleading language", () => {
    expect(fileIconSpecFor("mystery.xyzabc")).toMatchObject({ mark: "", tone: "file" });
  });
});
