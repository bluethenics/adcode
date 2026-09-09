#!/usr/bin/env node
/**
 * Refuse a release the terminal install scripts cannot serve.
 *
 * ADCode installs only from a terminal: `install.ps1` picks a `*.exe` out of the latest
 * GitHub release, `install.sh` picks a `.deb` or `.AppImage`. The exact filenames below
 * are what `electron-builder.yml` produces through `artifactName` templates whose
 * `${arch}` token resolves differently per target. When the two drift apart the build
 * still succeeds, the release still publishes, and the install command finds nothing.
 *
 * So this checks the built output carries the exact names the install scripts will look
 * for, and exits non-zero if it cannot. macOS is advertised as coming soon, so its
 * absence is not a failure.
 *
 *   node scripts/check-release-assets.mjs <directory>
 *   node scripts/check-release-assets.mjs --platform linux <directory>
 *
 * The asset table lives in `packages/release/src/downloadAssets.ts` so it is tested
 * without a filesystem; this is the shell that reads the disk.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
  ALL_TERMINAL_ASSETS,
  missingFrom,
  TERMINAL_REQUIRED_ASSETS,
} from "../packages/release/src/downloadAssets.ts";

const ROOT = join(import.meta.dirname, "..");

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

if (only !== undefined && !(only in TERMINAL_REQUIRED_ASSETS)) {
  process.stderr.write(`Unknown platform: ${only}\n`);
  process.exit(1);
}

const wanted = only === undefined ? ALL_TERMINAL_ASSETS : TERMINAL_REQUIRED_ASSETS[only];

if (wanted.length === 0) {
  process.stdout.write(
    only === undefined
      ? "No installers required; nothing to check.\n"
      : `${only} is not published yet; nothing to check.\n`,
  );
  process.exit(0);
}

const present = readdirSync(directory);
const missing = missingFrom(present, wanted);

if (missing.length > 0) {
  process.stderr.write(
    `These assets are missing from ${directory}, and the terminal install scripts ask for them by exact name:\n` +
      missing.map((name) => `  - ${name}\n`).join("") +
      `\nWhat is there:\n` +
      present.map((name) => `  ${name}\n`).join(""),
  );
  process.exit(1);
}

process.stdout.write(`All ${wanted.length} required asset(s) present in ${directory}.\n`);
