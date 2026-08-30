#!/usr/bin/env node
/**
 * Refuse a release the website cannot serve.
 *
 * `apps/web/src/lib/downloads.ts` names the exact filename each download resolves to.
 * `electron-builder.yml` produces those names through `artifactName` templates whose
 * `${arch}` token resolves differently per target. When the two drift apart the build
 * still succeeds, the release still publishes, and every download returns 404.
 *
 * So this reads the expected names out of the file the site itself reads, and exits
 * non-zero if the built output cannot answer it. Platforms marked `available: false` are
 * advertised as coming soon and not linked, so their absence is not a failure.
 *
 *   node scripts/check-release-assets.mjs <directory>
 *   node scripts/check-release-assets.mjs --platform linux <directory>
 *
 * The parsing lives in `packages/release/src/downloadAssets.ts` so it is tested without a
 * filesystem; this is the shell that reads the disk.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
  missingFrom,
  parseDownloads,
  requiredAssets,
} from "../packages/release/src/downloadAssets.ts";

const ROOT = join(import.meta.dirname, "..");
const SOURCE = join(ROOT, "apps", "web", "src", "lib", "downloads.ts");

const args = process.argv.slice(2);
const platformAt = args.indexOf("--platform");
const only = platformAt === -1 ? undefined : args[platformAt + 1];
const directory = args.find((arg) => !arg.startsWith("--") && arg !== only) ?? "release";

try {
  statSync(directory);
} catch {
  process.stderr.write(`No such directory: ${directory}\n`);
  process.exit(1);
}

const targets = parseDownloads(readFileSync(SOURCE, "utf8"));

if (only !== undefined && !targets.some((target) => target.id === only)) {
  process.stderr.write(`Unknown platform: ${only}\n`);
  process.exit(1);
}

const wanted = requiredAssets(targets, only);

if (wanted.length === 0) {
  process.stdout.write(
    only === undefined
      ? "No downloads are marked available; nothing to check.\n"
      : `${only} is not published yet (available: false); nothing to check.\n`,
  );
  process.exit(0);
}

const present = readdirSync(directory);
const missing = missingFrom(present, wanted);

if (missing.length > 0) {
  process.stderr.write(
    `These assets are missing from ${directory}, and the website asks for them by exact name:\n` +
      missing.map((name) => `  - ${name}\n`).join("") +
      `\nWhat is there:\n` +
      present.map((name) => `  ${name}\n`).join(""),
  );
  process.exit(1);
}

process.stdout.write(`All ${wanted.length} required asset(s) present in ${directory}.\n`);
