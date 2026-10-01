/**
 * `view_page` as data: what the model asked for, where it may go, what the page said.
 *
 * Plain TypeScript, no Electron, so the rules that keep the agent's browser on the user's own
 * machine - and the report the model reads - are testable without opening a window.
 * `agentBrowser.ts` owns the window and the DevTools protocol; this owns everything else.
 */

export type PageActionType = "click" | "type" | "press" | "select" | "hover" | "scroll" | "wait" | "eval";

export interface PageAction {
  readonly type: PageActionType;
  readonly selector?: string;
  readonly text?: string;
  readonly value?: string;
  readonly submit?: boolean;
  readonly key?: string;
  readonly to?: "top" | "bottom";
  readonly y?: number;
  readonly ms?: number;
  readonly expression?: string;
}

export type PageTarget =
  /** A page of the live preview, relative to its root. */
  | { readonly kind: "preview"; readonly path: string }
  /** Any local address, such as a dev server the agent started itself. */
  | { readonly kind: "url"; readonly url: string }
  /** Wherever the last call left the browser. */
  | { readonly kind: "current" };

export interface ViewPageRequest {
  readonly target: PageTarget;
  readonly width: number;
  readonly height: number;
  readonly actions: readonly PageAction[];
  readonly screenshot: boolean;
  readonly fullPage: boolean;
}

export const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;
const ACTION_TYPES: ReadonlySet<string> = new Set(["click", "type", "press", "select", "hover", "scroll", "wait", "eval"]);
const MAX_ACTIONS = 20;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A local http(s) address with no credentials - the only kind the agent's browser opens. */
export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      (LOOPBACK_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost")) &&
      url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

/**
 * A page of the preview, as an absolute URL on the preview's own origin.
 *
 * Models write the page every way there is - `about.html`, `/about.html`, `./about.html`,
 * `#pricing`, `?tab=2`, the whole URL they were given earlier - and every spelling should
 * land on the same server. A full URL is accepted only when it is on that same origin, so a
 * page path can never become a way to point the browser somewhere else.
 */
export function resolvePreviewPage(base: string, path: string): string | null {
  let root: URL;
  try {
    root = new URL(base);
  } catch {
    return null;
  }
  const trimmed = path.trim().replaceAll("\\", "/");
  if (trimmed.length === 0 || trimmed === "/" || trimmed === ".") return root.href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    try {
      const absolute = new URL(trimmed);
      return absolute.origin === root.origin ? absolute.href : null;
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("//")) return null;
  try {
    // Relative to the site root, not to whatever page the base address happened to name.
    const resolved = new URL(trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith("?") ? trimmed : `/${trimmed.replace(/^\.\//, "")}`, `${root.origin}/`);
    return resolved.origin === root.origin ? resolved.href : null;
  } catch {
    return null;
  }
}

const int = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;

const shortString = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;

/** One action, or what is wrong with it. */
function parseAction(raw: unknown, index: number): PageAction | string {
  const where = `Action ${index + 1}`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return `${where} must be an object such as {"type": "click", "text": "Sign up"}.`;
  const record = raw as Record<string, unknown>;
  const type = record["type"];
  if (typeof type !== "string" || !ACTION_TYPES.has(type)) {
    return `${where} has type ${JSON.stringify(type)}; use one of click, type, press, select, hover, scroll, wait, eval.`;
  }
  const selector = shortString(record["selector"], 500);
  const text = shortString(record["text"], 200);
  const value = typeof record["value"] === "string" && record["value"].length <= 10_000 ? record["value"] : undefined;
  const action: PageAction = {
    type: type as PageActionType,
    ...(selector === undefined ? {} : { selector }),
    ...(text === undefined ? {} : { text }),
    ...(value === undefined ? {} : { value }),
    ...(record["submit"] === true ? { submit: true } : {}),
    ...(shortString(record["key"], 40) === undefined ? {} : { key: record["key"] as string }),
    ...(record["to"] === "top" || record["to"] === "bottom" ? { to: record["to"] } : {}),
    ...(int(record["y"], 0, 1_000_000) === null ? {} : { y: record["y"] as number }),
    ...(int(record["ms"], 0, 10_000) === null ? {} : { ms: record["ms"] as number }),
    ...(shortString(record["expression"], 4_000) === undefined ? {} : { expression: record["expression"] as string }),
  };
  const target = action.selector !== undefined || action.text !== undefined;
  switch (action.type) {
    case "click":
    case "hover":
      return target ? action : `${where} (${action.type}) needs a selector or the element's visible text.`;
    case "type":
      return action.value === undefined ? `${where} (type) needs the value to enter.` : action;
    case "select":
      return action.selector === undefined || action.value === undefined ? `${where} (select) needs a selector and a value.` : action;
    case "press":
      return action.key === undefined ? `${where} (press) needs a key, such as Enter.` : action;
    case "scroll":
      return action.to === undefined && action.y === undefined && action.selector === undefined && action.text === undefined
        ? `${where} (scroll) needs to (top or bottom), y, or a selector.`
        : action;
    case "wait":
      return action.ms === undefined && action.selector === undefined && action.text === undefined ? `${where} (wait) needs ms, or a selector to wait for.` : action;
    case "eval":
      return action.expression === undefined ? `${where} (eval) needs an expression.` : action;
  }
}

/** The tool's input as a request, or a sentence saying what to fix. */
export function parseViewPageInput(input: Record<string, unknown>): ViewPageRequest | string {
  const path = input["path"];
  const url = input["url"];
  if (path !== undefined && typeof path !== "string") return "view_page path must be text, such as about.html.";
  if (url !== undefined && typeof url !== "string") return "view_page url must be text, such as http://localhost:5173/.";
  if (typeof path === "string" && typeof url === "string" && path.trim() && url.trim()) {
    return "Pass path (a page of the live preview) or url (any local address), not both.";
  }
  let target: PageTarget;
  if (typeof url === "string" && url.trim().length > 0) {
    if (!isLoopbackUrl(url.trim())) {
      return "view_page opens local addresses only - http://localhost:PORT or http://127.0.0.1:PORT. To read a public page, use fetch_url.";
    }
    target = { kind: "url", url: new URL(url.trim()).href };
  } else if (typeof path === "string" && path.trim().length > 0) {
    target = { kind: "preview", path: path.trim() };
  } else {
    target = { kind: "current" };
  }
  const width = input["width"] === undefined ? DEFAULT_VIEWPORT.width : int(input["width"], 240, 3840);
  const height = input["height"] === undefined ? DEFAULT_VIEWPORT.height : int(input["height"], 240, 2400);
  if (width === null || height === null) return "view_page width is 240 to 3840 and height 240 to 2400, in whole pixels.";
  const rawActions = input["actions"];
  if (rawActions !== undefined && !Array.isArray(rawActions)) return "view_page actions must be a list of steps.";
  const list = (rawActions as unknown[] | undefined) ?? [];
  if (list.length > MAX_ACTIONS) return `view_page takes at most ${MAX_ACTIONS} actions per call.`;
  const actions: PageAction[] = [];
  for (const [index, raw] of list.entries()) {
    const parsed = parseAction(raw, index);
    if (typeof parsed === "string") return parsed;
    actions.push(parsed);
  }
  return { target, width, height, actions, screenshot: input["screenshot"] !== false, fullPage: input["full_page"] === true };
}

/** A key name a model writes, as the DevTools protocol wants it. */
export function keyEvent(name: string): { key: string; code: string; keyCode: number; text?: string } | null {
  const named: Readonly<Record<string, { key: string; code: string; keyCode: number; text?: string }>> = {
    enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
    return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
    tab: { key: "Tab", code: "Tab", keyCode: 9 },
    escape: { key: "Escape", code: "Escape", keyCode: 27 },
    esc: { key: "Escape", code: "Escape", keyCode: 27 },
    backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
    delete: { key: "Delete", code: "Delete", keyCode: 46 },
    space: { key: " ", code: "Space", keyCode: 32, text: " " },
    arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
    arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
    arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
    arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
    up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
    down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
    left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
    right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
    home: { key: "Home", code: "Home", keyCode: 36 },
    end: { key: "End", code: "End", keyCode: 35 },
    pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
    pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  };
  const found = named[name.trim().toLowerCase().replace(/[\s_-]/g, "")];
  if (found !== undefined) return found;
  // A single printable character presses that key.
  if ([...name].length === 1) {
    const upper = name.toUpperCase();
    return { key: name, code: /[A-Z]/.test(upper) ? `Key${upper}` : "", keyCode: upper.charCodeAt(0), text: name };
  }
  return null;
}

/* ── In the page ─────────────────────────────────────────────────────────── */

/**
 * Shared by the scripts below: a short CSS selector for an element, and whether it shows.
 * Kept as source text because it runs in the page, not here.
 */
const PAGE_HELPERS = String.raw`
  const clean = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  const shows = (el) => {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.02;
  };
  const selectorOf = (el) => {
    if (!(el instanceof Element)) return null;
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return "#" + el.id;
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 3; depth++) {
      let part = node.tagName.toLowerCase();
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) { parts.unshift("#" + node.id); break; }
      const name = node.getAttribute("name");
      if (name && /^[\w-]+$/.test(name)) part += "[name=" + JSON.stringify(name) + "]";
      else {
        const classes = typeof node.className === "string" ? node.className.split(/\s+/).filter((c) => /^[A-Za-z][\w-]*$/.test(c)).slice(0, 2) : [];
        if (classes.length) part += "." + classes.join(".");
      }
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((child) => child.tagName === node.tagName);
        if (same.length > 1 && !part.includes("[name=")) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      if (document.querySelectorAll(parts.join(" > ")).length === 1) break;
      node = parent;
    }
    return parts.join(" > ");
  };
  const labelOf = (field) => {
    if (field.labels && field.labels[0]) return clean(field.labels[0].innerText, 80);
    return clean(field.getAttribute("aria-label") || field.getAttribute("placeholder") || field.getAttribute("name") || field.id, 80);
  };
  const INTERACTIVE = "a[href], button, [role=button], [role=link], [role=tab], [role=menuitem], input[type=submit], input[type=button], input[type=checkbox], input[type=radio], summary, label, select, [onclick], [tabindex]";
  const textOf = (el) => clean(el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("alt"), 200);
  const findByText = (wanted) => {
    const needle = wanted.trim().toLowerCase();
    const interactive = [...document.querySelectorAll(INTERACTIVE)].filter(shows);
    const exact = interactive.find((el) => textOf(el).toLowerCase() === needle);
    if (exact) return exact;
    const partial = interactive.filter((el) => textOf(el).toLowerCase().includes(needle));
    if (partial.length) return partial.sort((a, b) => textOf(a).length - textOf(b).length)[0];
    const fields = [...document.querySelectorAll("input, textarea, select")].filter(shows);
    const field = fields.find((el) => labelOf(el).toLowerCase().includes(needle));
    if (field) return field;
    const any = [...document.querySelectorAll("body *")].filter((el) => shows(el) && textOf(el).toLowerCase().includes(needle));
    return any.sort((a, b) => textOf(a).length - textOf(b).length)[0] || null;
  };
`;

/**
 * Find an element, scroll it into view, and say where its middle is.
 *
 * Returns `{ ok: false, error }` in words a model can act on - "no element matches #email;
 * these fields exist: ..." - rather than a bare null, because the next call is a guess
 * otherwise.
 */
export function locateScript(selector: string | undefined, text: string | undefined): string {
  return `(() => {${PAGE_HELPERS}
    let el = null;
    const selector = ${JSON.stringify(selector ?? null)};
    const text = ${JSON.stringify(text ?? null)};
    try { if (selector) el = document.querySelector(selector); } catch (error) { return { ok: false, error: "That selector is not valid CSS: " + error.message }; }
    if (!el && text) el = findByText(text);
    if (!el) {
      const offered = [...document.querySelectorAll(INTERACTIVE + ", input, textarea")].filter(shows).slice(0, 12).map((item) => (selectorOf(item) || "?") + (textOf(item) ? " (" + textOf(item).slice(0, 40) + ")" : ""));
      return { ok: false, error: "No visible element matches " + (selector ? JSON.stringify(selector) : "the text " + JSON.stringify(text)) + "." + (offered.length ? " Some that exist: " + offered.join("; ") : " The page has no interactive elements.") };
    }
    el.scrollIntoView({ block: "center", inline: "center" });
    const rect = el.getBoundingClientRect();
    return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, selector: selectorOf(el), label: textOf(el).slice(0, 60), tag: el.tagName.toLowerCase(), editable: el.matches("input, textarea, [contenteditable=''], [contenteditable=true]"), shown: shows(el) };
  })()`;
}

/** Put the cursor in a field and select what is in it, so typing replaces it. */
export function focusForTypingScript(selector: string | undefined, text: string | undefined): string {
  return `(() => {${PAGE_HELPERS}
    let el = null;
    try { if (${JSON.stringify(selector ?? null)}) el = document.querySelector(${JSON.stringify(selector ?? "")}); } catch { return { ok: false, error: "That selector is not valid CSS." }; }
    if (!el && ${JSON.stringify(text ?? null)}) el = findByText(${JSON.stringify(text ?? "")});
    if (!el && !${JSON.stringify(selector ?? null)} && !${JSON.stringify(text ?? null)}) el = document.activeElement;
    if (!el || el === document.body) return { ok: false, error: "No field to type into. Pass the field's selector or label text." };
    el.scrollIntoView({ block: "center" });
    el.focus();
    if (typeof el.select === "function") el.select();
    else if (el.isContentEditable) document.execCommand("selectAll");
    return { ok: true, selector: selectorOf(el) };
  })()`;
}

/** Choose an option in a <select> by value or by its label, firing the events frameworks listen for. */
export function selectOptionScript(selector: string, value: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.tagName !== "SELECT") return { ok: false, error: "No <select> matches " + ${JSON.stringify(JSON.stringify(selector))} + "." };
    const wanted = ${JSON.stringify(value)}.trim().toLowerCase();
    const option = [...el.options].find((item) => item.value.toLowerCase() === wanted) || [...el.options].find((item) => item.text.trim().toLowerCase() === wanted);
    if (!option) return { ok: false, error: "No option " + ${JSON.stringify(JSON.stringify(value))} + ". Options: " + [...el.options].map((item) => item.text.trim()).slice(0, 20).join(", ") };
    el.value = option.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, chose: option.text.trim() };
  })()`;
}

export function scrollScript(action: PageAction): string {
  return `(() => {${PAGE_HELPERS}
    if (${JSON.stringify(action.selector ?? null)} || ${JSON.stringify(action.text ?? null)}) {
      let el = null;
      try { el = ${JSON.stringify(action.selector ?? null)} ? document.querySelector(${JSON.stringify(action.selector ?? "")}) : null; } catch { return { ok: false, error: "That selector is not valid CSS." }; }
      if (!el && ${JSON.stringify(action.text ?? null)}) el = findByText(${JSON.stringify(action.text ?? "")});
      if (!el) return { ok: false, error: "Nothing to scroll to: no element matches." };
      el.scrollIntoView({ block: "start" });
    } else if (${JSON.stringify(action.to ?? null)} === "bottom") window.scrollTo(0, document.documentElement.scrollHeight);
    else if (${JSON.stringify(action.to ?? null)} === "top") window.scrollTo(0, 0);
    else window.scrollTo(0, ${action.y ?? 0});
    return { ok: true, y: Math.round(window.scrollY) };
  })()`;
}

/** Whether an element has appeared yet. */
export function presentScript(selector: string | undefined, text: string | undefined): string {
  return `(() => {${PAGE_HELPERS}
    try { if (${JSON.stringify(selector ?? null)} && document.querySelector(${JSON.stringify(selector ?? "")})) return true; } catch { return false; }
    return ${JSON.stringify(text ?? null)} ? findByText(${JSON.stringify(text ?? "")}) !== null : false;
  })()`;
}

export interface PageSnapshot {
  readonly url: string;
  readonly title: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly scroll: { readonly width: number; readonly height: number; readonly y: number };
  readonly text: string;
  readonly headings: readonly string[];
  readonly links: readonly { readonly text: string; readonly href: string }[];
  readonly buttons: readonly { readonly text: string; readonly selector: string | null; readonly disabled: boolean }[];
  readonly fields: readonly { readonly kind: string; readonly label: string; readonly selector: string | null; readonly value: string }[];
  readonly brokenImages: readonly string[];
  readonly imagesWithoutAlt: number;
  readonly overflowing: readonly string[];
  readonly focused: string | null;
}

/** What the page shows, read from the page itself. */
export const SNAPSHOT_SCRIPT = `(() => {${PAGE_HELPERS}
  const body = document.body;
  const lines = (body ? body.innerText : "").split("\\n").map((line) => line.replace(/\\s+/g, " ").trim()).filter(Boolean);
  const text = lines.join("\\n").slice(0, 8000);
  const headings = [...document.querySelectorAll("h1, h2, h3")].filter(shows).slice(0, 30).map((h) => h.tagName.toLowerCase() + ": " + clean(h.innerText, 120));
  const links = [...document.querySelectorAll("a[href]")].filter(shows).slice(0, 40).map((a) => ({ text: textOf(a).slice(0, 80), href: a.getAttribute("href") || "" }));
  const buttons = [...document.querySelectorAll("button, [role=button], input[type=submit], input[type=button]")].filter(shows).slice(0, 30).map((b) => ({ text: textOf(b).slice(0, 80), selector: selectorOf(b), disabled: !!b.disabled || b.getAttribute("aria-disabled") === "true" }));
  const fields = [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select")].filter(shows).slice(0, 30).map((f) => ({
    kind: f.tagName === "INPUT" ? (f.getAttribute("type") || "text") : f.tagName.toLowerCase(),
    label: labelOf(f),
    selector: selectorOf(f),
    value: f.type === "password" ? (f.value ? "(filled)" : "") : f.type === "checkbox" || f.type === "radio" ? (f.checked ? "checked" : "unchecked") : clean(f.value, 60),
  }));
  const images = [...document.images];
  const brokenImages = images.filter((img) => img.complete && img.naturalWidth === 0 && (img.getAttribute("src") || "").length > 0).slice(0, 20).map((img) => img.getAttribute("src"));
  const imagesWithoutAlt = images.filter((img) => !img.hasAttribute("alt")).length;
  const doc = document.documentElement;
  const overflowing = doc.scrollWidth > innerWidth + 1
    ? [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1; }).filter((el, _i, all) => !all.some((other) => other !== el && other.contains(el))).slice(0, 6).map((el) => selectorOf(el))
    : [];
  const active = document.activeElement;
  return {
    url: location.href,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight },
    scroll: { width: doc.scrollWidth, height: doc.scrollHeight, y: Math.round(scrollY) },
    text, headings, links, buttons, fields, brokenImages, imagesWithoutAlt, overflowing,
    focused: active && active !== body && active !== doc ? selectorOf(active) : null,
  };
})()`;

export interface PageReport {
  readonly snapshot: PageSnapshot;
  /** HTTP status of the document itself, when it was loaded by this call. */
  readonly status: number | null;
  readonly actions: readonly string[];
  readonly console: readonly string[];
  readonly failedRequests: readonly string[];
  readonly screenshot: "attached" | "skipped" | "failed";
  readonly fullPage: boolean;
}

const list = (items: readonly string[], empty: string): string => (items.length === 0 ? empty : items.map((item) => `- ${item}`).join("\n"));

/**
 * The report the model reads.
 *
 * Problems lead - console errors, failed requests, broken images, sideways overflow - because
 * "does it work" is the question this tool exists to answer, and a model skims. The page's
 * own words follow, then what can be clicked and filled, with selectors ready for the next
 * call's actions.
 */
export function formatPageReport(report: PageReport): string {
  const { snapshot } = report;
  const problems: string[] = [];
  if (report.status !== null && report.status >= 400) problems.push(`The page itself answered HTTP ${report.status}.`);
  for (const line of report.console) if (/^(error|exception)\b/i.test(line)) problems.push(`Console ${line}`);
  for (const line of report.failedRequests) problems.push(`Request failed: ${line}`);
  for (const src of snapshot.brokenImages) problems.push(`Broken image: ${src}`);
  if (snapshot.overflowing.length > 0) {
    problems.push(`The page scrolls sideways at ${snapshot.viewport.width}px wide (content is ${snapshot.scroll.width}px); widest elements: ${snapshot.overflowing.join(", ")}`);
  }
  const otherConsole = report.console.filter((line) => !/^(error|exception)\b/i.test(line));

  const sections = [
    `${snapshot.title.length > 0 ? snapshot.title : "(untitled page)"} - ${snapshot.url}`,
    `Viewport ${snapshot.viewport.width}x${snapshot.viewport.height}, page ${snapshot.scroll.width}x${snapshot.scroll.height}, scrolled to y=${snapshot.scroll.y}.${report.status === null ? "" : ` HTTP ${report.status}.`}`,
  ];
  if (report.actions.length > 0) sections.push(`Actions:\n${report.actions.map((line, index) => `${index + 1}. ${line}`).join("\n")}`);
  sections.push(`Problems:\n${list(problems, "- None found: no console errors, failed requests, broken images or sideways scrolling.")}`);
  if (otherConsole.length > 0) sections.push(`Other console output:\n${list(otherConsole.slice(-15), "")}`);
  if (snapshot.headings.length > 0) sections.push(`Headings:\n${list(snapshot.headings, "")}`);
  sections.push(`Visible text:\n${snapshot.text.length > 0 ? snapshot.text : "(the page shows no text)"}`);
  if (snapshot.buttons.length > 0) {
    sections.push(`Buttons:\n${list(snapshot.buttons.map((button) => `${button.text || "(no label)"}${button.selector === null ? "" : ` [${button.selector}]`}${button.disabled ? " (disabled)" : ""}`), "")}`);
  }
  if (snapshot.fields.length > 0) {
    sections.push(`Form fields:\n${list(snapshot.fields.map((field) => `${field.kind} "${field.label || "unlabelled"}"${field.selector === null ? "" : ` [${field.selector}]`}${field.value.length > 0 ? ` = ${field.value}` : ""}`), "")}`);
  }
  if (snapshot.links.length > 0) sections.push(`Links:\n${list(snapshot.links.map((link) => `${link.text || "(no text)"} -> ${link.href}`), "")}`);
  if (snapshot.imagesWithoutAlt > 0) sections.push(`${snapshot.imagesWithoutAlt} image${snapshot.imagesWithoutAlt === 1 ? " has" : "s have"} no alt text.`);
  if (snapshot.focused !== null) sections.push(`Focused: ${snapshot.focused}`);
  sections.push(
    report.screenshot === "attached"
      ? `Screenshot attached (${report.fullPage ? "whole page" : "visible part"}).`
      : report.screenshot === "failed"
        ? "The screenshot could not be taken; the text above is what the page holds."
        : "No screenshot was asked for.",
  );
  return sections.join("\n\n");
}
