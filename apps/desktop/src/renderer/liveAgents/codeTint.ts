/**
 * Just enough syntax colour for a live window.
 *
 * The window shows code being typed, a line at a time, many times a second, in several
 * windows at once. A real highlighter (Monaco, tree-sitter) per window would cost more than
 * the rest of the room together. Four tones - keywords, strings, comments, numbers - make it
 * read as code, which is all a glance at someone else's work needs.
 *
 * Pure, one line at a time, so a half-typed line colours the same way when it is finished.
 */

export type CodeTone = "plain" | "keyword" | "string" | "comment" | "number";

export interface CodeToken {
  readonly text: string;
  readonly tone: CodeTone;
}

const KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue", "def", "default", "do",
  "else", "enum", "export", "extends", "false", "finally", "fn", "for", "from", "func", "function",
  "if", "implements", "import", "in", "interface", "let", "new", "null", "of", "package", "private",
  "protected", "public", "return", "static", "struct", "super", "switch", "this", "throw", "true",
  "try", "type", "typeof", "undefined", "var", "void", "while", "yield", "None", "True", "False",
]);

const TOKEN = /(\/\/.*$|#(?!include|define|\[).*$)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;

export function tintLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let at = 0;
  const plain = (text: string): void => {
    if (text.length === 0) return;
    const last = tokens.at(-1);
    if (last !== undefined && last.tone === "plain") tokens[tokens.length - 1] = { text: last.text + text, tone: "plain" };
    else tokens.push({ text, tone: "plain" });
  };
  for (const match of line.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    plain(line.slice(at, index));
    const [text, comment, string, number, word] = match;
    if (comment !== undefined) tokens.push({ text, tone: "comment" });
    else if (string !== undefined) tokens.push({ text, tone: "string" });
    else if (number !== undefined) tokens.push({ text, tone: "number" });
    else if (word !== undefined && KEYWORDS.has(word)) tokens.push({ text, tone: "keyword" });
    else plain(text);
    at = index + text.length;
  }
  plain(line.slice(at));
  return tokens;
}
