/**
 * The shared browser as data: what the assistant may ask of it, and how a page is described.
 *
 * The page description follows vercel-labs/agent-browser: the accessibility tree, flattened to
 * one line per thing a person could read or use, with a short ref (`e12`) on everything that
 * can be clicked or typed into. The model then says `click e12` instead of inventing a CSS
 * selector, which is what makes driving an unfamiliar site reliable. Refs are only good for
 * the snapshot they came from; every action answers with a fresh one.
 *
 * Plain data in, plain data out. No Electron, no DevTools session.
 */

export type LiveBrowserCommand =
  | { readonly kind: "open"; readonly url: string; readonly newTab: boolean }
  | { readonly kind: "snapshot"; readonly interactiveOnly: boolean }
  | { readonly kind: "click" | "hover"; readonly ref: string }
  | { readonly kind: "fill"; readonly ref: string; readonly text: string; readonly submit: boolean }
  | { readonly kind: "type"; readonly text: string }
  | { readonly kind: "press"; readonly key: string }
  | { readonly kind: "select"; readonly ref: string; readonly value: string }
  | { readonly kind: "scroll"; readonly direction: "up" | "down"; readonly amount: number }
  | { readonly kind: "text" }
  | { readonly kind: "screenshot" }
  | { readonly kind: "back" | "forward" | "reload" | "tabs" }
  | { readonly kind: "wait"; readonly ms: number }
  | { readonly kind: "switch_tab" | "close_tab"; readonly tab: number };

export const LIVE_BROWSER_COMMANDS = [
  "open", "snapshot", "click", "hover", "fill", "type", "press", "select", "scroll", "text", "screenshot",
  "back", "forward", "reload", "wait", "tabs", "new_tab", "switch_tab", "close_tab",
] as const;

const REF = /^@?(e\d{1,5})$/;

/**
 * What a person types in an address bar, as an address: a URL as it is, a bare host with
 * https (http for this machine), and anything else as a web search.
 */
export function addressFromInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > 4096) return null;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(trimmed);
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : local
      ? `http://${trimmed}`
      : /^[^\s/]+\.[^\s/]+(\/\S*)?$/.test(trimmed) || /^[^\s/]+\.[^\s]+$/.test(trimmed)
        ? `https://${trimmed}`
        : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Pages the shared browser may load: the web, never a file, an app scheme or a script. */
export function isLiveBrowserUrl(value: string): boolean {
  if (value === "about:blank") return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

export function parseLiveBrowserInput(input: Record<string, unknown>): LiveBrowserCommand | string {
  const command = text(input["command"]).trim();
  const ref = (): string | null => REF.exec(text(input["ref"]).trim())?.[1] ?? null;
  const needRef = `${command} needs ref: one from the latest snapshot, such as e3.`;
  switch (command) {
    case "open":
    case "new_tab": {
      const raw = text(input["url"]);
      if (command === "new_tab" && raw.trim() === "") return { kind: "open", url: "about:blank", newTab: true };
      const url = addressFromInput(raw);
      if (url === null) return "open needs url: a web address such as https://example.com, or words to search for.";
      return { kind: "open", url, newTab: command === "new_tab" || input["new_tab"] === true };
    }
    case "snapshot":
      return { kind: "snapshot", interactiveOnly: input["interactive"] === true };
    case "click":
    case "hover": {
      const found = ref();
      return found === null ? needRef : { kind: command, ref: found };
    }
    case "fill": {
      const found = ref();
      if (found === null) return needRef;
      if (typeof input["text"] !== "string") return "fill needs text: what to put in the field.";
      return { kind: "fill", ref: found, text: input["text"].slice(0, 20_000), submit: input["submit"] === true };
    }
    case "type":
      if (typeof input["text"] !== "string" || input["text"] === "") return "type needs text. It goes to whatever has focus; click or fill a field first.";
      return { kind: "type", text: input["text"].slice(0, 20_000) };
    case "press": {
      const key = text(input["key"]).trim();
      return key === "" || key.length > 32 ? "press needs key, such as Enter, Tab, Escape or ArrowDown." : { kind: "press", key };
    }
    case "select": {
      const found = ref();
      if (found === null) return needRef;
      if (typeof input["text"] !== "string") return "select needs text: the option's label or value.";
      return { kind: "select", ref: found, value: input["text"] };
    }
    case "scroll": {
      const amount = typeof input["amount"] === "number" && Number.isFinite(input["amount"]) ? Math.min(5000, Math.max(50, Math.round(input["amount"]))) : 600;
      return { kind: "scroll", direction: input["direction"] === "up" ? "up" : "down", amount };
    }
    case "wait": {
      const ms = typeof input["ms"] === "number" && Number.isFinite(input["ms"]) ? Math.min(10_000, Math.max(100, Math.round(input["ms"]))) : 1000;
      return { kind: "wait", ms };
    }
    case "text":
    case "screenshot":
    case "back":
    case "forward":
    case "reload":
    case "tabs":
      return { kind: command };
    case "switch_tab":
    case "close_tab": {
      const tab = input["tab"];
      return typeof tab === "number" && Number.isInteger(tab) && tab > 0 ? { kind: command, tab } : `${command} needs tab: a number from the tabs command.`;
    }
    default:
      return `Unknown browser command. Use one of: ${LIVE_BROWSER_COMMANDS.join(", ")}.`;
  }
}

/** One node of `Accessibility.getFullAXTree`, as the protocol sends it. */
export interface AxNode {
  readonly nodeId: string;
  readonly ignored?: boolean;
  readonly role?: { readonly value?: unknown };
  readonly name?: { readonly value?: unknown };
  readonly value?: { readonly value?: unknown };
  readonly properties?: readonly { readonly name: string; readonly value?: { readonly value?: unknown } }[];
  readonly childIds?: readonly string[];
  readonly parentId?: string;
  readonly backendDOMNodeId?: number;
}

/** Roles a person acts on: each gets a ref. */
const INTERACTIVE = new Set([
  "button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "slider", "spinbutton",
  "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "listbox", "treeitem", "textarea",
]);
/** Roles worth reading even though nothing happens when they are clicked. */
const READABLE = new Set(["heading", "img", "image", "alert", "status", "dialog", "alertdialog", "navigation", "main", "form", "table", "row", "cell", "columnheader", "listitem", "paragraph", "banner", "contentinfo"]);
/** Containers that only add depth to the outline. */
const LANDMARK = new Set(["dialog", "alertdialog", "navigation", "main", "form", "table", "banner", "contentinfo"]);

export interface RefSnapshot {
  readonly lines: readonly string[];
  /** ref -> the DOM node behind it. */
  readonly refs: ReadonlyMap<string, number>;
  /** True when the page had more than was listed. */
  readonly truncated: boolean;
}

const MAX_LINES = 320;
const MAX_NAME = 140;

function clean(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).replace(/\s+/g, " ").trim() : "";
}

/**
 * The accessibility tree as an outline with refs. Text that sits inside something named
 * (a link's own words) is not repeated beneath it.
 */
export function buildRefSnapshot(nodes: readonly AxNode[], interactiveOnly: boolean): RefSnapshot {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const children = new Set(nodes.flatMap((node) => node.childIds ?? []));
  const roots = nodes.filter((node) => !children.has(node.nodeId) && node.parentId === undefined);
  const lines: string[] = [];
  const refs = new Map<string, number>();
  let truncated = false;
  let serial = 0;

  const visit = (node: AxNode, depth: number, insideNamed: boolean): void => {
    if (lines.length >= MAX_LINES) {
      truncated = true;
      return;
    }
    const role = clean(node.role?.value);
    const name = clean(node.name?.value).slice(0, MAX_NAME);
    const interactive = INTERACTIVE.has(role);
    let nextDepth = depth;
    let named = insideNamed;
    if (node.ignored !== true) {
      const props = new Map((node.properties ?? []).map((prop) => [prop.name, prop.value?.value]));
      const isText = role === "StaticText" || role === "text";
      const listed = interactive
        || (!interactiveOnly && ((isText && !insideNamed && name.length > 0) || (READABLE.has(role) && (name.length > 0 || LANDMARK.has(role)))));
      if (listed && props.get("hidden") !== true) {
        const parts = [`${"  ".repeat(Math.min(depth, 8))}- ${isText ? "text" : role}`];
        if (name.length > 0) parts.push(JSON.stringify(name));
        if (interactive && node.backendDOMNodeId !== undefined) {
          const ref = `e${(++serial).toString()}`;
          refs.set(ref, node.backendDOMNodeId);
          parts.push(`[ref=${ref}]`);
        }
        const value = clean(node.value?.value).slice(0, 80);
        if (value.length > 0 && value !== name) parts.push(`value=${JSON.stringify(value)}`);
        if (role === "heading" && props.get("level") !== undefined) parts.push(`[level=${String(props.get("level"))}]`);
        for (const flag of ["checked", "selected", "expanded", "disabled", "required", "focused"] as const) {
          const state = props.get(flag);
          if (state === true || state === "true" || state === "mixed") parts.push(`[${flag}${state === "mixed" ? "=mixed" : ""}]`);
        }
        lines.push(parts.join(" "));
        if (LANDMARK.has(role) || role === "listitem" || role === "row") nextDepth = depth + 1;
        // A named control already says its own words; its text children would repeat them.
        if (name.length > 0 && !LANDMARK.has(role) && role !== "listitem" && role !== "row" && role !== "cell" && role !== "paragraph") named = true;
      }
    }
    for (const id of node.childIds ?? []) {
      const child = byId.get(id);
      if (child !== undefined) visit(child, nextDepth, named);
    }
  };
  for (const root of roots) visit(root, 0, false);
  return { lines, refs, truncated };
}

export function formatRefSnapshot(page: { readonly url: string; readonly title: string }, snapshot: RefSnapshot): string {
  const head = `Page: ${page.title || "(untitled)"}\nURL: ${page.url}`;
  if (snapshot.lines.length === 0) return `${head}\n(The page has nothing to list yet. It may still be loading - wait, then snapshot again.)`;
  return `${head}\n${snapshot.lines.join("\n")}${snapshot.truncated ? "\n(More below. Scroll, then snapshot again, or pass interactive: true for controls only.)" : ""}`;
}

/** A DevTools key event for a key name, or null for one this browser does not send. */
export function liveKey(name: string): { key: string; code: string; keyCode: number; text?: string } | null {
  const named: Record<string, [string, number, string?]> = {
    Enter: ["Enter", 13, "\r"], Tab: ["Tab", 9], Escape: ["Escape", 27], Backspace: ["Backspace", 8], Delete: ["Delete", 46],
    ArrowUp: ["ArrowUp", 38], ArrowDown: ["ArrowDown", 40], ArrowLeft: ["ArrowLeft", 37], ArrowRight: ["ArrowRight", 39],
    Home: ["Home", 36], End: ["End", 35], PageUp: ["PageUp", 33], PageDown: ["PageDown", 34], Space: ["Space", 32, " "],
  };
  const alias: Record<string, string> = { esc: "Escape", return: "Enter", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", " ": "Space", del: "Delete" };
  const wanted = Object.keys(named).find((key) => key.toLowerCase() === (alias[name.toLowerCase()] ?? name).toLowerCase());
  if (wanted === undefined) return null;
  const [code, keyCode, typed] = named[wanted]!;
  return { key: wanted === "Space" ? " " : wanted, code, keyCode, ...(typed === undefined ? {} : { text: typed }) };
}
