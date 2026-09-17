/**
 * A small markdown subset, rendered to HTML.
 *
 * Headings, paragraphs, quotes, unordered and ordered lists, fenced code blocks with a
 * copy button, images, video embeds, inline code, bold, and links. That is what the
 * posts use, and a full markdown library would be a runtime dependency carried for a
 * handful of features.
 *
 * Every value is escaped before any markup is added, and inline rules run on the escaped
 * text. The posts are ours today, but the admin panel will let posts be typed by a human
 * into a form, and a renderer that is safe only while its input is trusted is a stored
 * XSS waiting for that change.
 *
 * Images: `![alt](url)` where the URL is site-relative or https. Anything else -
 * `data:`, `javascript:`, plain http - renders as its source text, never as an image.
 * Upload through the admin editor instead of pasting bytes: it stores the file on the
 * API's asset host and inserts the URL for you.
 *
 * Video: `@[youtube](id-or-link)` or `@[vimeo](id-or-link)` on its own line, rendering
 * a lazy 16:9 iframe from an allowlisted host only. Anything unrecognised renders as
 * its source text, never as a frame.
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

/**
 * An image source, as the reader's browser will be asked to fetch it.
 *
 * Site-relative or https only. No `data:` - a pasted data URL would inline the whole
 * file into the post row on every read, which is the failure `services/api/src/assets.ts`
 * documents at length - and no `http:`, which would mixed-content warn on the live site.
 */
function safeImageSrc(src: string): string | null {
  const trimmed = src.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A video reference to an embed, or null when it names nothing embeddable.
 *
 * Accepts a bare id (`dQw4w9WgXcQ`, `123456789`) or a full watch/share/player link;
 * the iframe always points at the privacy-enhanced host, never at a URL that arrived
 * over the wire. Hosts outside YouTube and Vimeo are not embeddable, full stop.
 */
function videoEmbed(kind: string, value: string): { src: string; title: string } | null {
  const trimmed = value.trim();
  const lower = kind.toLowerCase();

  if (lower === "youtube") {
    const bare = /^[A-Za-z0-9_-]{11}$/.exec(trimmed)?.[0];
    if (bare !== undefined) {
      return { src: `https://www.youtube-nocookie.com/embed/${bare}`, title: "YouTube video" };
    }
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      let id: string | null = null;
      if (host === "youtu.be") {
        id = /^[A-Za-z0-9_-]{11}$/.exec(parsed.pathname.slice(1))?.[0] ?? null;
      } else if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
        const pathId =
          /^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/.exec(parsed.pathname)?.[1] ?? null;
        const paramId = /^[A-Za-z0-9_-]{11}$/.exec(parsed.searchParams.get("v") ?? "")?.[0] ?? null;
        id = pathId ?? paramId;
      }
      if (id === null) return null;
      return { src: `https://www.youtube-nocookie.com/embed/${id}`, title: "YouTube video" };
    } catch {
      return null;
    }
  }

  if (lower === "vimeo") {
    const bare = /^[0-9]{1,12}$/.exec(trimmed)?.[0];
    if (bare !== undefined) {
      return { src: `https://player.vimeo.com/video/${bare}`, title: "Vimeo video" };
    }
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
      const id = /(?:\/video)?\/([0-9]{1,12})(?:\/|$)/.exec(parsed.pathname)?.[1] ?? null;
      if (id === null) return null;
      return { src: `https://player.vimeo.com/video/${id}`, title: "Vimeo video" };
    } catch {
      return null;
    }
  }

  return null;
}

/** The header label on a code box. `prompt` gets a name because prompts are copied whole. */
function codeLabel(language: string): string {
  const clean = language.trim().toLowerCase();
  if (clean === "") return "Code";
  if (clean === "prompt") return "Prompt";
  if (clean === "terminal" || clean === "shell") return "Terminal";
  return language.trim().slice(0, 20);
}

function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (whole, alt: string, src: string) => {
      const safe = safeImageSrc(src);
      if (safe === null) return whole;
      return `<img class="prose-img" loading="lazy" decoding="async" src="${safe}" alt="${alt}">`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, text: string, href: string) => {
      const safe = safeHref(href);
      return safe === null ? text : `<a href="${safe}">${text}</a>`;
    });
}

const FENCE = /^```([A-Za-z0-9_+-]*)\s*$/;
const VIDEO_LINE = /^@\[(youtube|vimeo)\]\(\s*([^)]+?)\s*\)$/i;
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/;

export function renderMarkdown(source: string): string {
  const lines = source.trim().split(/\r?\n/);
  const out: string[] = [];

  let paragraph: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];
  let fence: { language: string; lines: string[] } | null = null;

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

  const flushQuote = (): void => {
    if (quote.length === 0) return;
    out.push(`<blockquote>${inline(escapeHtml(quote.join(" ")))}</blockquote>`);
    quote = [];
  };

  const flushFence = (): void => {
    if (fence === null) return;
    const label = escapeHtml(codeLabel(fence.language));
    const code = escapeHtml(fence.lines.join("\n").replace(/\n+$/, ""));
    out.push(
      `<div class="codebox"><div class="codebox-bar"><span class="codebox-lang">${label}</span><button type="button" class="codebox-copy" data-codebox-copy>Copy</button></div><pre><code>${code}</code></pre></div>`,
    );
    fence = null;
  };

  const flushAll = (): void => {
    flushParagraph();
    flushList();
    flushQuote();
    flushFence();
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Inside a fenced block everything is literal until the closing fence, blank
    // lines included. An unclosed fence still renders at the end of the document
    // rather than swallowing the page into nothing.
    if (fence !== null) {
      if (trimmed === "```") flushFence();
      else fence.lines.push(line.replace(/\s+$/, ""));
      continue;
    }

    if (trimmed.length === 0) {
      flushAll();
      continue;
    }

    const fenceOpen = FENCE.exec(trimmed);
    if (fenceOpen !== null) {
      flushAll();
      fence = { language: fenceOpen[1] ?? "", lines: [] };
      continue;
    }

    const heading = /^(#{2,4})\s+(.*)$/.exec(trimmed);
    if (heading !== null) {
      flushAll();
      const level = (heading[1] as string).length;
      out.push(`<h${level}>${inline(escapeHtml(heading[2] as string))}</h${level}>`);
      continue;
    }

    // A video or a lone image is a block: full-width figure or 16:9 frame, not a
    // paragraph that happens to contain one.
    const video = VIDEO_LINE.exec(trimmed);
    if (video !== null) {
      const embed = videoEmbed(video[1] as string, video[2] as string);
      flushAll();
      if (embed !== null) {
        out.push(
          `<div class="video-embed"><iframe src="${embed.src}" title="${embed.title}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`,
        );
      } else {
        out.push(`<p>${escapeHtml(trimmed)}</p>`);
      }
      continue;
    }

    const image = IMAGE_LINE.exec(trimmed);
    if (image !== null) {
      const safe = safeImageSrc(image[2] as string);
      flushAll();
      if (safe !== null) {
        const alt = escapeHtml(image[1] as string);
        out.push(
          `<figure class="prose-media"><img loading="lazy" decoding="async" src="${safe}" alt="${alt}">` +
            (alt.length > 0 ? `<figcaption>${alt}</figcaption>` : "") +
            `</figure>`,
        );
      } else {
        out.push(`<p>${escapeHtml(trimmed)}</p>`);
      }
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet !== null) {
      flushParagraph();
      flushQuote();
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
      flushQuote();
      if (list?.kind !== "ol") {
        flushList();
        list = { kind: "ol", items: [] };
      }
      list.items.push(numbered[1] as string);
      continue;
    }

    const quotation = /^>\s?(.*)$/.exec(trimmed);
    if (quotation !== null) {
      flushParagraph();
      flushList();
      quote.push(quotation[1] as string);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(trimmed);
  }

  flushAll();
  return out.join("\n");
}
