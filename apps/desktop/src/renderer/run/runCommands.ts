/**
 * What the Go Live / Run button should do for the file in front of you.
 *
 * VS Code splits this across two things a beginner has to know exist separately: Live
 * Server's "Go Live" in the status bar for web pages, and a Run button elsewhere for
 * everything else. One button that names what it is about to do is a better answer for
 * someone who does not yet know which category their file is in - and naming it is the
 * whole trick. A button that says "Run Python" has told you what will happen; a play
 * triangle has not.
 *
 * Pure: language id, a path, the names of the files at the workspace root, and the
 * platform. No disk, no spawning, no DOM. Which matters more here than usual, because the
 * output of this module is a command line that gets executed - and a table of twenty-five
 * of them is exactly the kind of thing that quietly rots without tests.
 */

export type RunMode = "live" | "run";

export interface RunAction {
  readonly mode: RunMode;
  /** The button's text. Always says what pressing it does. */
  readonly label: string;
  /** The shell command, for `run`. Empty in `live` mode, which needs no command. */
  readonly command: string;
}

/**
 * Languages the preview serves rather than executes.
 *
 * CSS and JavaScript are conditional, further down: a `style.css` beside an `index.html` is
 * part of a page, and a standalone `script.js` is a program. Getting that wrong in either
 * direction gives the user a button that does something they did not mean.
 */
const WEB_LANGUAGES = new Set(["html", "handlebars", "razor", "pug"]);
const WEB_ADJACENT = new Set(["css", "scss", "less", "javascript", "typescript"]);

/** Anything the workspace root can hold that makes it a web page rather than a program. */
const PAGE_MARKERS = ["index.html", "index.htm", "default.html"];

interface Recipe {
  /** Display name for the button: "Run Python". */
  readonly label: string;
  /**
   * `{file}` is the quoted path. `{stem}` is the bare filename without its extension and
   * **without quotes**, so a template can write `"{stem}.jar"` and get one quoted token -
   * a pre-quoted `{stem}` would produce `"thing".jar`, which cmd.exe does not read the way
   * a POSIX shell does. `{exe}` is the compiled binary, already quoted, and already
   * carrying the `./` that a POSIX shell needs to look in the current directory at all.
   *
   * Templates quote `{stem}` themselves. That is the price of letting them append to it.
   */
  readonly template: string;
  /** Windows needs a different one, usually only for the interpreter's name. */
  readonly windows?: string;
  /**
   * A manifest at the workspace root, and what to run when it is there. Rust and C# are
   * project-shaped: running a loose file is not what anyone means once a manifest exists.
   */
  readonly project?: { readonly marker: string; readonly template: string };
  /**
   * True when there is no way to run a single loose file of this language at all.
   *
   * C# is the case: without a `.csproj` there is nothing `dotnet` can be pointed at, so the
   * button hides rather than offering a command that is certain to fail.
   */
  readonly projectOnly?: boolean;
}

/**
 * The table.
 *
 * Every entry runs a *single file*, because that is what the button is for: a beginner
 * checking whether the thing they just wrote works. Build systems, test runners and task
 * configurations are a different feature and pretending otherwise here would produce a
 * button that behaves differently in every project.
 */
const RECIPES: Readonly<Record<string, Recipe>> = {
  python: { label: "Python", template: 'python3 {file}', windows: 'python {file}' },

  // Node 24 runs TypeScript directly, and this package's `engines` already requires it -
  // so there is no transpile step to explain to somebody on their first day.
  javascript: { label: "JavaScript", template: "node {file}" },
  typescript: { label: "TypeScript", template: "node {file}" },

  go: { label: "Go", template: "go run {file}" },

  rust: {
    label: "Rust",
    template: 'rustc {file} -o "{stem}" && {exe}',
    project: { marker: "Cargo.toml", template: "cargo run" },
  },

  // Single-file source mode, JDK 11 and later. Before that this needed javac first, and
  // explaining that to a learner was most of a lesson on its own.
  java: { label: "Java", template: "java {file}" },

  c: { label: "C", template: 'gcc {file} -o "{stem}" && {exe}' },
  cpp: { label: "C++", template: 'g++ {file} -o "{stem}" && {exe}' },

  csharp: {
    label: "C#",
    template: "dotnet run",
    project: { marker: "*.csproj", template: "dotnet run" },
    projectOnly: true,
  },

  fsharp: { label: "F#", template: "dotnet fsi {file}" },
  ruby: { label: "Ruby", template: "ruby {file}" },
  php: { label: "PHP", template: "php {file}" },
  shell: { label: "Shell", template: "bash {file}" },
  powershell: { label: "PowerShell", template: "pwsh -File {file}" },
  bat: { label: "Batch", template: "cmd /c {file}" },
  lua: { label: "Lua", template: "lua {file}" },
  perl: { label: "Perl", template: "perl {file}" },
  r: { label: "R", template: "Rscript {file}" },
  swift: { label: "Swift", template: "swift {file}" },
  dart: { label: "Dart", template: "dart run {file}" },
  julia: { label: "Julia", template: "julia {file}" },
  elixir: { label: "Elixir", template: "elixir {file}" },
  scala: { label: "Scala", template: "scala {file}" },
  clojure: { label: "Clojure", template: "clojure -M {file}" },
  coffeescript: { label: "CoffeeScript", template: "coffee {file}" },
  kotlin: {
    label: "Kotlin",
    template: 'kotlinc {file} -include-runtime -d "{stem}.jar" && java -jar "{stem}.jar"',
  },
  "objective-c": { label: "Objective-C", template: 'clang {file} -o "{stem}" && {exe}' },
};

export function runnableLanguages(): string[] {
  return Object.keys(RECIPES);
}

/**
 * Quote a path for a shell we do not know the identity of.
 *
 * The terminal may be cmd, PowerShell, bash or zsh depending on the user's profile, and
 * double quotes are the one form all four accept around a path with a space in it.
 *
 * `null` for anything that could end the quoted string and start a new command. A filename
 * containing a double quote or a newline is not worth supporting, and building a command
 * line out of one would be handing the shell a second command the user never typed.
 */
export function quotePath(path: string): string | null {
  if (path.length === 0) return null;
  if (/["\r\n]/.test(path)) return null;

  return `"${path}"`;
}

function stemOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

function matchesMarker(marker: string, rootFiles: readonly string[]): boolean {
  if (!marker.startsWith("*")) return rootFiles.includes(marker);

  const suffix = marker.slice(1);
  return rootFiles.some((file) => file.endsWith(suffix));
}

/**
 * The action for a file, or `null` when there is nothing honest to offer.
 *
 * `null` hides the button rather than disabling it. A permanently greyed control is a
 * standing invitation to wonder what you did wrong; an absent one is simply not part of
 * this file's world.
 */
export function runActionFor(
  languageId: string,
  filePath: string,
  rootFiles: readonly string[],
  platform: string,
): RunAction | null {
  const hasPage = PAGE_MARKERS.some((marker) => rootFiles.includes(marker));

  if (WEB_LANGUAGES.has(languageId)) return { mode: "live", label: "Go Live", command: "" };

  // A stylesheet or a script beside an `index.html` is part of a page; the same file with
  // no page anywhere is a program. This is the one guess in here, and it is the guess that
  // decides whether the button previews or executes.
  if (hasPage && WEB_ADJACENT.has(languageId)) {
    return { mode: "live", label: "Go Live", command: "" };
  }

  const recipe = RECIPES[languageId];
  if (recipe === undefined) return null;

  const quoted = quotePath(filePath);
  if (quoted === null) return null;

  const stem = stemOf(filePath);
  if (quotePath(stem) === null) return null;

  const windows = platform === "win32";
  const project =
    recipe.project !== undefined && matchesMarker(recipe.project.marker, rootFiles)
      ? recipe.project.template
      : null;

  // No manifest and no way to run a loose file: hide rather than offer a command that is
  // certain to fail. A button that always errors teaches the user to stop pressing it.
  if (project === null && recipe.projectOnly === true) return null;

  const template =
    project ?? (windows && recipe.windows !== undefined ? recipe.windows : recipe.template);

  const command = template
    .split("{file}").join(quoted)
    .split("{stem}").join(stem)
    // A compiled binary is `thing.exe` on Windows and `./thing` elsewhere - and without the
    // `./`, a POSIX shell searches PATH and reports "command not found" for a file that is
    // sitting right there.
    .split("{exe}").join(windows ? `"${stem}.exe"` : `"./${stem}"`);

  return { mode: "run", label: `Run ${recipe.label}`, command };
}
