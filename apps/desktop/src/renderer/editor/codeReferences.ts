export interface CodeReference {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

/** Local file references only: never interpret a Markdown link as a command. */
export function parseCodeReference(target: string): CodeReference | null {
  const match = /^(.*?)(?:#L(\d+)(?:-L?\d+)?|:(\d+)(?::(\d+))?)$/.exec(target);
  if (!match) return null;
  let path: string;
  try { path = decodeURIComponent(match[1] ?? "").replace(/\\/g, "/"); }
  catch { return null; }
  if (!path || /[\u0000-\u001f\u007f]/.test(path) || path.startsWith("//")) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:\//i.test(path)) return null;
  const line = Number(match[2] ?? match[3]);
  const column = Number(match[4] ?? 1);
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) return null;
  return { path, line, column };
}

export function markdownCodeReference(path: string, line: number, endLine = line): string {
  const normalized = path.replace(/\\/g, "/");
  const label = `${normalized}:${line}`.replace(/[\\[\]]/g, "\\$&");
  const target = normalized.split("/").map(part => encodeURIComponent(part).replace(/[()]/g, char => `%${char.charCodeAt(0).toString(16)}`)).join("/");
  return `[${label}](${target}#L${line}${endLine > line ? `-L${endLine}` : ""})`;
}

export type ReferencePart = { readonly text: string; readonly reference?: CodeReference };

/** Leave code samples and unrecognized Markdown untouched. No HTML parsing. */
export function codeReferenceParts(text: string): ReferencePart[] {
  const parts: ReferencePart[] = [];
  const tokens = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|\[((?:\\.|[^\]\\])+)\]\(([^\s)]+)\)/g;
  let cursor = 0;
  for (const match of text.matchAll(tokens)) {
    if (match[1] === undefined || match[2] === undefined) continue;
    const reference = parseCodeReference(match[2]);
    if (!reference) continue;
    parts.push({ text: text.slice(cursor, match.index) });
    parts.push({ text: match[1].replace(/\\([\\[\]])/g, "$1").replace(/^`(.*)`$/, "$1"), reference });
    cursor = match.index + match[0].length;
  }
  parts.push({ text: text.slice(cursor) });
  return parts;
}
