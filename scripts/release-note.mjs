#!/usr/bin/env node
/**
 * Turn a range of commits into a draft release note.
 *
 * This is the path an agent takes. A tool - this script, Claude, anything holding the
 * token - can write a note, and what it writes is **always a draft**. The server enforces
 * that rather than trusting the caller: `POST /v1/releases/draft` sets `status: "draft"`
 * whatever the body says. A person opens the admin panel, reads it, edits it, and decides
 * whether it is worth telling anybody about. Nothing written here can reach a user.
 *
 * That split is the whole design. Generated prose is fine for a first pass over sixty
 * commits and completely unfit to be the thing that interrupts somebody's afternoon.
 *
 * Usage:
 *
 *   node scripts/release-note.mjs --dry-run              # print what it would send
 *   node scripts/release-note.mjs                        # draft for the package version
 *   node scripts/release-note.mjs --version 0.3.0 --since v0.2.0
 *
 * Environment:
 *
 *   ADCODE_AGENT_TOKEN   the shared secret the API checks. Required unless --dry-run.
 *   ADCODE_API_ORIGIN    defaults to the production API.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DEFAULT_ORIGIN = "https://adcode.bluethenics01.workers.dev";

/**
 * Conventional-commit types, and what each is called in a note somebody reads.
 *
 * The order is the order they appear in. Features first because that is what a reader is
 * looking for; chores are absent entirely, because "bumped a dependency" has never been
 * worth anybody's attention.
 */
const SECTIONS = [
  { type: "feat", heading: "New" },
  { type: "fix", heading: "Fixed" },
  { type: "perf", heading: "Faster" },
];

function argv(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  return value === undefined || value.startsWith("--") ? true : value;
}

function git(...args) {
  // stderr piped rather than inherited: `git describe` on a repository with no tags yet
  // prints "fatal: No names found", which is a case handled below and not worth showing.
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** The last tag, or the repository's first commit when there are no tags yet. */
function defaultSince() {
  try {
    return git("describe", "--tags", "--abbrev=0");
  } catch {
    return git("rev-list", "--max-parents=0", "HEAD").split("\n")[0];
  }
}

/**
 * Commits in the range, parsed into `{ type, scope, subject }`.
 *
 * Merge commits are dropped: on a squash-merge workflow they duplicate what is already
 * there, and on a merge workflow they say "Merge pull request #12", which is not a
 * sentence anybody wants in a release note.
 */
function commits(since) {
  const raw = git("log", `${since}..HEAD`, "--no-merges", "--pretty=format:%s");
  if (raw.length === 0) return [];

  return raw.split("\n").map((subject) => {
    const match = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/.exec(subject);
    if (match === null) return { type: "other", scope: null, subject };
    return { type: match[1], scope: match[2] ?? null, subject: match[3] };
  });
}

/** Sentence case, and no trailing full stop - the note's own formatting supplies that. */
const tidy = (subject) =>
  subject.charAt(0).toUpperCase() + subject.slice(1).replace(/\.$/, "");

function compose(parsed, version) {
  const bySection = SECTIONS.map((section) => ({
    heading: section.heading,
    lines: parsed.filter((one) => one.type === section.type).map((one) => tidy(one.subject)),
  })).filter((section) => section.lines.length > 0);

  const body = bySection
    .map((section) => `## ${section.heading}\n\n${section.lines.map((line) => `- ${line}`).join("\n")}`)
    .join("\n\n");

  /*
   * The first three features, or the first three fixes when there are no features. These
   * become the card in the editor, so three is the limit that reads well rather than an
   * arbitrary cap - a card with six bullets is a wall.
   */
  const highlights = (bySection[0]?.lines ?? []).slice(0, 3);

  const title = highlights[0] ?? `ADCode ${version}`;

  return { title, body, highlights };
}

async function main() {
  const dryRun = argv("dry-run") === true;
  const version =
    argv("version") ??
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  const since = argv("since") ?? defaultSince();

  const parsed = commits(since);

  if (parsed.length === 0) {
    console.log(`No commits between ${since} and HEAD. Nothing to draft.`);
    return;
  }

  const { title, body, highlights } = compose(parsed, version);

  const draft = {
    version,
    title,
    body,
    highlights,
    // Both false, always. A tool proposes; a person decides who gets interrupted, and
    // sending `announce: true` from a script would make that decision for them.
    announce: false,
    critical: false,
  };

  if (dryRun) {
    console.log(`${parsed.length} commits since ${since}\n`);
    console.log(JSON.stringify(draft, null, 2));
    return;
  }

  const token = process.env["ADCODE_AGENT_TOKEN"];
  if (token === undefined || token.length === 0) {
    console.error(
      "ADCODE_AGENT_TOKEN is not set. Run with --dry-run to see the note without sending it.",
    );
    process.exitCode = 1;
    return;
  }

  const origin = process.env["ADCODE_API_ORIGIN"] ?? DEFAULT_ORIGIN;
  const response = await fetch(`${origin}/v1/releases/draft`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(draft),
  });

  if (!response.ok) {
    console.error(`Draft rejected: ${String(response.status)} ${await response.text()}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Drafted ${version} from ${String(parsed.length)} commits since ${since}.\n` +
      `Nobody sees it yet. Open the admin panel under Releases to read it over and publish.`,
  );
}

await main();
