/**
 * A folder name for a new project, taken from what the person wants to build.
 *
 * "Build me a landing page for my bakery" becomes `landing-page-bakery`, so the folder
 * says what is in it when the person finds it in Documents next month. The request around
 * the idea - "build me a", "for my", "please" - is dropped, and what is left is cut to a
 * few words, lower-cased and reduced to letters, digits and hyphens.
 *
 * The output is always a single safe path segment: no separators, no dots, never a name
 * Windows reserves, never longer than 40 characters. Pure, so all of that is tested.
 */

const FILLER = new Set([
  "a", "an", "the", "me", "my", "our", "your", "i", "we", "you", "it", "this", "that",
  "build", "make", "create", "generate", "write", "code", "design", "develop", "start", "new",
  "please", "pls", "for", "with", "of", "to", "and", "in", "on", "some", "simple", "basic",
  "quick", "small", "little", "nice", "cool", "something", "thing", "want", "need", "like",
  "would", "could", "can", "help", "let", "lets", "let's", "just",
]);

/** Device names Windows refuses as a file or folder, whatever the extension. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const MAX_WORDS = 4;
const MAX_LENGTH = 40;
const FALLBACK = "my-project";

export function projectFolderName(idea: string, taken: ReadonlySet<string>): string {
  const words = idea
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word.length > 0 && !FILLER.has(word));

  let base = words.slice(0, MAX_WORDS).join("-").slice(0, MAX_LENGTH).replace(/-+$/g, "");
  if (base.length === 0) base = FALLBACK;
  if (RESERVED.test(base)) base = `${base}-project`;

  const lowerTaken = new Set([...taken].map((name) => name.toLowerCase()));
  if (!lowerTaken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base.slice(0, MAX_LENGTH - String(n).length - 1)}-${n}`;
    if (!lowerTaken.has(candidate)) return candidate;
  }
}
