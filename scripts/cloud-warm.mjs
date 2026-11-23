#!/usr/bin/env node
/**
 * Asks the live site for every file the cloud build just uploaded, once, right after a deploy.
 *
 *   node scripts/cloud-warm.mjs https://web.bluethenics.com
 *
 * A file's very first request after a deploy can take most of a minute while Cloudflare fetches
 * it into its cache (23 Nov 2026: 38 s for the 2 MB renderer chunk, then under a second). The
 * first visitor's browser gave up on it and the app could not start. This makes that first
 * request ours. It warms the edge this machine reaches; others warm on their own first request,
 * which the page now survives by reloading once (apps/desktop/src/web/boot.ts).
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const origin = (process.argv[2] ?? "https://web.bluethenics.com").replace(/\/$/, "");
// The live preview's own files are served only on its own origin (apps/cloud router.ts).
const previewOrigin = origin.replace("://", "://preview.");
const onPreviewOrigin = (path) => path === "/preview-sw.js" || path.startsWith("/__preview/");
const root = fileURLToPath(new URL("../apps/cloud/public/", import.meta.url));

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

// The page's own code first: those are what a visitor waits on. Maps are for debuggers.
const paths = files(root)
  .map((path) => `/${relative(root, path).split("\\").join("/")}`)
  .filter((path) => !path.endsWith(".map") && !path.startsWith("/grammars/"))
  .sort((a, b) => Number(b.endsWith(".js")) - Number(a.endsWith(".js")));

let failed = 0;
const slow = [];
const queue = [...paths];
async function worker() {
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    const started = Date.now();
    try {
      const response = await fetch((onPreviewOrigin(path) ? previewOrigin : origin) + path, { signal: AbortSignal.timeout(120_000) });
      await response.arrayBuffer();
      if (!response.ok) { failed += 1; console.log(`${response.status} ${path}`); }
    } catch (error) {
      failed += 1;
      console.log(`failed ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const took = Date.now() - started;
    if (took > 3_000) slow.push(`${path} ${(took / 1000).toFixed(1)} s`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`[cloud:warm] ${paths.length - failed}/${paths.length} files from ${origin}${slow.length > 0 ? `; slow first requests: ${slow.join(", ")}` : ""}`);
process.exit(failed === 0 ? 0 : 1);
