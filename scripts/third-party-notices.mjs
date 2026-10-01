/**
 * `THIRD-PARTY-NOTICES.txt` - the licences of everything the desktop app bundles.
 *
 * `apps/desktop/package.json` lists one production dependency, node-pty, because everything
 * else is bundled by electron-vite out of devDependencies. So the manifest cannot say what
 * ships. The source can: every bare import under `apps/desktop/src` and `packages/*\/src` is
 * a package that ends up in the installer, and its `dependencies` come with it.
 *
 * Electron and Chromium are not listed here. electron-builder already ships
 * `LICENSE.electron.txt` and `LICENSES.chromium.html` beside the executable.
 *
 * Run by `scripts/package.mjs` and `scripts/package-store.mjs` before electron-builder, and
 * by hand with `node scripts/third-party-notices.mjs`.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const BUILTINS = new Set(builtinModules);

/** The package a specifier belongs to, or null when it is not a third-party package. */
export function packageNameOf(specifier) {
  const clean = specifier.split("?")[0];
  if (clean.length === 0 || clean.startsWith(".") || clean.startsWith("/")) return null;
  if (clean.startsWith("node:")) return null;

  const parts = clean.split("/");
  if (clean.startsWith("@") && parts.length < 2) return null;
  const name = clean.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];

  if (name.startsWith("@adcode/")) return null;
  if (name === "electron") return null;
  if (BUILTINS.has(name) || BUILTINS.has(clean)) return null;
  return name;
}

/** Every specifier a source file imports that could pull code into the bundle. */
export function bareImports(source) {
  const found = new Set();
  const patterns = [
    // import x from "y", export { x } from "y" - but not `import type` / `export type`.
    // Newlines are allowed between the keyword and `from`: most imports here span lines.
    /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^"';]*?\bfrom\s*["']([^"']+)["']/g,
    // import "y"
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    // import("y") and require("y")
    /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

/** The licence a manifest declares, whichever of the three shapes it uses. */
export function licenceOf(manifest) {
  const { license, licenses } = manifest;
  if (typeof license === "string" && license.length > 0) return license;
  if (typeof license === "object" && license !== null && typeof license.type === "string") {
    return license.type;
  }
  if (Array.isArray(licenses)) {
    const types = licenses
      .map((one) => (typeof one === "object" && one !== null ? one.type : one))
      .filter((type) => typeof type === "string");
    if (types.length > 0) return types.join(" OR ");
  }
  return "UNKNOWN";
}

const RULE = "=".repeat(78);

export function renderNotices(packages) {
  const sorted = [...packages].sort((a, b) => a.name.localeCompare(b.name));
  const head = [
    "ADCode - third-party notices",
    "",
    "ADCode bundles the open-source packages listed below. Each is the work of its own",
    "authors and is distributed under its own licence, reproduced here.",
    "",
    "Electron and Chromium are distributed with their own notices, beside the ADCode",
    "executable: LICENSE.electron.txt and LICENSES.chromium.html.",
    "",
    `${String(sorted.length)} packages.`,
    "",
  ];
  const body = sorted.flatMap((one) => [
    RULE,
    `${one.name}@${one.version}`,
    `Licence: ${one.licence}`,
    RULE,
    "",
    one.text === null
      ? "(This package ships no licence file. The licence above is the one it declares.)"
      : one.text.trim(),
    "",
  ]);
  return [...head, ...body].join("\n");
}

function sourceFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "out" || name === "test") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|mts|js|mjs|css)$/.test(name)) out.push(path);
  }
  return out;
}

/**
 * A package's licence, followed by any third-party notices it carries beside it.
 *
 * The second half matters. monaco-editor compiles TypeScript, marked and others into the
 * files that ship, and credits them in `ThirdPartyNotices.txt`, not in its LICENSE - so
 * reproducing the LICENSE alone would drop attributions the installer is obliged to carry.
 */
function licenceText(dir) {
  const names = readdirSync(dir);
  const licence = names.find((name) => /^(licen[sc]e|copying)(\.|-|$)/i.test(name));
  const notices = names.filter(
    (name) => name !== licence && /^(third[-_ ]?party[-_ ]?notices?|notices?)(\.|$)/i.test(name),
  );
  const parts = [
    ...(licence === undefined ? [] : [readFileSync(join(dir, licence), "utf8").trim()]),
    ...notices.map((name) => `--- ${name} ---\n\n${readFileSync(join(dir, name), "utf8").trim()}`),
  ];
  return parts.length === 0 ? null : parts.join("\n\n");
}

/**
 * Packages whose files are copied into the installer rather than imported.
 *
 * `scripts/grammars.mjs` copies grammar .wasm files out of tree-sitter-wasms into the
 * renderer's public directory. No source file imports the package, so the import scan
 * cannot see it.
 */
const COPIED_PACKAGES = ["tree-sitter-wasms"];

/**
 * Notices for code that ships but has no package of its own to read them from.
 *
 * The grammars inside tree-sitter-wasms are compiled from the tree-sitter repositories,
 * whose MIT licences require their copyright lines to travel with the binaries. Those
 * texts are kept in `scripts/notices/`, taken from each repository once.
 */
export function copiedNotices(root) {
  const dir = join(root, "scripts", "notices");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".txt"))
    .sort()
    .map((name) => readFileSync(join(dir, name), "utf8").trim());
}

/** Every third-party package the desktop bundle imports, with its transitive dependencies. */
export function collectPackages(root) {
  const moduleRoots = [join(root, "node_modules"), join(root, "apps", "desktop", "node_modules")];
  const locate = (name) =>
    moduleRoots.map((base) => join(base, name)).find((dir) => existsSync(join(dir, "package.json")));

  const sources = [
    ...sourceFiles(join(root, "apps", "desktop", "src")),
    ...readdirSync(join(root, "packages")).flatMap((name) =>
      sourceFiles(join(root, "packages", name, "src")),
    ),
  ];

  const queue = [...COPIED_PACKAGES];
  for (const file of sources) {
    for (const specifier of bareImports(readFileSync(file, "utf8"))) {
      const name = packageNameOf(specifier);
      if (name !== null) queue.push(name);
    }
  }

  const seen = new Map();
  while (queue.length > 0) {
    const name = queue.pop();
    if (seen.has(name)) continue;

    const dir = locate(name);
    // Imported in source but not installed: an optional peer, or a type-only package the
    // regex could not tell apart. Nothing ships, so there is nothing to attribute.
    if (dir === undefined) continue;

    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    seen.set(name, {
      name,
      version: typeof manifest.version === "string" ? manifest.version : "0.0.0",
      licence: licenceOf(manifest),
      text: licenceText(dir),
    });

    for (const dependency of Object.keys({
      ...(manifest.dependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
    })) {
      if (packageNameOf(dependency) !== null) queue.push(dependency);
    }
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  const root = process.cwd();
  const out = join(root, "build", "licenses");
  mkdirSync(out, { recursive: true });

  const packages = collectPackages(root);
  if (packages.length === 0) {
    process.stderr.write("third-party-notices: found no bundled packages - the source shape has changed.\n");
    process.exit(1);
  }

  const copied = copiedNotices(root);
  writeFileSync(
    join(out, "THIRD-PARTY-NOTICES.txt"),
    [renderNotices(packages), ...copied.map((text) => `${"=".repeat(78)}\n${text}\n`)].join("\n"),
    "utf8",
  );
  copyFileSync(join(root, "LICENSE"), join(out, "LICENSE"));
  copyFileSync(join(root, "NOTICE"), join(out, "NOTICE"));

  const unknown = packages.filter((one) => one.licence === "UNKNOWN").map((one) => one.name);
  process.stdout.write(`Third-party notices: ${String(packages.length)} packages -> build/licenses/\n`);
  if (unknown.length > 0) {
    process.stdout.write(`  No declared licence: ${unknown.join(", ")}\n`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
