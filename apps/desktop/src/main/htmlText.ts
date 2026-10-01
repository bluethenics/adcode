/**
 * A web page as readable text, for `fetch_url`.
 *
 * Documentation pages are mostly markup: a typical one is 150 KB of HTML around 15 KB of
 * words, and the 24,000-character cap used to spend itself on `<script>` and navigation
 * before reaching the part the model asked for. This keeps the words, the headings and the
 * links - which is what reading docs needs - and drops the rest. Not a full HTML parser; a
 * page that defeats it is still readable with `raw: true`.
 */

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
  middot: "·",
  times: "×",
  rarr: "→",
  larr: "←",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      const code = Number.parseInt(name.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    if (name.startsWith("#")) {
      const code = Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

/** Whether a response body is an HTML page. */
export function looksLikeHtml(contentType: string | null, body: string): boolean {
  if (contentType !== null && /text\/html|application\/xhtml/i.test(contentType)) return true;
  return /^\s*(?:<!doctype html|<html[\s>])/i.test(body.slice(0, 500));
}

const stripTags = (text: string): string => decodeEntities(text.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

/** The page's title and readable text, with headings marked and links kept as "text (href)". */
export function htmlToText(html: string, base?: string): string {
  let body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg|canvas|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, "");
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1];
  body = body.replace(/<head\b[\s\S]*?<\/head\s*>/i, "");
  // Prefer the main content when the page marks it.
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(body)?.[1] ?? /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(body)?.[1];
  if (main !== undefined && stripTags(main).length > 200) body = main;

  body = body
    .replace(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi, (_match, _quote: string, href: string, inner: string) => {
      const text = stripTags(inner);
      if (text.length === 0 || href.startsWith("#") || /^javascript:/i.test(href)) return ` ${text} `;
      let absolute = decodeEntities(href);
      if (base !== undefined) {
        try { absolute = new URL(absolute, base).href; } catch { /* keep it as written */ }
      }
      return ` ${text} (${absolute}) `;
    })
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_match, level: string, inner: string) => `\n\n${"#".repeat(Number(level))} ${stripTags(inner)}\n\n`)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_match, inner: string) => `\n\n\`\`\`\n${decodeEntities(inner.replace(/<[^>]*>/g, ""))}\n\`\`\`\n\n`)
    .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(?:p|div|section|article|header|footer|nav|aside|main|ul|ol|table|tr|blockquote|figure|figcaption|form|fieldset|dl|dt|dd|details|summary)\b[^>]*>/gi, "\n")
    .replace(/<\/?(?:td|th)\b[^>]*>/gi, " | ")
    .replace(/<[^>]*>/g, "");

  const lines: string[] = [];
  let fence = false;
  for (const raw of decodeEntities(body).split("\n")) {
    if (raw.trim() === "```") fence = !fence;
    const line = fence ? raw.replace(/\s+$/, "") : raw.replace(/[ \t ]+/g, " ").trim();
    if (line.length === 0 && (lines.length === 0 || lines[lines.length - 1] === "")) continue;
    lines.push(line);
  }
  const text = lines.join("\n").trim();
  const heading = title === undefined ? "" : stripTags(title);
  return heading.length > 0 ? `${heading}\n\n${text}` : text;
}
