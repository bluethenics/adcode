/**
 * JSON.
 *
 * The one language here that can be formatted by re-printing rather than by re-indenting,
 * because it has a complete, unambiguous grammar and no comments to preserve. Parse it,
 * print it, done - and the printing is guaranteed idempotent because it is a function of
 * the parsed value rather than of the text.
 *
 * `JSON.stringify` is not used for the printing. It cannot be told to keep a short array on
 * one line, and `[1, 2, 3]` broken across five lines is what makes people turn formatters
 * off for data files.
 */
import { indentOf, type FormatOptions } from "./types.ts";

/** Short, simple arrays stay on one line. Longer or nested ones break. */
const INLINE_ARRAY_LIMIT = 60;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isPrimitive(value: Json): boolean {
  return value === null || typeof value !== "object";
}

function print(value: Json, options: FormatOptions, depth: number): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);

  const inner = indentOf(options, depth + 1);
  const outer = indentOf(options, depth);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";

    // `["a", "b", "c"]` reads better than three lines, but only when every element is a
    // primitive - a one-line array of objects is unreadable at any length.
    if (value.every(isPrimitive)) {
      const oneLine = `[${value.map((item) => print(item, options, 0)).join(", ")}]`;
      if (oneLine.length + outer.length <= INLINE_ARRAY_LIMIT) return oneLine;
    }

    const items = value.map((item) => `${inner}${print(item, options, depth + 1)}`);
    return `[\n${items.join(",\n")}\n${outer}]`;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";

  // Key order is preserved, never sorted. A package.json whose keys were alphabetised on
  // save would be a formatter making an editorial decision nobody asked it to make.
  const entries = keys.map(
    (key) => `${inner}${JSON.stringify(key)}: ${print(value[key] as Json, options, depth + 1)}`,
  );
  return `{\n${entries.join(",\n")}\n${outer}}`;
}

/**
 * Format JSON, or return it untouched.
 *
 * Invalid JSON is returned exactly as it came in. A formatter that mangles a file it could
 * not parse - or worse, empties it - is the reason people are afraid of format-on-save.
 */
export function formatJson(text: string, options: FormatOptions): string {
  let parsed: Json;
  try {
    parsed = JSON.parse(text) as Json;
  } catch {
    return text;
  }

  return print(parsed, options, 0).split("\n").join(options.lineEnding) + options.lineEnding;
}
