/**
 * Compiler messages, rewritten for someone who has not read a compiler message before.
 *
 * Pure data and pure functions: no clock, no randomness, no I/O, nothing imported but
 * `types.ts`. `test/purity.test.ts` reads this file's source and asserts as much, the same
 * guard `packages/ads` puts on its five pure modules - a rule that is only checked by
 * review is a rule that drifts.
 *
 * Entries cannot be static strings. TS2322 carries the actual type names inside its
 * message, and "You're putting text where a number belongs" can only be written by reading
 * them back out. So an entry is a pattern plus a renderer over its captures.
 *
 * Coverage is deliberately partial. `explain` returning `null` is a designed path, not a
 * gap: the caller falls back to the compiler's own text plus an "Explain this" button, so
 * the surface is never worse than showing the raw message, at any table size.
 */
import type { Diagnostic, Explanation } from "./types.ts";

export interface TableEntry {
  /** Normalised source family: `ts`, `json`, `css`, `html`. */
  readonly source: string;
  /** Matched against `Diagnostic.code` when present. */
  readonly code?: string;
  /** Matched against `Diagnostic.message` when present. Captures feed `render`. */
  readonly pattern?: RegExp;
  readonly render: (match: RegExpMatchArray | null, diagnostic: Diagnostic) => Explanation;
}

/**
 * Type names a beginner should never have to look up. Anything absent falls through to
 * being quoted as-is, which is honest: we do not know what a `RequestHandler` is either.
 */
const ENGLISH: Readonly<Record<string, string>> = {
  string: "text",
  String: "text",
  number: "a number",
  Number: "a number",
  bigint: "a whole number",
  boolean: "true or false",
  Boolean: "true or false",
  null: "nothing (null)",
  undefined: "nothing (undefined)",
  void: "nothing",
  any: "anything",
  unknown: "something we can't identify yet",
  never: "a value that can never exist",
  object: "an object",
  "string[]": "a list of text",
  "number[]": "a list of numbers",
  "boolean[]": "a list of true/false values",
  "any[]": "a list of anything",
};

/** Renders a type name as the object of a sentence: "text", "a number", "a `Foo`". */
export function subject(type: string): string {
  const trimmed = type.trim();

  const known = ENGLISH[trimmed];
  if (known !== undefined) return known;

  // A literal type describes itself better than any paraphrase could.
  if (/^"[^"]*"$/.test(trimmed) || /^'[^']*'$/.test(trimmed)) {
    return `the exact text ${trimmed}`;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return `exactly ${trimmed}`;
  if (trimmed.endsWith("[]")) return `a list of \`${trimmed.slice(0, -2)}\` values`;

  return `a \`${trimmed}\``;
}

/** A capture, or an empty string. `noUncheckedIndexedAccess` makes this worth centralising. */
function g(match: RegExpMatchArray | null, index: number): string {
  return match?.[index] ?? "";
}

function plain(text: string): Explanation {
  return { plain: text };
}

function withHint(text: string, hint: string): Explanation {
  return { plain: text, hint };
}

/**
 * The classic beginner assignment mistakes get a concrete suggestion; everything else gets
 * the general one. Naming the two directions explicitly is worth more than a clever
 * general rule, because these two are most of what a first-week error actually is.
 */
function assignmentHint(from: string, to: string): string {
  if (from === "string" && to === "number") {
    return 'Quotes make a value text. Try 5 rather than "5", or Number(value) to convert it.';
  }
  if (from === "number" && to === "string") {
    return 'Wrap it in quotes, or use String(value) to convert it.';
  }
  if (to === "boolean") {
    return "This wants true or false - a comparison like x > 0 produces one.";
  }
  if (from === "null" || from === "undefined") {
    return "The value might be missing here. Give it a starting value, or check for it first.";
  }
  return "Either change the value, or change the type this was declared as.";
}

const TS_ENTRIES: readonly TableEntry[] = [
  {
    source: "ts",
    code: "2304",
    pattern: /Cannot find name '([^']+)'/,
    render: (m) =>
      withHint(
        `Nothing called \`${g(m, 1)}\` has been defined yet.`,
        "Check the spelling, or define it before this line with const, let or function.",
      ),
  },
  {
    source: "ts",
    code: "2552",
    pattern: /Cannot find name '([^']+)'\. Did you mean '([^']+)'\?/,
    render: (m) =>
      withHint(
        `Nothing called \`${g(m, 1)}\` has been defined.`,
        `You probably meant \`${g(m, 2)}\`.`,
      ),
  },
  {
    source: "ts",
    code: "2322",
    pattern: /Type '([^']+)' is not assignable to type '([^']+)'/,
    render: (m) =>
      withHint(
        `You're putting ${subject(g(m, 1))} where ${subject(g(m, 2))} belongs.`,
        assignmentHint(g(m, 1), g(m, 2)),
      ),
  },
  {
    source: "ts",
    code: "2345",
    pattern: /Argument of type '([^']+)' is not assignable to parameter of type '([^']+)'/,
    render: (m) =>
      withHint(
        `This function was handed ${subject(g(m, 1))}, but it expects ${subject(g(m, 2))}.`,
        assignmentHint(g(m, 1), g(m, 2)),
      ),
  },
  {
    source: "ts",
    code: "2339",
    pattern: /Property '([^']+)' does not exist on type '([^']+)'/,
    render: (m) =>
      withHint(
        `${subject(g(m, 2))} has no \`${g(m, 1)}\` on it.`,
        "Check the spelling, or check that this is the value you think it is.",
      ),
  },
  {
    source: "ts",
    code: "2551",
    pattern: /Property '([^']+)' does not exist on type '([^']+)'\. Did you mean '([^']+)'\?/,
    render: (m) =>
      withHint(
        `${subject(g(m, 2))} has no \`${g(m, 1)}\` on it.`,
        `You probably meant \`${g(m, 3)}\`.`,
      ),
  },
  {
    source: "ts",
    code: "2554",
    pattern: /Expected (\d+) arguments?, but got (\d+)/,
    render: (m) => {
      const expected = Number(g(m, 1));
      const got = Number(g(m, 2));
      const noun = expected === 1 ? "value" : "values";
      return withHint(
        `This function takes ${expected} ${noun}, but ${got} ${got === 1 ? "was" : "were"} given.`,
        got > expected ? "Remove the extra ones." : "Some are missing - check what it needs.",
      );
    },
  },
  {
    source: "ts",
    code: "2555",
    pattern: /Expected at least (\d+) arguments?, but got (\d+)/,
    render: (m) =>
      withHint(
        `This function needs at least ${g(m, 1)}, but got ${g(m, 2)}.`,
        "Some required values are missing.",
      ),
  },
  {
    source: "ts",
    code: "2307",
    pattern: /Cannot find module '([^']+)'/,
    render: (m) =>
      withHint(
        `\`${g(m, 1)}\` couldn't be found.`,
        g(m, 1).startsWith(".")
          ? "That's a path to a file in your project - check the spelling and the folder."
          : "If it's a package, it may need installing first.",
      ),
  },
  {
    source: "ts",
    code: "2305",
    pattern: /Module '([^']+)' has no exported member '([^']+)'/,
    render: (m) =>
      withHint(
        `\`${g(m, 2)}\` isn't something \`${g(m, 1)}\` provides.`,
        "Check the spelling, or look at what that module actually exports.",
      ),
  },
  {
    source: "ts",
    code: "7006",
    pattern: /Parameter '([^']+)' implicitly has an 'any' type/,
    render: (m) =>
      withHint(
        `We can't tell what kind of value \`${g(m, 1)}\` is meant to be.`,
        `Say so directly: \`${g(m, 1)}: string\`, for example.`,
      ),
  },
  {
    source: "ts",
    code: "18047",
    pattern: /'([^']+)' is possibly 'null'/,
    render: (m) =>
      withHint(
        `\`${g(m, 1)}\` might be nothing at this point, and using it would crash.`,
        `Check it first: \`if (${g(m, 1)}) { ... }\`.`,
      ),
  },
  {
    source: "ts",
    code: "18048",
    pattern: /'([^']+)' is possibly 'undefined'/,
    render: (m) =>
      withHint(
        `\`${g(m, 1)}\` might not have been set yet, and using it would crash.`,
        `Check it first: \`if (${g(m, 1)}) { ... }\`.`,
      ),
  },
  {
    source: "ts",
    code: "2531",
    render: () =>
      withHint(
        "This might be nothing at this point, and using it would crash.",
        "Check that it exists before reaching into it.",
      ),
  },
  {
    source: "ts",
    code: "2532",
    render: () =>
      withHint(
        "This might not have been set yet, and using it would crash.",
        "Check that it exists before reaching into it.",
      ),
  },
  {
    source: "ts",
    code: "2571",
    render: () =>
      withHint(
        "We don't know what kind of value this is, so we can't let you reach into it.",
        "Check its type first, or declare what you expect it to be.",
      ),
  },
  {
    source: "ts",
    code: "1005",
    pattern: /'([^']+)' expected/,
    render: (m) =>
      withHint(
        `Something is missing here - a \`${g(m, 1)}\` was expected.`,
        "Usually a missing bracket, comma or semicolon on this line or the one above.",
      ),
  },
  {
    source: "ts",
    code: "1003",
    render: () =>
      withHint("A name was expected here.", "Check for a stray character or a missing word."),
  },
  {
    source: "ts",
    code: "1109",
    render: () =>
      withHint(
        "A value was expected here and there isn't one.",
        "Often a trailing operator, or a comma with nothing after it.",
      ),
  },
  {
    source: "ts",
    code: "1128",
    render: () =>
      withHint(
        "This doesn't read as a complete statement.",
        "Usually one bracket too many, or one too few, somewhere above.",
      ),
  },
  {
    source: "ts",
    code: "1002",
    render: () =>
      withHint("This piece of text was never closed.", "Add the matching quote mark."),
  },
  {
    source: "ts",
    code: "1010",
    render: () => withHint("This comment was never closed.", "Add the matching `*/`."),
  },
  {
    source: "ts",
    code: "2451",
    pattern: /Cannot redeclare block-scoped variable '([^']+)'/,
    render: (m) =>
      withHint(
        `\`${g(m, 1)}\` is already defined in this scope.`,
        "Either pick a different name, or drop the second const/let and just assign to it.",
      ),
  },
  {
    source: "ts",
    code: "2588",
    pattern: /Cannot assign to '([^']+)' because it is a constant/,
    render: (m) =>
      withHint(
        `\`${g(m, 1)}\` was declared with const, so it can't be pointed at something else.`,
        `Declare it with \`let\` instead if it needs to change.`,
      ),
  },
  {
    source: "ts",
    code: "2540",
    pattern: /Cannot assign to '([^']+)' because it is a read-only property/,
    render: (m) => plain(`\`${g(m, 1)}\` is read-only - it can be looked at but not changed.`),
  },
  {
    source: "ts",
    code: "2365",
    pattern: /Operator '([^']+)' cannot be applied to types '([^']+)' and '([^']+)'/,
    render: (m) =>
      withHint(
        `\`${g(m, 1)}\` doesn't work between ${subject(g(m, 2))} and ${subject(g(m, 3))}.`,
        "Convert one side so both are the same kind of value.",
      ),
  },
  {
    source: "ts",
    code: "2367",
    pattern: /types '([^']+)' and '([^']+)' have no overlap/,
    render: (m) =>
      withHint(
        `${subject(g(m, 1))} and ${subject(g(m, 2))} can never be equal, so this is always false.`,
        "Check you're comparing the two things you meant to.",
      ),
  },
  {
    source: "ts",
    code: "2349",
    render: () =>
      withHint(
        "This isn't a function, so it can't be called.",
        "Check the name, and check whether you meant to use it without the ().",
      ),
  },
  {
    source: "ts",
    code: "2741",
    pattern: /Property '([^']+)' is missing in type '([^']+)' but required in type '([^']+)'/,
    render: (m) =>
      withHint(
        `This object is missing \`${g(m, 1)}\`, which ${subject(g(m, 3))} has to have.`,
        `Add \`${g(m, 1)}\` to it.`,
      ),
  },
  {
    source: "ts",
    code: "2564",
    pattern: /Property '([^']+)' has no initializer/,
    render: (m) =>
      withHint(
        `\`${g(m, 1)}\` is never given a starting value.`,
        "Set it where it's declared, or in the constructor.",
      ),
  },
  {
    source: "ts",
    code: "2769",
    render: () =>
      withHint(
        "This function can be called several ways, and none of them match what was passed.",
        "Check the number of values and their types against what it accepts.",
      ),
  },
  {
    source: "ts",
    code: "6133",
    pattern: /'([^']+)' is declared but its value is never read/,
    render: (m) =>
      withHint(
        `\`${g(m, 1)}\` is created but never used.`,
        "Harmless, but it's usually a leftover - or a sign you meant to use it somewhere.",
      ),
  },
  {
    source: "ts",
    code: "7027",
    render: () =>
      withHint(
        "This code can never run - something above it always returns or throws first.",
        "Check for a `return` that ended the function earlier than you meant.",
      ),
  },
  {
    source: "ts",
    code: "1117",
    render: () =>
      plain("This object sets the same property twice, so the first one is thrown away."),
  },
];

const JSON_ENTRIES: readonly TableEntry[] = [
  {
    source: "json",
    pattern: /Comma expected|Expected comma/i,
    render: () =>
      withHint(
        "A comma is missing between two entries.",
        "Every entry except the last one needs a comma after it.",
      ),
  },
  {
    source: "json",
    pattern: /Colon expected/i,
    render: () =>
      withHint("A colon is missing.", 'Entries look like "name": value.'),
  },
  {
    source: "json",
    pattern: /Trailing comma/i,
    render: () =>
      withHint(
        "There's a comma after the last entry.",
        "JSON doesn't allow that - remove it.",
      ),
  },
  {
    source: "json",
    pattern: /Property keys must be doublequoted|doublequoted/i,
    render: () =>
      withHint(
        "Names in JSON have to be wrapped in double quotes.",
        'Write "name": value, not name: value.',
      ),
  },
  {
    source: "json",
    pattern: /Value expected/i,
    render: () =>
      withHint("A value is missing here.", "Something needs to come after the colon."),
  },
  {
    source: "json",
    pattern: /Duplicate object key/i,
    render: () => plain("This name is used twice in the same object, so the first is ignored."),
  },
  {
    source: "json",
    pattern: /End of file expected/i,
    render: () =>
      withHint(
        "There's extra content after the end of the data.",
        "Usually one closing bracket too many.",
      ),
  },
  {
    source: "json",
    pattern: /Comments are not permitted/i,
    render: () => plain("Plain JSON files can't contain comments."),
  },
  {
    source: "json",
    pattern: /Invalid escape character|Unexpected end of string/i,
    render: () =>
      withHint(
        "There's a problem inside this piece of text.",
        "A backslash needs another backslash: write \\\\ for one backslash.",
      ),
  },
];

const CSS_ENTRIES: readonly TableEntry[] = [
  {
    source: "css",
    pattern: /Unknown property: '?([^'\s]+)'?/i,
    render: (m) =>
      withHint(
        `There's no CSS property called \`${g(m, 1)}\`.`,
        "Check the spelling - this rule will be ignored by the browser.",
      ),
  },
  {
    source: "css",
    pattern: /Unknown at rule (@\S+)/i,
    render: (m) => plain(`\`${g(m, 1)}\` isn't a CSS rule the browser recognises.`),
  },
  {
    source: "css",
    pattern: /property value expected/i,
    render: () =>
      withHint("This property has no value.", "Something needs to come after the colon."),
  },
  {
    source: "css",
    pattern: /colon expected/i,
    render: () => withHint("A colon is missing.", "Rules look like `color: red;`."),
  },
  {
    source: "css",
    pattern: /semi-colon expected/i,
    render: () => withHint("A semicolon is missing.", "Each rule ends with `;`."),
  },
  {
    source: "css",
    pattern: /Do not use empty rulesets/i,
    render: () => plain("This selector has no rules inside it, so it does nothing."),
  },
  {
    source: "css",
    pattern: /at-rule or selector expected/i,
    render: () =>
      withHint(
        "This doesn't read as something CSS can style.",
        "Usually a stray character, or a missing `}` above.",
      ),
  },
  {
    source: "css",
    pattern: /Unknown vendor specific property/i,
    render: () =>
      plain("This is a browser-specific property that not every browser will understand."),
  },
];

const HTML_ENTRIES: readonly TableEntry[] = [
  {
    source: "html",
    pattern: /Tag '?([^'\s]+)'? is not closed|is not closed/i,
    render: (m) =>
      withHint(
        g(m, 1).length > 0 ? `The \`<${g(m, 1)}>\` tag is never closed.` : "A tag is never closed.",
        g(m, 1).length > 0 ? `Add \`</${g(m, 1)}>\` where it should end.` : "Add its closing tag.",
      ),
  },
  {
    source: "html",
    pattern: /Special characters must be escaped/i,
    render: () =>
      withHint(
        "A character here means something to HTML.",
        "Write `&lt;` for `<` and `&amp;` for `&`.",
      ),
  },
];

export const TABLE: readonly TableEntry[] = [
  ...TS_ENTRIES,
  ...JSON_ENTRIES,
  ...CSS_ENTRIES,
  ...HTML_ENTRIES,
];

/**
 * Indexed once at module load so `explain` is a map hit rather than a walk over the whole
 * table on every row of every redraw. Entries carrying a code are looked up by it; the
 * rest are tried in order for their source.
 */
const BY_CODE = new Map<string, TableEntry[]>();
const BY_SOURCE = new Map<string, TableEntry[]>();

for (const item of TABLE) {
  const bucket = item.code === undefined ? BY_SOURCE : BY_CODE;
  const key = item.code === undefined ? item.source : `${item.source}:${item.code}`;

  const existing = bucket.get(key);
  if (existing === undefined) bucket.set(key, [item]);
  else existing.push(item);
}

/**
 * More specific entries first: TS2551 ("did you mean") carries everything TS2339 does plus
 * a suggestion, and a table walked in declaration order would hand back the poorer one.
 */
function best(candidates: readonly TableEntry[], diagnostic: Diagnostic): Explanation | null {
  let fallback: Explanation | null = null;

  for (const item of candidates) {
    if (item.pattern === undefined) {
      fallback ??= item.render(null, diagnostic);
      continue;
    }

    const match = item.pattern.exec(diagnostic.message);
    if (match !== null) return item.render(match, diagnostic);
  }

  return fallback;
}

/**
 * The plain-English rewrite for a diagnostic, or `null` when we have nothing better to say
 * than the compiler already did.
 */
export function explain(diagnostic: Diagnostic): Explanation | null {
  const byCode = BY_CODE.get(`${diagnostic.source}:${diagnostic.code}`);
  if (byCode !== undefined) {
    const found = best(byCode, diagnostic);
    if (found !== null) return found;
  }

  const bySource = BY_SOURCE.get(diagnostic.source);
  if (bySource !== undefined) return best(bySource, diagnostic);

  return null;
}
