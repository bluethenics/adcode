/**
 * Put the tree-sitter grammars where the renderer can load them.
 *
 * `tree-sitter-wasms` ships about forty languages and unpacks to 52 MB, which is not a
 * thing to put in an installer. This copies the chosen subset - and only that subset - into
 * the renderer's `public` directory, where Vite serves it at `/grammars/` and copies it
 * verbatim into the build output.
 *
 * The copies are generated, so they are gitignored rather than committed: 7 MB of binaries
 * in the history for files that npm already has is a bad trade.
 *
 * Run by the desktop build and dev scripts. Missing grammars are not an error - the
 * highlighter falls back to Monaco's own tokenizer, which is what happens today anyway.
 *
 * **The runtime version is pinned to the grammars, not the other way round.**
 * `tree-sitter-wasms` is built with tree-sitter-cli 0.20, which emits the legacy `dylink`
 * custom section. web-tree-sitter 0.26 requires `dylink.0` and rejects every one of these
 * grammars with "need dylink section" - a failure that looks like a broken file and is
 * really a version pair. 0.20.8 is the runtime that matches this grammar pack.
 */
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

const SOURCE = join(REPO, "node_modules", "tree-sitter-wasms", "out");
const RUNTIME = join(REPO, "node_modules", "web-tree-sitter", "tree-sitter.wasm");
const TARGET = join(REPO, "apps", "desktop", "src", "renderer", "public", "grammars");

/**
 * The languages worth the bytes.
 *
 * Chosen by what this editor's users actually open, weighed against size. C++ (4.5 MB) and
 * Objective-C (7.5 MB) are deliberately absent: together they are larger than everything
 * below put together, and Monaco's own tokenizer handles both acceptably.
 */
const LANGUAGES = [
  "typescript",
  "tsx",
  "javascript",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "css",
  "html",
  "json",
];

async function main() {
  await mkdir(TARGET, { recursive: true });

  let copied = 0;
  let bytes = 0;

  try {
    await cp(RUNTIME, join(TARGET, "tree-sitter.wasm"));
    bytes += (await stat(RUNTIME)).size;
  } catch {
    process.stdout.write("grammars: web-tree-sitter runtime not found; highlighting stays on Monaco\n");
    return;
  }

  let available;
  try {
    available = new Set(await readdir(SOURCE));
  } catch {
    process.stdout.write("grammars: tree-sitter-wasms not installed; skipping\n");
    return;
  }

  for (const language of LANGUAGES) {
    const name = `tree-sitter-${language}.wasm`;
    if (!available.has(name)) continue;

    const from = join(SOURCE, name);
    await cp(from, join(TARGET, name));
    bytes += (await stat(from)).size;
    copied += 1;
  }

  process.stdout.write(
    `grammars: ${String(copied)} of ${String(LANGUAGES.length)} copied, ${String(Math.round(bytes / 1024))} KB\n`,
  );
}

await main();
