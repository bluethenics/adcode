import { describe, expect, it } from "vitest";
import { firstBuildPrompt, looksLikeBuildRequest } from "../src/shared/firstBuild.ts";

describe("the first prompt for a new project", () => {
  it("asks for something that runs without installing anything", () => {
    const prompt = firstBuildPrompt("A snake game", true);
    expect(prompt.startsWith("A snake game")).toBe(true);
    expect(prompt).toContain("plain HTML, CSS and JavaScript");
    expect(prompt).toContain("open it in the preview");
  });

  it("keeps the stack the person named", () => {
    const prompt = firstBuildPrompt("A todo app in React with Tailwind", true);
    expect(prompt).toContain("Use the stack I named.");
    expect(prompt).not.toContain("plain HTML");
  });

  it("asks an existing project to build and check, without inventing a stack", () => {
    const prompt = firstBuildPrompt("Add a dark mode", false);
    expect(prompt).toBe("Add a dark mode\n\nBuild this in my project, then run it and check that it works.");
  });
});

describe("telling a build request from a question", () => {
  it("recognises asking for something to be made", () => {
    for (const text of ["Build me a landing page", "make a snake game", "create a budget tracker", "I want a website for my bakery", "a portfolio site with my projects"]) {
      expect(looksLikeBuildRequest(text)).toBe(true);
    }
  });

  it("leaves questions alone", () => {
    for (const text of ["What is a closure?", "how do promises work", "explain recursion to me"]) {
      expect(looksLikeBuildRequest(text)).toBe(false);
    }
  });
});
