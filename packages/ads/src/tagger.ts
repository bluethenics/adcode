/**
 * Map language IDs and workspace filenames into a fixed, compiled-in tag vocabulary.
 *
 * Brief §8.2: "This module is why the privacy claim in §1 is structural rather than
 * aspirational." Two properties do that work, and both are structural rather than a
 * matter of the tables below being written carefully:
 *
 *   1. Every input is reduced to its basename before matching, so a path arriving where
 *      a filename was expected cannot leak a directory name.
 *   2. The final step intersects against `TAG_VOCABULARY` unconditionally, so even a
 *      carelessly edited table cannot emit a tag that was not compiled into the binary.
 *
 * Filename-level detection only. This module never reads the *contents* of
 * `package.json` or any other manifest.
 */
import { MAX_TAGS, TAG_VOCABULARY } from "./types.ts";

/** Language ID (as an editor reports it) to vocabulary tag. */
const BY_LANGUAGE_ID: Readonly<Record<string, string>> = {
  c: "lang:c",
  cpp: "lang:cpp",
  "c++": "lang:cpp",
  csharp: "lang:csharp",
  cs: "lang:csharp",
  css: "lang:css",
  scss: "lang:css",
  go: "lang:go",
  html: "lang:html",
  java: "lang:java",
  javascript: "lang:javascript",
  javascriptreact: "lang:javascript",
  json: "lang:json",
  jsonc: "lang:json",
  kotlin: "lang:kotlin",
  lua: "lang:lua",
  markdown: "lang:markdown",
  php: "lang:php",
  python: "lang:python",
  ruby: "lang:ruby",
  rust: "lang:rust",
  shellscript: "lang:shell",
  bash: "lang:shell",
  sh: "lang:shell",
  powershell: "lang:shell",
  sql: "lang:sql",
  swift: "lang:swift",
  typescript: "lang:typescript",
  typescriptreact: "lang:typescript",
  yaml: "lang:yaml",
  yml: "lang:yaml",
};

/** Exact basename to vocabulary tag. */
const BY_FILENAME: Readonly<Record<string, string>> = {
  "dockerfile": "tool:docker",
  "docker-compose.yml": "tool:docker",
  "docker-compose.yaml": "tool:docker",
  "cargo.toml": "tool:cargo",
  "cargo.lock": "tool:cargo",
  "package.json": "tool:npm",
  "package-lock.json": "tool:npm",
  "pnpm-lock.yaml": "tool:npm",
  "build.gradle": "tool:gradle",
  "build.gradle.kts": "tool:gradle",
  "pom.xml": "tool:maven",
  "vite.config.ts": "tool:vite",
  "vite.config.js": "tool:vite",
  "webpack.config.js": "tool:webpack",
  "webpack.config.ts": "tool:webpack",
  "next.config.js": "fw:next",
  "next.config.mjs": "fw:next",
  "next.config.ts": "fw:next",
  "nuxt.config.ts": "fw:nuxt",
  "nuxt.config.js": "fw:nuxt",
  "angular.json": "fw:angular",
  "svelte.config.js": "fw:svelte",
  "vue.config.js": "fw:vue",
  "manage.py": "fw:django",
  "gemfile": "fw:rails",
  "artisan": "fw:laravel",
  "kustomization.yaml": "tool:kubernetes",
};

/** Basename suffix to vocabulary tag, checked only when no exact match applied. */
const BY_EXTENSION: Readonly<Record<string, string>> = {
  ".ts": "lang:typescript",
  ".tsx": "lang:typescript",
  ".js": "lang:javascript",
  ".jsx": "lang:javascript",
  ".mjs": "lang:javascript",
  ".py": "lang:python",
  ".rs": "lang:rust",
  ".go": "lang:go",
  ".java": "lang:java",
  ".kt": "lang:kotlin",
  ".rb": "lang:ruby",
  ".php": "lang:php",
  ".swift": "lang:swift",
  ".cs": "lang:csharp",
  ".cpp": "lang:cpp",
  ".hpp": "lang:cpp",
  ".c": "lang:c",
  ".h": "lang:c",
  ".lua": "lang:lua",
  ".sql": "lang:sql",
  ".sh": "lang:shell",
  ".ps1": "lang:shell",
  ".css": "lang:css",
  ".scss": "lang:css",
  ".html": "lang:html",
  ".json": "lang:json",
  ".md": "lang:markdown",
  ".yml": "lang:yaml",
  ".yaml": "lang:yaml",
  ".tf": "tool:terraform",
};

/**
 * Everything after the last `/` or `\`.
 *
 * A trailing separator yields an empty basename, which matches nothing - a directory
 * named `Dockerfile` must not be mistaken for a Dockerfile.
 */
function basename(input: string): string {
  let cut = -1;
  for (let i = input.length - 1; i >= 0; i--) {
    const ch = input[i];
    if (ch === "/" || ch === "\\") {
      cut = i;
      break;
    }
  }
  return input.slice(cut + 1).toLowerCase();
}

export interface TagInput {
  readonly languageIds: readonly string[];
  readonly filenames: readonly string[];
}

export function tag(input: TagInput): string[] {
  const found = new Set<string>();

  for (const raw of input.languageIds) {
    if (typeof raw !== "string") continue;
    const mapped = BY_LANGUAGE_ID[raw.trim().toLowerCase()];
    if (mapped !== undefined) found.add(mapped);
  }

  for (const raw of input.filenames) {
    if (typeof raw !== "string") continue;
    const name = basename(raw);
    if (name.length === 0) continue;

    const exact = BY_FILENAME[name];
    if (exact !== undefined) {
      found.add(exact);
      continue;
    }

    const dot = name.lastIndexOf(".");
    if (dot > 0) {
      const byExtension = BY_EXTENSION[name.slice(dot)];
      if (byExtension !== undefined) found.add(byExtension);
    }
  }

  // The intersection is unconditional and last. Nothing reaches the network that was
  // not compiled into this binary, whatever the tables above come to say.
  const allowed: string[] = [];
  for (const candidate of found) {
    if ((TAG_VOCABULARY as readonly string[]).includes(candidate)) allowed.push(candidate);
  }

  return allowed.sort().slice(0, MAX_TAGS);
}
