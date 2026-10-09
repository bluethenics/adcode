/**
 * Vendor taste-skill (https://github.com/Leonxlnx/taste-skill, MIT) into the desktop app.
 *
 * The built-in assistant and every agent read these files before they build or restyle a
 * user interface (`apps/desktop/src/main/builtinSkills.ts`). They are copied, not fetched
 * at runtime: a skill that changes under a shipped app is a prompt nobody reviewed.
 *
 *   git clone --depth 1 https://github.com/Leonxlnx/taste-skill.git /tmp/taste-skill
 *   node scripts/vendor-taste-skill.mjs /tmp/taste-skill
 *
 * Three skills come across. Two verbatim. The third, the main design skill, is 87 KB in one
 * file - past the 64 KB a skill may be here, and about 22,000 tokens a model would pay on
 * every interface request. It is split along its own `## ` sections instead: the sections
 * that decide most outcomes (reading the brief, the dials, the stack, the AI tells, the
 * pre-flight check) stay in SKILL.md, and the rest become `references/` files the model
 * reads when the work needs them. Not a word of the upstream text is changed; SKILL.md
 * gains one index section saying where the rest went.
 *
 * Read what changed upstream before committing a re-run. These files go into prompts.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** Sections of the design skill kept in SKILL.md, by their number. */
const CORE_SECTIONS = new Set(["0", "1", "3", "9", "13", "14"]);

/** When a reference is worth reading, keyed by section number, for the index. */
const WHEN = {
  "2": "before choosing a design system or component library",
  "4": "before choosing type, colour, layout, cards, states or forms - the bulk of the bias corrections",
  "5": "before adding glass, magnetic, perpetual or scroll-driven motion",
  "6": "for animation performance, reduced motion, dark mode and Core Web Vitals",
  "7": "for the exact meaning of each dial level",
  "8": "before styling dark mode",
  "10": "for the names of layout, menu, card and motion patterns",
  "11": "before redesigning an existing site",
  "12": "for the block-library contract",
  appendices: "for install commands, canonical design-system docs and the glass approximation",
};

function slug(heading) {
  return heading
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Strip trailing horizontal rules and blank lines a section ends with. */
function trimSection(lines) {
  const out = [...lines];
  while (out.length > 0 && /^(---|\s*)$/.test(out[out.length - 1])) out.pop();
  return out;
}

/**
 * Split the design skill into SKILL.md plus references, keyed by output path.
 *
 * Exported for the test, which runs it against a small fixture rather than the real skill.
 */
export function splitDesignSkill(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const front = /^---\n[\s\S]*?\n---\n/.exec(lines.join("\n"));
  if (front === null) throw new Error("The design skill has no frontmatter.");
  const frontLines = front[0].trimEnd().split("\n");

  const chunks = [];
  let current = { key: "intro", heading: "", lines: [] };
  for (const line of lines.slice(frontLines.length)) {
    const section = /^## (\d+)\. (.+)$/.exec(line);
    const appendices = /^# APPENDICES\b/.test(line);
    if (section !== null || appendices) {
      chunks.push(current);
      current = section !== null
        ? { key: section[1], heading: line.slice(3), lines: [line] }
        : { key: "appendices", heading: line.slice(2), lines: [line] };
      continue;
    }
    current.lines.push(line);
  }
  chunks.push(current);

  const intro = chunks.find((chunk) => chunk.key === "intro");
  const core = chunks.filter((chunk) => CORE_SECTIONS.has(chunk.key));
  const references = chunks.filter((chunk) => chunk.key !== "intro" && !CORE_SECTIONS.has(chunk.key));
  if (core.length !== CORE_SECTIONS.size) throw new Error("The design skill's sections have changed; check CORE_SECTIONS.");

  const files = {};
  const index = [
    "## Reference files",
    "",
    "This copy is split so the core rules load first. The sections below are in `references/`; read one with the same tool, passing its path as the resource, when the work calls for it.",
    "",
  ];
  for (const chunk of references) {
    const name = chunk.key === "appendices" ? "appendices.md" : `${chunk.key.padStart(2, "0")}-${slug(chunk.heading.replace(/^\d+\.\s*/, ""))}.md`;
    files[`references/${name}`] = `${trimSection(chunk.lines).join("\n")}\n`;
    index.push(`- \`references/${name}\` - ${chunk.heading}: read ${WHEN[chunk.key] ?? "when the work calls for it"}.`);
  }

  const body = [
    ...frontLines,
    ...trimSection(intro.lines),
    "",
    ...index,
    "",
    "---",
    "",
    ...core.flatMap((chunk, position) => [...trimSection(chunk.lines), ...(position === core.length - 1 ? [] : ["", "---", ""])]),
  ];
  files["SKILL.md"] = `${body.join("\n")}\n`;
  return files;
}

function main() {
  const upstream = process.argv[2];
  if (upstream === undefined || !existsSync(join(upstream, "skills"))) {
    process.stderr.write("Usage: node scripts/vendor-taste-skill.mjs <path to a taste-skill checkout>\n");
    process.exit(1);
  }
  const root = process.cwd();
  const target = join(root, "apps", "desktop", "src", "main", "builtinSkills");
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // Not a git checkout: the README says so.
  }

  const write = (path, text) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text.replace(/\r\n/g, "\n"), "utf8");
  };

  rmSync(target, { recursive: true, force: true });
  const design = splitDesignSkill(readFileSync(join(upstream, "skills", "taste-skill", "SKILL.md"), "utf8"));
  for (const [path, text] of Object.entries(design)) write(join(target, "design-taste-frontend", path), text);
  write(join(target, "redesign-existing-projects", "SKILL.md"), readFileSync(join(upstream, "skills", "redesign-skill", "SKILL.md"), "utf8"));
  write(join(target, "full-output-enforcement", "SKILL.md"), readFileSync(join(upstream, "skills", "output-skill", "SKILL.md"), "utf8"));

  const licence = readFileSync(join(upstream, "LICENSE"), "utf8").trim();
  write(join(target, "LICENSE"), `${licence}\n`);
  write(
    join(target, "README.md"),
    [
      "# Built-in skills",
      "",
      "Vendored from [taste-skill](https://github.com/Leonxlnx/taste-skill) by Leonxlnx, MIT licence (`LICENSE`).",
      "",
      `Upstream commit: \`${commit}\``,
      "",
      "| Folder | Upstream file |",
      "|---|---|",
      "| `design-taste-frontend/` | `skills/taste-skill/SKILL.md`, split into SKILL.md and `references/` along its own sections; no upstream text changed |",
      "| `redesign-existing-projects/` | `skills/redesign-skill/SKILL.md`, verbatim |",
      "| `full-output-enforcement/` | `skills/output-skill/SKILL.md`, verbatim |",
      "",
      "Regenerate with `node scripts/vendor-taste-skill.mjs <checkout>`, then read the diff: these files become prompts.",
      "",
    ].join("\n"),
  );
  write(
    join(root, "scripts", "notices", "taste-skill.txt"),
    [
      "taste-skill (vendored design guidance)",
      "https://github.com/Leonxlnx/taste-skill",
      `Commit ${commit}`,
      "",
      "ADCode's assistants read these files before building a user interface. Licence:",
      "",
      licence,
    ].join("\n") + "\n",
  );
  process.stdout.write(`Vendored taste-skill ${commit.slice(0, 12)} -> ${target}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
