#!/usr/bin/env node
/**
 * Turn `packages/help` into the website's bundled documentation.
 *
 * Every feature in ADCode already carries an explanation - the text behind each `?` in
 * settings, and behind Help → ADCode Guide. This writes the same text into the marketing
 * site so `/docs` documents the whole product on day one, before an admin has written a
 * single page, and so a search engine or an answer engine has something to find.
 *
 * A generated file rather than an import. The website does not compile the desktop app's
 * packages: they reach for `@adcode/settings`, they assume this repository's `.ts`-suffixed
 * import style, and none of that belongs in a Next bundle. This is the same arrangement as
 * `packages/ai/src/catalogueSnapshot.ts` and it is committed for the same reason - the
 * output is reviewable, diffable, and needs no build step to be correct.
 *
 * `packages/help/test/docsSeed.test.ts` regenerates it and fails if the committed copy has
 * drifted, so the two cannot quietly disagree.
 *
 *   node scripts/docs-seed.mjs           # write the seed
 *   node scripts/docs-seed.mjs --check   # exit 1 if the committed copy is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "apps", "web", "src", "lib", "docsSeed.ts");

/**
 * Read a source file with its line endings normalised.
 *
 * Every pattern below is written against LF. On a Windows checkout with `core.autocrlf`
 * on, these files arrive with CRLF and each one silently matches nothing - which wrote an
 * empty seed rather than failing. The comparison at the bottom already normalised for the
 * same reason; the input needs it just as much.
 */
const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

/**
 * The help entries, read out of the source rather than imported.
 *
 * A regex over TypeScript is usually the wrong tool. It is the right one here because the
 * alternative is a build step that transpiles a package so a *content* file can be
 * generated, and because the shape being read is one this repository controls and a test
 * pins: entries are object literals with double-quoted string fields, and `packages/help`
 * has a test asserting every setting has one.
 */
function readEntries() {
  const dir = join(ROOT, "packages", "help", "src", "entries");
  const index = read(join(dir, "index.ts"));

  const files = [...index.matchAll(/from "\.\/([a-zA-Z]+)\.ts"/g)].map((m) => m[1]);
  const entries = [];

  for (const file of files) {
    const source = read(join(dir, `${file}.ts`));

    // Each entry is a `{ ... }` at one indent level inside the exported array.
    for (const block of source.matchAll(/\n  \{\n([\s\S]*?)\n  \},/g)) {
      const body = block[1];

      const field = (name) => {
        // `(?:^|\n)` rather than `\n`: the first field of a block has no newline before it.
        const match = new RegExp(`(?:^|\\n)\\s*${name}:\\s*\\n?\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(body);
        return match === null ? null : match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      };

      const list = (name) => {
        const match = new RegExp(`${name}:\\s*\\[([^\\]]*)\\]`).exec(body);
        if (match === null) return [];
        return [...match[1].matchAll(/"([^"]+)"/g)].map((one) => one[1]);
      };

      const id = field("id");
      const title = field("title");
      const plain = field("plain");
      const why = field("why");
      const how = field("how");
      const group = field("group");

      if (id === null || title === null || plain === null || why === null || how === null) {
        throw new Error(`entries/${file}.ts: an entry is missing a required field (id ${String(id)})`);
      }

      entries.push({
        id,
        title,
        plain,
        why,
        how,
        group: group ?? file,
        settingIds: list("settingIds"),
        related: list("related"),
        shortcut: field("shortcut"),
      });
    }
  }

  // Reading source with regexes fails by matching nothing, which looks exactly like a
  // package with no entries in it. Refuse to write an empty catalogue over a full one.
  if (entries.length === 0) {
    throw new Error(`no help entries found in ${dir} - the source shape has changed`);
  }

  return entries;
}

/** What each group is called on the website, and the order the sidebar shows them in. */
const GROUP_TITLES = {
  editing: "Editing",
  navigation: "Finding your way",
  formatting: "Formatting",
  structure: "Understanding a project",
  language: "Languages",
  ai: "The assistant",
  git: "Git",
  session: "Your session",
  workbench: "The workbench",
  appearance: "Appearance",
  ads: "Ads and earnings",
  updates: "Updates",
};

const ORDER = Object.keys(GROUP_TITLES);

/** A URL-safe slug from an entry id: `adcode.editing.formatOnSave` -> `editing-format-on-save`. */
function slugFor(id) {
  return id
    .replace(/^adcode\./, "")
    .replace(/\./g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const quote = (text) => JSON.stringify(text);

function render(entries) {
  const known = entries.filter((entry) => ORDER.includes(entry.group));
  const bySlug = new Map(known.map((entry) => [entry.id, slugFor(entry.id)]));

  const sorted = [...known].sort((a, b) => {
    const group = ORDER.indexOf(a.group) - ORDER.indexOf(b.group);
    return group !== 0 ? group : a.title.localeCompare(b.title);
  });

  const rows = sorted
    .map((entry) => {
      const related = entry.related
        .map((id) => bySlug.get(id))
        .filter((slug) => slug !== undefined);

      return `  {
    slug: ${quote(slugFor(entry.id))},
    title: ${quote(entry.title)},
    section: ${quote(GROUP_TITLES[entry.group])},
    description: ${quote(entry.plain)},
    why: ${quote(entry.why)},
    how: ${quote(entry.how)},${entry.shortcut === null ? "" : `\n    shortcut: ${quote(entry.shortcut)},`}
    related: [${related.map(quote).join(", ")}],
  },`;
    })
    .join("\n");

  const sections = ORDER.filter((group) => sorted.some((entry) => entry.group === group))
    .map((group) => `  ${quote(GROUP_TITLES[group])},`)
    .join("\n");

  return `/**
 * Every feature ADCode has, explained.
 *
 * GENERATED by \`node scripts/docs-seed.mjs\` from \`packages/help\` - the same text that sits
 * behind each \`?\` in the editor's settings and behind Help → ADCode Guide. Do not edit this
 * file; edit the help entries and regenerate. \`packages/help/test/docsSeed.test.ts\` fails if
 * the two drift apart.
 *
 * It exists so \`/docs\` documents the whole product before an admin has written anything,
 * and so there is one description of each feature rather than two that disagree.
 */

export interface DocSeed {
  readonly slug: string;
  readonly title: string;
  readonly section: string;
  /** One sentence, plain enough for a child. */
  readonly description: string;
  readonly why: string;
  readonly how: string;
  readonly shortcut?: string;
  readonly related: readonly string[];
}

/** The sidebar order. Editing first, settings-shaped groups last. */
export const DOC_SECTIONS: readonly string[] = [
${sections}
];

export const DOC_SEED: readonly DocSeed[] = [
${rows}
];
`;
}

const rendered = render(readEntries());

if (process.argv.includes("--check")) {
  let existing = "";
  try {
    existing = readFileSync(OUT, "utf8");
  } catch {
    existing = "";
  }

  if (existing.replace(/\r\n/g, "\n") !== rendered) {
    console.error("apps/web/src/lib/docsSeed.ts is stale. Run: node scripts/docs-seed.mjs");
    process.exitCode = 1;
  } else {
    console.log("docsSeed.ts is up to date.");
  }
} else {
  writeFileSync(OUT, rendered, "utf8");
  console.log(`Wrote ${OUT}`);
}
