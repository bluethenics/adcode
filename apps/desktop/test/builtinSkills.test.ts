import { describe, expect, it } from "vitest";
import {
  BUILTIN_SKILL_TOOL,
  BUILTIN_SKILL_TOOL_NAME,
  BUILTIN_SKILLS,
  builtinSkillGuidance,
  frontmatter,
  readBuiltinSkill,
  withBuiltinSkills,
} from "../src/main/builtinSkills.ts";
import { splitDesignSkill } from "../../../scripts/vendor-taste-skill.mjs";

describe("the bundled skills", () => {
  it("ships the design, redesign and full-output skills, each named after its folder", () => {
    expect(BUILTIN_SKILLS.map((skill) => skill.name)).toEqual([
      "design-taste-frontend",
      "full-output-enforcement",
      "redesign-existing-projects",
    ]);
    for (const skill of BUILTIN_SKILLS) expect(skill.description.length).toBeGreaterThan(20);
  });

  it("reads a description from a Windows checkout, with CRLF line endings and a BOM", () => {
    const lf = "---\nname: a\ndescription: Design guidance for interfaces.\n---\n\n# Body\n";
    expect(frontmatter(lf, "description")).toBe("Design guidance for interfaces.");
    expect(frontmatter(lf.replaceAll("\n", "\r\n"), "description")).toBe("Design guidance for interfaces.");
    expect(frontmatter(`﻿${lf.replaceAll("\n", "\r\n")}`, "description")).toBe("Design guidance for interfaces.");
    expect(frontmatter("# No front matter\ndescription: not this\n", "description")).toBe("");
  });

  it("keeps every file under the 64 KB a skill may be, so a model never loads a whole book", () => {
    for (const skill of BUILTIN_SKILLS) {
      const main = readBuiltinSkill({ name: skill.name }, true).content;
      expect(new TextEncoder().encode(main).length).toBeLessThan(64_000);
      for (const resource of skill.resources) {
        const text = readBuiltinSkill({ name: skill.name, resource }, true);
        expect(text.isError).toBe(false);
        expect(new TextEncoder().encode(text.content).length).toBeLessThan(64_000);
      }
    }
  });

  it("indexes every reference file the design skill was split into", () => {
    const design = BUILTIN_SKILLS.find((skill) => skill.name === "design-taste-frontend");
    const main = readBuiltinSkill({ name: "design-taste-frontend" }, true).content;
    expect(design?.resources.length).toBeGreaterThan(5);
    for (const resource of design?.resources ?? []) expect(main).toContain(resource);
    expect(main).toContain("taste-skill");
    expect(main).toContain("MIT");
  });
});

describe("the tool", () => {
  it("is read-only, safe to run alongside other reads, and offers exactly the bundled skills", () => {
    expect(BUILTIN_SKILL_TOOL.name).toBe(BUILTIN_SKILL_TOOL_NAME);
    expect(BUILTIN_SKILL_TOOL.mutating).toBe(false);
    expect(BUILTIN_SKILL_TOOL.concurrent).toBe(true);
    const properties = BUILTIN_SKILL_TOOL.inputSchema["properties"] as { name: { enum: string[] } };
    expect(properties.name.enum).toEqual(BUILTIN_SKILLS.map((skill) => skill.name));
  });

  it("answers a wrong name or path with the right choices, and reads nothing outside the bundle", () => {
    expect(readBuiltinSkill({ name: "nope" }, true)).toMatchObject({ isError: true });
    expect(readBuiltinSkill({ name: "nope" }, true).content).toContain("design-taste-frontend");
    const escape = readBuiltinSkill({ name: "design-taste-frontend", resource: "../../../package.json" }, true);
    expect(escape.isError).toBe(true);
    expect(escape.content).toContain("references/");
  });

  it("says the skills are off rather than reading them when the setting is off", () => {
    const off = readBuiltinSkill({ name: "design-taste-frontend" }, false);
    expect(off.isError).toBe(true);
    expect(off.content).toContain("Design taste skill");
  });

  it("routes only its own calls, leaving every other tool to the runner it wraps", async () => {
    const seen: string[] = [];
    const runner = withBuiltinSkills({ run: async (call) => { seen.push(call.name); return { content: "base", isError: false }; } }, () => true);
    const signal = new AbortController().signal;
    const skill = await runner.run({ type: "tool-call", id: "1", name: BUILTIN_SKILL_TOOL_NAME, input: { name: "full-output-enforcement" } }, signal);
    const other = await runner.run({ type: "tool-call", id: "2", name: "read_file", input: {} }, signal);
    expect(skill.content).toContain("Full-Output Enforcement");
    expect(other.content).toBe("base");
    expect(seen).toEqual(["read_file"]);
  });
});

describe("the standing instruction", () => {
  it("points at the tool and keeps the project's own stack", () => {
    const line = builtinSkillGuidance(true) ?? "";
    expect(line).toContain(BUILTIN_SKILL_TOOL_NAME);
    expect(line).toContain("design-taste-frontend");
    expect(line).toMatch(/plain HTML, CSS and JavaScript project stays plain/);
    expect(builtinSkillGuidance(false)).toBeNull();
  });
});

describe("vendoring", () => {
  const upstream = [
    "---",
    "name: design-taste-frontend",
    "description: A fixture.",
    "---",
    "",
    "# Title",
    "",
    "Intro line.",
    "",
    ...["0. READ", "1. DIALS", "2. MAP", "3. STACK", "4. RULES", "9. TELLS", "13. OUT", "14. CHECK"].flatMap((heading) => [
      `## ${heading}`,
      `Body of ${heading}.`,
      "",
      "---",
      "",
    ]),
    "# APPENDICES - Reference",
    "Appendix body.",
  ].join("\n");

  it("keeps the core sections in SKILL.md, moves the rest to indexed references, and loses no line", () => {
    const files = splitDesignSkill(upstream);
    const skill = files["SKILL.md"]!;
    expect(skill.startsWith("---\nname: design-taste-frontend\n")).toBe(true);
    for (const kept of ["0. READ", "1. DIALS", "3. STACK", "9. TELLS", "13. OUT", "14. CHECK"]) expect(skill).toContain(`## ${kept}`);
    expect(skill).not.toContain("Body of 4. RULES");
    expect(Object.keys(files).sort()).toEqual(["SKILL.md", "references/02-map.md", "references/04-rules.md", "references/appendices.md"]);
    expect(skill).toContain("`references/04-rules.md`");
    const everything = Object.values(files).join("\n");
    for (const line of upstream.split("\n").filter((one) => one.trim().length > 0 && one !== "---")) expect(everything).toContain(line);
  });
});
