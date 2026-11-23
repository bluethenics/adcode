/**
 * The "it's done" card: the one design every ADCode success, connected and confirmation page
 * uses, wherever it is served from.
 *
 * Signed in to the desktop app, a GitHub account connected, an email verified, a payment back
 * from checkout, an alert subscription confirmed. Each of these lands somebody on a page whose
 * only job is to say what just happened and where to go next, so they all look the same: one
 * centred card, the ADCode icon, a title, a short table of what changed, a line of small print
 * and one button.
 *
 * Three places serve these pages and none of them shares a bundle with the others:
 *
 * - the website (`apps/web`), through `components/DoneCard.tsx`, which renders the same markup
 *   in React and loads `DONE_CARD_CSS` from here;
 * - this API, which answers email links with a plain HTML document (`doneCardDocument`);
 * - the desktop app's loopback sign-in server (`apps/desktop/src/main/oauthResultPage.ts`).
 *
 * So this file is plain TypeScript with no imports: a string of CSS, a string of markup and
 * an escape function. Change the design here and all three change with it.
 */

export type DoneTone = "ok" | "info" | "warn";

export interface DoneRow {
  label: string;
  value: string;
}

/** The card's one primary button: a link, or a form that posts (a GET must never confirm anything). */
export type DoneAction =
  | { kind: "link"; label: string; href: string }
  | { kind: "post"; label: string; action: string; fields?: Readonly<Record<string, string>> };

export interface DoneCardContent {
  title: string;
  /** What just changed, as label/value pairs. Leave it out rather than invent rows. */
  rows?: readonly DoneRow[];
  /** One or two short lines of small print under the table. */
  notes?: readonly string[];
  action?: DoneAction;
  /** A quieter way out under the button ("Not now", "Keep them"). */
  secondary?: { label: string; href: string };
  tone?: DoneTone;
}

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** `bluebird.dev@gmail.com` → `b***@gmail.com`: enough to recognise, not enough to harvest. */
export function maskEmail(email: string | null | undefined): string {
  if (typeof email !== "string") return "";
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "";
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`;
}

/**
 * The ADCode app icon, plate included: the plate is the rounded tile the card shows.
 * Path for path the same as `build/icon.svg`; the gradient and filter ids are renamed so the
 * icon can sit on a page that also draws the inline mark.
 */
export const ADCODE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="72" height="72" aria-hidden="true" focusable="false"><defs><linearGradient id="doneIconFold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".42"/><stop offset=".55" stop-color="#000" stop-opacity=".16"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient><filter id="doneIconGlow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="22" flood-color="#ffffff" flood-opacity="0.35"/></filter></defs><rect width="1024" height="1024" rx="224" fill="#050505"/><g fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" filter="url(#doneIconGlow)"><path d="M320 348L140 512L320 676" stroke-width="96"/><path d="M704 348L884 512L704 676" stroke-width="96"/><path d="M512 296V388" stroke-width="64"/><path d="M512 636V728" stroke-width="64"/><path d="M584 405C563 374 531 356 494 356C446 356 413 383 413 423C413 463 444 484 505 500C569 517 606 541 606 590C606 641 565 671 511 671C466 671 429 651 405 619" stroke-width="92"/></g><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M128 478L128 546L198 512Z" fill="url(#doneIconFold)" stroke="none"/><path d="M896 478L896 546L826 512Z" fill="url(#doneIconFold)" stroke="none"/><path d="M292 358L164 474" stroke="#fff" stroke-width="20" opacity=".26"/><path d="M732 358L860 474" stroke="#fff" stroke-width="20" opacity=".26"/><path d="M164 550L292 666" stroke="#000" stroke-width="20" opacity=".2"/><path d="M860 550L732 666" stroke="#000" stroke-width="20" opacity=".2"/><path d="M480 340L544 340L522 394L498 394Z" fill="#000" opacity=".3" stroke="none"/><path d="M480 630L544 630L522 684L498 684Z" fill="#000" opacity=".3" stroke="none"/><path d="M492 512Q560 536 512 576" stroke="#000" stroke-width="32" opacity=".22"/><path d="M440 400Q450 375 490 368" stroke="#fff" stroke-width="15" opacity=".24"/></g></svg>`;

const DARK_TOKENS =
  "--done-bg:#171717;--done-card:#212121;--done-table:#1b1b1b;--done-line:#333331;--done-ink:#f3f3f1;--done-muted:#a6a6a1;--done-button:#f5f5f3;--done-button-ink:#161616;--done-button-hover:#ffffff;--done-warn:#f2a98e;--done-ring:#ffffff1f;";

/**
 * Light by default, dark when the system asks for it, and the site's own appearance switch
 * (`data-theme` on <html>) wins over both. Standalone pages have no switch, so they follow
 * the system.
 */
export const DONE_CARD_CSS = `
.done-page,.done-canvas{--done-bg:#f3f3f1;--done-card:#ffffff;--done-table:#fafaf8;--done-line:#e2e2dd;--done-ink:#1c1c1a;--done-muted:#686863;--done-button:#1c1c1a;--done-button-ink:#fafaf8;--done-button-hover:#34342f;--done-warn:#a33d1c;--done-ring:#00000014;}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .done-page,:root:not([data-theme="light"]) .done-canvas{${DARK_TOKENS}}}
:root[data-theme="dark"] .done-page,:root[data-theme="dark"] .done-canvas{${DARK_TOKENS}}
.done-canvas{margin:0;background:var(--done-bg);color-scheme:light dark;}
.done-page{box-sizing:border-box;min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:clamp(24px,6vh,64px) 16px;background:var(--done-bg);color:var(--done-ink);font-family:var(--font-body,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased;text-align:center;}
.done-page[data-overlay]{position:fixed;inset:0;z-index:2147483000;overflow-y:auto;}
html:has(.done-page[data-overlay]),body:has(.done-page[data-overlay]){overflow:hidden;}
.done-page *,.done-page *::before,.done-page *::after{box-sizing:border-box;}
.done-card{width:min(100%,472px);padding:44px 40px 36px;border:1px solid var(--done-line);border-radius:20px;background:var(--done-card);animation:done-arrive .2s ease-out;}
.done-icon{display:block;width:72px;height:72px;margin:0 auto 24px;border-radius:16px;box-shadow:0 0 0 1px var(--done-ring);overflow:hidden;}
.done-icon svg{display:block;width:72px;height:72px;}
.done-title{margin:0 0 26px;font-family:var(--font-display,inherit);font-size:26px;line-height:1.25;font-weight:500;letter-spacing:-.015em;text-wrap:balance;overflow-wrap:anywhere;color:var(--done-ink);}
.done-rows{margin:0;padding:0;border:1px solid var(--done-line);border-radius:12px;background:var(--done-table);text-align:left;font-size:14px;overflow:hidden;}
.done-row{display:grid;grid-template-columns:minmax(0,128px) minmax(0,1fr);gap:16px;align-items:baseline;padding:11px 14px;}
.done-row+.done-row{border-top:1px solid var(--done-line);}
.done-row dt{margin:0;color:var(--done-muted);}
.done-row dd{margin:0;font-weight:600;color:var(--done-ink);overflow-wrap:anywhere;}
.done-note{max-width:36ch;margin:24px auto 0;color:var(--done-muted);font-size:14px;line-height:1.55;text-wrap:balance;}
.done-note+.done-note{margin-top:4px;}
.done-alert{margin:20px auto 0;max-width:38ch;color:var(--done-warn);font-size:14px;line-height:1.5;}
.done-actions{display:grid;gap:14px;margin-top:26px;}
.done-actions form{margin:0;}
.done-button{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:44px;padding:10px 18px;border:0;border-radius:10px;background:var(--done-button);color:var(--done-button-ink);font:inherit;font-size:15px;font-weight:600;line-height:1.2;text-decoration:none;cursor:pointer;transition:background-color .15s ease,transform .1s ease;}
.done-button:hover{background:var(--done-button-hover);color:var(--done-button-ink);}
.done-button:active{transform:scale(.99);}
.done-button:focus-visible,.done-secondary:focus-visible{outline:2px solid var(--done-ink);outline-offset:3px;}
.done-button:disabled,.done-button[aria-disabled="true"]{opacity:.55;cursor:default;transform:none;}
.done-secondary{justify-self:center;padding:2px 4px;border:0;background:none;color:var(--done-muted);font:inherit;font-size:14px;text-decoration:underline;text-underline-offset:3px;cursor:pointer;}
.done-secondary:hover{color:var(--done-ink);}
.done-footer{margin:22px 0 0;color:var(--done-muted);font-size:12px;}
.done-footer a{color:inherit;text-underline-offset:3px;}
.done-spinner{width:15px;height:15px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:done-spin .7s linear infinite;}
@keyframes done-arrive{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}
@keyframes done-spin{to{transform:rotate(360deg);}}
@media (prefers-reduced-motion:reduce){.done-card,.done-spinner{animation:none;}.done-button{transition:none;}}
@media (max-width:420px){.done-card{padding:34px 20px 26px;}.done-title{font-size:23px;}.done-row{grid-template-columns:1fr;gap:2px;}}
`;

function actionHtml(action: DoneAction): string {
  if (action.kind === "link") return `<a class="done-button" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`;
  const fields = Object.entries(action.fields ?? {})
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("");
  return `<form method="post" action="${escapeHtml(action.action)}">${fields}<button type="submit" class="done-button">${escapeHtml(action.label)}</button></form>`;
}

/** The card itself, as markup: `<main class="done-page">` and everything in it. */
export function doneCardHtml(content: DoneCardContent): string {
  const rows = content.rows ?? [];
  const notes = content.notes ?? [];
  const table = rows.length === 0 ? "" : `<dl class="done-rows">${rows.map((row) => `<div class="done-row"><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`).join("")}</dl>`;
  const actions = content.action === undefined && content.secondary === undefined ? "" :
    `<div class="done-actions">${content.action === undefined ? "" : actionHtml(content.action)}${content.secondary === undefined ? "" : `<a class="done-secondary" href="${escapeHtml(content.secondary.href)}">${escapeHtml(content.secondary.label)}</a>`}</div>`;
  return `<main class="done-page" data-tone="${content.tone ?? "ok"}"><section class="done-card" aria-labelledby="done-title"><span class="done-icon">${ADCODE_ICON_SVG}</span><h1 class="done-title" id="done-title">${escapeHtml(content.title)}</h1>${table}${notes.map((note) => `<p class="done-note">${escapeHtml(note)}</p>`).join("")}${actions}</section></main>`;
}

/** A complete page for servers with no React: the API's email links and the desktop's loopback. */
export function doneCardDocument(content: DoneCardContent, options: { favicon?: boolean } = {}): string {
  const favicon = options.favicon === true ? `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(ADCODE_ICON_SVG)}">` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>${escapeHtml(content.title)} - ADCode</title>${favicon}<style>${DONE_CARD_CSS}</style></head><body class="done-canvas">${doneCardHtml(content)}</body></html>`;
}
