/**
 * What each language's declarations look like, as data.
 *
 * There is one outline engine and twenty-odd tables, rather than twenty-odd outline
 * implementations. That choice is the whole reason this file can grow: adding Zig is a
 * table entry and a test, not a new module with its own idea of what nesting means.
 *
 * **Why regular expressions and not parsers.** A real parser per language is the correct
 * answer for a compiler and the wrong answer here. Twenty grammars is a dependency the
 * size of the rest of the app, they disagree about error recovery, and an outline has to
 * work on the file *as it is being typed* - which is, by definition, syntactically broken
 * most of the time. A line-oriented scanner degrades gracefully: an unparseable line
 * contributes nothing and the lines around it still appear. A parser fails whole-file, and
 * a panel that empties itself while you type is worse than no panel.
 *
 * The cost is honest and worth stating: these tables recognise declarations written the
 * way they are almost always written. A function signature split across four lines is not
 * found. That is a missing row, never a wrong one, which is the failure direction to
 * choose.
 *
 * **The one rule for adding a language.** Every pattern is matched against the line with
 * its indentation removed, and must carry a named group `name`. `detail` is optional and
 * is the rest of the declaration - parameters, a base class - which the panel dims. Order
 * matters: the first rule that matches a line wins, so the specific goes above the general.
 */
import type { SymbolKind } from "./types.ts";

export interface Rule {
  readonly kind: SymbolKind;
  /** Named group `name` is required; `detail` is optional. */
  readonly pattern: RegExp;
}

/**
 * How a language nests.
 *
 * - `brace` - depth is `{` minus `}`. C, JavaScript, Rust, Go, PHP, and the rest.
 * - `indent` - depth is leading whitespace. Python, Ruby, YAML, Elixir.
 * - `markup` - tags nest inside tags. HTML, XML, SVG, Vue.
 * - `style` - selectors and at-rules, which are braces with different contents.
 * - `heading` - `#` levels. Markdown.
 * - `flat` - no nesting at all. SQL, Dockerfile, ini.
 */
export type OutlineModel = "brace" | "indent" | "markup" | "style" | "heading" | "flat";

export interface Grammar {
  readonly model: OutlineModel;
  readonly rules: readonly Rule[];
  /** Stripped before matching, so a commented-out function is not in the outline. */
  readonly lineComment: readonly string[];
}

/*
 * Fragments shared across the C family, named so a change lands in one place.
 *
 * `IDENT` deliberately allows `~` and `$`: a C++ destructor is `~Widget`, and jQuery-era
 * JavaScript is full of `$el`. `TYPEISH` is the return type and its decorations, which is
 * the part of a C or Java signature nobody wants in the outline - it is matched so it can
 * be thrown away.
 */
const IDENT = "[A-Za-z_$~][A-Za-z0-9_$]*";
const TYPEISH = "[A-Za-z_][A-Za-z0-9_:<>,\\s*&\\[\\]]*?";

/**
 * Words that look like a declaration and are not.
 *
 * `if (x) {` matches every "type name(args) {" pattern ever written, and without this list
 * every conditional in a C file becomes a function in the outline. Checked by the engine
 * rather than encoded in the patterns, because negative lookahead for thirty keywords in
 * every rule is unreadable and gets one of them wrong.
 */
export const NOT_A_DECLARATION: ReadonlySet<string> = new Set([
  "if", "else", "for", "while", "switch", "catch", "do", "return", "sizeof", "typeof",
  "new", "delete", "throw", "case", "default", "with", "await", "yield", "and", "or",
  "not", "in", "is", "assert", "elif", "except", "finally", "match", "when", "using",
  "typedef", "template", "requires", "constexpr", "static_assert", "defer", "go",
  "select", "lock", "unsafe", "fixed", "checked", "unchecked", "foreach", "try",
]);

/* ── JavaScript, TypeScript, and the JSX dialects ─────────────────────────── */

/**
 * `describe` / `it` / `test` are in here on purpose.
 *
 * A test file's structure is its describe blocks, and every other outline in every other
 * editor shows a test file as one anonymous arrow function per assertion - which is to say,
 * as nothing. These names are the one place where a *call* is the declaration.
 */
const JS_RULES: readonly Rule[] = [
  { kind: "import", pattern: /^import\s+(?:type\s+)?(?<name>[^;]+?)\s+from\s+["'](?<detail>[^"']+)["']/ },
  { kind: "import", pattern: /^import\s+["'](?<name>[^"']+)["']/ },
  {
    kind: "function",
    pattern: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(?<name>[A-Za-z_$][\w$]*)\s*(?<detail>\([^)]*\))?/,
  },
  {
    kind: "class",
    pattern: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(?<name>[A-Za-z_$][\w$]*)\s*(?<detail>(?:extends|implements)[^{]*)?/,
  },
  { kind: "interface", pattern: /^(?:export\s+)?(?:declare\s+)?interface\s+(?<name>[A-Za-z_$][\w$]*)\s*(?<detail><[^{]*>)?/ },
  { kind: "type", pattern: /^(?:export\s+)?(?:declare\s+)?type\s+(?<name>[A-Za-z_$][\w$]*)/ },
  { kind: "enum", pattern: /^(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+(?<name>[A-Za-z_$][\w$]*)/ },
  // An arrow or function expression bound to a name is a function, and is how most modern
  // JavaScript declares one. Matched before the plain `const`, which would swallow it.
  {
    kind: "function",
    pattern: /^(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?<detail>\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/,
  },
  {
    kind: "function",
    pattern: /^(?:export\s+)?(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\*?\s*(?<detail>\([^)]*\))?/,
  },
  { kind: "constant", pattern: /^(?:export\s+)?const\s+(?<name>[A-Za-z_$][\w$]*)\s*(?::\s*(?<detail>[^=]+?))?\s*=/ },
  { kind: "variable", pattern: /^(?:export\s+)?(?:let|var)\s+(?<name>[A-Za-z_$][\w$]*)/ },
  { kind: "function", pattern: /^(?<name>describe|it|test|suite|bench)\s*(?:\.\w+)?\s*\(\s*["'`](?<detail>[^"'`]+)["'`]/ },
  { kind: "constructor", pattern: /^(?<name>constructor)\s*(?<detail>\([^)]*\))/ },
  // Class members. `get`/`set`/`static`/`async` are prefixes, not the name, and the
  // trailing `{` is what separates a method from a call sitting on its own line.
  {
    kind: "method",
    pattern: /^(?:public\s+|private\s+|protected\s+|readonly\s+)?(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?\*?\s*(?<name>[A-Za-z_$#][\w$]*)\s*(?<detail>\([^)]*\))\s*(?::[^{;]+)?\{/,
  },
];

/* ── Python ───────────────────────────────────────────────────────────────── */

const PYTHON_RULES: readonly Rule[] = [
  { kind: "import", pattern: /^(?:from\s+(?<detail>[\w.]+)\s+)?import\s+(?<name>[\w.,*\s]+)/ },
  { kind: "class", pattern: /^class\s+(?<name>\w+)\s*(?<detail>\([^)]*\))?/ },
  { kind: "function", pattern: /^(?:async\s+)?def\s+(?<name>\w+)\s*(?<detail>\([^)]*\))?/ },
  // Only SHOUTING names. Every other assignment in a Python file is a local, and listing
  // them turns a fifty-line module into a two-hundred-row outline nobody reads.
  { kind: "constant", pattern: /^(?<name>[A-Z][A-Z0-9_]+)\s*(?::[^=]+)?=/ },
];

/* ── C, C++, and Objective-C ──────────────────────────────────────────────── */

const C_RULES: readonly Rule[] = [
  { kind: "import", pattern: /^#\s*(?:include|import)\s*[<"](?<name>[^>"]+)[>"]/ },
  { kind: "macro", pattern: /^#\s*define\s+(?<name>\w+)\s*(?<detail>\([^)]*\))?/ },
  { kind: "namespace", pattern: /^namespace\s+(?<name>[\w:]+)/ },
  { kind: "class", pattern: /^(?:template\s*<[^>]*>\s*)?class\s+(?<name>\w+)\s*(?<detail>:[^{;]+)?/ },
  { kind: "struct", pattern: /^(?:template\s*<[^>]*>\s*)?struct\s+(?<name>\w+)\s*(?<detail>:[^{;]+)?/ },
  { kind: "struct", pattern: /^union\s+(?<name>\w+)/ },
  { kind: "enum", pattern: /^enum\s+(?:class\s+|struct\s+)?(?<name>\w+)/ },
  { kind: "type", pattern: /^using\s+(?<name>\w+)\s*=/ },
  // Objective-C, whose declarations look nothing like C's.
  { kind: "class", pattern: /^@(?:interface|implementation)\s+(?<name>\w+)\s*(?<detail>:[^{]*)?/ },
  { kind: "method", pattern: /^[-+]\s*\((?<detail>[^)]*)\)\s*(?<name>\w+)/ },
  /*
   * A function definition, which in C is "some type, a name, parentheses, and a brace".
   *
   * The trailing `{` is doing the real work: without it this matches every function
   * *call* on its own line, and a file that calls `printf` forty times gets forty rows.
   * Declarations ending in `;` are prototypes and are deliberately left out - a header's
   * outline should be its types, and listing each prototype beside the definition in the
   * `.c` doubles the noise for no new information.
   */
  {
    kind: "function",
    pattern: new RegExp(
      "^(?:(?:static|inline|extern|virtual|explicit|constexpr|friend)\\s+)*" +
        `(?:${TYPEISH}[\\s*&]+)?(?<name>${IDENT}(?:::${IDENT})?)\\s*` +
        "\\((?<detail>[^;{]*)\\)\\s*(?:const\\s*)?(?:noexcept\\s*)?(?:override\\s*)?(?:->[^{]+)?\\{",
    ),
  },
];

/* ── Java, C#, Kotlin, Scala, Swift ───────────────────────────────────────── */

const JVM_MODIFIERS =
  "(?:public|private|protected|internal|static|final|abstract|sealed|override|open|" +
  "virtual|async|suspend|inline|data|partial|const|readonly|lateinit|operator|" +
  "companion|implicit|@\\w+)";

const JAVA_RULES: readonly Rule[] = [
  { kind: "namespace", pattern: /^(?:package|namespace)\s+(?<name>[\w.]+)/ },
  { kind: "import", pattern: /^(?:import|using)\s+(?:static\s+)?(?<name>[\w.*]+)/ },
  {
    kind: "class",
    pattern: new RegExp(
      `^(?:${JVM_MODIFIERS}\\s+)*(?:class|record|object)\\s+(?<name>\\w+)\\s*(?<detail>(?:<[^>]*>)?(?:\\s*[:(]|\\s+extends|\\s+implements)[^{]*)?`,
    ),
  },
  { kind: "interface", pattern: new RegExp(`^(?:${JVM_MODIFIERS}\\s+)*(?:interface|protocol|trait)\\s+(?<name>\\w+)`) },
  { kind: "enum", pattern: new RegExp(`^(?:${JVM_MODIFIERS}\\s+)*enum(?:\\s+class)?\\s+(?<name>\\w+)`) },
  { kind: "struct", pattern: new RegExp(`^(?:${JVM_MODIFIERS}\\s+)*struct\\s+(?<name>\\w+)`) },
  { kind: "type", pattern: /^(?:typealias|type)\s+(?<name>\w+)/ },
  // Kotlin and Swift put the name before the parameters and the type after them.
  { kind: "function", pattern: new RegExp(`^(?:${JVM_MODIFIERS}\\s+)*(?:fun|func|def)\\s+(?<name>\\w+)\\s*(?<detail>\\([^)]*\\))?`) },
  { kind: "constructor", pattern: /^(?:public\s+|internal\s+)?(?<name>init)\s*(?<detail>\([^)]*\))/ },
  { kind: "property", pattern: new RegExp(`^(?:${JVM_MODIFIERS}\\s+)*(?:val|var|let)\\s+(?<name>\\w+)\\s*(?<detail>:[^={]+)?`) },
  // Java and C#: modifiers, a return type, a name, parameters, a brace.
  {
    kind: "method",
    pattern: new RegExp(
      `^(?:${JVM_MODIFIERS}\\s+)*(?:${TYPEISH}[\\s*]+)?(?<name>\\w+)\\s*\\((?<detail>[^;{]*)\\)\\s*(?:throws [\\w.,\\s]+)?\\{`,
    ),
  },
];

/* ── Go ───────────────────────────────────────────────────────────────────── */

const GO_RULES: readonly Rule[] = [
  { kind: "namespace", pattern: /^package\s+(?<name>\w+)/ },
  { kind: "import", pattern: /^(?:import\s+)?(?:\w+\s+)?"(?<name>[\w./-]+)"$/ },
  // The receiver comes first and is the thing that makes this a method rather than a
  // function, so it is captured as the detail rather than discarded.
  { kind: "method", pattern: /^func\s+(?<detail>\([^)]*\))\s+(?<name>\w+)\s*\([^)]*\)/ },
  { kind: "function", pattern: /^func\s+(?<name>\w+)\s*(?<detail>\([^)]*\))/ },
  { kind: "struct", pattern: /^type\s+(?<name>\w+)\s+(?<detail>struct)/ },
  { kind: "interface", pattern: /^type\s+(?<name>\w+)\s+(?<detail>interface)/ },
  { kind: "type", pattern: /^type\s+(?<name>\w+)/ },
  { kind: "constant", pattern: /^const\s+(?<name>\w+)/ },
  { kind: "variable", pattern: /^var\s+(?<name>\w+)/ },
];

/* ── Rust ─────────────────────────────────────────────────────────────────── */

const RUST_RULES: readonly Rule[] = [
  { kind: "import", pattern: /^(?:pub\s+)?use\s+(?<name>[\w:{}*,\s]+);/ },
  { kind: "macro", pattern: /^macro_rules!\s*(?<name>\w+)/ },
  { kind: "module", pattern: /^(?:pub(?:\([^)]*\))?\s+)?mod\s+(?<name>\w+)/ },
  {
    kind: "function",
    pattern: /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+(?<name>\w+)\s*(?:<[^>]*>)?\s*(?<detail>\([^)]*\))?/,
  },
  { kind: "struct", pattern: /^(?:pub(?:\([^)]*\))?\s+)?struct\s+(?<name>\w+)/ },
  { kind: "enum", pattern: /^(?:pub(?:\([^)]*\))?\s+)?enum\s+(?<name>\w+)/ },
  { kind: "interface", pattern: /^(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+(?<name>\w+)/ },
  { kind: "class", pattern: /^impl(?:<[^>]*>)?\s+(?<name>[\w:<>,\s]+?)(?<detail>\s+for\s+[\w:<>,\s]+)?\s*\{/ },
  { kind: "type", pattern: /^(?:pub\s+)?type\s+(?<name>\w+)/ },
  { kind: "constant", pattern: /^(?:pub\s+)?(?:const|static)\s+(?:mut\s+)?(?<name>\w+)/ },
];

/* ── Ruby ─────────────────────────────────────────────────────────────────── */

const RUBY_RULES: readonly Rule[] = [
  { kind: "import", pattern: /^require(?:_relative)?\s+["'](?<name>[^"']+)["']/ },
  { kind: "module", pattern: /^module\s+(?<name>[\w:]+)/ },
  { kind: "class", pattern: /^class\s+(?<name>[\w:]+)\s*(?<detail><[^;]*)?/ },
  { kind: "method", pattern: /^def\s+(?<name>[\w.?!=]+)\s*(?<detail>\([^)]*\))?/ },
  { kind: "function", pattern: /^(?<name>describe|context|it|scenario|feature)\s+["'](?<detail>[^"']+)["']/ },
  { kind: "constant", pattern: /^(?<name>[A-Z][A-Za-z0-9_]*)\s*=/ },
];

/* ── PHP ──────────────────────────────────────────────────────────────────── */

const PHP_RULES: readonly Rule[] = [
  { kind: "namespace", pattern: /^namespace\s+(?<name>[\w\\]+)/ },
  { kind: "import", pattern: /^use\s+(?<name>[\w\\]+)/ },
  { kind: "import", pattern: /^(?:require|include)(?:_once)?\s*\(?\s*["'](?<name>[^"']+)["']/ },
  { kind: "class", pattern: /^(?:abstract\s+|final\s+)?class\s+(?<name>\w+)\s*(?<detail>(?:extends|implements)[^{]*)?/ },
  { kind: "interface", pattern: /^(?:interface|trait)\s+(?<name>\w+)/ },
  {
    kind: "function",
    pattern: /^(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+(?<name>\w+)\s*(?<detail>\([^)]*\))?/,
  },
  { kind: "constant", pattern: /^const\s+(?<name>\w+)/ },
];

/* ── Shell, PowerShell ────────────────────────────────────────────────────── */

const SHELL_RULES: readonly Rule[] = [
  { kind: "function", pattern: /^(?:function\s+)?(?<name>[\w.-]+)\s*\(\s*\)\s*\{/ },
  { kind: "function", pattern: /^function\s+(?<name>[\w.:-]+)/ },
  { kind: "constant", pattern: /^(?:export|readonly)\s+(?<name>\w+)=/ },
  { kind: "variable", pattern: /^(?<name>[A-Z][A-Z0-9_]*)=/ },
];

/**
 * Batch, whose only structure is its labels.
 *
 * A `.cmd` file has no functions - it has `:name` labels that `call` and `goto` jump to,
 * and that is genuinely what a reader is looking for when they open one. Flat, because
 * batch has no nesting of any kind.
 */
const BAT_RULES: readonly Rule[] = [
  { kind: "function", pattern: /^:(?<name>[\w.-]+)\s*(?<detail>.*)$/ },
  { kind: "variable", pattern: /^set\s+(?:\/[aApP]\s+)?"?(?<name>[\w]+)=/i },
];

const POWERSHELL_RULES: readonly Rule[] = [
  { kind: "function", pattern: /^function\s+(?<name>[\w-]+)/i },
  { kind: "class", pattern: /^class\s+(?<name>\w+)/i },
  { kind: "variable", pattern: /^\$(?<name>\w+)\s*=/ },
];

/* ── The smaller tables ───────────────────────────────────────────────────── */

const LUA_RULES: readonly Rule[] = [
  { kind: "function", pattern: /^(?:local\s+)?function\s+(?<name>[\w.:]+)\s*(?<detail>\([^)]*\))?/ },
  { kind: "function", pattern: /^(?:local\s+)?(?<name>[\w.]+)\s*=\s*function\s*(?<detail>\([^)]*\))?/ },
  { kind: "variable", pattern: /^local\s+(?<name>\w+)/ },
];

const PERL_RULES: readonly Rule[] = [
  { kind: "import", pattern: /^use\s+(?<name>[\w:]+)/ },
  { kind: "namespace", pattern: /^package\s+(?<name>[\w:]+)/ },
  { kind: "function", pattern: /^sub\s+(?<name>\w+)/ },
];

const R_RULES: readonly Rule[] = [
  { kind: "import", pattern: /^(?:library|require)\s*\(\s*(?<name>[\w."']+)\s*\)/ },
  { kind: "function", pattern: /^(?<name>[\w.]+)\s*(?:<-|=)\s*function\s*(?<detail>\([^)]*\))?/ },
];

const JULIA_RULES: readonly Rule[] = [
  { kind: "module", pattern: /^module\s+(?<name>\w+)/ },
  { kind: "import", pattern: /^(?:using|import)\s+(?<name>[\w.,\s]+)/ },
  { kind: "struct", pattern: /^(?:mutable\s+)?struct\s+(?<name>\w+)/ },
  { kind: "function", pattern: /^function\s+(?<name>[\w.!]+)\s*(?<detail>\([^)]*\))?/ },
  { kind: "macro", pattern: /^macro\s+(?<name>\w+)/ },
];

const ELIXIR_RULES: readonly Rule[] = [
  { kind: "module", pattern: /^defmodule\s+(?<name>[\w.]+)/ },
  { kind: "macro", pattern: /^defmacrop?\s+(?<name>[\w?!]+)/ },
  { kind: "function", pattern: /^defp?\s+(?<name>[\w?!]+)\s*(?<detail>\([^)]*\))?/ },
  { kind: "import", pattern: /^(?:import|alias|use|require)\s+(?<name>[\w.{}, ]+)/ },
];

const DART_RULES: readonly Rule[] = [
  { kind: "import", pattern: /^(?:import|export|part)\s+["'](?<name>[^"']+)["']/ },
  { kind: "class", pattern: /^(?:abstract\s+)?class\s+(?<name>\w+)\s*(?<detail>(?:extends|implements|with)[^{]*)?/ },
  { kind: "enum", pattern: /^enum\s+(?<name>\w+)/ },
  { kind: "type", pattern: /^typedef\s+(?<name>\w+)/ },
  { kind: "method", pattern: /^(?:static\s+|final\s+)?(?:[\w<>,\s?]+\s+)?(?<name>\w+)\s*(?<detail>\([^)]*\))\s*(?:async\s*)?\{/ },
];

const SQL_RULES: readonly Rule[] = [
  {
    kind: "class",
    pattern: /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?<name>[\w."`[\]]+)/i,
  },
  { kind: "interface", pattern: /^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?<name>[\w."`[\]]+)/i },
  {
    kind: "function",
    pattern: /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(?<name>[\w."`[\]]+)\s*(?<detail>\([^)]*\))?/i,
  },
  { kind: "property", pattern: /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?<name>[\w."`[\]]+)/i },
  { kind: "type", pattern: /^ALTER\s+TABLE\s+(?<name>[\w."`[\]]+)/i },
];

const DOCKER_RULES: readonly Rule[] = [
  { kind: "class", pattern: /^FROM\s+(?<name>\S+)(?<detail>\s+AS\s+\S+)?/i },
  { kind: "variable", pattern: /^(?:ENV|ARG)\s+(?<name>\w+)/i },
  { kind: "function", pattern: /^(?<name>RUN|CMD|ENTRYPOINT|COPY|ADD|WORKDIR|EXPOSE|VOLUME|USER)\s+(?<detail>.+)/i },
];

const INI_RULES: readonly Rule[] = [
  { kind: "namespace", pattern: /^\[(?<name>[^\]]+)\]/ },
  { kind: "key", pattern: /^(?<name>[\w.-]+)\s*=/ },
];

const GRAPHQL_RULES: readonly Rule[] = [
  { kind: "class", pattern: /^type\s+(?<name>\w+)\s*(?<detail>implements[^{]*)?/ },
  { kind: "interface", pattern: /^interface\s+(?<name>\w+)/ },
  { kind: "enum", pattern: /^enum\s+(?<name>\w+)/ },
  { kind: "struct", pattern: /^input\s+(?<name>\w+)/ },
  { kind: "function", pattern: /^(?:query|mutation|subscription|fragment)\s+(?<name>\w+)/ },
];

const PROTO_RULES: readonly Rule[] = [
  { kind: "namespace", pattern: /^package\s+(?<name>[\w.]+)/ },
  { kind: "import", pattern: /^import\s+"(?<name>[^"]+)"/ },
  { kind: "struct", pattern: /^message\s+(?<name>\w+)/ },
  { kind: "interface", pattern: /^service\s+(?<name>\w+)/ },
  { kind: "enum", pattern: /^enum\s+(?<name>\w+)/ },
  { kind: "method", pattern: /^rpc\s+(?<name>\w+)\s*(?<detail>\([^)]*\)(?:\s*returns\s*\([^)]*\))?)/ },
];

const SOLIDITY_RULES: readonly Rule[] = [
  { kind: "import", pattern: /^import\s+.*["'](?<name>[^"']+)["']/ },
  { kind: "class", pattern: /^(?:abstract\s+)?contract\s+(?<name>\w+)\s*(?<detail>is[^{]*)?/ },
  { kind: "interface", pattern: /^interface\s+(?<name>\w+)/ },
  { kind: "module", pattern: /^library\s+(?<name>\w+)/ },
  { kind: "struct", pattern: /^struct\s+(?<name>\w+)/ },
  { kind: "enum", pattern: /^enum\s+(?<name>\w+)/ },
  { kind: "constructor", pattern: /^(?<name>constructor)\s*(?<detail>\([^)]*\))?/ },
  { kind: "function", pattern: /^function\s+(?<name>\w+)\s*(?<detail>\([^)]*\))?/ },
  { kind: "property", pattern: /^event\s+(?<name>\w+)/ },
];

const VB_RULES: readonly Rule[] = [
  { kind: "module", pattern: /^(?:Public\s+|Private\s+)?Module\s+(?<name>\w+)/i },
  { kind: "class", pattern: /^(?:Public\s+|Private\s+|Friend\s+)?Class\s+(?<name>\w+)/i },
  {
    kind: "function",
    pattern: /^(?:Public\s+|Private\s+|Protected\s+|Friend\s+|Shared\s+)*(?:Function|Sub)\s+(?<name>\w+)\s*(?<detail>\([^)]*\))?/i,
  },
];

const PASCAL_RULES: readonly Rule[] = [
  { kind: "module", pattern: /^(?:unit|program)\s+(?<name>\w+)/i },
  { kind: "function", pattern: /^(?:function|procedure)\s+(?<name>[\w.]+)\s*(?<detail>\([^)]*\))?/i },
  { kind: "type", pattern: /^(?<name>\w+)\s*=\s*(?:class|record|interface)/i },
];

const CLOJURE_RULES: readonly Rule[] = [
  { kind: "namespace", pattern: /^\(ns\s+(?<name>[\w./-]+)/ },
  { kind: "function", pattern: /^\(defn-?\s+(?<name>[\w./*+!?<>=-]+)/ },
  { kind: "macro", pattern: /^\(defmacro\s+(?<name>[\w./*+!?<>=-]+)/ },
  { kind: "constant", pattern: /^\(def\s+(?<name>[\w./*+!?<>=-]+)/ },
];

const FSHARP_RULES: readonly Rule[] = [
  { kind: "module", pattern: /^(?:module|namespace)\s+(?<name>[\w.]+)/ },
  { kind: "import", pattern: /^open\s+(?<name>[\w.]+)/ },
  { kind: "class", pattern: /^type\s+(?<name>\w+)/ },
  { kind: "function", pattern: /^let\s+(?:rec\s+)?(?:inline\s+)?(?<name>[\w']+)\s+(?<detail>[\w\s():,']*)=/ },
  { kind: "variable", pattern: /^let\s+(?:mutable\s+)?(?<name>[\w']+)\s*=/ },
];

const YAML_RULES: readonly Rule[] = [
  { kind: "key", pattern: /^(?:-\s+)?(?<name>[\w.$-]+)\s*:(?:\s+(?<detail>.+))?$/ },
];

/**
 * JSON is the brace engine with one rule, which is the point of having an engine.
 *
 * A `.json` file's shape is its keys, nested exactly as its braces nest - so the same code
 * that outlines a C file outlines a `package.json`, and the only new thing in the world is
 * this one line.
 */
const JSON_RULES: readonly Rule[] = [
  { kind: "key", pattern: /^"(?<name>[^"]+)"\s*:\s*(?<detail>[^,]*?),?$/ },
];

/**
 * Languages whose shape is read by a dedicated scanner rather than by line rules.
 *
 * They still need an entry, because `grammarFor` returning null is how the panel decides to
 * say "ADCode cannot read this file's shape yet" - and saying that about HTML would be
 * false in the most visible way possible.
 */
const NO_RULES: readonly Rule[] = [];

const SLASHES = ["//"];
const HASH = ["#"];
const NO_COMMENT: readonly string[] = [];

/**
 * Monaco language id to grammar.
 *
 * Keyed by Monaco's ids rather than by file extension, because that is what the editor
 * already decided when it opened the file - and having two places that map extensions to
 * languages is how a `.mjs` file ends up highlighted as JavaScript and outlined as nothing.
 */
export const GRAMMARS: Readonly<Record<string, Grammar>> = {
  typescript: { model: "brace", rules: JS_RULES, lineComment: SLASHES },
  javascript: { model: "brace", rules: JS_RULES, lineComment: SLASHES },
  python: { model: "indent", rules: PYTHON_RULES, lineComment: HASH },
  c: { model: "brace", rules: C_RULES, lineComment: SLASHES },
  cpp: { model: "brace", rules: C_RULES, lineComment: SLASHES },
  "objective-c": { model: "brace", rules: C_RULES, lineComment: SLASHES },
  java: { model: "brace", rules: JAVA_RULES, lineComment: SLASHES },
  csharp: { model: "brace", rules: JAVA_RULES, lineComment: SLASHES },
  kotlin: { model: "brace", rules: JAVA_RULES, lineComment: SLASHES },
  scala: { model: "brace", rules: JAVA_RULES, lineComment: SLASHES },
  swift: { model: "brace", rules: JAVA_RULES, lineComment: SLASHES },
  go: { model: "brace", rules: GO_RULES, lineComment: SLASHES },
  rust: { model: "brace", rules: RUST_RULES, lineComment: SLASHES },
  ruby: { model: "indent", rules: RUBY_RULES, lineComment: HASH },
  php: { model: "brace", rules: PHP_RULES, lineComment: [...SLASHES, ...HASH] },
  shell: { model: "brace", rules: SHELL_RULES, lineComment: HASH },
  powershell: { model: "brace", rules: POWERSHELL_RULES, lineComment: HASH },
  bat: { model: "flat", rules: BAT_RULES, lineComment: ["rem ", "::"] },
  lua: { model: "brace", rules: LUA_RULES, lineComment: ["--"] },
  perl: { model: "brace", rules: PERL_RULES, lineComment: HASH },
  r: { model: "brace", rules: R_RULES, lineComment: HASH },
  julia: { model: "indent", rules: JULIA_RULES, lineComment: HASH },
  elixir: { model: "indent", rules: ELIXIR_RULES, lineComment: HASH },
  dart: { model: "brace", rules: DART_RULES, lineComment: SLASHES },
  coffeescript: { model: "indent", rules: JS_RULES, lineComment: HASH },
  sql: { model: "flat", rules: SQL_RULES, lineComment: ["--"] },
  dockerfile: { model: "flat", rules: DOCKER_RULES, lineComment: HASH },
  ini: { model: "flat", rules: INI_RULES, lineComment: [";", "#"] },
  graphql: { model: "brace", rules: GRAPHQL_RULES, lineComment: HASH },
  protobuf: { model: "brace", rules: PROTO_RULES, lineComment: SLASHES },
  solidity: { model: "brace", rules: SOLIDITY_RULES, lineComment: SLASHES },
  vb: { model: "flat", rules: VB_RULES, lineComment: ["'"] },
  pascal: { model: "flat", rules: PASCAL_RULES, lineComment: SLASHES },
  clojure: { model: "flat", rules: CLOJURE_RULES, lineComment: [";"] },
  fsharp: { model: "indent", rules: FSHARP_RULES, lineComment: SLASHES },
  yaml: { model: "indent", rules: YAML_RULES, lineComment: HASH },

  html: { model: "markup", rules: NO_RULES, lineComment: NO_COMMENT },
  xml: { model: "markup", rules: NO_RULES, lineComment: NO_COMMENT },
  handlebars: { model: "markup", rules: NO_RULES, lineComment: NO_COMMENT },
  razor: { model: "markup", rules: NO_RULES, lineComment: NO_COMMENT },
  css: { model: "style", rules: NO_RULES, lineComment: NO_COMMENT },
  scss: { model: "style", rules: NO_RULES, lineComment: SLASHES },
  less: { model: "style", rules: NO_RULES, lineComment: SLASHES },
  markdown: { model: "heading", rules: NO_RULES, lineComment: NO_COMMENT },
  json: { model: "brace", rules: JSON_RULES, lineComment: SLASHES },
};

export function grammarFor(languageId: string): Grammar | null {
  return GRAMMARS[languageId] ?? null;
}

/** Every language whose shape ADCode can read. The settings roster lists these. */
export function supportedLanguages(): string[] {
  return Object.keys(GRAMMARS).sort();
}
