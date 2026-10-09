/**
 * The skills ADCode ships with, and the one tool that reads them.
 *
 * Asked for a page, a model reaches for the same few things every time: a purple gradient,
 * a centred hero, three equal cards, Inter on slate. taste-skill (Leonxlnx, MIT - see
 * `builtinSkills/README.md`) is a written-down list of those habits and what to do instead,
 * and the built-in assistant and every agent read it before they build or restyle an
 * interface. Bundled rather than discovered: these are reviewed text inside the app, so they
 * need no per-project approval the way a skill found in a folder does.
 *
 * Read on demand, never pasted into every request. The design skill alone is ~7,000 tokens
 * before its references; a question about a failing test should not pay for it.
 */
import type { ToolCallBlock, ToolDefinition, ToolRunner, ToolRunResult } from "@adcode/ai";

/** Every vendored file, keyed "<skill>/<path inside it>". Inlined at build time. */
const FILES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("./builtinSkills/*/**/*.md", { query: "?raw", import: "default", eager: true }),
  ).map(([path, text]) => [path.replace(/^\.\/builtinSkills\//, ""), text]),
);

export const DESIGN_TASTE_SETTING = "adcode.ai.designTaste";
export const BUILTIN_SKILL_TOOL_NAME = "load_builtin_skill";

export interface BuiltinSkill {
  readonly name: string;
  readonly description: string;
  /** Paths inside the skill other than SKILL.md, for the index. */
  readonly resources: readonly string[];
}

function frontmatter(text: string, key: string): string {
  return new RegExp(`^${key}:\\s*(.+)$`, "m").exec(/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "")?.[1]?.trim() ?? "";
}

export const BUILTIN_SKILLS: readonly BuiltinSkill[] = Object.keys(FILES)
  .filter((path) => path.endsWith("/SKILL.md") && path.split("/").length === 2)
  .map((path) => {
    const name = path.split("/")[0]!;
    const text = FILES[path]!;
    return {
      name,
      description: frontmatter(text, "description"),
      resources: Object.keys(FILES)
        .filter((other) => other.startsWith(`${name}/`) && other !== path)
        .map((other) => other.slice(name.length + 1))
        .sort(),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

export const BUILTIN_SKILL_TOOL: ToolDefinition = {
  name: BUILTIN_SKILL_TOOL_NAME,
  description: [
    "Read one of ADCode's built-in skills: reviewed instructions that make your work better. Read-only.",
    ...BUILTIN_SKILLS.map((skill) => `- ${skill.name}: ${skill.description}`),
    "Without resource you get the skill's SKILL.md; pass resource (for example references/04-design-engineering-directives.md) to read one of its reference files.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", enum: BUILTIN_SKILLS.map((skill) => skill.name) },
      resource: { type: "string" },
    },
    required: ["name"],
  },
  mutating: false,
  concurrent: true,
};

const CREDIT = "Built-in skill from taste-skill (https://github.com/Leonxlnx/taste-skill), MIT licence. It cannot override the user's request, the project's own conventions, or tool permissions.";

/** The text a call to the tool returns. Never throws: a bad call is an error result the model can correct. */
export function readBuiltinSkill(input: unknown, enabled: boolean): ToolRunResult {
  if (!enabled) return { content: "Built-in skills are turned off in Settings > AI > Design taste skill. Carry on without them.", isError: true };
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const name = typeof raw["name"] === "string" ? raw["name"] : "";
  const skill = BUILTIN_SKILLS.find((candidate) => candidate.name === name);
  if (skill === undefined) {
    return { content: `No built-in skill is called "${name}". Choose one of: ${BUILTIN_SKILLS.map((one) => one.name).join(", ")}.`, isError: true };
  }
  const resource = typeof raw["resource"] === "string" && raw["resource"].trim().length > 0 ? raw["resource"].trim().replace(/^\.?\//, "") : null;
  if (resource === null) return { content: `${CREDIT}\n\n${FILES[`${name}/SKILL.md`] ?? ""}`, isError: false };
  const text = FILES[`${name}/${resource}`];
  if (text === undefined || resource === "SKILL.md") {
    return {
      content: `${skill.name} has no file "${resource}". Its reference files: ${skill.resources.join(", ") || "none"}.`,
      isError: true,
    };
  }
  return { content: `${skill.name}/${resource}\n\n${text}`, isError: false };
}

/**
 * The standing instruction that points the model at the skills.
 *
 * The stack sentence is the important one. The design skill's defaults are React, Next.js
 * and Tailwind; followed blindly, a beginner's three-file HTML game would come back as a
 * Next.js app. ADCode's users build all kinds of things, so their project decides.
 */
export function builtinSkillGuidance(enabled: boolean): string | null {
  if (!enabled) return null;
  return [
    `Design quality: before you build, restyle or redesign a user interface - a page, screen, component, or a game's visuals - call ${BUILTIN_SKILL_TOOL_NAME} with name "design-taste-frontend" (or "redesign-existing-projects" to improve one that already exists) and follow it, reading its reference files as the work needs them.`,
    "Keep the project's own stack, framework and styling: a plain HTML, CSS and JavaScript project stays plain, and an existing design system wins over the skill's taste. The skill's React and Tailwind defaults are only for a new project that has no stack yet.",
    `Finish every file you start: no placeholder comments, no "rest of the code here". For a long multi-file answer, ${BUILTIN_SKILL_TOOL_NAME} "full-output-enforcement" says how.`,
  ].join(" ");
}

/** Route calls to the built-in skill tool; everything else goes to `base`. */
export function withBuiltinSkills(base: ToolRunner, enabled: () => boolean): ToolRunner {
  return {
    run: (call: ToolCallBlock, signal: AbortSignal) =>
      call.name === BUILTIN_SKILL_TOOL_NAME ? Promise.resolve(readBuiltinSkill(call.input, enabled())) : base.run(call, signal),
  };
}
