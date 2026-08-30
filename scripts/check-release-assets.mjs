#!/usr/bin/env node
/**
 * Refuse a release the website cannot serve.
 *
 * `apps/web/src/app/dl/[platform]/route.ts` asks for five exact filenames.
 * `electron-builder.yml` produces them through `${arch}` templates that resolve
 * differently per target. When those drift apart the build still succeeds, the release
 * still publishes, and every download button returns 404.
 *
 * So this reads the expected names out of the route itself - the file that will do the
 * asking - and exits non-zero if the built output cannot answer it.
 *
 *   node scripts/check-release-assets.mjs <directory>
 *   node scripts/check-release-assets.mjs --platform macos <directory>
 *
 * The logic lives in `packages/release/src/downloadAssets.ts` so it can be tested without
 * a filesystem; this is the shell that reads the disk, the same split
 * `scripts/release-directory.mjs` already uses.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { expectedAssets, missingFrom } from "../packages/release/src/downloadAssets.ts";

const ROOT = join(import.meta.dirname, "..");
const ROUTE = join(ROOT, "apps", "web", "src", "app", "dl", "[platform]", "route.ts");

const args = process.argv.slice(2);
const platformAt = args.indexOf("--platform");
const only = platformAt === -1 ? null : args[platformAt + 1];
const directory = args.find((arg) => !arg.startsWith("--") && arg !== only) ?? "release";

try {
  statSync(directory);
} catch {
  process.stderr.write(`No such directory: ${directory}\n`);
  process.exit(1);
}

const assets = expectedAssets(readFileSync(ROUTE, "utf8"));
const wanted =
  only === null ? [...assets.values()] : [assets.get(only)].filter((name) => name !== undefined);

if (wanted.length === 0) {
  process.stderr.write(`Unknown platform: ${String(only)}\n`);
  process.exit(1);
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

process.stdout.write(`All ${wanted.length} expected asset(s) present in ${directory}.\n`);
