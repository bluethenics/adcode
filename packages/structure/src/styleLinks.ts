/**
 * The link between a stylesheet and the markup it styles, in both directions.
 *
 * A class name written in one file and used in another is the most common untraceable
 * connection in a codebase. Nothing checks it, no compiler complains about it, and the only
 * way to find out whether `.card__title--muted` still styles anything is to read every
 * template. This answers it:
 *
 * - **Selector to elements** - `styles.ts` already does this, and the Structure popup uses it.
 * - **Element to rules** - which selectors apply to the thing under the cursor.
 * - **Neither** - a rule that styles nothing, and a class that no rule defines. Both are
 *   real findings, and both are noisy enough that they are switchable.
 *
 * **On honesty.** This matches by name, not by cascade. It does not resolve CSS modules,
 * `composes`, Tailwind's generated classes, or a class assembled at runtime from a
 * variable - and it says so where it reports, because a tool that quietly implies it
 * resolved something it guessed at is worse than one that shows its working.
 */
import { markupElements, type MarkupElement } from "./markup.ts";
import { elementMatches, selectorTargets, type SelectorTarget } from "./styles.ts";

/** One selector in a stylesheet, with where it is. */
export interface StyleRule {
  readonly selector: string;
  /** One-based, as the editor counts. */
  readonly line: number;
}

/**
 * Every selector in a stylesheet, with its line.
 *
 * A scan rather than a parse: a selector is whatever precedes a `{` at brace depth zero,
 * which is true of CSS, SCSS and LESS alike. At-rules are skipped - `@media` is not a thing
 * that styles an element - but their contents are not, because that is where half of a
 * responsive stylesheet's rules live.
 */
export function styleRules(css: string): StyleRule[] {
  const rules: StyleRule[] = [];

  let buffer = "";
  let line = 1;
  let depth = 0;
  let quote: string | null = null;
  let startLine = 1;

  for (let index = 0; index < css.length; index += 1) {
    const character = css[index] as string;

    if (character === "\n") {
      line += 1;
      if (buffer.trim().length === 0) startLine = line;
      buffer += " ";
      continue;
    }

    if (quote !== null) {
      if (character === quote) quote = null;
      buffer += character;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      buffer += character;
      continue;
    }

    // Comments carry no selectors and often carry braces.
    if (character === "/" && css[index + 1] === "*") {
      const close = css.indexOf("*/", index + 2);
      const skipped = css.slice(index, close === -1 ? css.length : close + 2);
      line += (skipped.match(/\n/g) ?? []).length;
      index = close === -1 ? css.length : close + 1;
      buffer = "";
      startLine = line;
      continue;
    }

    if (character === "{") {
      const selector = buffer.trim();
      buffer = "";

      // `@media`, `@supports` and friends open a block that holds rules rather than being
      // one. Their contents are scanned like any other, which is the point.
      if (selector.length > 0 && !selector.startsWith("@")) {
        rules.push({ selector, line: startLine });
      }

      depth += 1;
      startLine = line;
      continue;
    }

    if (character === "}") {
      depth = Math.max(0, depth - 1);
      buffer = "";
      startLine = line;
      continue;
    }

    if (character === ";") {
      buffer = "";
      startLine = line;
      continue;
    }

    buffer += character;
  }

  return rules;
}

/**
 * The rules that style an element.
 *
 * The reverse of what the Structure popup already does. Ordered as they appear in the
 * stylesheet, because later rules win and reading them in source order is how anybody
 * works out which one applied.
 */
export function rulesForElement(css: string, element: MarkupElement): StyleRule[] {
  return styleRules(css).filter((rule) => elementMatches(element, rule.selector));
}

/**
 * Selectors that match nothing in the markup they were given.
 *
 * Deliberately conservative. A selector naming a tag that is not in these files is *not*
 * reported - `body`, `html` and a component's own root live somewhere this was not shown -
 * and neither is anything with a pseudo-class or an attribute selector, where matching by
 * name stops being a fair test.
 */
export function unusedSelectors(css: string, markup: readonly string[]): StyleRule[] {
  const elements = markup.flatMap((text) => markupElements(text));
  if (elements.length === 0) return [];

  return styleRules(css).filter((rule) => {
    const targets = selectorTargets(rule.selector);

    // Nothing to judge, or judging it fairly is not possible from names alone.
    if (targets.length === 0) return false;
    if (/[:[]/.test(rule.selector)) return false;
    if (targets.every((target) => target.kind === "tag")) return false;

    return !elements.some((element) => elementMatches(element, rule.selector));
  });
}

/** A class used in markup that no rule in the given stylesheets defines. */
export interface MissingClass {
  readonly name: string;
  readonly line: number;
}

/**
 * Classes the markup uses that no stylesheet defines.
 *
 * The mirror of `unusedSelectors`, and the more useful of the two in practice: a typo in a
 * class name is silent, and this is the only thing that ever notices it.
 */
export function missingClasses(markupText: string, stylesheets: readonly string[]): MissingClass[] {
  const defined = new Set<string>();

  for (const css of stylesheets) {
    for (const rule of styleRules(css)) {
      for (const target of selectorTargets(rule.selector)) {
        if (target.kind === "class") defined.add(target.name);
      }
    }
  }

  // No stylesheets means nothing is defined, and reporting every class in the file as
  // missing would be technically true and completely useless.
  if (defined.size === 0) return [];

  const missing: MissingClass[] = [];
  const seen = new Set<string>();

  for (const element of markupElements(markupText)) {
    for (const name of element.classes) {
      if (defined.has(name) || seen.has(name)) continue;
      seen.add(name);
      missing.push({ name, line: element.line });
    }
  }

  return missing;
}

/** Every class a stylesheet defines, for a completion list or a summary. */
export function definedClasses(css: string): SelectorTarget[] {
  const targets: SelectorTarget[] = [];
  const seen = new Set<string>();

  for (const rule of styleRules(css)) {
    for (const target of selectorTargets(rule.selector)) {
      const key = `${target.kind}:${target.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(target);
    }
  }

  return targets;
}
