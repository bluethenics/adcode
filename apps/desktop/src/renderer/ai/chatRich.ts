/**
 * What a reply can show beyond text: links that open, rows of link buttons, and mockups.
 *
 * Pure strings, like `chatMarkdown.ts`, which calls these. Every value is escaped before it
 * becomes markup, and a link is only ever a button carrying its address as data - the chat
 * decides what a click does, so a reply can never navigate this window.
 */

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const escapeAttribute = (value: string): string => escapeHtml(value).replace(/\n/g, "&#10;");

/** Where a chat link may lead: the web, or a server on this machine. Never a file or a script. */
export function isSafeChatLink(url: string): boolean {
  const value = url.trim();
  if (value.length > 2000) return false;
  return /^https:\/\/[^\s"'<>]+$/i.test(value) || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/[^\s"'<>]*)?$/i.test(value);
}

/** `[label](https://…)` as a link the chat opens in the Browser panel. Input is already escaped. */
export function renderChatLinks(escaped: string): string {
  return escaped.replace(/(^|[^!])\[([^\]\n]{1,160})\]\((https?:\/\/[^\s)]{1,2000})\)/g, (whole: string, lead: string, label: string, url: string) =>
    isSafeChatLink(url.replace(/&amp;/g, "&"))
      ? `${lead}<button type="button" class="chat-link" data-chat-link="${url}" title="${url}">${label}</button>`
      : whole);
}

/**
 * A `buttons` block: one button per line, `Label | https://…` or `[Label](https://…)`.
 * A line that is not a safe link is dropped rather than drawn as a button that does nothing.
 * Returns "" when no line qualifies, so the caller can show the block as plain code instead.
 */
export function renderChatButtons(code: string): string {
  const buttons: string[] = [];
  for (const line of code.split("\n").slice(0, 8)) {
    const piped = /^\s*(.{1,80}?)\s*\|\s*(\S+)\s*$/.exec(line);
    const linked = /^\s*\[([^\]]{1,80})\]\((\S+)\)\s*$/.exec(line);
    const label = (linked?.[1] ?? piped?.[1] ?? "").trim();
    const url = (linked?.[2] ?? piped?.[2] ?? "").trim();
    if (label === "" || !isSafeChatLink(url)) continue;
    buttons.push(`<button type="button" class="chat-action-button" data-chat-link="${escapeAttribute(url)}" title="${escapeAttribute(url)}">${escapeHtml(label)}</button>`);
  }
  return buttons.length === 0 ? "" : `<div class="chat-actions" role="group" aria-label="Links">${buttons.join("")}</div>`;
}

export const MAX_MOCKUP_CHARS = 60_000;

/**
 * A `mockup` block: the model's HTML and CSS, drawn in a frame with every sandbox flag off.
 * No script runs in it, it has no origin, and it cannot navigate or reach this window; this
 * window's own policy still applies inside, so it loads nothing but https images. What is
 * left is a picture of a layout, with its source one click away. `sourceHtml` is that source
 * already rendered as a code block. Returns "" for a block too large or empty to draw.
 */
export function renderChatMockup(code: string, sourceHtml: string): string {
  if (code.trim() === "" || code.length > MAX_MOCKUP_CHARS) return "";
  const page = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}body{font-family:system-ui,sans-serif;padding:16px;box-sizing:border-box}</style>${code}`;
  return (
    `<figure class="chat-mockup">` +
    `<div class="chat-mockup-bar"><span class="chat-mockup-label">Mockup</span><button type="button" class="chat-mockup-toggle" aria-pressed="false">Phone width</button></div>` +
    `<iframe class="chat-mockup-frame" sandbox="" referrerpolicy="no-referrer" loading="lazy" title="Mockup" srcdoc="${escapeAttribute(page)}"></iframe>` +
    `<details class="chat-mockup-source"><summary>Show the HTML</summary>${sourceHtml}</details></figure>`
  );
}
