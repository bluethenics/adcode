/**
 * HTML, XML, and the template dialects.
 *
 * Re-indented rather than re-printed, for the reason `reindent.ts` explains at length: the
 * failure mode of re-printing markup is *changing what the page renders*, and in HTML that
 * is unusually easy to do by accident. Whitespace between inline elements is significant -
 * `<b>a</b> <b>b</b>` and `<b>a</b><b>b</b>` look different - so this never moves text
 * relative to its tags. It only changes the indentation at the front of a line.
 *
 * `<pre>`, `<textarea>`, `<script>` and `<style>` are left exactly as found. The first two
 * because their whitespace is the content, the second two because their content is not
 * markup at all and re-indenting it with a tag counter would produce nonsense.
 */
import { indentOf, toLines, type FormatOptions } from "./types.ts";

const MARKUP_LANGUAGES = new Set([
  "html", "xml", "handlebars", "razor", "vue", "svelte", "astro", "svg",
]);

export const markupSupported = (languageId: string): boolean => MARKUP_LANGUAGES.has(languageId);

/** Never have a closing tag, so never open a level. */
const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr", "!doctype", "?xml",
]);

/** Their contents are not markup, or their whitespace is the content. */
const VERBATIM = new Set(["pre", "textarea", "script", "style"]);

interface Step {
  readonly text: string;
  /** Levels this line closes before it opens anything - these dedent the line itself. */
  readonly leadingCloses: number;
  readonly delta: number;
  readonly verbatim: boolean;
}

const TAG = /<\/?([A-Za-z!?][\w:.-]*)([^>]*)>/g;

function scan(lines: readonly string[]): Step[] {
  const steps: Step[] = [];
  let verbatimTag: string | null = null;

  for (const line of lines) {
    if (verbatimTag !== null) {
      const closed = new RegExp(`</${verbatimTag}\\s*>`, "i").test(line);
      steps.push({ text: line, leadingCloses: 0, delta: 0, verbatim: true });
      if (closed) verbatimTag = null;
      continue;
    }

    let delta = 0;
    let leadingCloses = 0;
    let opened = false;
    let opensVerbatim: string | null = null;

    TAG.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TAG.exec(line)) !== null) {
      const whole = match[0];
      const name = (match[1] ?? "").toLowerCase();

      if (whole.startsWith("</")) {
        delta -= 1;
        if (!opened) leadingCloses += 1;
        if (VERBATIM.has(name)) opensVerbatim = null;
        continue;
      }

      // A comment is not a tag; `<!--` is matched as `<!--...` and must not open a level.
      if (whole.startsWith("<!--") || whole.endsWith("/>") || VOID.has(name)) continue;

      delta += 1;
      opened = true;

      // Only when the tag is still open at the end of the line does the next line belong
      // to it verbatim; `<script>x</script>` on one line changes nothing.
      if (VERBATIM.has(name) && !new RegExp(`</${name}\\s*>`, "i").test(line.slice(match.index))) {
        opensVerbatim = name;
      }
    }

    steps.push({ text: line, leadingCloses, delta, verbatim: false });
    if (opensVerbatim !== null) verbatimTag = opensVerbatim;
  }

  return steps;
}

export function formatMarkup(text: string, options: FormatOptions): string {
  const steps = scan(toLines(text));
  const out: string[] = [];

  let depth = 0;
  let blanks = 0;

  for (const step of steps) {
    if (step.verbatim) {
      out.push(step.text);
      blanks = 0;
      continue;
    }

    const content = step.text.trim();

    if (content.length === 0) {
      blanks += 1;
      if (blanks === 1 && out.length > 0) out.push("");
      continue;
    }
    blanks = 0;

    const own = Math.max(0, depth - step.leadingCloses);
    out.push(`${indentOf(options, own)}${content}`);
    depth = Math.max(0, depth + step.delta);
  }

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join(options.lineEnding) + options.lineEnding;
}
