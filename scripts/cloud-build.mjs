/*
 * Builds everything web.bluethenics.com deploys:
 *
 *   apps/cloud/public          - the page (the desktop renderer, booted by src/web/boot.ts)
 *   apps/cloud/public/phone    - ADCode Remote, the Phone link page (src/phone)
 *   apps/cloud/container/host  - adcode-host, copied into the sandbox image by its Dockerfile
 *
 *   npm run cloud:build            production page
 *   npm run cloud:build -- --dev   page with the development sign-in, for `wrangler dev` only
 *
 * Firebase's public web settings come from ADCODE_FIREBASE_* or apps/web/.env.production.
 */
import { spawnSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));
const vite = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const dev = process.argv.includes("--dev");

function run(args) {
  const result = spawnSync(process.execPath, [vite, ...args], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// A clean checkout must ship syntax grammars too; stale local assets cannot hide omissions.
const grammars = spawnSync(process.execPath, [join(REPO, "scripts/grammars.mjs"), "--strict"], { stdio: "inherit" });
if (grammars.status !== 0) process.exit(grammars.status ?? 1);

run(["build", "-c", "apps/desktop/vite.host.config.ts", "--logLevel", "warn"]);
run(["build", "-c", "apps/desktop/vite.web.config.ts", "--logLevel", "warn", "--mode", dev ? "development" : "production"]);
// After the web build, which empties apps/cloud/public: ADCode Remote, the Phone link page, at /phone.
run(["build", "-c", "apps/desktop/vite.phone.config.ts", "--logLevel", "warn", "--mode", dev ? "development" : "production"]);

const target = join(REPO, "apps/cloud/container/host");
rmSync(target, { recursive: true, force: true });
cpSync(join(REPO, "apps/desktop/out/host"), target, { recursive: true });

console.log(`[cloud:build] page -> apps/cloud/public (${dev ? "development" : "production"}), adcode-host -> apps/cloud/container/host`);
