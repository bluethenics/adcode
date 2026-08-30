#!/usr/bin/env node
/**
 * Turn `packages/help` into the website's bundled documentation.
 *
 * Every feature in ADCode already carries an explanation - the text behind each `?` in
 * settings, and behind Help → Feature Guide. This writes the same text into the marketing
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
const GUIDE_OUT = join(ROOT, "docs", "features", "complete-feature-guide.md");

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

/**
 * Read direct command routes and extra search language that cannot be inferred from a
 * setting. The deliberately small literal in `features.ts` also powers the desktop.
 */
function readMetadata() {
  const source = read(join(ROOT, "packages", "help", "src", "features.ts"));
  const result = new Map();

  for (const block of source.matchAll(/\n  "([^"]+)": \{\n([\s\S]*?)\n  \},/g)) {
    const id = block[1];
    const body = block[2];
    const actions = [...body.matchAll(/command\("([^"]+)", "([^"]+)"\)/g)].map((match) => ({
      command: match[1],
      label: match[2],
    }));
    const keywordsBlock = /keywords:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? "";
    const keywords = [...keywordsBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    result.set(id, { actions, keywords });
  }

  return result;
}

/**
 * Which settings are a plain on/off switch.
 *
 * `features.ts` turns every boolean setting into a "Turn on or off" action so a reader can
 * flip it where they found it. That route belongs in the docs too, and the only way to tell
 * a boolean from an enum here is to read the schema the same way everything else in this
 * file reads source - by regex, over a shape this repository controls and a test pins.
 */
function readBooleanSettings() {
  const source = read(join(ROOT, "packages", "settings", "src", "index.ts"));
  const ids = new Set([...source.matchAll(/(?:^|[^a-zA-Z])bool\(\s*"([^"]+)"/g)].map((match) => match[1]));

  if (ids.size === 0) {
    throw new Error("no boolean settings found in packages/settings - the source shape has changed");
  }

  return ids;
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
  account: "Account",
  gestures: "Files and gestures",
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

const unique = (items) => [...new Set(items)];

function accessFor(entry, metadata, booleanSettings) {
  return unique([
    `All Features → ${entry.title}`,
    ...metadata.actions.map((action) => `${action.label} (command:${action.command})`),
    ...entry.settingIds
      .filter((settingId) => booleanSettings.has(settingId))
      .map((settingId) => `Turn on or off (setting:${settingId})`),
    ...entry.settingIds.map((settingId) => `Settings → ${settingId}`),
    ...(entry.shortcut === null ? [] : [`Keyboard → ${entry.shortcut}`]),
  ]);
}

function render(entries, metadataById, booleanSettings) {
  const known = entries.filter((entry) => ORDER.includes(entry.group));
  const bySlug = new Map(known.map((entry) => [entry.id, slugFor(entry.id)]));

  const sorted = [...known].sort((a, b) => {
    const group = ORDER.indexOf(a.group) - ORDER.indexOf(b.group);
    return group !== 0 ? group : a.title.localeCompare(b.title);
  });

  const rows = sorted
    .map((entry) => {
      const metadata = metadataById.get(entry.id) ?? { actions: [], keywords: [] };
      const related = entry.related
        .map((id) => bySlug.get(id))
        .filter((slug) => slug !== undefined);
      const keywords = unique([entry.title, GROUP_TITLES[entry.group], ...metadata.keywords]);
      const access = accessFor(entry, metadata, booleanSettings);

      return `  {
    slug: ${quote(slugFor(entry.id))},
    title: ${quote(entry.title)},
    section: ${quote(GROUP_TITLES[entry.group])},
    description: ${quote(entry.plain)},
    why: ${quote(entry.why)},
    how: ${quote(entry.how)},${entry.shortcut === null ? "" : `\n    shortcut: ${quote(entry.shortcut)},`}
    keywords: [${keywords.map(quote).join(", ")}],
    access: [${access.map(quote).join(", ")}],
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
 * behind each \`?\` in the editor's settings and behind Help → Feature Guide. Do not edit this
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
  /** Terms accepted by the desktop Universal Search for this feature. */
  readonly keywords: readonly string[];
  /** Safe routes a person can use to reach the feature. */
  readonly access: readonly string[];
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

function guideShortcut(shortcut) {
  return shortcut.replaceAll("CmdOrCtrl", "Ctrl/Cmd");
}

function renderGuide(entries, metadataById, booleanSettings) {
  const sorted = [...entries].sort((a, b) => {
    const group = ORDER.indexOf(a.group) - ORDER.indexOf(b.group);
    return group !== 0 ? group : a.title.localeCompare(b.title);
  });

  const inventory = ORDER.filter((group) => sorted.some((entry) => entry.group === group))
    .map((group) => {
      const features = sorted
        .filter((entry) => entry.group === group)
        .map((entry) => {
          const metadata = metadataById.get(entry.id) ?? { actions: [], keywords: [] };
          const routes = accessFor(entry, metadata, booleanSettings);
          return `<!-- feature:${entry.id} -->
### ${entry.title}

${entry.plain}

Why use it: ${entry.why}

How to use it: ${entry.how}

Access: ${routes.map((route) => `\`${route}\``).join("; ")}.
`;
        })
        .join("\n");
      return `## ${GROUP_TITLES[group]}\n\n${features}`;
    })
    .join("\n");

  const shortcuts = entries
    .filter((entry) => entry.shortcut !== null)
    .map((entry) => `- ${entry.title}: \`${guideShortcut(entry.shortcut)}\``)
    .join("\n");

  return `# Complete ADCode feature guide

This guide is the human-readable inventory behind ADCode's **All Features** library. The
same catalogue also powers the title-bar Universal Search, the Help → Feature Guide, menu
routes, and the website docs. It is generated from \`packages/help\`; edit that catalogue
and run \`node scripts/docs-seed.mjs\` rather than letting these surfaces drift apart.

## Find and open anything

- Open **All Features** with the four-cell icon below Earnings, with **View → All
  Features**, or by running \`command:features.open\`.
- Use the title-bar **Universal Search** or \`command:search.universal\` when you know what
  you want but not where it lives. It searches features, commands, files, recent projects,
  and workspace symbols. Start with \`>\` to favour commands.
- Use **Quick Open** (\`Ctrl+P\`) when you only want a file.
- Use the **Command Palette** (\`Ctrl+Shift+P\`) when you only want a command.
- Use **Symbol Search** (\`Ctrl+T\`) when you only want a function, class, or symbol.
- Use project **Content Search** (\`Ctrl+Shift+F\`) when you want text inside files.

Search results are grouped by kind and arrive progressively. A failed symbol or recent-file
provider does not prevent local feature and command results from opening. A newer query
always replaces an older one, so stale asynchronous results cannot take over the panel.

## Use the Feature Library

1. Open **All Features** using the icon, View menu, Feature Guide, or Universal Search.
2. Type a goal such as “multiple AI”, “format on save”, or “preview phone”.
3. Filter by category if you want to browse instead of search.
4. Select **Open**, **Search**, **Connect**, **Schedule**, or the setting route shown on the
   card. The library dispatches only registered ADCode commands and known settings.
5. Select the \`?\` explanation for **What it does**, **Why use it**, and **How to use it**.

## AI work without giving up normal coding

AI features are optional. Files, menus, editor shortcuts, terminals, source control,
debugging, and extensions continue to work normally without connecting a model.

- **Isolated mode** gives an AI task a separate Git-backed workspace. Review the diff and
  apply it when ready; discard it to roll back without touching the working project.
- **Team** can divide one goal among multiple AI roles. ADCode shows the shared goal,
  ownership, trace, token use, and each proposed change instead of hiding parallel work.
- **Trusted mode** permits broader automated edits for a workspace you trust. You can turn
  it off at any time; it does not remove the review, history, or rollback path.
- **Scheduled messages** are delivered only while ADCode is open. Built-in chat is always
  supported; terminal delivery requires a visibly waiting compatible agent and a one-time
  permission. Missed one-time messages wait for you to choose **Run now**.
- **Auto-continuation** resumes a paused supported agent only under the configured limits.
  It never bypasses provider usage limits, token budgets, approvals, or a closed ADCode
  window.
- **Trace and review** show requests, tool activity, file changes, costs, pauses, and errors.
  Secrets stay in the operating system credential store and the user decides what is
  applied to the real project.

Read [AI workspaces and automation](./ai-workspaces.md) for the end-to-end workflow and
[AI workspace security](../architecture/ai-workspace-security.md) for the trust boundary,
privacy rules, validation, and rollback guarantees.

## Keyboard routes

On macOS, use Command where a shortcut below says Ctrl.

${shortcuts}

# Feature inventory

Every item below is also a searchable card in **All Features**. Command identifiers are
included for automation, keyboard customization, and troubleshooting; most people can use
the matching menu or button.

${inventory}`;
}

const entries = readEntries();
const metadata = readMetadata();
const booleanSettings = readBooleanSettings();
const rendered = render(entries, metadata, booleanSettings);
const renderedGuide = renderGuide(entries, metadata, booleanSettings);

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

  let existingGuide = "";
  try {
    existingGuide = readFileSync(GUIDE_OUT, "utf8");
  } catch {
    existingGuide = "";
  }

  if (existingGuide.replace(/\r\n/g, "\n") !== renderedGuide) {
    console.error("docs/features/complete-feature-guide.md is stale. Run: node scripts/docs-seed.mjs");
    process.exitCode = 1;
  } else {
    console.log("complete-feature-guide.md is up to date.");
  }
} else {
  writeFileSync(OUT, rendered, "utf8");
  writeFileSync(GUIDE_OUT, renderedGuide, "utf8");
  console.log(`Wrote ${OUT}`);
  console.log(`Wrote ${GUIDE_OUT}`);
}
