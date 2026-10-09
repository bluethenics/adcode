/**
 * 12.45–18.1 s. One editor. Then the flip.
 *
 * The white of "Zero" is the glass of one window: the camera pulls back and it is ADCode,
 * dark, turned a little in space. The tools from the loop fly back in from wherever they
 * were and snap into its panels - chat, editor, terminal, git - and the agents take their
 * seats. Inside it, a sentence in the chat becomes an edit in the file, the tests pass and
 * the change waits in Git. Then a sponsored card slides into the corner: "An occasional ad
 * keeps it free." The card lifts off, flips toward us, and its back is a green 50%:
 * "Half the ad money is yours."
 */
import { CUE, LINES } from "../cues.js";
import { ease, h, lerp, put, rng, seg, spring, typed } from "../shared/engine.js";
import { assistantFace, icon, markInline, mascot } from "../shared/ui.js";
import { Dust, LENS, mixCam, shake, view, wordSpans } from "../fx.js";
import { WIN, chatApp, editorApp, gitApp, terminalApp } from "./apps.js";

const APP = { w: 1480, h: 860 };
const TOP = 44;
/** Panel rects inside the window, in window pixels. */
const PANELS = {
  chat: { x: 0, y: TOP, w: 400, h: APP.h - TOP },
  editor: { x: 400, y: TOP, w: 780, h: 560 },
  terminal: { x: 400, y: TOP + 560, w: 780, h: APP.h - TOP - 560 },
  git: { x: 1180, y: TOP, w: 300, h: 360 },
  agents: { x: 1180, y: TOP + 360, w: 300, h: APP.h - TOP - 360 },
};
/** Where each tool flies in from (world), and how it is turned on the way. */
const FLY = [
  { panel: "chat", make: chatApp, from: { x: -1700, y: -80, z: 500, ry: 55, rx: 0 } },
  { panel: "editor", make: editorApp, from: { x: 300, y: -1300, z: 400, ry: -10, rx: -50 } },
  { panel: "terminal", make: terminalApp, from: { x: 500, y: 1400, z: 450, ry: 10, rx: 50 } },
  { panel: "git", make: gitApp, from: { x: 1900, y: -300, z: 500, ry: -55, rx: 0 } },
];
const PROMPT = "Fix the login bug";
const PARTS = LINES.parts.text.split(" · ");

/** A camera on window point (wx, wy): the window's centre is the world's origin. */
const on = (wx, wy, d, ry = 0, rx = 0) => ({ x: wx - APP.w / 2, y: wy - APP.h / 2, z: 0, d, rx, ry });
const CAM = {
  full: { x: 0, y: 0, z: 0, d: 1225, rx: 0, ry: 0 },
  hero: { x: 30, y: 60, z: 0, d: 2000, rx: 4, ry: -9 },
  composer: on(250, 700, 1050, -12, 3),
  fix: on(760, 175, 980, -6, 4),
  tests: on(700, 740, 1080, -3, -2),
  corner: on(980, 560, 1650, -7, 2),
  flip: { x: 0, y: 40, z: 0, d: 2300, rx: 2, ry: -2 },
};
/** The guided tour: pull back to the whole window, then follow the work through it. */
const MOVES = [
  [CUE.shrink, 0.5, "hero", ease.inOutExpo],
  [13.3, 0.4, "composer"],
  [CUE.edit - 0.12, 0.34, "fix"],
  [CUE.passed - 0.34, 0.34, "tests"],
  [14.95, 0.45, "corner"],
  [CUE.split - 0.1, 0.5, "flip"],
];

function camAt(t) {
  let cam = CAM.full;
  for (const [at, len, name, curve = ease.inOutCubic] of MOVES) cam = mixCam(cam, CAM[name], curve(seg(t, at, at + len)));
  return cam;
}

const px = (v) => `${v}px`;
const rect = ({ x, y, w, h: hh }) => ({ left: px(x), top: px(y), width: px(w), height: px(hh) });

function codeRow(n, html, cls = "") {
  return h("div", { class: `pc-row ${cls}` }, h("span", { class: "ln", text: String(n) }), html);
}
const tok = (kind, text) => h("span", { class: `t-${kind}`, text });

export const product = {
  id: "product",
  from: CUE.shrink,
  to: CUE.mark,
  mount(root) {
    root.append(h("div", { class: "product-bg" }));
    this.dust = new Dust(root, 110, 23);
    this.world = h("div", { class: "world" });
    root.append(h("div", { class: "viewport" }, this.world));

    // ── The window ──
    const menu = ["File", "Edit", "Selection", "View", "Go", "Run", "Git", "Terminal", "Help"];
    const titlebar = h("div", { class: "pw-title" }, markInline(18), h("b", { text: "ADCode" }),
      menu.map((item) => h("span", { text: item })), h("i", { class: "pw-spacer" }), h("span", { class: "pw-project", text: "my-app" }));

    // Chat (Vibe).
    this.typedEl = h("span", { class: "pc-typed" });
    this.placeholder = h("span", { class: "pc-placeholder", text: "Plan, Build, / for skills, @ for context…" });
    this.caret = h("span", { class: "pc-caret" });
    this.bubble = h("div", { class: "pc-me", text: PROMPT });
    this.reply = h("div", { class: "pc-ai" }, h("div", { class: "pc-face" }, assistantFace(28)),
      h("div", {}, h("p", { text: "Found it - user can be undefined when the email is new. Fixed in login.js." }),
        h("div", { class: "pc-chip" }, icon("file", 14), h("span", { text: "login.js" }), h("small", { text: "+1 −1" }))));
    const chat = h("div", { class: "pp pp-chat" },
      h("div", { class: "pp-head" }, icon("chat", 15), h("span", { text: "Chat" })),
      h("div", { class: "pc-thread" }, this.bubble, this.reply),
      h("div", { class: "pc-composer" }, h("div", { class: "pc-input" }, this.placeholder, this.typedEl, this.caret),
        h("div", { class: "pc-foot" }, h("span", { text: "+ Attach" }), h("span", { text: "@ Files" }), h("i"), h("b", {}, icon("arrowUp", 16)))));

    // Editor.
    this.oldLine = codeRow(14, [tok("p", "  if (!"), tok("n", "user"), tok("p", ".verified) "), tok("k", "return "), tok("n", "null"), tok("p", ";")], "pc-old");
    this.newLine = codeRow(14, [tok("p", "  if (!"), tok("n", "user"), h("span", { class: "t-fix", text: "?." }), tok("p", "verified) "), tok("k", "return "), tok("n", "null"), tok("p", ";")], "pc-new");
    this.fixLines = h("div", { class: "pc-fix" }, this.oldLine, this.newLine);
    const editor = h("div", { class: "pp pp-editor" },
      h("div", { class: "pe-tabs" }, h("div", { class: "pe-tab on" }, icon("file", 13), h("span", { text: "login.js" })), h("div", { class: "pe-tab" }, icon("file", 13), h("span", { text: "session.ts" }))),
      h("div", { class: "pe-code" },
        codeRow(12, [tok("k", "export async function "), tok("f", "login"), tok("p", "(email, password) {")]),
        codeRow(13, [tok("p", "  const "), tok("n", "user"), tok("p", " = await db.users.find(email);")]),
        this.fixLines,
        codeRow(15, [tok("p", "  const "), tok("n", "ok"), tok("p", " = await verify(password, user.hash);")]),
        codeRow(16, [tok("p", "  if (!ok) "), tok("k", "return "), tok("n", "null"), tok("p", ";")]),
        codeRow(17, [tok("p", "  const "), tok("n", "token"), tok("p", " = sign(user.id, SECRET);")]),
        codeRow(18, [tok("p", "  "), tok("k", "return "), tok("p", "{ user, token };")]),
        codeRow(19, [tok("p", "}")]),
        codeRow(20, []),
        codeRow(21, [tok("k", "export function "), tok("f", "logout"), tok("p", "(session) {")]),
        codeRow(22, [tok("p", "  return db.sessions.remove(session.id);")]),
        codeRow(23, [tok("p", "}")])));

    // Terminal.
    this.testRows = [
      "$ npm test",
      " ✓ tests/login.test.js (12)",
      " ✓ tests/session.test.js (30)",
      "",
      " Tests  42 passed (42)",
    ].map((text, i) => h("div", { class: `pt-row${i === 4 ? " pass" : ""}`, text: text || " " }));
    const terminal = h("div", { class: "pp pp-terminal" },
      h("div", { class: "pp-head" }, icon("terminal", 15), h("span", { text: "Terminal 1" })), h("div", { class: "pt-body" }, this.testRows));

    // Git.
    this.change = h("div", { class: "pg-change" }, icon("file", 14), h("span", { text: "login.js" }), h("b", { text: "M" }));
    const git = h("div", { class: "pp pp-git" },
      h("div", { class: "pp-head" }, icon("git", 15), h("span", { text: "Changes" }), this.count = h("small", { text: "0" })),
      h("div", { class: "pg-body" }, this.change, h("div", { class: "pg-msg", text: "Fix the login bug" }), h("div", { class: "pg-commit", text: "Commit" })));

    // Agents.
    this.mascots = [["hexagon", "Reviewer"], ["capsule", "Tester"], ["drop", "Bug fixer"]].map(([shape, name]) => {
      const m = mascot(shape, 36);
      const card = h("div", { class: "pa-card" }, m.element, h("div", {}, h("b", { text: name }), h("small", { text: "Working" })));
      return { ...m, card, status: card.querySelector("small") };
    });
    const agents = h("div", { class: "pp pp-agents" }, h("div", { class: "pp-head" }, icon("agents", 15), h("span", { text: "Agents" })),
      h("div", { class: "pa-body" }, this.mascots.map(({ card }) => card)));

    this.panels = { chat, editor, terminal, git, agents };
    for (const [name, panel] of Object.entries(this.panels)) Object.assign(panel.style, rect(PANELS[name]));
    this.slots = Object.keys(PANELS).map((name) => {
      const slot = h("div", { class: "pw-slot" });
      Object.assign(slot.style, rect(PANELS[name]));
      return slot;
    });
    this.whiteOver = h("div", { class: "pw-white" });
    this.win = h("div", { class: "pw" }, titlebar, this.slots, Object.values(this.panels), this.whiteOver);
    this.world.append(this.win);

    // The flyers: the loop's own windows, coming home.
    this.flyers = FLY.map((fly, i) => {
      const one = fly.make();
      one.el.classList.add("flyer");
      one.step(0, 0);
      this.world.append(one.el);
      return { ...fly, el: one.el, at: CUE.snaps[i] };
    });

    // The sponsored card, and its back.
    this.card = h("div", { class: "ad-card" },
      h("div", { class: "ad-front" },
        h("div", { class: "ad-logo", text: "A" }),
        h("div", { class: "ad-copy" }, h("small", { text: "SPONSORED" }), h("b", { text: "Acme Cloud" }), h("p", { text: "Deploy previews in one click. Free for open source." }))),
      h("div", { class: "ad-back" }, this.fifty = h("div", { class: "fifty", text: LINES.fifty.text })));
    this.world.append(this.card);
    const random = rng(50);
    this.sparks = Array.from({ length: 26 }, () => {
      const el = h("div", { class: "spark" });
      this.world.append(el);
      return { el, a: random() * Math.PI * 2, v: 300 + random() * 700, s: 0.4 + random() * 0.9, delay: random() * 0.12 };
    });

    // Words, in screen space.
    this.oneLine = h("div", { class: "p-line" }, wordSpans(LINES.one.text));
    this.adLine = h("div", { class: "p-line" }, wordSpans(LINES.ad.text));
    this.halfLine = h("div", { class: "p-line half" }, wordSpans(LINES.half.text));
    this.parts = h("div", { class: "p-parts" }, PARTS.flatMap((part, i) => [i ? h("i", { text: "·" }) : null, h("span", { text: part })]).filter(Boolean));
    this.partEls = [...this.parts.querySelectorAll("span")];
    this.scrim = h("div", { class: "p-scrim" });
    this.vignette = h("div", { class: "vignette" });
    root.append(this.scrim, this.oneLine, this.adLine, this.halfLine, this.parts, this.vignette);
  },

  draw(t) {
    const base = camAt(t);
    // The hand steadies into the cut, where the next scene picks the card up exactly.
    const hand = shake(t, 0.35 * (1 - seg(t, CUE.mark - 0.5, CUE.mark - 0.1)));
    const cam = { ...base, x: base.x + hand.x * 0.6, y: base.y + hand.y * 0.6, rx: base.rx + hand.rx * 0.4, ry: base.ry + hand.ry * 0.4, rz: hand.rz * 0.4 };
    put(this.world, { transform: view(cam) });
    this.dust.draw(t, { focus: 1.4, pan: { x: cam.x * 0.4, y: cam.y * 0.4 }, alpha: 0.5 * seg(t, CUE.shrink + 0.2, CUE.one + 0.4) * (1 - seg(t, CUE.mark - 0.3, CUE.mark - 0.02)), zoom: LENS / cam.d });

    // The white glass becomes the window. The vignette and scrims wait for the dark, so the
    // first frame is exactly the white "Zero" left.
    const open = ease.inOutCubic(seg(t, CUE.shrink + 0.08, CUE.shrink + 0.28));
    put(this.vignette, { opacity: seg(t, CUE.shrink + 0.15, CUE.shrink + 0.45) });
    put(this.scrim, { opacity: seg(t, CUE.shrink + 0.3, CUE.shrink + 0.6) * (1 - 0.6 * seg(t, CUE.split, CUE.split + 0.3)) });
    put(this.whiteOver, { opacity: 1 - open });
    put(this.win, { borderRadius: `${lerp(0, 22, seg(t, CUE.shrink, CUE.shrink + 0.3)).toFixed(1)}px`, transform: `translate(${-APP.w / 2}px, ${-APP.h / 2}px)` });

    // Snaps: each tool flies home, lands with a flash, and becomes the panel.
    const snapIndex = { chat: 0, editor: 1, terminal: 2, git: 3, agents: 4 };
    for (const [name, panel] of Object.entries(this.panels)) {
      const at = CUE.snaps[snapIndex[name]];
      const landed = seg(t, at + 0.12, at + 0.22);
      const flash = seg(t, at + 0.12, at + 0.15) * (1 - seg(t, at + 0.15, at + 0.45));
      put(panel, { opacity: landed, "--flash": flash.toFixed(3) });
    }
    this.slots.forEach((slot, i) => put(slot, { opacity: open * (1 - seg(t, CUE.snaps[i] + 0.12, CUE.snaps[i] + 0.2)) }));
    for (const fly of this.flyers) {
      const p = PANELS[fly.panel];
      const go = ease.inOutCubic(seg(t, fly.at - 0.2, fly.at + 0.14));
      const target = { x: p.x + p.w / 2 - APP.w / 2, y: p.y + p.h / 2 - APP.h / 2, z: 1, ry: 0, rx: 0 };
      const at = {
        x: lerp(fly.from.x, target.x, go), y: lerp(fly.from.y, target.y, go), z: lerp(fly.from.z, target.z, go),
        ry: lerp(fly.from.ry, 0, go), rx: lerp(fly.from.rx, 0, go),
      };
      const sx = lerp(0.9, p.w / WIN.w, go);
      const sy = lerp(0.9, p.h / WIN.h, go);
      put(fly.el, {
        display: t >= fly.at - 0.2 && t < fly.at + 0.24 ? "block" : "none",
        opacity: 1 - seg(t, fly.at + 0.12, fly.at + 0.24),
        transform: `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, ${at.z.toFixed(1)}px) rotateY(${at.ry.toFixed(2)}deg) rotateX(${at.rx.toFixed(2)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)}) translate(${-WIN.w / 2}px, ${-WIN.h / 2}px)`,
      });
    }
    // The agents take their seats.
    this.mascots.forEach((m, i) => {
      const since = t - (CUE.snaps[4] + i * 0.06);
      put(m.element, { transform: `scale(${(since <= 0 ? 0 : spring(since, 300, 14)).toFixed(3)})` });
      const done = t >= CUE.passed + 0.1 + i * 0.08;
      m.setMood(done ? "happy" : "thinking");
      m.status.textContent = done ? "Ready" : "Working";
    });

    // The demo: prompt → edit → tests → change.
    const text = typed(PROMPT, t, CUE.prompt, 42);
    const sent = t >= CUE.prompt + 0.5;
    this.typedEl.textContent = sent ? "" : text;
    put(this.placeholder, { display: text.length === 0 || sent ? "inline" : "none" });
    put(this.caret, { opacity: t >= CUE.prompt && !sent && Math.floor(t * 4) % 2 === 0 ? 1 : 0 });
    const bubbleIn = ease.outCubic(seg(t, CUE.prompt + 0.5, CUE.prompt + 0.7));
    put(this.bubble, { opacity: bubbleIn, transform: `translateY(${lerp(16, 0, bubbleIn).toFixed(1)}px)` });
    const replyIn = ease.outCubic(seg(t, CUE.edit - 0.12, CUE.edit + 0.1));
    put(this.reply, { opacity: replyIn, transform: `translateY(${lerp(16, 0, replyIn).toFixed(1)}px)` });
    const swap = ease.inOutCubic(seg(t, CUE.edit, CUE.edit + 0.25));
    put(this.oldLine, { opacity: 1 - swap, transform: `translateY(${(-100 * swap).toFixed(1)}%)` });
    put(this.newLine, { opacity: swap, transform: `translateY(${(100 * (1 - swap)).toFixed(1)}%)` });
    put(this.fixLines, { "--glow": (seg(t, CUE.edit, CUE.edit + 0.1) * (1 - seg(t, CUE.edit + 0.5, CUE.edit + 1.2))).toFixed(3) });
    this.testRows.forEach((row, i) => put(row, { opacity: seg(t, CUE.passed - 0.35 + i * 0.08, CUE.passed - 0.3 + i * 0.08) }));
    put(this.change, { opacity: seg(t, CUE.edit + 0.25, CUE.edit + 0.35) });
    this.count.textContent = t >= CUE.edit + 0.25 ? "1" : "0";

    // The card slides into the corner, then lifts, flips and grows.
    const slide = t < CUE.card ? 0 : spring(t - CUE.card, 220, 20);
    const lift = ease.inOutCubic(seg(t, CUE.split, CUE.split + 0.42));
    const corner = { x: APP.w / 2 - 250, y: APP.h / 2 - 104 };
    const centre = { x: 0, y: -60 };
    const cx = lerp(corner.x + 420 * (1 - slide), centre.x, lift);
    const cy = lerp(corner.y, centre.y, lift);
    const cz = lerp(24, 520, lift);
    const flipAngle = lerp(0, 180, ease.inOutCubic(seg(t, CUE.split + 0.02, CUE.split + 0.36)));
    const grow = lerp(1, 2.6, lift) * (1 + 0.03 * seg(t, CUE.fifty + 0.2, CUE.mark));
    put(this.card, {
      display: t >= CUE.card ? "block" : "none",
      opacity: seg(t, CUE.card, CUE.card + 0.06),
      transform: `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, ${cz.toFixed(1)}px) rotateY(${flipAngle.toFixed(2)}deg) rotateX(${(lift * (1 - lift) * 30).toFixed(2)}deg) scale(${grow.toFixed(4)}) translate(-200px, -64px)`,
    });
    const fiftyIn = t < CUE.fifty ? 0 : spring(t - CUE.fifty, 260, 13);
    put(this.fifty, { transform: `scale(${(0.55 + 0.45 * fiftyIn).toFixed(4)})`, opacity: seg(t, CUE.fifty, CUE.fifty + 0.05) });
    // The window steps back into the dark as the money comes forward.
    // It is gone by the cut, so the mark scene's plate takes over without a jump.
    put(this.win, { opacity: 1 - seg(t, CUE.mark - 0.4, CUE.mark - 0.05), filter: `brightness(${lerp(1, 0.28, lift).toFixed(3)}) blur(${(lift * 5).toFixed(1)}px)` });
    for (const spark of this.sparks) {
      const since = t - CUE.fifty - spark.delay;
      const life = seg(since, 0, 0.9);
      const d = spark.v * ease.outCubic(life);
      put(spark.el, {
        display: since > 0 && life < 1 ? "block" : "none",
        opacity: 1 - life,
        transform: `translate3d(${(centre.x + Math.cos(spark.a) * d).toFixed(1)}px, ${(centre.y + Math.sin(spark.a) * d * 0.6).toFixed(1)}px, ${(cz + 40).toFixed(1)}px) scale(${spark.s.toFixed(3)})`,
      });
    }

    // The words.
    const lineIn = (el, from, to, exitAt, exitLen = 0.18) => {
      const words = [...el.querySelectorAll(".word")];
      words.forEach((word, i) => {
        const rise = ease.outCubic(seg(t, from + i * 0.035, from + 0.24 + i * 0.035));
        const fall = ease.inCubic(seg(t, exitAt, exitAt + exitLen));
        put(word, { opacity: rise * (1 - fall), transform: `translateY(${(lerp(40, 0, rise) - fall * 24).toFixed(1)}px)`, filter: rise < 1 || fall > 0 ? `blur(${((1 - rise) * 10 + fall * 10).toFixed(1)}px)` : "none" });
      });
      put(el, { display: t >= from && t < exitAt + exitLen ? "block" : "none" });
    };
    lineIn(this.oneLine, CUE.oneTitle - 0.05, LINES.one.from, LINES.one.to);
    lineIn(this.adLine, LINES.one.to + 0.12, LINES.ad.from, LINES.ad.to, 0.12);
    // The half line carries on into the mark scene, which fades it; no exit here.
    lineIn(this.halfLine, CUE.split + 0.05, LINES.half.from, CUE.mark + 1);
    const partsOn = (1 - seg(t, LINES.parts.to, LINES.parts.to + 0.15)) * seg(t, CUE.snaps[0] + 0.1, CUE.snaps[0] + 0.2);
    put(this.parts, { opacity: partsOn });
    this.partEls.forEach((el, i) => el.classList.toggle("lit", t >= CUE.snaps[i] + 0.12));
  },
};
