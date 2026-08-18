/**
 * Working out how to start someone's project, and where it ended up listening.
 *
 * The static server in `liveServer.ts` covers a folder of HTML, CSS and JavaScript. This
 * covers the other case: a project with a build step, where the thing that serves the site
 * is the project's own dev server and no amount of static file serving will substitute for
 * it. Rather than reimplement thirty toolchains, ADCode runs the one the project already
 * has and watches for the address it prints.
 *
 * Pure: filename lists, a package.json that has already been read, and text that has
 * already been captured. No spawning, no disk, no clock - `devServer.ts` does all of that
 * and calls in here for the decisions. Which is what makes the decisions testable, and it
 * matters more than usual, because "which command starts this project" is a guess and a
 * wrong guess runs an arbitrary command on the user's machine.
 */

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface DevCommand {
  /** Shown in the preview bar, e.g. "Vite · pnpm run dev". */
  readonly label: string;
  readonly packageManager: PackageManager;
  readonly script: string;
  /**
   * The framework marker found, or `null` for a project that merely has a `dev` script.
   *
   * This is what decides whether the preview *starts* this command on its own or only
   * offers to. A `vite.config.ts` means static serving definitely cannot work - the
   * `index.html` next to it is an unbuilt shell that renders blank - so running the dev
   * server is the only useful thing to do. A bare `dev` script means nothing of the sort:
   * ADCode's own is `electron-vite`, which launches a desktop app and serves no page at
   * all. Clicking "preview" must not become "run whatever this project calls dev".
   */
  readonly framework: string | null;
}

/**
 * Lockfile to package manager.
 *
 * Getting this wrong is not cosmetic: running `npm run dev` in a pnpm workspace resolves a
 * different dependency tree, and the failure it produces looks like the user's code is
 * broken rather than like the wrong tool was used.
 */
const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

export function packageManagerFor(files: readonly string[]): PackageManager {
  const present = new Set(files);

  for (const [lockfile, manager] of LOCKFILES) {
    if (present.has(lockfile)) return manager;
  }

  // npm is what ships with Node. A project with no lockfile has not expressed a preference,
  // and guessing anything else would be inventing one on their behalf.
  return "npm";
}

/**
 * Framework markers, detected by filename.
 *
 * Only the name is used - never the contents - which is the same rule §8.2 puts on the ad
 * tagger, and for a related reason: a detector that reads files grows an appetite for
 * reading more of them.
 *
 * The label is the only thing this buys us. Every framework in the list is started by its
 * project's own `dev` script, so knowing it is Vite rather than Next changes nothing about
 * what gets run - it changes what the preview bar can honestly say it is running.
 */
const FRAMEWORKS: readonly (readonly [RegExp, string])[] = [
  [/^vite\.config\.[mc]?[jt]s$/, "Vite"],
  [/^next\.config\.([mc]?js|ts)$/, "Next.js"],
  [/^nuxt\.config\.[mc]?[jt]s$/, "Nuxt"],
  [/^svelte\.config\.[mc]?[jt]s$/, "SvelteKit"],
  [/^astro\.config\.[mc]?[jt]s$/, "Astro"],
  [/^remix\.config\.[mc]?[jt]s$/, "Remix"],
  [/^angular\.json$/, "Angular"],
  [/^gatsby-config\.[mc]?[jt]s$/, "Gatsby"],
  [/^webpack\.config\.[mc]?[jt]s$/, "webpack"],
];

export function frameworkFor(files: readonly string[]): string | null {
  for (const [pattern, name] of FRAMEWORKS) {
    if (files.some((file) => pattern.test(file))) return name;
  }
  return null;
}

/** Scripts worth offering to run, best first. */
const DEV_SCRIPTS = ["dev", "start", "serve", "develop"];

/**
 * The command that starts this project, or `null` when there is nothing to start.
 *
 * `null` is the common case and not a failure: a folder of plain HTML has no dev server,
 * and the static server is the right answer for it. Returning `null` is how the preview
 * knows to stay static rather than reporting that something went wrong.
 */
export function detectDevCommand(
  files: readonly string[],
  packageJson: unknown,
): DevCommand | null {
  if (!files.includes("package.json")) return null;

  const scripts = readScripts(packageJson);
  if (scripts === null) return null;

  const script = DEV_SCRIPTS.find((name) => typeof scripts[name] === "string");
  if (script === undefined) return null;

  const packageManager = packageManagerFor(files);
  const framework = frameworkFor(files);
  const invocation = `${packageManager} run ${script}`;

  return {
    label: framework === null ? invocation : `${framework} · ${invocation}`,
    packageManager,
    script,
    framework,
  };
}

function readScripts(packageJson: unknown): Record<string, unknown> | null {
  if (typeof packageJson !== "object" || packageJson === null) return null;

  const scripts = (packageJson as { scripts?: unknown }).scripts;
  if (typeof scripts !== "object" || scripts === null) return null;

  return scripts as Record<string, unknown>;
}

/**
 * The argv to hand a shell.
 *
 * A shell is used here, unlike everywhere else in this codebase - `packages/git` refuses
 * one on principle. The difference is what the shell is protecting against. Git's rule
 * exists so that *our* arguments, built from paths and refs the renderer supplied, cannot
 * be reinterpreted as flags. Here there is nothing to protect: the whole point is to run
 * the project's own script, which npm will hand to a shell regardless of what we do.
 *
 * What still matters is that nothing untrusted reaches the command line. The package
 * manager comes from a fixed list of four, and the script name from a fixed list of four;
 * no string from package.json, from a filename, or from the renderer is interpolated here.
 */
export function shellInvocation(
  command: DevCommand,
  platform: NodeJS.Platform,
): { readonly file: string; readonly args: readonly string[] } {
  const line = `${command.packageManager} run ${command.script}`;

  if (platform === "win32") {
    const system = process.env["SystemRoot"] ?? "C:\\Windows";
    return { file: `${system}\\System32\\cmd.exe`, args: ["/d", "/s", "/c", line] };
  }

  return { file: "/bin/sh", args: ["-c", line] };
}

/** Terminal escape sequences, which every dev server's banner is full of. */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]|\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/**
 * The address a dev server just announced, or `null`.
 *
 * Two passes, and the order is the whole point. Vite, Next, Astro and Nuxt all print a
 * "Local:" line beside a "Network:" line, and the network one is the machine's LAN address
 * - which the preview iframe may not be able to reach, and which is not what the user
 * means by "my site". Taking the first URL in the output picks whichever the banner
 * happened to print first. So: prefer a line that says Local, and only then fall back.
 */
export function parseServerUrl(text: string): string | null {
  const clean = stripAnsi(text);
  const url = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s"'<>]*)?/;

  for (const line of clean.split(/\r?\n/)) {
    if (!/local/i.test(line)) continue;

    const match = url.exec(line);
    if (match !== null) return normaliseUrl(match[0]);
  }

  const anywhere = url.exec(clean);
  return anywhere === null ? null : normaliseUrl(anywhere[0]);
}

/** A trailing `.` or `,` from prose, and a guaranteed path so the iframe has a document. */
function normaliseUrl(raw: string): string {
  const trimmed = raw.replace(/[.,;:)\]]+$/, "");
  return /^https?:\/\/[^/]+$/.test(trimmed) ? `${trimmed}/` : trimmed;
}
