import { describe, expect, it } from "vitest";
import { projectFolderName } from "../src/shared/projectName.ts";

describe("naming a new project after the idea", () => {
  it("keeps the words that name the thing and drops the request around them", () => {
    expect(projectFolderName("Build me a landing page for my bakery", new Set())).toBe("landing-page-bakery");
    expect(projectFolderName("make a snake game", new Set())).toBe("snake-game");
    expect(projectFolderName("Create a to-do app with dark mode please", new Set())).toBe("to-do-app-dark-mode");
  });

  it("never makes a name Windows refuses or a path could escape", () => {
    expect(projectFolderName("../../etc/passwd", new Set())).toBe("etc-passwd");
    expect(projectFolderName("CON", new Set())).toBe("con-project");
    expect(projectFolderName("café ☕ menu", new Set())).toBe("cafe-menu");
    expect(projectFolderName("a".repeat(200), new Set()).length).toBeLessThanOrEqual(40);
  });

  it("falls back to a plain name when the idea has no usable words", () => {
    expect(projectFolderName("", new Set())).toBe("my-project");
    expect(projectFolderName("build me something", new Set())).toBe("my-project");
    expect(projectFolderName("🚀🚀🚀", new Set())).toBe("my-project");
  });

  it("numbers the name rather than reuse a folder that already exists", () => {
    expect(projectFolderName("snake game", new Set(["snake-game"]))).toBe("snake-game-2");
    expect(projectFolderName("snake game", new Set(["snake-game", "snake-game-2"]))).toBe("snake-game-3");
  });

  it("compares names the way Windows does, without case", () => {
    expect(projectFolderName("Snake Game", new Set(["SNAKE-GAME"]))).toBe("snake-game-2");
  });
});
