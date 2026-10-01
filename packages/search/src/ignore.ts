/**
 * Which directories a walk of the workspace never enters.
 *
 * One rule for every walker that indexes the project - the search panel, quick open,
 * symbol search and universal search all read `createWorkspaceSearch`, and the assistant's
 * own file tools walk with this too. Two lists that disagree mean a file the editor cannot
 * find but the assistant can, or the other way round.
 *
 * The fixed lists below are the floor. On top of them go the directory patterns from the
 * root `.gitignore` and from `.git/info/exclude` - which is where Claude Code records the
 * worktrees it checks out inside a project, and where people put what they keep out of a
 * repository without telling everyone else.
 *
 * Only directories. A gitignored *file* - a `.env`, a local note - is still something a
 * person may well be searching for, and skipping a directory is what saves the walk.
 *
 * No Electron and no DOM; the only dependency is `node:fs`.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Directories nobody means to search, skipped by name at any depth. */
export const SKIP_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "build",
  ".next",
  ".worktrees",
  ".open-next",
  ".wrangler",
  "target",
  "coverage",
  ".adcode",
  ".adcode-cache",
  ".cache",
]);

/**
 * Workspace-relative directories skipped whatever the ignore files say.
 *
 * `.claude/worktrees` is where Claude Code checks out a complete second copy of the
 * repository for each agent. It is normally in `.git/info/exclude` as well, but not in a
 * folder that is not a repository, or one whose exclude file was reset. Skipping `.claude`
 * itself would hide settings, skills and commands people do mean to search, so this is a
 * path, not a name.
 */
const SKIP_DIRECTORY_PATHS: readonly string[] = [".claude/worktrees"];

/** True for a directory the walk should not enter. `path` is workspace-relative, `/`-separated. */
export type DirectoryFilter = (path: string) => boolean;

interface IgnoreRule {
  readonly negated: boolean;
  readonly pattern: RegExp;
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One gitignore pattern as a regex over a workspace-relative path.
 *
 * The subset of gitignore(5) that matters for directories: `*`, `?`, `[...]`, the three
 * placements of `**`, backslash escapes, and anchoring. Not braces - git has none.
 */
function patternBody(pattern: string): string {
  let source = "";

  for (let i = 0; i < pattern.length; i++) {
    const character = pattern[i]!;

    if (character === "\\" && i + 1 < pattern.length) {
      source += escapeRegex(pattern[i + 1]!);
      i += 1;
      continue;
    }

    if (character === "*") {
      const atSegmentStart = i === 0 || pattern[i - 1] === "/";

      if (pattern[i + 1] === "*" && atSegmentStart) {
        // `**/x` and `a/**/x`: zero or more whole directories.
        if (pattern[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
          continue;
        }
        // `a/**`: everything inside.
        if (i + 2 === pattern.length) {
          source += ".*";
          i += 1;
          continue;
        }
      }

      // Any other run of asterisks is an ordinary `*`.
      while (pattern[i + 1] === "*") i += 1;
      source += "[^/]*";
      continue;
    }

    if (character === "?") {
      source += "[^/]";
      continue;
    }

    if (character === "[") {
      const close = pattern.indexOf("]", i + 2);
      if (close !== -1) {
        const body = pattern.slice(i + 1, close).replace(/\\/g, "\\\\");
        source += body.startsWith("!") ? `[^${body.slice(1)}]` : `[${body}]`;
        i = close;
        continue;
      }
      // An unclosed `[` is the character itself.
    }

    source += escapeRegex(character);
  }

  return source;
}

function parseIgnoreFile(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];

  for (const raw of text.split(/\r?\n/)) {
    // Trailing spaces are dropped unless escaped; leading ones are part of the pattern.
    let line = raw.replace(/(?<!\\)\s+$/, "");
    if (line === "" || line.startsWith("#")) continue;

    const negated = line.startsWith("!");
    if (negated) line = line.slice(1);

    // Only directories are ever asked about, so "directories only" needs no tracking.
    if (line.endsWith("/")) line = line.slice(0, -1);
    if (line === "") continue;

    // A slash at the start or in the middle ties the pattern to the root; otherwise it
    // matches at any depth.
    const anchored = line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);

    try {
      rules.push({
        negated,
        pattern: new RegExp(`^${anchored ? "" : "(?:.*/)?"}${patternBody(line)}$`),
      });
    } catch {
      // `[z-a]` and friends. Git matches nothing with them; neither does this.
    }
  }

  return rules;
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * The repository's shared `.git` directory, where `info/exclude` lives.
 *
 * In a linked worktree `.git` is a file - `gitdir: <repo>/.git/worktrees/<name>` - and that
 * directory's `commondir` leads back to the main repository's `.git`.
 */
async function gitCommonDirectory(root: string): Promise<string> {
  let gitDirectory = join(root, ".git");

  const pointer = /^gitdir:\s*(.+)$/m.exec(await readText(gitDirectory));
  if (pointer !== null) gitDirectory = resolve(root, pointer[1]!.trim());

  const common = (await readText(join(gitDirectory, "commondir"))).trim();
  return common === "" ? gitDirectory : resolve(gitDirectory, common);
}

export async function loadDirectoryFilter(root: string): Promise<DirectoryFilter> {
  const [exclude, gitignore] = await Promise.all([
    gitCommonDirectory(root).then((common) => readText(join(common, "info", "exclude"))),
    readText(join(root, ".gitignore")),
  ]);

  // The exclude file first, so a `.gitignore` line - which git ranks above it - is the
  // later one and wins.
  const rules = [...parseIgnoreFile(exclude), ...parseIgnoreFile(gitignore)];

  return (path) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (SKIP_DIRECTORY_NAMES.has(name) || SKIP_DIRECTORY_PATHS.includes(path)) return true;

    let ignored = false;
    for (const rule of rules) {
      if (rule.pattern.test(path)) ignored = !rule.negated;
    }
    return ignored;
  };
}
