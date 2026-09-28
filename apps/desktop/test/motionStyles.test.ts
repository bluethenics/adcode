/**
 * Motion that stays smooth and stays optional.
 *
 * Smooth means the compositor can do it alone: only transform, opacity and their individual
 * `scale`/`translate` cousins ever animate, so no animation re-lays out the page. Optional
 * means every animation sits behind both the operating system's reduce-motion setting and
 * ADCode's own switch. And lively is for Vibe: Code keeps its short, plain timings.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const motion = read("../src/renderer/styles/motion.css");
const main = read("../src/renderer/main.ts");
const dock = read("../src/renderer/workbench/assistantDock.ts");
const pages = read("../src/renderer/workbench/vibePages.ts");
const panel = read("../src/renderer/workbench/floatingPanel.ts");
const agents = read("../src/renderer/agents/agentsPage.ts");
const chat = read("../src/renderer/ai/chatWidget.ts");

/** The body of the first block that opens with `opener`, braces balanced. */
function block(css: string, opener: string): string {
  const start = css.indexOf(opener);
  if (start < 0) return "";
  let depth = 0;
  for (let index = css.indexOf("{", start); index < css.length; index++) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(css.indexOf("{", start) + 1, index);
  }
  return "";
}

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** A selector list split on its top-level commas - not the ones inside :is() or :not(). */
function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  return [...parts, current];
}

describe("motion.css", () => {
  const css = stripComments(motion);
  const guard = block(css, "@media (prefers-reduced-motion: no-preference)");

  it("is loaded after the stylesheets it animates", () => {
    const at = main.indexOf('import "./styles/motion.css";');
    expect(at).toBeGreaterThan(0);
    for (const sheet of ["floatingPanel.css", "agents.css", "tools.css", "ai.css"]) {
      expect(main.indexOf(`import "./styles/${sheet}";`)).toBeLessThan(at);
    }
  });

  it("animates nothing but transform and opacity", () => {
    const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)].map((match) => block(css, match[0]));
    expect(keyframes.length).toBeGreaterThanOrEqual(6);
    for (const frames of keyframes) {
      const properties = [...frames.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
      for (const property of properties) expect(["transform", "opacity", "scale", "translate"]).toContain(property);
    }
  });

  it("puts every animation and transition behind both reduce-motion switches", () => {
    expect(guard.length).toBeGreaterThan(0);
    const outside = css.replace(guard, "").replace(/@keyframes\s+[\w-]+\s*\{[\s\S]*?\}\s*\}/g, "");
    expect(outside).not.toMatch(/\b(animation|transition)(-[a-z-]+)?\s*:/);
    const selectors = [...guard.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((match) => match[1]!.trim());
    expect(selectors.length).toBeGreaterThan(5);
    for (const group of selectors) {
      for (const selector of splitSelectors(group)) expect(selector.trim().startsWith(':root:not([data-reduced-motion="true"])')).toBe(true);
    }
  });

  it("is lively only where Vibe asks for it", () => {
    expect(block(css, ':root[data-motion="lively"]')).toMatch(/--motion-move:\s*320ms/);
    expect(block(css, ":root {")).toMatch(/--motion-move:\s*180ms/);
  });
});

describe("motion wiring", () => {
  it("sets the personality from the workspace mode", () => {
    expect(dock).toContain('document.documentElement.dataset["motion"] = motionPersonality(mode);');
  });

  it("slides a page in from the side it sits on", () => {
    expect(pages).toContain('dataset["enter"]');
  });

  it("grows a floating panel out of what opened it without moving it", () => {
    expect(panel).toContain("style.transformOrigin");
  });

  it("glides boxes between columns and celebrates a finished run", () => {
    expect(agents).toContain("playFlip(");
    expect(agents).toContain('markFor(entry.li, "celebrate", "true", 900);');
  });

  it("brings new messages in, but not a whole reopened conversation", () => {
    expect(chat).toContain('if (!restoring) markFor(element, "enter", "true", 700);');
    expect(chat).toContain("markFreshBlocks(");
  });
});
