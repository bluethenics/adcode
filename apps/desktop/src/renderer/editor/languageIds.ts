/**
 * Filename to language.
 *
 * This one function decides more than it looks like it does. The language id it returns
 * selects the syntax highlighting, whether a language worker checks the file, which
 * keyword completions appear, what the Structure view can read, whether tags auto-close,
 * and which command the Run button offers. A file that lands on `plaintext` gets none of
 * those, and the user's conclusion is "this editor does not support Kotlin" - which is a
 * verdict on the whole application, reached because of a missing line in a table.
 *
 * So the table is deliberately long, and it is here rather than in `editorHost.ts` for one
 * reason: it can be tested. `editorHost` imports `monaco-editor`, which needs a DOM, so a
 * test for the mapping could only run by launching a window. This file imports nothing.
 *
 * **Two rules for adding to it.**
 *
 * 1. The id must be one Monaco actually registers, or the file opens unhighlighted and
 *    nothing says why. `monaco.languages.getLanguages()` is the list.
 * 2. Where a mapping is an approximation rather than the truth, say so on the line. There
 *    are four of them below and every one is a deliberate trade, not an oversight.
 */

/**
 * Files whose name *is* their type.
 *
 * Extension-only matching leaves `Dockerfile` and `Gemfile` as plain text, and those are
 * not obscure files - they are the ones sitting at the root of the project, which is to say
 * the first thing anybody opens.
 *
 * Matched lowercased, and after any `.` prefix, so `.env.local` and `Dockerfile.prod` both
 * land where they should.
 */
const BY_NAME: Readonly<Record<string, string>> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",

  // These are Ruby programs that happen to have no extension.
  gemfile: "ruby",
  rakefile: "ruby",
  podfile: "ruby",
  brewfile: "ruby",
  vagrantfile: "ruby",
  guardfile: "ruby",
  fastfile: "ruby",
  appfile: "ruby",

  // Approximation, and a deliberate one: a Makefile's recipes are shell, which is most of
  // the file and all of the part anybody misreads. The variable syntax is highlighted
  // wrongly, which is a smaller cost than the whole file being grey. Monaco has no
  // makefile grammar to do better with.
  makefile: "shell",
  gnumakefile: "shell",

  ".bashrc": "shell",
  ".bash_profile": "shell",
  ".zshrc": "shell",
  ".zprofile": "shell",
  ".profile": "shell",

  // `KEY=value` with `#` comments is exactly what the ini grammar draws.
  ".env": "ini",
  ".editorconfig": "ini",
  ".gitignore": "ini",
  ".gitattributes": "ini",
  ".dockerignore": "ini",
  ".npmignore": "ini",
  ".npmrc": "ini",

  ".babelrc": "json",
  ".eslintrc": "json",
  ".prettierrc": "json",
  ".stylelintrc": "json",
};

/**
 * The extension table.
 *
 * Grouped by family rather than sorted, because the reason two extensions share an id is
 * that they are the same language, and a group makes a missing member obvious.
 */
const BY_EXTENSION: Readonly<Record<string, string>> = {
  /* JavaScript and TypeScript */
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".d.ts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",

  /* Data and configuration */
  ".json": "json",
  ".jsonc": "json",
  ".json5": "json",
  ".jsonl": "json",
  ".ndjson": "json",
  ".map": "json",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "ini",
  ".ini": "ini",
  ".cfg": "ini",
  ".conf": "ini",
  ".properties": "ini",
  ".env": "ini",

  /* The web */
  ".html": "html",
  ".htm": "html",
  ".xhtml": "html",
  // Component single-file formats. Monaco has no grammar for any of them, and their
  // template half is HTML - which is the half a beginner is looking at. The script block
  // is highlighted as markup rather than as JavaScript, which is the price.
  ".vue": "html",
  ".svelte": "html",
  ".astro": "html",
  ".erb": "html",
  ".ejs": "html",
  ".hbs": "handlebars",
  ".handlebars": "handlebars",
  ".mustache": "handlebars",
  ".cshtml": "razor",
  ".razor": "razor",
  ".liquid": "liquid",
  ".twig": "twig",
  ".pug": "pug",
  ".jade": "pug",
  ".css": "css",
  ".scss": "scss",
  ".sass": "scss",
  ".less": "less",

  /* Markup and documents */
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "mdx",
  ".rst": "restructuredtext",
  ".xml": "xml",
  ".xsd": "xml",
  ".xsl": "xml",
  ".xslt": "xml",
  ".svg": "xml",
  ".rss": "xml",
  ".atom": "xml",
  ".plist": "xml",
  ".csproj": "xml",
  ".vbproj": "xml",
  ".fsproj": "xml",
  ".props": "xml",
  ".targets": "xml",
  ".xaml": "xml",

  /* Python */
  ".py": "python",
  ".pyw": "python",
  ".pyi": "python",

  /* The C family */
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".c++": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  ".h++": "cpp",
  ".ipp": "cpp",
  ".tpp": "cpp",
  ".inl": "cpp",
  ".m": "objective-c",
  ".mm": "objective-c",

  /* The JVM and .NET */
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".sc": "scala",
  ".sbt": "scala",
  // Approximation: Gradle build files are Groovy, and Monaco has no Groovy grammar. Java's
  // is the closest thing in the box - same comments, same string forms, same block syntax.
  ".groovy": "java",
  ".gradle": "java",
  ".cs": "csharp",
  ".vb": "vb",
  ".vbs": "vb",
  ".fs": "fsharp",
  ".fsi": "fsharp",
  ".fsx": "fsharp",
  ".fsscript": "fsharp",
  ".apex": "apex",
  ".cls": "apex",

  /* Systems languages */
  ".rs": "rust",
  ".go": "go",
  ".swift": "swift",
  ".zig": "cpp", // Approximation: no Zig grammar, and its syntax reads closest to C's.
  ".pas": "pascal",
  ".pp": "pascal",
  ".dpr": "pascal",

  /* Scripting */
  ".rb": "ruby",
  ".rake": "ruby",
  ".gemspec": "ruby",
  ".php": "php",
  ".phtml": "php",
  ".lua": "lua",
  ".pl": "perl",
  ".pm": "perl",
  ".t": "perl",
  ".r": "r",
  ".rmd": "r",
  ".jl": "julia",
  ".ex": "elixir",
  ".exs": "elixir",
  ".eex": "elixir",
  ".heex": "elixir",
  ".dart": "dart",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
  ".edn": "clojure",
  ".coffee": "coffeescript",
  ".tcl": "tcl",
  ".scm": "scheme",
  ".ss": "scheme",

  /* Shells */
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".ksh": "shell",
  ".fish": "shell",
  ".bat": "bat",
  ".cmd": "bat",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".psd1": "powershell",

  /* Queries, schemas and contracts */
  ".sql": "sql",
  ".pgsql": "pgsql",
  ".mysql": "mysql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".proto": "protobuf",
  ".sol": "solidity",
  ".cypher": "cypher",
  ".cyp": "cypher",
  ".sparql": "sparql",
  ".rq": "sparql",

  /* Infrastructure and hardware */
  ".tf": "hcl",
  ".tfvars": "hcl",
  ".hcl": "hcl",
  ".bicep": "bicep",
  ".dockerfile": "dockerfile",
  ".sv": "systemverilog",
  ".svh": "systemverilog",
  ".v": "systemverilog",
  ".vh": "systemverilog",
  ".wgsl": "wgsl",
  ".abap": "abap",
  ".st": "st",
};

/**
 * Every suffix of `name` that begins at a dot, longest first.
 *
 * Longest first is what makes `.d.ts` reachable at all - a plain "text after the last dot"
 * lookup can only ever see `.ts`. The search starts at index 1 so a dotfile's leading dot
 * is not read as an extension separator: `.eslintrc.json` is JSON, not a file of type
 * `.eslintrc.json`.
 */
function byExtension(name: string): string | undefined {
  for (let at = name.indexOf(".", 1); at !== -1; at = name.indexOf(".", at + 1)) {
    const found = BY_EXTENSION[name.slice(at)];
    if (found !== undefined) return found;
  }

  return undefined;
}

/**
 * The language id for a filename, or `plaintext`.
 *
 * Three passes, in this order, and the order is the whole design:
 *
 * 1. **The exact name.** `Dockerfile` and `Gemfile` have no extension to consult.
 * 2. **The extension.** `Dockerfile.md` is documentation *about* a Dockerfile and is
 *    markdown, so a real extension has to beat the name it is attached to.
 * 3. **The name before the first dot.** `Dockerfile.prod` and `.env.local` are the thing
 *    they are named after. Reached only when nothing after the dot meant anything, which
 *    is what stops `styles.css.old` from being caught here.
 */
export function languageForFilename(filename: string): string {
  const name = (filename.split(/[\\/]/).pop() ?? filename).toLowerCase();

  const exact = BY_NAME[name];
  if (exact !== undefined) return exact;

  const extension = byExtension(name);
  if (extension !== undefined) return extension;

  const firstDot = name.indexOf(".", 1);
  if (firstDot !== -1) {
    const prefix = BY_NAME[name.slice(0, firstDot)];
    if (prefix !== undefined) return prefix;
  }

  return "plaintext";
}

/** Every language id this editor will open a file as. The settings roster reads it. */
export function knownLanguageIds(): string[] {
  return [...new Set([...Object.values(BY_NAME), ...Object.values(BY_EXTENSION)])].sort();
}
