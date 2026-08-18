/**
 * A small markdown subset, rendered to HTML.
 *
 * Headings, paragraphs, unordered and ordered lists, inline code, bold, and links. That
 * is what the posts use, and a full markdown library would be a runtime dependency
 * carried for a handful of features.
 *
 * Every value is escaped before any markup is added, and inline rules run on the escaped
 * text. The posts are ours today, but the admin panel will let posts be typed by a human
 * into a form, and a renderer that is safe only while its input is trusted is a stored
 * XSS waiting for that change.
 */

const escapeHtml = (raw: string): string =>
  raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Only http(s) and site-relative links. `javascript:` is the reason this exists. */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, text: string, href: string) => {
      const safe = safeHref(href);
      return safe === null ? text : `<a href="${safe}">${text}</a>`;
    });
}

export function renderMarkdown(source: string): string {
  const lines = source.trim().split(/\r?\n/);
  const out: string[] = [];

  let paragraph: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(escapeHtml(paragraph.join(" ")))}</p>`);
    paragraph = [];
  };

  const flushList = (): void => {
    if (list === null) return;
    const items = list.items.map((item) => `<li>${inline(escapeHtml(item))}</li>`).join("");
    out.push(`<${list.kind}>${items}</${list.kind}>`);
    list = null;
  };

  const flushAll = (): void => {
    flushParagraph();
    flushList();
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      flushAll();
      continue;
    }

    const heading = /^(#{2,4})\s+(.*)$/.exec(trimmed);
    if (heading !== null) {
      flushAll();
      const level = (heading[1] as string).length;
      out.push(`<h${level}>${inline(escapeHtml(heading[2] as string))}</h${level}>`);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet !== null) {
      flushParagraph();
      if (list?.kind !== "ul") {
        flushList();
        list = { kind: "ul", items: [] };
      }
      list.items.push(bullet[1] as string);
      continue;
    }

    const numbered = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (numbered !== null) {
      flushParagraph();
      if (list?.kind !== "ol") {
        flushList();
        list = { kind: "ol", items: [] };
      }
      list.items.push(numbered[1] as string);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushAll();
  return out.join("\n");
}
