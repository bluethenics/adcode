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
import type { AnnotateProbe, AnnotateRect, AnnotateTarget } from "../shared/api.ts";

/**
 * Where the pointer goes: an element from the latest snapshot, or a spot on the latest
 * screenshot. Coordinates are what lets the assistant use pages whose controls are not in the
 * accessibility tree at all - canvases, maps, custom widgets - the way a person would: look,
 * point, click.
 */
export type PointerTarget = { readonly ref: string } | { readonly x: number; readonly y: number };

export type MouseButton = "left" | "right" | "middle";

/** One step the assistant can take. A `batch` runs several in a row in one call. */
export type LiveBrowserStep =
  | { readonly kind: "open"; readonly url: string; readonly newTab: boolean }
  | { readonly kind: "snapshot"; readonly interactiveOnly: boolean }
  | { readonly kind: "click"; readonly at: PointerTarget; readonly button: MouseButton; readonly count: number }
  | { readonly kind: "hover"; readonly at: PointerTarget }
  /** Press and keep holding until mouse_up, so a drag or a long press can be built from parts. */
  | { readonly kind: "mouse_down"; readonly at: PointerTarget | null; readonly button: MouseButton }
  | { readonly kind: "mouse_up"; readonly at: PointerTarget | null; readonly button: MouseButton }
  /** Press, keep holding for `ms`, let go: "hold to confirm" buttons, long-press menus. */
  | { readonly kind: "hold"; readonly at: PointerTarget; readonly ms: number }
  | { readonly kind: "drag"; readonly from: PointerTarget; readonly to: PointerTarget }
  | { readonly kind: "fill"; readonly ref: string; readonly text: string; readonly submit: boolean; readonly delay: number }
  /** `delay` > 0 types a key at a time, the way a person does; 0 puts the text in at once. */
  | { readonly kind: "type"; readonly text: string; readonly delay: number }
  | { readonly kind: "press"; readonly key: string }
  | { readonly kind: "key_down" | "key_up"; readonly key: string }
  | { readonly kind: "select"; readonly ref: string; readonly value: string }
  | { readonly kind: "scroll"; readonly direction: "up" | "down" | "left" | "right"; readonly amount: number; readonly at: PointerTarget | null }
  | { readonly kind: "text" }
  | { readonly kind: "screenshot" }
  | { readonly kind: "back" | "forward" | "reload" | "tabs" }
  | { readonly kind: "wait"; readonly ms: number }
  | { readonly kind: "switch_tab" | "close_tab"; readonly tab: number };

export type LiveBrowserCommand = LiveBrowserStep | { readonly kind: "batch"; readonly steps: readonly LiveBrowserStep[] };

export const LIVE_BROWSER_COMMANDS = [
  "open", "snapshot", "click", "double_click", "right_click", "hover", "mouse_down", "mouse_up", "hold", "drag",
  "fill", "type", "press", "key_down", "key_up", "select", "scroll", "text", "screenshot",
  "back", "forward", "reload", "wait", "tabs", "new_tab", "switch_tab", "close_tab", "batch",
] as const;

/** Steps one batch may take. Enough to write and send an email; not enough to run away. */
export const MAX_BATCH_STEPS = 25;

const REF = /^@?(e\d{1,5})$/;

const coordinate = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 20_000 ? Math.round(value) : null;

/** A ref, or x and y, under the given names. Null when neither is there; a sentence when half is. */
function pointerFrom(input: Record<string, unknown>, refKey: string, xKey: string, yKey: string): PointerTarget | null | string {
  const rawRef = text(input[refKey]).trim();
  if (rawRef !== "") {
    const found = REF.exec(rawRef)?.[1];
    return found === undefined ? `${refKey} must be a ref from the latest snapshot, such as e3.` : { ref: found };
  }
  if (input[xKey] === undefined && input[yKey] === undefined) return null;
  const x = coordinate(input[xKey]);
  const y = coordinate(input[yKey]);
  return x === null || y === null ? `${xKey} and ${yKey} must both be pixel positions on the latest screenshot.` : { x, y };
}

const buttonOf = (value: unknown): MouseButton => (value === "right" || value === "middle" ? value : "left");

/** 0 pastes at once; a positive value types key by key, the way a person does. */
const typingDelay = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(300, Math.max(0, Math.round(value))) : 0;

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
  if (text(input["command"]).trim() !== "batch") return parseLiveBrowserStep(input);
  const raw = input["actions"];
  if (!Array.isArray(raw) || raw.length === 0) return "batch needs actions: a list of steps such as {\"command\": \"click\", \"ref\": \"e4\"}.";
  if (raw.length > MAX_BATCH_STEPS) return `batch takes at most ${MAX_BATCH_STEPS.toString()} actions. Split the work into several batches.`;
  const steps: LiveBrowserStep[] = [];
  for (const [index, item] of raw.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return `Action ${(index + 1).toString()} must be an object with a command.`;
    const record = item as Record<string, unknown>;
    if (text(record["command"]).trim() === "batch") return `Action ${(index + 1).toString()}: a batch cannot hold another batch.`;
    const step = parseLiveBrowserStep(record);
    if (typeof step === "string") return `Action ${(index + 1).toString()}: ${step}`;
    steps.push(step);
  }
  return { kind: "batch", steps };
}

function parseLiveBrowserStep(input: Record<string, unknown>): LiveBrowserStep | string {
  const command = text(input["command"]).trim();
  const ref = (): string | null => REF.exec(text(input["ref"]).trim())?.[1] ?? null;
  const needRef = `${command} needs ref: one from the latest snapshot, such as e3.`;
  const needPoint = `${command} needs ref (from the latest snapshot) or x and y (pixels on the latest screenshot).`;
  const point = (): PointerTarget | null | string => pointerFrom(input, "ref", "x", "y");
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
    case "double_click":
    case "right_click":
    case "hover": {
      const at = point();
      if (typeof at === "string") return at;
      if (at === null) return needPoint;
      if (command === "hover") return { kind: "hover", at };
      const count = command === "double_click" ? 2 : typeof input["count"] === "number" && [1, 2, 3].includes(input["count"]) ? input["count"] : 1;
      return { kind: "click", at, button: command === "right_click" ? "right" : buttonOf(input["button"]), count };
    }
    case "mouse_down": {
      const at = point();
      if (typeof at === "string") return at;
      return { kind: "mouse_down", at, button: buttonOf(input["button"]) };
    }
    case "mouse_up": {
      const at = point();
      if (typeof at === "string") return at;
      return { kind: "mouse_up", at, button: buttonOf(input["button"]) };
    }
    case "hold": {
      const at = point();
      if (typeof at === "string") return at;
      if (at === null) return needPoint;
      const ms = typeof input["ms"] === "number" && Number.isFinite(input["ms"]) ? Math.min(10_000, Math.max(100, Math.round(input["ms"]))) : 1000;
      return { kind: "hold", at, ms };
    }
    case "drag": {
      const from = point();
      if (typeof from === "string") return from;
      const to = pointerFrom(input, "to_ref", "to_x", "to_y");
      if (typeof to === "string") return to;
      if (from === null || to === null) return "drag needs where to start (ref, or x and y) and where to let go (to_ref, or to_x and to_y).";
      return { kind: "drag", from, to };
    }
    case "key_down":
    case "key_up": {
      const key = text(input["key"]).trim();
      if (key === "" || key.length > 40) return `${command} needs key, such as Shift or Control.`;
      return keyCombo(key) === null ? `${key} is not a key this browser sends.` : { kind: command, key };
    }
    case "fill": {
      const found = ref();
      if (found === null) return needRef;
      if (typeof input["text"] !== "string") return "fill needs text: what to put in the field.";
      return { kind: "fill", ref: found, text: input["text"].slice(0, 20_000), submit: input["submit"] === true, delay: typingDelay(input["delay"]) };
    }
    case "type": {
      if (typeof input["text"] !== "string" || input["text"] === "") return "type needs text. It goes to whatever has focus in the page; click or fill a field first.";
      return { kind: "type", text: input["text"].slice(0, 20_000), delay: typingDelay(input["delay"]) };
    }
    case "press": {
      const key = text(input["key"]).trim();
      if (key === "" || key.length > 40) return "press needs key, such as Enter, Tab, Escape, ArrowDown or Control+Enter.";
      return keyCombo(key) === null ? `${key} is not a key this browser sends. Use a key name such as Enter or Tab, a letter, or a combination such as Control+A.` : { kind: "press", key };
    }
    case "select": {
      const found = ref();
      if (found === null) return needRef;
      if (typeof input["text"] !== "string") return "select needs text: the option's label or value.";
      return { kind: "select", ref: found, value: input["text"] };
    }
    case "scroll": {
      const amount = typeof input["amount"] === "number" && Number.isFinite(input["amount"]) ? Math.min(5000, Math.max(50, Math.round(input["amount"]))) : 600;
      const direction = input["direction"] === "up" || input["direction"] === "left" || input["direction"] === "right" ? input["direction"] : "down";
      const at = point();
      if (typeof at === "string") return at;
      return { kind: "scroll", direction, amount, at };
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

export interface KeyStroke {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  /** What the key types, when it types anything and no Control/Alt/Meta is held. */
  readonly text?: string;
  /** DevTools modifier bits: Alt 1, Control 2, Meta 4, Shift 8. */
  readonly modifiers: number;
  /** The modifier keys to hold down around it, in press order. */
  readonly held: readonly { readonly key: string; readonly code: string; readonly keyCode: number; readonly bit: number }[];
}

const MODIFIERS: Readonly<Record<string, { key: string; code: string; keyCode: number; bit: number }>> = {
  alt: { key: "Alt", code: "AltLeft", keyCode: 18, bit: 1 },
  option: { key: "Alt", code: "AltLeft", keyCode: 18, bit: 1 },
  control: { key: "Control", code: "ControlLeft", keyCode: 17, bit: 2 },
  ctrl: { key: "Control", code: "ControlLeft", keyCode: 17, bit: 2 },
  meta: { key: "Meta", code: "MetaLeft", keyCode: 91, bit: 4 },
  cmd: { key: "Meta", code: "MetaLeft", keyCode: 91, bit: 4 },
  command: { key: "Meta", code: "MetaLeft", keyCode: 91, bit: 4 },
  win: { key: "Meta", code: "MetaLeft", keyCode: 91, bit: 4 },
  shift: { key: "Shift", code: "ShiftLeft", keyCode: 16, bit: 8 },
};

/** A single printable character as the key that types it. */
function characterKey(char: string): { key: string; code: string; keyCode: number; text: string } | null {
  if ([...char].length !== 1) return null;
  if (/^[a-z]$/i.test(char)) return { key: char, code: `Key${char.toUpperCase()}`, keyCode: char.toUpperCase().charCodeAt(0), text: char };
  if (/^[0-9]$/.test(char)) return { key: char, code: `Digit${char}`, keyCode: char.charCodeAt(0), text: char };
  const punctuation: Record<string, [string, number]> = {
    ".": ["Period", 190], ",": ["Comma", 188], "/": ["Slash", 191], ";": ["Semicolon", 186], "'": ["Quote", 222],
    "[": ["BracketLeft", 219], "]": ["BracketRight", 221], "\\": ["Backslash", 220], "-": ["Minus", 189], "=": ["Equal", 187], "`": ["Backquote", 192],
  };
  const known = punctuation[char];
  if (known !== undefined) return { key: char, code: known[0], keyCode: known[1], text: char };
  // Anything else (é, @, emoji) still types; it just has no physical key to name.
  return { key: char, code: "", keyCode: 0, text: char };
}

/**
 * A key or a combination as a person names it: `Enter`, `a`, `Control+A`, `Ctrl+Enter`,
 * `Shift+Tab`, `Meta+Enter`. Null for anything this browser cannot send, so the assistant is
 * told rather than having a keystroke silently dropped.
 */
export function keyCombo(name: string): KeyStroke | null {
  const trimmed = name.trim();
  if (trimmed === "") return null;
  // "+" alone, or a combination ending in "+", means the plus key itself.
  const parts = trimmed === "+" ? ["+"] : trimmed.endsWith("++") ? [...trimmed.slice(0, -2).split("+"), "+"] : trimmed.split("+");
  const last = parts.pop()!.trim();
  const held: KeyStroke["held"][number][] = [];
  for (const part of parts) {
    const modifier = MODIFIERS[part.trim().toLowerCase()];
    if (modifier === undefined || held.some((item) => item.bit === modifier.bit)) return null;
    held.push(modifier);
  }
  const lone = MODIFIERS[last.toLowerCase()];
  if (lone !== undefined && held.length === 0) return { key: lone.key, code: lone.code, keyCode: lone.keyCode, modifiers: lone.bit, held: [] };
  // "Page Down" and "Arrow Down" are how people write the key names they see.
  const base = liveKey(last) ?? liveKey(last.replace(/\s+/g, "")) ?? characterKey(last);
  if (base === null) return null;
  const modifiers = held.reduce((bits, item) => bits | item.bit, 0);
  // Control, Alt or Meta turn a key into a shortcut: it no longer types its character.
  const typesText = base.text !== undefined && (modifiers & 7) === 0;
  const shifted = (modifiers & 8) !== 0 && base.text !== undefined && /^[a-z]$/.test(base.text) ? base.text.toUpperCase() : base.text;
  return {
    key: typesText && shifted !== undefined && shifted.length === 1 ? shifted : base.key,
    code: base.code,
    keyCode: base.keyCode,
    modifiers,
    held,
    ...(typesText && shifted !== undefined ? { text: shifted } : {}),
  };
}

/**
 * The points a hand moves the pointer through between two spots: a slight arc, quick in the
 * middle and slow at both ends, rather than a jump. Pages that open menus on hover, or watch
 * for a human-looking pointer, see a real path; the person watching sees where it is going.
 * The last point is always exactly `to`.
 */
export function pointerPath(from: { x: number; y: number }, to: { x: number; y: number }, seed = 1): { x: number; y: number }[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 2) return [{ x: to.x, y: to.y }];
  const steps = Math.max(4, Math.min(24, Math.round(distance / 30)));
  // Bow sideways by up to 8% of the distance, one way or the other.
  const bow = (((seed * 9301 + 49297) % 233280) / 233280 - 0.5) * 0.16 * distance;
  const nx = -dy / distance;
  const ny = dx / distance;
  const points: { x: number; y: number }[] = [];
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const arc = Math.sin(Math.PI * t) * bow;
    points.push(step === steps ? { x: to.x, y: to.y } : { x: Math.round(from.x + dx * eased + nx * arc), y: Math.round(from.y + dy * eased + ny * arc) });
  }
  return points;
}

/**
 * Run in the workbench window: give the keyboard to one Browser tab's `<webview>`.
 *
 * The bug this exists for: DevTools' `Input.insertText` on a webview guest does not go to the
 * guest. Chromium sends it to whichever web contents has focus in the window - and when the
 * person has just typed their request, that is ADCode's own chat box. So the assistant's
 * email went into the chat instead of the page. Focusing the `<webview>` element first makes
 * the guest the focused contents, which is exactly what a person's click on the page does.
 *
 * It remembers what had focus so `RETURN_FOCUS_SCRIPT` can hand the keyboard back afterwards,
 * and answers "focused" only when the webview really has it - anything else and the caller
 * types inside the page instead, where text cannot reach the chat.
 */
export function focusWebviewScript(contentsId: number): string {
  return `(() => {
    const view = [...document.querySelectorAll("webview")].find((item) => { try { return item.getWebContentsId() === ${String(contentsId)}; } catch { return false; } });
    if (!view) return "missing";
    const before = document.activeElement;
    // Never remember another Browser tab as "where the person was": after switching tabs,
    // the keyboard should still go back to the chat, not to a hidden webview.
    if (before !== view && before && before !== document.body && before.tagName !== "WEBVIEW") window.__adcodeBrowserReturnFocus = new WeakRef(before);
    if (before !== view) view.focus({ preventScroll: true });
    return document.activeElement === view ? "focused" : "unfocused";
  })()`;
}

/**
 * Whether one Browser tab's `<webview>` still owns the window's keyboard. Typing checks
 * this as it goes: if the person closes the panel or clicks the address bar mid-email, the
 * rest of the text must stop rather than follow their focus to another field.
 */
export function webviewFocusedScript(contentsId: number): string {
  return `(() => {
    const view = [...document.querySelectorAll("webview")].find((item) => { try { return item.getWebContentsId() === ${String(contentsId)}; } catch { return false; } });
    return view !== undefined && document.activeElement === view;
  })()`;
}

/** Hand the keyboard back to where the person left it (their chat box, say), but only if the
 * Browser still has it: if they have moved focus elsewhere - the address bar, the editor, the
 * chat again - that choice stands.
 */
export const RETURN_FOCUS_SCRIPT = `(() => {
  const saved = window.__adcodeBrowserReturnFocus && window.__adcodeBrowserReturnFocus.deref();
  window.__adcodeBrowserReturnFocus = undefined;
  if (!saved || !saved.isConnected || !document.activeElement || document.activeElement.tagName !== "WEBVIEW") return false;
  saved.focus({ preventScroll: true });
  return true;
})()`;

/**
 * Type into the focused element from inside the page. The fallback when the webview cannot
 * take focus (the panel is hidden): `execCommand("insertText")` edits the page's own
 * selection and fires the input events frameworks listen for, and it cannot reach any other
 * window, so text is never misdelivered.
 */
export function insertTextInPageScript(value: string): string {
  return `(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "nothing focused";
    if (document.execCommand("insertText", false, ${JSON.stringify(value)})) return "ok";
    if ("value" in el) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
      const start = typeof el.selectionStart === "number" ? el.selectionStart : el.value.length;
      const end = typeof el.selectionEnd === "number" ? el.selectionEnd : el.value.length;
      const next = el.value.slice(0, start) + ${JSON.stringify(value)} + el.value.slice(end);
      if (setter) setter.call(el, next); else el.value = next;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(value)} }));
      return "ok";
    }
    return "not editable";
  })()`;
}

/** What the focused element in the page holds, to check that typing landed there. */
export const FOCUSED_TEXT_SCRIPT = `(() => {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (!el || (el === document.body && el.isContentEditable !== true)) return null;
  return String("value" in el && typeof el.value === "string" ? el.value : el.innerText || "").slice(-4000);
})()`;

/**
 * Whether the page's focused element can actually take typed text. A tool that says "typed"
 * after putting the text into a focused button has lied to the assistant; this is the check
 * that turns that into a useful sentence instead.
 */
export const FOCUS_IS_EDITABLE_SCRIPT = `(() => {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (!el || (el === document.body && el.isContentEditable !== true)) return false;
  if (el.tagName === "IFRAME") return true;
  if (el.isContentEditable === true) return true;
  if (el.tagName === "TEXTAREA") return true;
  // A custom editor may be a focusable div that handles keys itself (a canvas, a code
  // editor); its ARIA role is the page saying it takes text.
  const role = String((el.getAttribute && el.getAttribute("role")) || "").toLowerCase();
  if (role === "textbox" || role === "searchbox" || role === "combobox") return true;
  if (el.tagName === "INPUT") {
    const kind = String(el.type || "text").toLowerCase();
    return ["text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "month", "time", "week"].includes(kind);
  }
  return false;
})()`;

/** Where the caret is, so `type` without a preceding click can show the cursor on the field. */
export const FOCUSED_RECT_SCRIPT = `(() => {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === document.body) return null;
  const rect = el.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
})()`;

/**
 * What kind of input has focus. The assistant is told never to type passwords or card
 * numbers; this makes that a rule the page enforces, not a sentence the model may skip.
 */
export const FOCUSED_FIELD_KIND_SCRIPT = `(() => {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el.tagName !== "INPUT") return { type: "", autocomplete: "" };
  return { type: String(el.type || "text").toLowerCase(), autocomplete: String(el.autocomplete || "").toLowerCase() };
})()`;

/** A field the assistant must never type into: a password, a card number or a card code. */
export function isSecretField(field: { readonly type?: unknown; readonly autocomplete?: unknown }): boolean {
  const type = typeof field.type === "string" ? field.type.toLowerCase() : "";
  const autocomplete = typeof field.autocomplete === "string" ? field.autocomplete.toLowerCase() : "";
  return type === "password" || autocomplete.includes("cc-") || autocomplete.includes("password");
}

/** Whether `typed` shows up in what the field holds, ignoring how whitespace was laid out. */
export function textLanded(fieldText: string | null, typed: string): boolean {
  if (fieldText === null) return false;
  const squash = (value: string): string => value.replace(/\s+/g, "");
  const wanted = squash(typed).slice(-40);
  return wanted === "" || squash(fieldText).includes(wanted);
}

/** The page's own size, in CSS pixels - the units pointer coordinates and screenshots use. */
export const VIEWPORT_SCRIPT = `(() => ({
  width: Math.max(1, Math.round(window.innerWidth)),
  height: Math.max(1, Math.round(window.innerHeight)),
  devicePixelRatio: window.devicePixelRatio || 1,
  scrollX: Math.round(window.scrollX),
  scrollY: Math.round(window.scrollY),
}))()`;

/**
 * A cursor in the page, so the person can watch the assistant work.
 *
 * It lives in a closed shadow root: page CSS cannot move or restyle it, it takes no clicks
 * (`pointer-events: none`), and it is drawn at the exact point the synthetic mouse is at, so
 * what the person sees and what the page receives are the same place. The arrow is ADCode's
 * blue with a white edge; a ring pulses where a press lands, and a small ADCode tag rides
 * beside it. It is removed with the page on navigation and made again on the next action.
 *
 * The overlay is a courtesy, not the input: the real clicks and keys go through DevTools in
 * `liveBrowser.ts`. If a page removes it, nothing about the action changes.
 */
export const CURSOR_ENSURE_SCRIPT = `(() => {
  if (window.__adcodeCursor) return true;
  const host = document.createElement("div");
  host.id = "__adcode_cursor";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "all:initial;position:fixed;left:0;top:0;width:0;height:0;overflow:visible;z-index:2147483647;pointer-events:none;contain:layout style;";
  const root = host.attachShadow({ mode: "closed" });
  // Built node by node rather than with innerHTML: pages that enforce Trusted Types (Gmail,
  // Google Docs and others) refuse an HTML string, and the cursor must still appear there.
  const style = document.createElement("style");
  style.textContent = \`
      .arrow, .ring, .tag { position: fixed; left: 0; top: 0; pointer-events: none; }
      .arrow { width: 24px; height: 24px; will-change: transform; filter: drop-shadow(0 2px 5px rgba(0,0,0,.38)); transform: translate3d(-100px,-100px,0); }
      .arrow svg { display: block; width: 24px; height: 24px; transform-origin: 4px 3px; transition: transform .09s ease; }
      .arrow.pressed svg { transform: scale(.88); }
      .ring { width: 10px; height: 10px; margin: -5px 0 0 -5px; border: 2px solid rgba(59,130,246,.9); border-radius: 50%; opacity: 0; }
      .ring.on { animation: adcode-ping .5s cubic-bezier(.2,.7,.3,1); }
      .tag { transform: translate(17px, 15px); padding: 2px 7px 3px; border-radius: 999px; background: rgba(15,23,42,.92); color: #f8fafc;
             font: 600 10px/1.35 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; letter-spacing: .02em; white-space: nowrap;
             box-shadow: 0 1px 4px rgba(0,0,0,.35); opacity: .94; }
      @keyframes adcode-ping {
        0% { opacity: .85; width: 10px; height: 10px; margin: -5px 0 0 -5px; }
        100% { opacity: 0; width: 46px; height: 46px; margin: -23px 0 0 -23px; }
      }\`;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ring = document.createElement("div");
  ring.className = "ring";
  ring.style.cssText = "position:fixed;left:0;top:0;width:10px;height:10px;margin:-5px 0 0 -5px;border:2px solid rgba(59,130,246,.9);border-radius:50%;opacity:0;pointer-events:none;";
  const arrow = document.createElement("div");
  arrow.className = "arrow";
  arrow.style.cssText = "position:fixed;left:0;top:0;width:24px;height:24px;pointer-events:none;filter:drop-shadow(0 2px 5px rgba(0,0,0,.38));transform:translate3d(-100px,-100px,0);";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M4.2 2.6 20 12.1l-7.1 1.5-3.6 7L4.2 2.6Z");
  path.setAttribute("fill", "#2563eb");
  path.setAttribute("stroke", "#fff");
  path.setAttribute("stroke-width", "1.7");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  arrow.appendChild(svg);
  const tag = document.createElement("div");
  tag.className = "tag";
  tag.textContent = "ADCode";
  tag.style.cssText = "position:fixed;left:0;top:0;transform:translate(17px,15px);padding:2px 7px 3px;border-radius:999px;background:rgba(15,23,42,.92);color:#f8fafc;font:600 10px/1.35 ui-sans-serif,system-ui,sans-serif;white-space:nowrap;pointer-events:none;";
  root.append(style, ring, arrow, tag);
  (document.body || document.documentElement).appendChild(host);
  let frame = 0;
  const place = (x, y) => {
    arrow.style.transform = "translate3d(" + (x - 3) + "px," + (y - 2) + "px,0)";
    ring.style.left = x + "px";
    ring.style.top = y + "px";
    tag.style.left = x + "px";
    tag.style.top = y + "px";
  };
  window.__adcodeCursor = {
    move(points, ms) {
      if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
      cancelAnimationFrame(frame);
      const list = Array.isArray(points) && points.length > 0 ? points : [{ x: 0, y: 0 }];
      const last = list[list.length - 1];
      // With reduced motion the pointer is still shown, it just arrives at once.
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        place(last.x, last.y);
        return;
      }
      const started = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - started) / Math.max(1, ms));
        const point = list[Math.min(list.length - 1, Math.floor(t * list.length))];
        place(point.x, point.y);
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    },
    press() {
      arrow.classList.add("pressed");
      ring.classList.remove("on");
      void ring.offsetWidth;
      ring.classList.add("on");
    },
    release() { arrow.classList.remove("pressed"); },
    label(text) { tag.textContent = String(text || "ADCode").slice(0, 40); },
    hide() { cancelAnimationFrame(frame); host.remove(); window.__adcodeCursor = undefined; },
  };
  return true;
})()`;

/** Move the in-page cursor along `points` over `ms`, so it arrives with the real pointer. */
export function cursorMoveScript(points: readonly { readonly x: number; readonly y: number }[], ms: number): string {
  return `window.__adcodeCursor && window.__adcodeCursor.move(${JSON.stringify(points)}, ${Math.max(1, Math.round(ms))}); true`;
}

/** Show a press on the in-page cursor: the arrow dips and a ring expands. */
export function cursorPressScript(pressed: boolean): string {
  return `window.__adcodeCursor && window.__adcodeCursor.${pressed ? "press" : "release"}(); true`;
}

/** Change the small tag beside the in-page cursor, e.g. when typing. */
export function cursorLabelScript(label: string): string {
  return `window.__adcodeCursor && window.__adcodeCursor.label(${JSON.stringify(label)}); true`;
}

/* ── Annotate: the page side of pins dropped in the Browser or Preview panel ─────────────── */

const MAX_COORD = 100_000;
const MAX_SELECTORS = 60;
const MAX_SELECTOR_CHARS = 600;

function finite(value: unknown, limit = MAX_COORD): number | null {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The capture box of a Preview frame: whole, positive, and of a size a window can have. */
export function parseAnnotateRect(value: unknown): AnnotateRect | null {
  const input = record(value);
  if (input === null) return null;
  const x = finite(input["x"]);
  const y = finite(input["y"]);
  const width = finite(input["width"]);
  const height = finite(input["height"]);
  if (x === null || y === null || width === null || height === null || width < 1 || height < 1) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** Which page an annotate call is about. Anything else is refused. */
export function parseAnnotateTarget(value: unknown): AnnotateTarget | string {
  const input = record(value);
  if (input === null) return "Annotate needs a page.";
  if (input["surface"] === "browser") {
    const tab = input["tab"];
    return typeof tab === "number" && Number.isInteger(tab) && tab > 0 ? { surface: "browser", tab } : "Annotate needs a Browser tab.";
  }
  if (input["surface"] === "preview") {
    if (input["rect"] === undefined) return { surface: "preview" };
    const rect = parseAnnotateRect(input["rect"]);
    return rect === null ? "The preview's box is not a box." : { surface: "preview", rect };
  }
  return "Annotate works on the Browser and the Preview.";
}

/** One annotate question, checked field by field before it is written into a script. */
export function parseAnnotateProbe(value: unknown): AnnotateProbe | string {
  const input = record(value);
  if (input === null) return "Annotate needs a question for the page.";
  const x = finite(input["x"]);
  const y = finite(input["y"]);
  switch (input["kind"]) {
    case "point":
      return x === null || y === null ? "A pin needs a place." : { kind: "point", x, y };
    case "area": {
      const width = finite(input["width"]);
      const height = finite(input["height"]);
      if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return "A box needs a place and a size.";
      return { kind: "area", x, y, width, height };
    }
    case "locate": {
      const selectors = input["selectors"];
      if (!Array.isArray(selectors) || selectors.length > MAX_SELECTORS) return "Too many pins to find.";
      if (!selectors.every((item): item is string => typeof item === "string" && item.length <= MAX_SELECTOR_CHARS)) return "A pin's element is not a selector.";
      return { kind: "locate", selectors };
    }
    case "scroll": {
      const dx = finite(input["dx"], 20_000);
      const dy = finite(input["dy"], 20_000);
      if (x === null || y === null || dx === null || dy === null) return "Scrolling needs a place and a distance.";
      return { kind: "scroll", x, y, dx, dy };
    }
    default:
      return "Unknown annotate question.";
  }
}

/**
 * The page-side half, as a real function so the compiler checks it; it is sent to the page
 * as its source text with the question as its argument.
 *
 * One call, run and gone: no globals, no listeners, nothing left in the page, so the page
 * gains nothing it did not have. It may only use what it is given and the page's own DOM,
 * because it runs over there, not here. Everything it returns is the page's own words and
 * is treated as data by whoever reads it.
 */
function annotatePageProbe(probe: AnnotateProbe, maxSelector: number): unknown {
  const clean = (value: unknown, max: number): string =>
    String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const esc = (value: string): string => (typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"));
  const box = (rect: DOMRect) => ({
    x: Math.round(rect.left * 10) / 10,
    y: Math.round(rect.top * 10) / 10,
    width: Math.round(rect.width * 10) / 10,
    height: Math.round(rect.height * 10) / 10,
  });
  const classesOf = (el: Element): string[] =>
    typeof el.className === "string" ? el.className.split(/\s+/).filter((name) => name !== "" && name.length < 40) : [];
  const unique = (selector: string, el: Element): boolean => {
    try {
      const found = document.querySelectorAll(selector);
      return found.length === 1 && found[0] === el;
    } catch {
      return false;
    }
  };
  const selectorOf = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    for (let depth = 0; node !== null && depth < 24; depth++) {
      if (node === document.documentElement) { parts.unshift("html"); break; }
      if (node.id !== "" && unique(`#${esc(node.id)}`, node)) { parts.unshift(`#${esc(node.id)}`); break; }
      let part = node.tagName.toLowerCase();
      const classes = classesOf(node).slice(0, 2);
      if (classes.length > 0) part += `.${classes.map(esc).join(".")}`;
      const parent: Element | null = node.parentElement;
      if (parent !== null) {
        const tag = node.tagName;
        const same = Array.from(parent.children).filter((child) => child.tagName === tag);
        if (same.length > 1) part += `:nth-of-type(${String(same.indexOf(node) + 1)})`;
      }
      parts.unshift(part);
      if (unique(parts.join(" > "), el)) break;
      node = parent;
    }
    return parts.join(" > ");
  };
  const words = (el: Element): string => (el instanceof HTMLElement ? el.innerText : el.textContent ?? "");
  const describe = (el: Element) => {
    const link = el.closest("a[href]");
    return {
      tag: clean(el.tagName.toLowerCase(), 30),
      id: el.id !== "" ? clean(el.id, 80) : null,
      classes: classesOf(el).slice(0, 4).map((name) => clean(name, 40)),
      text: clean(words(el), 140),
      label: clean(el.getAttribute("aria-label") ?? el.getAttribute("alt") ?? el.getAttribute("title") ?? el.getAttribute("placeholder") ?? "", 100),
      role: el.getAttribute("role") !== null ? clean(el.getAttribute("role"), 30) : null,
      href: link !== null ? clean(link.getAttribute("href"), 200) : null,
      selector: clean(selectorOf(el), maxSelector),
      rect: box(el.getBoundingClientRect()),
    };
  };
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const at = (x: number, y: number): Element | null =>
    document.elementFromPoint(Math.max(0, Math.min(viewport.width - 1, x)), Math.max(0, Math.min(viewport.height - 1, y)));
  const CONTROL = "a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[role=menuitem]";

  if (probe.kind === "point") {
    let el = at(probe.x, probe.y);
    if (el === null) return { viewport, element: null };
    // A click on the icon inside a button means the button.
    const control = el.closest(CONTROL);
    if (control !== null && control !== el) {
      let depth = 0;
      for (let node: Element | null = el; node !== null && node !== control; node = node.parentElement) depth++;
      if (depth <= 3) el = control;
    }
    return { viewport, element: describe(el) };
  }
  if (probe.kind === "area") {
    const right = probe.x + probe.width;
    const bottom = probe.y + probe.height;
    // The smallest element that holds the whole box.
    let el = at(probe.x + probe.width / 2, probe.y + probe.height / 2);
    while (el !== null && el.parentElement !== null && el !== document.body) {
      const rect = el.getBoundingClientRect();
      if (rect.left <= probe.x + 2 && rect.top <= probe.y + 2 && rect.right >= right - 2 && rect.bottom >= bottom - 2) break;
      el = el.parentElement;
    }
    const seen: Element[] = [];
    const contains: string[] = [];
    for (let row = 1; row <= 3 && contains.length < 5; row++) {
      for (let col = 1; col <= 3 && contains.length < 5; col++) {
        const inner = at(probe.x + (probe.width * col) / 4, probe.y + (probe.height * row) / 4);
        if (inner === null || inner === el || seen.includes(inner) || inner === document.body || inner === document.documentElement) continue;
        seen.push(inner);
        const said = clean(words(inner), 60);
        contains.push(clean(`${inner.tagName.toLowerCase()}${said !== "" ? ` "${said}"` : ""}`, 80));
      }
    }
    return { viewport, element: el !== null ? describe(el) : null, contains };
  }
  if (probe.kind === "locate") {
    const rects = probe.selectors.map((selector) => {
      try {
        const el = selector !== "" ? document.querySelector(selector) : null;
        return el !== null ? box(el.getBoundingClientRect()) : null;
      } catch {
        return null;
      }
    });
    return { viewport, rects };
  }
  // Scroll: the nearest scrollable box under the pointer, else the page.
  let node = at(probe.x, probe.y);
  while (node !== null && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node);
    const canY = probe.dy !== 0 && /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    const canX = probe.dx !== 0 && /(auto|scroll|overlay)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
    if (canY || canX) break;
    node = node.parentElement;
  }
  if (node !== null && node !== document.body && node !== document.documentElement) node.scrollBy(probe.dx, probe.dy);
  else window.scrollBy(probe.dx, probe.dy);
  return { viewport };
}

/**
 * The script a page runs for one annotate question: the function above as source text, called
 * once with the question embedded as JSON after `parseAnnotateProbe` checked it - never text
 * from the renderer.
 */
export function annotateProbeScript(probe: AnnotateProbe): string {
  return `(${annotatePageProbe.toString()})(${JSON.stringify(probe)}, ${String(MAX_SELECTOR_CHARS)})`;
}
