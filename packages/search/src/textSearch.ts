/**
 * Workspace text search.
 *
 * Brief §4: "global regex search and replace". §7 budgets *first results*, not total
 * time, which is why this is an async generator - the panel fills as the walk proceeds
 * rather than after it finishes, and a search over a large repository feels immediate
 * even when it is not fast.
 *
 * No Electron and no DOM; the only dependency is `node:fs`.
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** Directories nobody means to search, skipped before they are walked. */
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "build",
  ".next",
  "target",
  "coverage",
  ".adcode",
  ".cache",
]);

/** Past this, a file is a build artefact or a blob, not something a person is reading. */
const MAX_FILE_BYTES = 2_000_000;
const DEFAULT_MAX_RESULTS = 2000;
/** How much of a line to keep for the result row. */
const MAX_TEXT_LENGTH = 400;

export interface SearchQuery {
  readonly pattern: string;
  readonly isRegex?: boolean;
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
  /** Glob, matched against the workspace-relative path. */
  readonly include?: string;
  readonly exclude?: string;
  readonly maxResults?: number;
}

export interface SearchResult {
  readonly path: string;
  /** One-based, as a human counts them. */
  readonly line: number;
  readonly column: number;
  readonly text: string;
  readonly matchLength: number;
}

/** What a replace-all actually did, for the summary line the panel shows. */
export interface ReplaceSummary {
  readonly files: number;
  readonly replacements: number;
}

export interface WorkspaceSearch {
  listFiles(): Promise<string[]>;
  search(query: SearchQuery, signal?: AbortSignal): AsyncIterable<SearchResult>;
  /**
   * Rewrite every match in the workspace.
   *
   * With a literal pattern the replacement is literal too - `$1` in a replacement box is
   * a dollar sign and a one unless the user asked for a regex, and silently treating it
   * as a capture reference would corrupt files that mention prices.
   */
  replaceAll(query: SearchQuery, replacement: string, signal?: AbortSignal): Promise<ReplaceSummary>;
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A small glob: `*` within a segment, `**` across segments, `?` for one character.
 *
 * Deliberately not a full glob implementation. This covers the patterns a search panel's
 * include/exclude box actually receives, and a dependency for the rest would be a poor
 * trade in a package whose value is having none.
 */
/**
 * The index of the `}` that closes the `{` at `open`, or -1.
 *
 * Counts nesting, so `{a,{b,c}}` closes at the last brace rather than the first one seen.
 */
function matchingBrace(glob: string, open: number): number {
  let depth = 0;

  for (let i = open; i < glob.length; i++) {
    if (glob[i] === "{") depth += 1;
    else if (glob[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/** Split on commas that are not inside a nested brace group. */
function splitAlternatives(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < body.length; i++) {
    const character = body[i];
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(body.slice(start));
  return parts;
}

function globBody(glob: string): string {
  let source = "";

  for (let i = 0; i < glob.length; i++) {
    const character = glob[i]!;

    /*
     * `{ts,tsx}` - alternation, and the one piece of glob syntax whose absence is silent.
     *
     * A missing `*` or `?` produces obviously wrong results. A missing `{a,b}` produces
     * *no* results: every character was escaped as a literal, so the pattern could only
     * ever match a file whose name really did contain the braces and the comma. Somebody
     * typing `*.{ts,tsx}` into the include box - which is the syntax every other search
     * tool accepts - got an empty panel and no reason for it.
     *
     * Each alternative goes back through this function, so `{a,{b,c}}` and `*.{ts,js}`
     * both work without the two cases knowing about each other.
     */
    if (character === "{") {
      const close = matchingBrace(glob, i);

      if (close !== -1) {
        const alternatives = splitAlternatives(glob.slice(i + 1, close));
        source += `(?:${alternatives.map(globBody).join("|")})`;
        i = close;
        continue;
      }

      // An unmatched `{` is a brace in a filename, and some filenames really do have one.
    }

    if (character === "*") {
      if (glob[i + 1] === "*") {
        // `**/` should also match zero directories, so `src/**` matches `src/a.ts`.
        if (glob[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }

    if (character === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegex(character);
  }

  return source;
}

function globToRegex(glob: string): RegExp {
  // A glob with no separator is matched at any depth, so `*.ts` finds `src/deep/a.ts`
  // rather than only top-level files. Every search box a developer has used behaves this
  // way, and the literal reading is never what they meant.
  const anyDepth = glob.includes("/") ? "" : "(?:.*/)?";

  return new RegExp(`^${anyDepth}${globBody(glob)}$`, "i");
}

/** A NUL byte in the first block is the standard binary heuristic. */
function looksBinary(contents: string): boolean {
  const limit = Math.min(contents.length, 8000);
  for (let i = 0; i < limit; i++) {
    if (contents.charCodeAt(i) === 0) return true;
  }
  return false;
}

export interface WorkspaceSearchDeps {
  readonly root: string;
}

export function createWorkspaceSearch(deps: WorkspaceSearchDeps): WorkspaceSearch {
  async function* walkFiles(directory: string, signal?: AbortSignal): AsyncGenerator<string> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (signal !== undefined && signal.aborted) return;

      const full = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        yield* walkFiles(full, signal);
        continue;
      }

      if (entry.isFile()) yield relative(deps.root, full).split(sep).join("/");
    }
  }

  function buildMatcher(query: SearchQuery): RegExp | null {
    if (query.pattern.length === 0) return null;

    let source = query.isRegex === true ? query.pattern : escapeRegex(query.pattern);
    if (query.wholeWord === true) source = `\\b(?:${source})\\b`;

    try {
      // `g` so every match on a line is found, not just the first.
      return new RegExp(source, query.caseSensitive === true ? "g" : "gi");
    } catch {
      // An invalid regex is something the user is still typing, not an error to throw.
      return null;
    }
  }

  return {
    async listFiles(): Promise<string[]> {
      const files: string[] = [];
      for await (const file of walkFiles(deps.root)) files.push(file);
      return files;
    },

    async replaceAll(
      query: SearchQuery,
      replacement: string,
      signal?: AbortSignal,
    ): Promise<ReplaceSummary> {
      const matcher = buildMatcher(query);
      if (matcher === null) return { files: 0, replacements: 0 };

      // A pattern that matches the empty string matches between every pair of characters.
      // Running that over a workspace would interleave the replacement through every file
      // in it, so refuse rather than "succeed".
      matcher.lastIndex = 0;
      if (matcher.exec("")?.[0] === "") return { files: 0, replacements: 0 };

      const aborted = (): boolean => signal?.aborted === true;

      const include = query.include === undefined ? null : globToRegex(query.include);
      const exclude = query.exclude === undefined ? null : globToRegex(query.exclude);

      let files = 0;
      let replacements = 0;

      for await (const path of walkFiles(deps.root, signal)) {
        if (aborted()) break;

        if (include !== null && !include.test(path)) continue;
        if (exclude !== null && exclude.test(path)) continue;

        const full = join(deps.root, path);

        let contents: string;
        try {
          const info = await stat(full);
          if (info.size > MAX_FILE_BYTES) continue;

          contents = await readFile(full, "utf8");
        } catch {
          continue;
        }

        if (looksBinary(contents)) continue;

        matcher.lastIndex = 0;
        const found = contents.match(matcher)?.length ?? 0;
        if (found === 0) continue;

        // `String.replace` reads `$&` and `$1` out of a replacement *string*. That is what
        // a regex search should do and what a literal one must not, so literal mode passes
        // a function instead - which switches the substitution off entirely rather than
        // trying to out-escape it.
        matcher.lastIndex = 0;
        const rewritten =
          query.isRegex === true
            ? contents.replace(matcher, replacement)
            : contents.replace(matcher, () => replacement);

        try {
          await writeFile(full, rewritten, "utf8");
        } catch {
          // A read-only file is the user's business, not a reason to abandon the rest.
          continue;
        }

        files += 1;
        replacements += found;
      }

      return { files, replacements };
    },

    async *search(query: SearchQuery, signal?: AbortSignal): AsyncIterable<SearchResult> {
      const matcher = buildMatcher(query);
      if (matcher === null) return;

      // Read through a function, not a narrowed expression. `signal.aborted` is mutable
      // state the caller changes while this loop runs, but after one `=== true` check
      // TypeScript narrows it to `false` for the rest of the scope and then reports every
      // later check as unreachable - which is exactly backwards.
      const aborted = (): boolean => signal?.aborted === true;

      const include = query.include === undefined ? null : globToRegex(query.include);
      const exclude = query.exclude === undefined ? null : globToRegex(query.exclude);
      const maxResults = query.maxResults ?? DEFAULT_MAX_RESULTS;

      let emitted = 0;

      for await (const path of walkFiles(deps.root, signal)) {
        if (aborted() || emitted >= maxResults) return;

        if (include !== null && !include.test(path)) continue;
        if (exclude !== null && exclude.test(path)) continue;

        let contents: string;
        try {
          const info = await stat(join(deps.root, path));
          if (info.size > MAX_FILE_BYTES) continue;

          contents = await readFile(join(deps.root, path), "utf8");
        } catch {
          continue;
        }

        if (looksBinary(contents)) continue;

        const lines = contents.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (aborted() || emitted >= maxResults) return;

          const line = lines[i]!;
          matcher.lastIndex = 0;

          let match: RegExpExecArray | null;
          while ((match = matcher.exec(line)) !== null) {
            yield {
              path,
              line: i + 1,
              column: match.index + 1,
              text: line.length > MAX_TEXT_LENGTH ? `${line.slice(0, MAX_TEXT_LENGTH)}…` : line,
              matchLength: match[0].length,
            };

            emitted += 1;
            if (emitted >= maxResults) return;

            // A zero-width match (`a*`, `^`) never advances `lastIndex` on its own, so
            // the loop would spin forever on the same position.
            if (match[0].length === 0) matcher.lastIndex += 1;
          }
        }
      }
    },
  };
}
