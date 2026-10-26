#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { changelogSection, releaseVersion } from "../packages/release/src/releasePreparation.ts";

try {
  const root = join(import.meta.dirname, "..");
  const version = process.argv[2] ?? JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  releaseVersion(version);
  console.log(changelogSection(readFileSync(join(root, "CHANGELOG.md"), "utf8"), version));
} catch (error) { console.error(error.message); process.exitCode = 1; }
