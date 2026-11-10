#!/usr/bin/env node
/**
 * The artifact live room's acceptance check.
 *
 * Runs the pure rules, the Durable Object and the HTTP surface against real in-memory
 * SQLite. One command, and a non-zero exit when any part of sharing or live collaboration
 * stops behaving.
 */
import { spawnSync } from "node:child_process";

const tests = [
  "packages/collab/test/artifactRoom.test.ts",
  "apps/collab-relay/test/artifactRoom.test.ts",
  "apps/collab-relay/test/community.test.ts",
];

console.log("Artifact live room: rules, Durable Object and HTTP");
const result = spawnSync("npx", ["vitest", "run", ...tests, "--maxWorkers", "4"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
