/**
 * The "too many tools": six generic apps, each in its own window with its own chrome, the
 * way a day of building with AI looks when nothing talks to anything else. Monochrome, and
 * named by what they are - chat, editor, browser, terminal, git, docs - never by a product.
 *
 * Every builder returns { el, step(visit, local) }: `visit` is how many times the loop has
 * come back to this window (the chat grows, the tabs multiply), `local` is progress through
 * the current shot, 0 → 1, with the pointer's click at CLICK.
 */
import { clamp, ease, h, put, seg, tf } from "../shared/engine.js";
import { icon, pointer } from "../shared/ui.js";

export const WIN = { w: 900, h: 580 };
export const CLICK = 0.42;

const lights = () => h("div", { class: "lights" }, h("i"), h("i"), h("i"));

function frame(kind, title, body, { tabs = null, bar = null } = {}) {
  const el = h("div", { class: `win win-${kind}` },
    h("div", { class: "win-top" }, lights(), tabs ?? h("div", { class: "win-title", text: title }), bar),
    body);
  return el;
}

/** The pointer and the button it goes for; both live on the window's plane. */
function hand(el) {
  const p = pointer();
  p.classList.add("win-pointer");
  el.append(p);
  return p;
}

function movePointer(p, from, to, local) {
  const go = ease.inOutCubic(seg(local, 0.05, CLICK));
  const press = seg(local, CLICK, CLICK + 0.08) * (1 - seg(local, CLICK + 0.08, CLICK + 0.2));
  put(p, { transform: tf({ x: from.x + (to.x - from.x) * go, y: from.y + (to.y - from.y) * go, s: 1 - 0.14 * press }), opacity: seg(local, 0, 0.08) });
  return press;
}

const CODE = [
  ["k", "export async function "], ["f", "login"], ["p", "(email, password) {"],
  null,
  ["p", "  const "], ["n", "user"], ["p", " = await db.users.find(email);"],
  null,
  ["p", "  if (!user.verified) "], ["k", "return "], ["n", "null"], ["p", ";"],
  null,
  ["p", "  const "], ["n", "token"], ["p", " = sign(user.id, SECRET);"],
  null,
  ["p", "  "], ["k", "return "], ["p", "{ user, token };"],
  null,
  ["p", "}"],
];
function codeLines(className = "") {
  const lines = [[]];
  for (const token of CODE) {
    if (token === null) lines.push([]);
    else lines.at(-1).push(token);
  }
  return h("div", { class: `code ${className}` }, lines.map((tokens, i) =>
    h("div", { class: "code-line" }, h("span", { class: "ln", text: String(i + 12) }),
      tokens.map(([kind, text]) => h("span", { class: `t-${kind}`, text })))));
}

export function chatApp() {
  const thread = h("div", { class: "chat-thread" });
  const say = (who, text, extra = null) => h("div", { class: `chat-msg ${who}` }, h("div", { class: "chat-bubble" }, h("p", { text }), extra));
  const copy = h("div", { class: "chat-copy" }, icon("file", 14), h("span", { text: "Copy code" }));
  const block = h("div", { class: "chat-code" }, h("div", { class: "chat-code-head" }, h("span", { text: "javascript" }), copy), codeLines("small"));
  const messages = [
    say("me", "it says user is undefined again"),
    say("ai", "Here is the fixed version - paste it back into your file:", block),
    say("me", "now the page is blank"),
    say("ai", "Try this instead. Replace the whole function:"),
  ];
  thread.append(...messages);
  const composer = h("div", { class: "chat-composer" }, h("span", { text: "Message…" }), h("b", {}, icon("arrowUp", 16)));
  const el = frame("chat", "Chat", h("div", { class: "chat-body" }, h("div", { class: "chat-side" },
    Array.from({ length: 9 }, (_, i) => h("i", { style: { width: `${60 + ((i * 37) % 30)}%` } }))), h("div", { class: "chat-main" }, thread, composer)));
  const p = hand(el);
  return {
    el,
    step(visit, local) {
      const press = movePointer(p, { x: 620, y: 520 }, { x: 790, y: 150 }, local);
      put(copy, { background: press > 0 || local > CLICK ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.04)" });
      messages.forEach((m, i) => put(m, { display: i < 2 + Math.min(2, visit) ? "flex" : "none" }));
      put(thread, { transform: tf({ y: -Math.min(2, visit) * 70 }) });
    },
  };
}

export function editorApp() {
  const names = ["login.js", "api.ts", "auth.ts", "index.tsx", "db.ts", "utils.js", "types.ts", "App.tsx", "routes.ts", "env.d.ts"];
  const tabs = names.map((name, i) => h("div", { class: `ed-tab${i === 0 ? " on" : ""}` }, icon("file", 12), h("span", { text: name })));
  const strip = h("div", { class: "ed-tabs" }, tabs);
  const code = codeLines();
  const paste = h("div", { class: "ed-paste" });
  const body = h("div", { class: "ed-body" },
    h("div", { class: "ed-tree" }, ["src", "  auth", "  api", "  pages", "  db", "public", "package.json"].map((row) => h("div", { class: "ed-row", text: row }))),
    h("div", { class: "ed-code" }, code, paste));
  const el = frame("editor", "", body, { tabs: strip });
  const p = hand(el);
  return {
    el,
    step(visit, local) {
      const press = movePointer(p, { x: 700, y: 480 }, { x: 420, y: 250 }, local);
      tabs.forEach((tab, i) => put(tab, { display: i < 3 + visit * 2 ? "flex" : "none" }));
      const flash = seg(local, CLICK, CLICK + 0.05) * (1 - seg(local, CLICK + 0.3, 1));
      put(paste, { opacity: local > CLICK ? 0.18 + 0.5 * flash : 0 });
      put(code, { transform: tf({ y: local > CLICK ? -8 : 0 }) });
      return press;
    },
  };
}

export function browserApp() {
  const spinner = h("div", { class: "br-spin" });
  const page = h("div", { class: "br-page" },
    h("div", { class: "br-error" }, h("b", { text: "Something went wrong." }), h("p", { text: "TypeError: Cannot read properties of undefined (reading 'id')" }),
      h("small", { text: "at login (auth/login.js:14:31)" })));
  const bar = h("div", { class: "br-bar" }, icon("refresh", 15), h("div", { class: "br-url" }, icon("globe", 13), h("span", { text: "localhost:3000/login" })));
  const el = frame("browser", "", h("div", { class: "br-body" }, page, spinner), { bar });
  const p = hand(el);
  return {
    el,
    step(visit, local) {
      movePointer(p, { x: 600, y: 420 }, { x: 36, y: 22 }, local);
      const reload = seg(local, CLICK, CLICK + 0.25);
      put(page, { opacity: reload > 0 && reload < 1 ? 0.15 : 1 });
      put(spinner, { opacity: reload > 0 && reload < 1 ? 1 : 0, transform: `rotate(${(local * 900).toFixed(1)}deg)` });
    },
  };
}

export function terminalApp() {
  const rows = [
    "$ npm run dev",
    "",
    "  ready in 412 ms  ➜  http://localhost:3000",
    "",
    "✕ TypeError: Cannot read properties of undefined (reading 'id')",
    "    at login (src/auth/login.js:14:31)",
    "    at async handler (src/api/session.ts:8:18)",
    "",
    "$ npm test",
    "✕ 3 failed · 39 passed",
  ].map((text) => h("div", { class: `term-row${text.startsWith("✕") ? " bad" : ""}`, text: text || " " }));
  const select = h("div", { class: "term-select" });
  const el = frame("terminal", "bash — 120×32", h("div", { class: "term-body" }, select, rows));
  const p = hand(el);
  return {
    el,
    step(visit, local) {
      movePointer(p, { x: 700, y: 470 }, { x: 560, y: 196 }, local);
      put(select, { transform: `scaleX(${ease.outCubic(seg(local, CLICK - 0.2, CLICK)).toFixed(3)})` });
      rows.forEach((row, i) => put(row, { opacity: i < 8 + Math.min(2, visit * 2) ? 1 : 0 }));
    },
  };
}

export function gitApp() {
  const lanes = Array.from({ length: 11 }, (_, i) => h("div", { class: "git-row" },
    h("span", { class: "git-dot", style: { marginLeft: `${[0, 18, 0, 36, 18, 0, 18, 0, 36, 0, 18][i]}px` } }),
    h("span", { class: "git-msg", text: ["fix login", "wip", "fix again", "revert fix", "try the other fix", "merge branch 'fix'", "fix", "maybe this", "undo", "fix login for real", "wip"][i] }),
    h("small", { text: `${2 + i}m` })));
  return { el: frame("git", "Git — main", h("div", { class: "git-body" }, lanes)), step() {} };
}

export function docsApp() {
  const para = (n) => h("div", { class: "docs-para" }, Array.from({ length: n }, (_, i) => h("i", { style: { width: `${70 + ((i * 29) % 30)}%` } })));
  return {
    el: frame("docs", "Docs", h("div", { class: "docs-body" }, h("b", { text: "Authentication" }), para(4), h("b", { text: "Sessions and tokens" }), para(5), para(3))),
    step() {},
  };
}

/** A pair (or one) of keycaps, popped toward the camera when the pointer clicks. */
export function keycaps(keys) {
  return h("div", { class: "keys" }, keys.map((key) => h("div", { class: `key${key.length > 2 ? " wide" : ""}` }, h("span", { text: key }))));
}

export function popKeys(el, local, dur) {
  const since = (local - CLICK) * dur;
  const rise = clamp(since / 0.18);
  const s = since < 0 ? 0 : 1 + 0.35 * Math.exp(-since * 9) * Math.sin(since * 30);
  put(el, { opacity: since < 0 ? 0 : clamp(rise * 3), transform: tf({ z: 60 + 140 * ease.outCubic(rise), s: 0.6 + 0.4 * ease.outBack(rise) * s }) });
}
