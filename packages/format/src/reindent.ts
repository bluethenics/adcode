/**
 * The brace languages: JavaScript, TypeScript, C, Java, Go, Rust, and the rest.
 *
 * **This deliberately does less than a real formatter.** It fixes indentation, strips
 * trailing whitespace, settles runs of blank lines, and ensures a final newline. It does
 * not re-flow expressions, decide where to break a long line, add or remove semicolons, or
 * change quote style.
 *
 * That restraint is the point. Writing a printer for JavaScript's grammar - template
 * literals, JSX, decorators, arrow chains, comments in every position - is an enormous
 * amount of code whose failure mode is *silently producing different code*. A formatter
 * that only ever moves whitespace cannot change what a program means, and that is worth
 * more here than matching Prettier.
 *
 * Where a language server is running it is asked first, and it will do the fuller job. This
 * is what happens on a machine with nothing installed, which is the case the settings row
 * promises to cover.
 *
 * The scan tracks strings, template literals, and comments so that a brace inside any of
 * them never moves a line, and so the inside of a multi-line string is never touched.
 */
import { indentOf, toLines, type FormatOptions } from "./types.ts";

/** Whether this language's structure is carried by braces at all. */
const BRACE_LANGUAGES = new Set([
  "javascript", "typescript", "javascriptreact", "typescriptreact", "json", "jsonc",
  "c", "cpp", "csharp", "java", "kotlin", "scala", "swift", "go", "rust", "php",
  "dart", "solidity", "graphql", "protobuf", "groovy", "objective-c",
]);

export const reindentSupported = (languageId: string): boolean => BRACE_LANGUAGES.has(languageId);

interface LineFacts {
  readonly text: string;
  /** Inside a multi-line string or block comment that began on an earlier line. */
  readonly continued: boolean;
  /** Net bracket change contributed by this line. */
  readonly delta: number;
  /** Brackets closed before anything is opened - these dedent the line itself. */
  readonly leadingCloses: number;
}

type Mode = "code" | "line-comment" | "block-comment" | "string" | "template";

/**
 * Read the file once, recording what each line does to the bracket depth.
 *
 * Done as one pass over the whole text rather than per line, because the states that matter
 * - a block comment, a template literal - span lines by definition, and a per-line scan
 * cannot know it is inside one.
 */
function scan(text: string): LineFacts[] {
  const lines = toLines(text);
  const facts: LineFacts[] = [];

  let mode: Mode = "code";
  let quote = "";
  /** `${` inside a template puts us back in code, and this counts the way out again. */
  let templateDepth = 0;

  for (const line of lines) {
    const continued = mode === "block-comment" || mode === "string" || mode === "template";

    let delta = 0;
    let leadingCloses = 0;
    let opened = false;

    if (mode === "line-comment") mode = "code";

    for (let index = 0; index < line.length; index += 1) {
      const character = line[index] as string;
      const next = line[index + 1];

      if (mode === "block-comment") {
        if (character === "*" && next === "/") {
          mode = "code";
          index += 1;
        }
        continue;
      }

      if (mode === "string") {
        if (character === "\\") index += 1;
        else if (character === quote) mode = "code";
        continue;
      }

      if (mode === "template") {
        if (character === "\\") index += 1;
        else if (character === "`") mode = "code";
        else if (character === "$" && next === "{") {
          mode = "code";
          templateDepth += 1;
          index += 1;
        }
        continue;
      }

      if (character === "/" && next === "*") {
        mode = "block-comment";
        index += 1;
        continue;
      }
      if (character === "/" && next === "/") {
        mode = "line-comment";
        break;
      }
      if (character === "#" && index === 0) break;

      if (character === '"' || character === "'") {
        mode = "string";
        quote = character;
        continue;
      }
      if (character === "`") {
        mode = "template";
        continue;
      }

      if (character === "{" || character === "[" || character === "(") {
        delta += 1;
        opened = true;
        continue;
      }

      if (character === "}" || character === "]" || character === ")") {
        // A `}` that closes a `${` returns to the template rather than to the outer block.
        if (character === "}" && templateDepth > 0) {
          templateDepth -= 1;
          mode = "template";
          continue;
        }

        delta -= 1;
        if (!opened) leadingCloses += 1;
        continue;
      }
    }

    facts.push({ text: line, continued, delta, leadingCloses });
  }

  return facts;
}

export function reindent(text: string, options: FormatOptions): string {
  const facts = scan(text);
  const out: string[] = [];

  let depth = 0;
  let blanks = 0;

  for (const line of facts) {
    // Inside a multi-line string, every character is data. Even the trailing spaces.
    if (line.continued) {
      out.push(line.text);
      blanks = 0;
      continue;
    }

    const content = line.text.trim();

    if (content.length === 0) {
      blanks += 1;
      // One blank line separates; two or more is just space nobody chose.
      if (blanks === 1 && out.length > 0) out.push("");
      continue;
    }
    blanks = 0;

    // A line that begins by closing what an earlier line opened belongs at the outer level.
    const own = Math.max(0, depth - line.leadingCloses);
    out.push(`${indentOf(options, own)}${content}`);

    depth = Math.max(0, depth + line.delta);
  }

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join(options.lineEnding) + options.lineEnding;
}
