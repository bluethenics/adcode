/** Pure, bounded context sent to the selected completion provider. */
export const COMPLETION_PREFIX_CHARS = 6_000;
export const COMPLETION_SUFFIX_CHARS = 2_000;

export interface InlineCompletionContext {
  readonly languageId: string;
  readonly prefix: string;
  readonly suffix: string;
}

export function completionContextAt(
  text: string,
  cursorOffset: number,
  languageId: string,
): InlineCompletionContext {
  const offset = Math.max(0, Math.min(text.length, Math.floor(cursorOffset)));
  return {
    languageId,
    prefix: text.slice(Math.max(0, offset - COMPLETION_PREFIX_CHARS), offset),
    suffix: text.slice(offset, offset + COMPLETION_SUFFIX_CHARS),
  };
}

/** Files whose usual purpose is carrying credentials never enter an automatic AI request. */
export function allowsAiCompletionForPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLocaleLowerCase();
  const name = normalized.split("/").at(-1) ?? normalized;
  if (normalized.includes("/.ssh/")) return false;
  if (name === ".env" || name.startsWith(".env.")) return false;
  if (/^(?:credentials|secrets?)(?:\.[^.]+)?$/.test(name)) return false;
  if (/^(?:id_rsa|id_ed25519|\.npmrc|\.netrc)$/.test(name)) return false;
  return !/\.(?:pem|key|p12|pfx)$/.test(name);
}
