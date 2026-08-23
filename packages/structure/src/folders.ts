/**
 * What the folders in a project are *for*.
 *
 * Opening an unfamiliar repository is a reading problem before it is a coding problem, and
 * no editor helps with it. You get a tree of nineteen names - `src`, `dist`, `.husky`,
 * `public`, `vendor` - and every one of them is either obvious or completely opaque, with
 * nothing in between and no way to tell which is which except by opening it.
 *
 * So this is a dictionary. It is not clever and it is not inferred: somebody has to write
 * down what `node_modules` is, once, in a sentence a person who has never seen it can read.
 * That is the entire feature, and the reason it works is that the set of names is small and
 * changes slowly - about eighty entries cover almost every project anyone will open.
 *
 * **Never guessed.** A name with no entry gets no explanation rather than a hedge. "This
 * might be source code" is worse than silence: it teaches the reader that the notes are
 * unreliable, and after that the true ones are worth nothing either.
 */

export interface PathNote {
  /** A short label: "Source code", "Dependencies". */
  readonly title: string;
  /** One or two sentences, written for somebody who has not seen this before. */
  readonly detail: string;
  /**
   * True when the folder is generated and not worth reading.
   *
   * The tree dims these. It is the single most useful thing to know about a project's
   * root - roughly half of what is there was not written by anybody.
   */
  readonly generated?: boolean;
}

/**
 * Directories, by name.
 *
 * Matched case-insensitively against the folder's own name, not its path, because these
 * conventions are about the name: `src` means the same thing at the root and three levels
 * down.
 */
const DIRECTORIES: Readonly<Record<string, PathNote>> = {
  src: { title: "Source code", detail: "The code you write. Nearly every project keeps its own code here." },
  lib: { title: "Library code", detail: "Code meant to be used by other code, rather than run on its own." },
  app: { title: "Application code", detail: "The application itself - its screens, routes, or entry points." },
  apps: { title: "Applications", detail: "Several separate applications kept in one repository." },
  packages: { title: "Packages", detail: "Separate libraries kept in one repository, usually depended on by the apps beside them." },
  components: { title: "Components", detail: "Reusable pieces of interface, each one a self-contained part of a screen." },
  pages: { title: "Pages", detail: "One file per screen or URL. The framework turns each into a route." },
  routes: { title: "Routes", detail: "The URLs this project answers, and the code that answers them." },
  views: { title: "Views", detail: "The screens the user sees, separate from the logic behind them." },
  models: { title: "Models", detail: "The shapes of the data this project stores and moves around." },
  controllers: { title: "Controllers", detail: "The code that decides what happens when a request arrives." },
  services: { title: "Services", detail: "Long-running or shared logic - talking to a database, an API, a queue." },
  utils: { title: "Utilities", detail: "Small helpers used all over the project." },
  helpers: { title: "Helpers", detail: "Small helpers used all over the project." },
  hooks: { title: "Hooks", detail: "Reusable stateful logic, in the React sense of the word." },
  styles: { title: "Stylesheets", detail: "How everything looks. CSS and its relatives." },
  assets: { title: "Assets", detail: "Images, fonts, icons and other files shipped as-is." },
  static: { title: "Static files", detail: "Files served exactly as they are, at the address that matches their name." },
  public: { title: "Public files", detail: "Served to the browser untouched. Anything here is visible to anyone." },
  templates: { title: "Templates", detail: "Pages with holes in them, filled in with data before being sent." },
  migrations: { title: "Database migrations", detail: "Numbered steps that change the database's shape. Run in order, never edited once shipped." },
  scripts: { title: "Scripts", detail: "Jobs run by hand or by the build - not part of the shipped program." },
  bin: { title: "Executables", detail: "Programs meant to be run directly from a terminal." },
  config: { title: "Configuration", detail: "Settings that change how the project builds or runs." },
  docs: { title: "Documentation", detail: "Written explanation - for people, not for the compiler." },
  examples: { title: "Examples", detail: "Small working programs showing how to use this project." },
  test: { title: "Tests", detail: "Code that checks the rest of the code still works." },
  tests: { title: "Tests", detail: "Code that checks the rest of the code still works." },
  spec: { title: "Tests", detail: "Code that checks the rest of the code still works. \"Spec\" is the Ruby and JavaScript name for it." },
  __tests__: { title: "Tests", detail: "Code that checks the rest of the code still works. Jest looks for this name." },
  fixtures: { title: "Test fixtures", detail: "Sample files the tests read. Never used by the running program." },
  __fixtures__: { title: "Test fixtures", detail: "Sample files the tests read. Never used by the running program." },
  __mocks__: { title: "Test doubles", detail: "Stand-ins that let a test run without the real thing behind them." },
  include: { title: "Headers", detail: "C and C++ declarations - what exists, without saying how it works." },
  target: { title: "Build output", detail: "Compiled Rust. Generated, and safe to delete.", generated: true },
  build: { title: "Build output", detail: "What the build produced. Generated from the source beside it.", generated: true },
  dist: { title: "Build output", detail: "The finished, shippable version, generated from `src`. Editing it is always a mistake - the next build overwrites it.", generated: true },
  out: { title: "Build output", detail: "What the build produced. Generated, and safe to delete.", generated: true },
  obj: { title: "Build output", detail: "Intermediate compiler output. Generated, and safe to delete.", generated: true },
  node_modules: { title: "Dependencies", detail: "Every library this project installs, downloaded by npm. Nobody writes code here, it is enormous, and it is rebuilt by `npm install`.", generated: true },
  vendor: { title: "Dependencies", detail: "Third-party code copied into the project rather than installed.", generated: true },
  venv: { title: "Python environment", detail: "A private copy of Python and its packages for this project alone.", generated: true },
  ".venv": { title: "Python environment", detail: "A private copy of Python and its packages for this project alone.", generated: true },
  __pycache__: { title: "Python cache", detail: "Compiled Python, regenerated automatically. Safe to delete.", generated: true },
  ".git": { title: "Version history", detail: "Git's own storage: every commit this project has ever had. Never edit anything in here by hand.", generated: true },
  ".github": { title: "GitHub configuration", detail: "Workflows, issue templates, and other things GitHub reads." },
  ".vscode": { title: "Editor settings", detail: "Settings another editor reads. ADCode ignores them." },
  ".idea": { title: "Editor settings", detail: "Settings JetBrains editors read. ADCode ignores them." },
  ".next": { title: "Next.js build cache", detail: "Generated by the dev server and the build. Safe to delete.", generated: true },
  ".cache": { title: "Cache", detail: "Saved work from a previous run, kept to make the next one faster.", generated: true },
  coverage: { title: "Coverage report", detail: "Which lines the tests actually ran, from the last test run.", generated: true },
  release: { title: "Release artefacts", detail: "Installers and archives built for distribution.", generated: true },
  locales: { title: "Translations", detail: "The same text in every language this project speaks." },
  i18n: { title: "Translations", detail: "The same text in every language this project speaks." },
};

/** Files, by exact name. */
const FILES: Readonly<Record<string, PathNote>> = {
  "package.json": { title: "Project manifest", detail: "The project's name, its dependencies, and the commands you can run with `npm run`. The first file to read in any JavaScript project." },
  "package-lock.json": { title: "Dependency lock", detail: "The exact version of every library installed, so everyone gets the same ones. Generated - never edited by hand.", generated: true },
  "yarn.lock": { title: "Dependency lock", detail: "The exact version of every library installed. Generated by Yarn.", generated: true },
  "pnpm-lock.yaml": { title: "Dependency lock", detail: "The exact version of every library installed. Generated by pnpm.", generated: true },
  "tsconfig.json": { title: "TypeScript settings", detail: "How strictly TypeScript checks this project, and which files it looks at." },
  "jsconfig.json": { title: "JavaScript settings", detail: "How the editor resolves imports in this project." },
  "requirements.txt": { title: "Python dependencies", detail: "The libraries this project needs. `pip install -r requirements.txt` installs them." },
  "pyproject.toml": { title: "Python project", detail: "The modern Python manifest: the project's name, dependencies and build settings." },
  "Pipfile": { title: "Python dependencies", detail: "The libraries this project needs, managed by Pipenv." },
  "Cargo.toml": { title: "Rust project", detail: "The project's name and dependencies. `cargo run` reads this." },
  "Cargo.lock": { title: "Dependency lock", detail: "The exact version of every crate installed. Generated by Cargo.", generated: true },
  "go.mod": { title: "Go module", detail: "The module's name and the versions it depends on." },
  "go.sum": { title: "Dependency checksums", detail: "Verification hashes for every dependency. Generated.", generated: true },
  "pom.xml": { title: "Maven project", detail: "A Java project's dependencies and build steps." },
  "build.gradle": { title: "Gradle build", detail: "How this Java or Android project is compiled and packaged." },
  Gemfile: { title: "Ruby dependencies", detail: "The gems this project needs. `bundle install` installs them." },
  "composer.json": { title: "PHP dependencies", detail: "The packages this project needs. `composer install` installs them." },
  Makefile: { title: "Build recipes", detail: "Named jobs run with `make`. Often the quickest way to see what a project can do." },
  Dockerfile: { title: "Container image", detail: "Step-by-step instructions for building the environment this project runs in." },
  "docker-compose.yml": { title: "Container setup", detail: "Several containers - the app, a database, a cache - started together as one." },
  "README.md": { title: "Read this first", detail: "What the project is and how to run it, written by the people who made it." },
  LICENSE: { title: "Licence", detail: "What you are legally allowed to do with this code." },
  "CONTRIBUTING.md": { title: "How to contribute", detail: "What the maintainers expect from a change before they will take it." },
  "CHANGELOG.md": { title: "What changed", detail: "What was added, fixed and broken in each version." },
  ".gitignore": { title: "Untracked files", detail: "Patterns git deliberately does not save - build output, secrets, caches." },
  ".env": { title: "Local secrets", detail: "Passwords, API keys and settings for this machine only. Should never be committed." },
  ".editorconfig": { title: "Formatting rules", detail: "Indentation and line endings, agreed once so every editor matches." },
  "index.html": { title: "The front door", detail: "The page a browser loads first when it visits this folder." },
  "vite.config.ts": { title: "Vite build settings", detail: "How the dev server and the production build are configured." },
  "webpack.config.js": { title: "Webpack build settings", detail: "How the source files are bundled into what the browser loads." },
  "eslint.config.js": { title: "Lint rules", detail: "The style and correctness rules this project holds its code to." },
};

/**
 * Directories the file tree does not walk into.
 *
 * Defined here rather than in the shell because two places need to agree about it: the
 * workspace listing, which skips them because walking a `node_modules` is slow enough to
 * matter, and the project map, which has to *say* they were skipped. A map that silently
 * omitted them would be describing a folder the user does not have - and "the big one you
 * can ignore is not even shown" is a useful thing to be told, not an implementation detail.
 */
export const HIDDEN_DIRECTORIES: readonly string[] = [
  ".git",
  "node_modules",
  ".DS_Store",
  "dist",
  "out",
  ".next",
  "target",
];

/** The note for one entry, or `null` when there is nothing honest to say about it. */
export function describeEntry(name: string, isDirectory: boolean): PathNote | null {
  if (isDirectory) return DIRECTORIES[name] ?? DIRECTORIES[name.toLowerCase()] ?? null;
  return FILES[name] ?? null;
}

/**
 * What kind of project this looks like, from the files at its root.
 *
 * Reported as a list, because a real repository is usually several at once - a Next.js app
 * with a Dockerfile and a Python service is three true answers, and picking one would be
 * choosing which two thirds of the project to hide.
 */
export function projectKinds(rootNames: readonly string[]): string[] {
  const has = (name: string): boolean => rootNames.some((entry) => entry === name);
  const hasSuffix = (suffix: string): boolean => rootNames.some((entry) => entry.endsWith(suffix));

  const kinds: string[] = [];

  if (has("package.json")) kinds.push("a Node.js or web project");
  if (has("pyproject.toml") || has("requirements.txt") || has("Pipfile")) kinds.push("a Python project");
  if (has("Cargo.toml")) kinds.push("a Rust project");
  if (has("go.mod")) kinds.push("a Go project");
  if (has("pom.xml") || has("build.gradle")) kinds.push("a Java project");
  if (hasSuffix(".csproj") || hasSuffix(".sln")) kinds.push("a .NET project");
  if (has("Gemfile")) kinds.push("a Ruby project");
  if (has("composer.json")) kinds.push("a PHP project");
  if (has("CMakeLists.txt") || has("Makefile")) kinds.push("a C or C++ project");
  if (has("Dockerfile") || has("docker-compose.yml")) kinds.push("packaged as a container");
  if (has("index.html") && !has("package.json")) kinds.push("a plain website");

  return kinds;
}

/**
 * Where to start reading, given what is at the root.
 *
 * Ordered by how much they tell you per minute spent. The README first, always: it is the
 * only file written specifically to answer this question, and skipping past it to read
 * source is how people spend an hour learning what a paragraph would have told them.
 */
export function whereToStart(rootNames: readonly string[]): string[] {
  const order = [
    "README.md",
    "readme.md",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "Makefile",
    "index.html",
    "docker-compose.yml",
  ];

  const found = order.filter((name) => rootNames.includes(name));
  const seen = new Set<string>();

  // De-duplicated by the note they carry, so `README.md` and `readme.md` do not both appear
  // on a case-insensitive filesystem that reports them as two entries.
  return found.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
