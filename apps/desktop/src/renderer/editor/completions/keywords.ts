/**
 * Completions for the languages that have no language worker.
 *
 * Monaco ships real, type-aware completions for TypeScript, JavaScript, JSON, CSS and
 * HTML - five languages out of the seventy-odd it can syntax-highlight. In every other
 * language the suggest widget has historically had nothing to offer but words already
 * typed in the file, which is least useful exactly when a beginner needs it most: on the
 * first line of an empty Python file.
 *
 * This is the honest middle. It is not semantic analysis and does not pretend to be: it
 * knows a language's keywords and the shape of its most common constructs, and no more.
 * A learner writing Python gets `for`, `def`, and a `if __name__ == "__main__"` block with
 * the body already indented, which is most of what the first week actually consists of.
 *
 * Pure data and a pure lookup - no Monaco import, no DOM - so the tables are testable
 * without a window, and so this file cannot quietly grow a dependency on the editor.
 *
 * `insert` uses Monaco's snippet syntax: `${1:name}` is a tab stop with placeholder text,
 * `$0` is where the cursor finishes.
 */

export type SuggestionKind = "keyword" | "snippet" | "function";

export interface KeywordSuggestion {
  readonly label: string;
  readonly insert: string;
  /** Shown beside the label in the widget. Written for someone who does not know yet. */
  readonly detail: string;
  readonly kind: SuggestionKind;
}

function keyword(label: string, detail: string): KeywordSuggestion {
  return { label, insert: label, detail, kind: "keyword" };
}

function snippet(label: string, insert: string, detail: string): KeywordSuggestion {
  return { label, insert, detail, kind: "snippet" };
}

function fn(label: string, insert: string, detail: string): KeywordSuggestion {
  return { label, insert, detail, kind: "function" };
}

/** Turn a bare keyword list into suggestions sharing one description. */
function keywords(detail: string, ...labels: string[]): KeywordSuggestion[] {
  return labels.map((label) => keyword(label, detail));
}

const PYTHON: readonly KeywordSuggestion[] = [
  snippet("def", "def ${1:name}(${2:args}):\n\t${0:pass}", "Define a function"),
  snippet("class", "class ${1:Name}:\n\tdef __init__(self${2}):\n\t\t${0:pass}", "Define a class"),
  snippet("if", "if ${1:condition}:\n\t${0:pass}", "Run code only when something is true"),
  snippet("ifmain", 'if __name__ == "__main__":\n\t${0:main()}', "Run this file directly"),
  snippet("for", "for ${1:item} in ${2:items}:\n\t${0:pass}", "Repeat once per item"),
  snippet("while", "while ${1:condition}:\n\t${0:pass}", "Repeat while something is true"),
  snippet("try", "try:\n\t${1:pass}\nexcept ${2:Exception} as e:\n\t${0:print(e)}", "Handle an error"),
  snippet("with", "with open(${1:path}) as ${2:f}:\n\t${0:pass}", "Open something and close it after"),
  fn("print", "print(${0})", "Show a value in the terminal"),
  fn("len", "len(${0})", "How many items something has"),
  fn("range", "range(${0:10})", "A sequence of numbers"),
  fn("input", "input(${0})", "Ask the person running the program for text"),
  ...keywords(
    "Python keyword",
    "elif", "else", "return", "import", "from", "as", "pass", "break", "continue",
    "lambda", "yield", "raise", "finally", "assert", "global", "nonlocal", "del",
    "and", "or", "not", "in", "is", "None", "True", "False", "async", "await",
  ),
];

const RUST: readonly KeywordSuggestion[] = [
  snippet("fn", "fn ${1:name}(${2}) {\n\t${0}\n}", "Define a function"),
  snippet("main", "fn main() {\n\t${0}\n}", "The function your program starts at"),
  snippet("struct", "struct ${1:Name} {\n\t${0}\n}", "Define a type with named fields"),
  snippet("enum", "enum ${1:Name} {\n\t${0}\n}", "Define a type with several variants"),
  snippet("impl", "impl ${1:Type} {\n\t${0}\n}", "Attach methods to a type"),
  snippet("match", "match ${1:value} {\n\t${2:pattern} => ${3},\n\t_ => ${0},\n}", "Branch on a value's shape"),
  snippet("for", "for ${1:item} in ${2:items} {\n\t${0}\n}", "Repeat once per item"),
  snippet("if", "if ${1:condition} {\n\t${0}\n}", "Run code only when something is true"),
  snippet("iflet", "if let ${1:Some(value)} = ${2:option} {\n\t${0}\n}", "Run code if a value is there"),
  snippet("test", "#[test]\nfn ${1:name}() {\n\t${0}\n}", "A test the compiler will run"),
  fn("println", 'println!("${0}")', "Print a line to the terminal"),
  ...keywords(
    "Rust keyword",
    "let", "mut", "const", "static", "pub", "use", "mod", "crate", "trait", "type",
    "where", "while", "loop", "return", "break", "continue", "else", "move", "ref",
    "self", "Self", "dyn", "async", "await", "unsafe", "as", "in",
  ),
];

const GO: readonly KeywordSuggestion[] = [
  snippet("func", "func ${1:name}(${2}) ${3}{\n\t${0}\n}", "Define a function"),
  snippet("main", "func main() {\n\t${0}\n}", "The function your program starts at"),
  snippet("if", "if ${1:condition} {\n\t${0}\n}", "Run code only when something is true"),
  snippet("iferr", "if err != nil {\n\t${0:return err}\n}", "Handle an error"),
  snippet("for", "for ${1:i} := 0; ${1:i} < ${2:n}; ${1:i}++ {\n\t${0}\n}", "Repeat a number of times"),
  snippet("forrange", "for ${1:i}, ${2:v} := range ${3:items} {\n\t${0}\n}", "Repeat once per item"),
  snippet("struct", "type ${1:Name} struct {\n\t${0}\n}", "Define a type with named fields"),
  snippet("switch", "switch ${1:value} {\ncase ${2}:\n\t${0}\n}", "Branch on a value"),
  fn("Println", "fmt.Println(${0})", "Print a line to the terminal"),
  ...keywords(
    "Go keyword",
    "package", "import", "var", "const", "type", "interface", "map", "chan", "go",
    "defer", "return", "break", "continue", "else", "range", "select", "case", "default",
  ),
];

const JAVA: readonly KeywordSuggestion[] = [
  snippet("main", "public static void main(String[] args) {\n\t${0}\n}", "Where your program starts"),
  snippet("class", "public class ${1:Name} {\n\t${0}\n}", "Define a class"),
  snippet("if", "if (${1:condition}) {\n\t${0}\n}", "Run code only when something is true"),
  snippet("for", "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${0}\n}", "Repeat a number of times"),
  snippet("foreach", "for (${1:Type} ${2:item} : ${3:items}) {\n\t${0}\n}", "Repeat once per item"),
  snippet("try", "try {\n\t${1}\n} catch (${2:Exception} e) {\n\t${0}\n}", "Handle an error"),
  fn("sout", "System.out.println(${0});", "Print a line to the terminal"),
  // `class` is deliberately absent: the snippet above already offers it, with the braces
  // and the body, and two entries under one label is a widget that looks broken.
  ...keywords(
    "Java keyword",
    "public", "private", "protected", "static", "final", "void", "return", "new",
    "interface", "extends", "implements", "import", "package", "this", "super",
    "while", "switch", "case", "break", "continue", "else", "throw", "throws", "null",
  ),
];

const C_FAMILY: readonly KeywordSuggestion[] = [
  snippet("main", "int main(void) {\n\t${0}\n\treturn 0;\n}", "Where your program starts"),
  snippet("if", "if (${1:condition}) {\n\t${0}\n}", "Run code only when something is true"),
  snippet("for", "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${0}\n}", "Repeat a number of times"),
  snippet("while", "while (${1:condition}) {\n\t${0}\n}", "Repeat while something is true"),
  snippet("struct", "struct ${1:Name} {\n\t${0}\n};", "Define a type with named fields"),
  fn("printf", 'printf("${1}\\n"${0});', "Print to the terminal"),
  ...keywords(
    "C keyword",
    "include", "define", "int", "char", "float", "double", "long", "short", "unsigned",
    "void", "const", "static", "return", "break", "continue", "else", "switch", "case",
    "sizeof", "typedef", "enum", "union", "NULL",
  ),
];

const RUBY: readonly KeywordSuggestion[] = [
  snippet("def", "def ${1:name}\n\t${0}\nend", "Define a method"),
  snippet("class", "class ${1:Name}\n\t${0}\nend", "Define a class"),
  snippet("if", "if ${1:condition}\n\t${0}\nend", "Run code only when something is true"),
  snippet("each", "${1:items}.each do |${2:item}|\n\t${0}\nend", "Repeat once per item"),
  fn("puts", "puts ${0}", "Print a line to the terminal"),
  ...keywords(
    "Ruby keyword",
    "end", "do", "module", "require", "attr_accessor", "unless", "elsif", "else",
    "while", "until", "return", "yield", "begin", "rescue", "ensure", "nil", "self",
  ),
];

const PHP: readonly KeywordSuggestion[] = [
  snippet("function", "function ${1:name}(${2}) {\n\t${0}\n}", "Define a function"),
  snippet("if", "if (${1:condition}) {\n\t${0}\n}", "Run code only when something is true"),
  snippet("foreach", "foreach (${1:$items} as ${2:$item}) {\n\t${0}\n}", "Repeat once per item"),
  fn("echo", "echo ${0};", "Output a value"),
  // `function` is deliberately absent: the snippet above already offers it with its body.
  ...keywords(
    "PHP keyword",
    "class", "public", "private", "protected", "static", "return", "new",
    "use", "namespace", "require", "include", "else", "elseif", "while", "for", "array",
  ),
];

const SHELL: readonly KeywordSuggestion[] = [
  snippet("if", "if [ ${1:condition} ]; then\n\t${0}\nfi", "Run code only when something is true"),
  snippet("for", "for ${1:item} in ${2:items}; do\n\t${0}\ndone", "Repeat once per item"),
  snippet("while", "while ${1:condition}; do\n\t${0}\ndone", "Repeat while something is true"),
  snippet("function", "${1:name}() {\n\t${0}\n}", "Define a function"),
  ...keywords("Shell keyword", "then", "else", "elif", "fi", "do", "done", "case", "esac", "echo", "export", "local", "return"),
];

const SQL: readonly KeywordSuggestion[] = [
  snippet("select", "SELECT ${1:*}\nFROM ${2:table}\nWHERE ${0:condition};", "Read rows from a table"),
  snippet("insert", "INSERT INTO ${1:table} (${2:columns})\nVALUES (${0:values});", "Add a row"),
  snippet("update", "UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${0:condition};", "Change existing rows"),
  snippet("createtable", "CREATE TABLE ${1:name} (\n\t${0}\n);", "Define a new table"),
  ...keywords(
    "SQL keyword",
    "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "INNER", "GROUP", "ORDER", "BY", "LIMIT",
    "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "TABLE", "INDEX", "VALUES",
    "AND", "OR", "NOT", "NULL", "DISTINCT", "COUNT", "SUM", "AVG", "AS", "ON",
  ),
];

const YAML: readonly KeywordSuggestion[] = keywords(
  "YAML value",
  "true", "false", "null", "on", "off", "yes", "no",
);

const MARKDOWN: readonly KeywordSuggestion[] = [
  snippet("code", "```${1:language}\n${0}\n```", "A block of code"),
  snippet("link", "[${1:text}](${0:url})", "A link"),
  snippet("image", "![${1:description}](${0:url})", "An image"),
  snippet("table", "| ${1:Column} | ${2:Column} |\n| --- | --- |\n| ${0} | |", "A table"),
];

const DOCKERFILE: readonly KeywordSuggestion[] = keywords(
  "Dockerfile instruction",
  "FROM", "RUN", "CMD", "COPY", "ADD", "WORKDIR", "ENV", "EXPOSE", "ENTRYPOINT",
  "ARG", "VOLUME", "USER", "LABEL", "HEALTHCHECK",
);

/**
 * Language id to table. Ids are Monaco's own, so the keys match what `getLanguageId()`
 * returns rather than what a file extension looks like.
 */
const TABLES: Readonly<Record<string, readonly KeywordSuggestion[]>> = {
  python: PYTHON,
  rust: RUST,
  go: GO,
  java: JAVA,
  c: C_FAMILY,
  cpp: C_FAMILY,
  csharp: JAVA,
  ruby: RUBY,
  php: PHP,
  shell: SHELL,
  bat: SHELL,
  powershell: SHELL,
  sql: SQL,
  mysql: SQL,
  pgsql: SQL,
  yaml: YAML,
  markdown: MARKDOWN,
  dockerfile: DOCKERFILE,
};

/** Languages that already have a real language worker, and must not be shadowed. */
export const WORKER_BACKED = new Set([
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact",
  "json",
  "jsonc",
  "css",
  "scss",
  "less",
  "html",
]);

export function languagesWithKeywords(): string[] {
  return Object.keys(TABLES);
}

/**
 * Suggestions for a language, or an empty list.
 *
 * Empty for the worker-backed five even if a table existed, because a keyword list sitting
 * alongside real type information is strictly noise - it would offer `class` with no idea
 * whether `class` makes sense there, next to a suggestion that does know.
 */
export function suggestionsFor(languageId: string): readonly KeywordSuggestion[] {
  if (WORKER_BACKED.has(languageId)) return [];
  return TABLES[languageId] ?? [];
}

/**
 * Filter by what the user has typed so far.
 *
 * Prefix match, case-insensitively, and nothing cleverer. Monaco applies its own fuzzy
 * filtering and sorting over whatever it is handed, so a second ranking here would fight
 * the widget rather than help it - the job is to hand over the right candidates.
 */
export function matching(
  suggestions: readonly KeywordSuggestion[],
  prefix: string,
): readonly KeywordSuggestion[] {
  if (prefix.length === 0) return suggestions;

  const needle = prefix.toLowerCase();
  return suggestions.filter((item) => item.label.toLowerCase().startsWith(needle));
}
