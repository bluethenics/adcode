/**
 * 1.5–4.5 s. The proof, in the real window.
 *
 * The chip from the hook lands in the title bar of an ADCode window. In the chat, a
 * sentence is sent; in the editor, the AI writes the file. Then a sponsored card slides into
 * the corner, a green +$0.04 leaves it and flies up into the chip, the chip jumps, and the
 * earnings list opens with the new row on top. The camera follows the work: the code, the
 * card, the money.
 */
import { CUE, H, LINES, W } from "../cues.js";
import { aim, camera, ease, h, lerp, put, seg, spring, typed } from "../shared/engine.js";
import { assistantFace, icon, markInline } from "../shared/ui.js";
import { wordSpans } from "../fx.js";
import { earningsChip, money } from "./chip.js";

const WIN = { w: 1200, h: 900 };
/** The chip's centre in window pixels: right end of the title bar (it is 176 × 32). */
const CHIP = { x: WIN.w - 18 - 88, y: 24 };
const START = { cx: 600, cy: 413.5, s: 0.86 };
/** Where, and how big, the title-bar chip is on screen in this scene's first frame. */
export const CHIP_LANDING = { x: W / 2 + (CHIP.x - START.cx) * START.s, y: H / 2 + (CHIP.y - START.cy) * START.s, s: START.s };

const SHOTS = [
  { at: 0, ...START },
  { at: CUE.product + 0.1, cx: 790, cy: 300, s: 1.18, move: 0.5 },
  { at: CUE.card - 0.05, cx: 820, cy: 560, s: 1.0, move: 0.25 },
  { at: CUE.payout - 0.02, cx: 905, cy: 235, s: 1.12, move: 0.38 },
];

const PROMPT = "Add sign-in with email";
const CODE = [
  [["k", "import "], ["p", "{ db } "], ["k", "from "], ["s", "\"./db\""], ["p", ";"]],
  [["k", "import "], ["p", "{ sendMail, link } "], ["k", "from "], ["s", "\"./mail\""], ["p", ";"]],
  [],
  [["k", "export async function "], ["f", "sendMagicLink"], ["p", "(email) {"]],
  [["p", "  const "], ["n", "user"], ["p", " = await db.users.upsert({ email });"]],
  [["p", "  const "], ["n", "token"], ["p", " = crypto.randomUUID();"]],
  [["p", "  await db.tokens.insert({ token, userId: user.id });"]],
  [["p", "  await sendMail(email, link(token));"]],
  [["p", "}"]],
  [],
  [["k", "export async function "], ["f", "signIn"], ["p", "(token) {"]],
  [["p", "  const "], ["n", "row"], ["p", " = await db.tokens.take(token);"]],
  [["p", "  "], ["k", "if "], ["p", "(!row || row.expired) "], ["k", "return "], ["n", "null"], ["p", ";"]],
  [["p", "  "], ["k", "return "], ["p", "db.sessions.create(row.userId);"]],
  [["p", "}"]],
];
const TOTAL = CODE.reduce((sum, line) => sum + line.reduce((n, [, text]) => n + text.length, 0) + 1, 0);
const ROWS = [
  { who: "Acme Cloud", amount: 0.04, when: "now" },
  { who: "Acme Cloud", amount: 0.04, when: "2 min" },
  { who: "Acme Cloud", amount: 0.03, when: "9 min" },
];

export const product = {
  id: "product",
  from: CUE.product,
  to: CUE.cuts[0],
  mount(root) {
    root.append(h("div", { class: "product-bg" }));
    const menu = ["File", "Edit", "Selection", "View", "Go", "Run", "Git", "Terminal", "Help"];
    this.chip = earningsChip();
    const titlebar = h("div", { class: "pw-title" }, markInline(18), h("b", { text: "ADCode" }), menu.map((item) => h("span", { text: item })), h("i", { class: "pw-spacer" }));
    this.chipSlot = h("div", { class: "pw-chip" }, this.chip.el);

    // Chat.
    this.typedEl = h("span", { class: "pc-typed" });
    this.placeholder = h("span", { class: "pc-placeholder", text: "Plan, Build, / for skills, @ for context…" });
    this.caret = h("span", { class: "pc-caret" });
    this.bubble = h("div", { class: "pc-me", text: PROMPT });
    this.dots = h("div", { class: "pc-dots" }, h("i"), h("i"), h("i"));
    this.reply = h("div", { class: "pc-ai" }, h("div", { class: "pc-face" }, assistantFace(26)),
      h("div", {}, h("p", { text: "Done - sign-in with a one-time link." }),
        h("div", { class: "pc-chip" }, icon("file", 13), h("span", { text: "auth.ts" }), h("small", { text: "+15" }))));
    const chat = h("div", { class: "pp pp-chat" },
      h("div", { class: "pp-head" }, icon("chat", 15), h("span", { text: "Chat" })),
      h("div", { class: "pc-thread" }, this.bubble, this.dots, this.reply),
      h("div", { class: "pc-composer" }, h("div", { class: "pc-input" }, this.placeholder, this.typedEl, this.caret),
        h("div", { class: "pc-foot" }, h("span", { text: "+ Attach" }), h("span", { text: "@ Files" }), h("i"), h("b", {}, icon("arrowUp", 15)))));

    // Editor: the lines exist from the start, empty; the stream fills them.
    this.codeLines = CODE.map((tokens, i) => {
      const spans = tokens.map(([kind, text]) => ({ el: h("span", { class: `t-${kind}` }), text }));
      const row = h("div", { class: "pe-row" }, h("span", { class: "ln", text: String(i + 1) }), spans.map(({ el }) => el));
      return { row, spans, length: tokens.reduce((n, [, text]) => n + text.length, 0) };
    });
    this.cursor = h("span", { class: "pe-cursor" });
    const editor = h("div", { class: "pp pp-editor" },
      h("div", { class: "pe-tabs" }, h("div", { class: "pe-tab on" }, icon("file", 13), h("span", { text: "auth.ts" })), h("div", { class: "pe-tab" }, icon("file", 13), h("span", { text: "SignIn.tsx" }))),
      h("div", { class: "pe-code" }, this.codeLines.map(({ row }) => row)));

    // The sponsored card, the payout, the earnings list.
    this.card = h("div", { class: "ad-card" },
      h("div", { class: "ad-logo", text: "A" }),
      h("div", { class: "ad-copy" }, h("small", { text: "SPONSORED" }), h("b", { text: "Acme Cloud" }), h("p", { text: "Deploy previews in one click." })));
    this.payout = h("div", { class: "payout", text: `+${money(0.04)}` });
    this.rows = ROWS.map(({ who, amount, when }, i) => h("div", { class: `er-row${i === 0 ? " new" : ""}` },
      h("span", { class: "er-who", text: who }), h("span", { class: "er-amount", text: `+${money(amount)}` }), h("small", { text: when })));
    this.list = h("div", { class: "earnings-list" }, h("div", { class: "er-head" }, h("b", { text: "Earnings" }), h("small", { text: "every view, itemized" })), this.rows);

    this.win = h("div", { class: "pw" }, titlebar, chat, editor, this.chipSlot, this.card, this.list, this.payout);
    Object.assign(chat.style, { left: "0px", top: "48px", width: "400px", height: `${WIN.h - 48}px` });
    Object.assign(editor.style, { left: "400px", top: "48px", width: `${WIN.w - 400}px`, height: `${WIN.h - 48}px` });
    this.camera = h("div", { class: "camera" }, this.win);

    // Captions, over a scrim.
    this.aiLine = h("div", { class: "caption" }, wordSpans(LINES.ai.text));
    this.halfLine = h("div", { class: "caption" }, wordSpans(LINES.half.text));
    root.append(this.camera, h("div", { class: "scrim" }), this.aiLine, this.halfLine);
  },

  draw(t) {
    const shot = camera(t, SHOTS);
    put(this.camera, { transform: aim(shot, W, H) });
    const hit = this.chip.draw(t, { landedAt: CUE.landed });
    put(this.chipSlot, { "--glow": hit.toFixed(3) });

    // The prompt, sent; the assistant thinking; its answer.
    const text = typed(PROMPT, t, CUE.prompt, 90);
    const sent = t >= CUE.send;
    this.typedEl.textContent = sent ? "" : text;
    put(this.placeholder, { display: text.length === 0 || sent ? "inline" : "none" });
    put(this.caret, { opacity: !sent && Math.floor(t * 6) % 2 === 0 ? 1 : 0 });
    const bubble = ease.outCubic(seg(t, CUE.send, CUE.send + 0.15));
    put(this.bubble, { opacity: bubble, transform: `translateY(${lerp(14, 0, bubble).toFixed(1)}px)` });
    put(this.dots, { display: t >= CUE.send + 0.08 && t < CUE.stream[1] ? "flex" : "none", "--phase": ((t * 3) % 1).toFixed(3) });
    const reply = ease.outCubic(seg(t, CUE.stream[1], CUE.stream[1] + 0.15));
    put(this.reply, { display: t >= CUE.stream[1] ? "flex" : "none", opacity: reply });

    // The file, streaming in.
    let left = Math.floor(seg(t, CUE.stream[0], CUE.stream[1]) * TOTAL);
    let cursorRow = null;
    for (const line of this.codeLines) {
      const show = Math.max(0, Math.min(line.length, left));
      let rest = show;
      for (const span of line.spans) {
        span.el.textContent = span.text.slice(0, Math.max(0, rest));
        rest -= span.text.length;
      }
      if (left >= 0 && left <= line.length && cursorRow === null && t >= CUE.stream[0]) cursorRow = line.row;
      line.row.classList.toggle("fresh", left > 0 && left <= line.length + 12 && t < CUE.stream[1] + 0.3);
      left -= line.length + 1;
    }
    if (cursorRow && t < CUE.stream[1]) cursorRow.append(this.cursor);
    else this.cursor.remove();

    // The card, the payout, the list.
    const slide = t < CUE.card ? 0 : spring(t - CUE.card, 240, 20);
    put(this.card, { opacity: seg(t, CUE.card, CUE.card + 0.05), transform: `translateX(${((1 - slide) * 480).toFixed(1)}px)` });
    const from = { x: 980, y: 815 };
    const at = (u) => {
      const v = ease.inOutCubic(u);
      return { x: lerp(from.x, CHIP.x, v), y: lerp(from.y, CHIP.y, v) - Math.sin(v * Math.PI) * 120, s: lerp(1.7, 0.7, v) };
    };
    const flight = seg(t, CUE.payout, CUE.landed);
    const pop = t < CUE.payout ? 0 : spring(t - CUE.payout, 400, 18);
    const p = at(flight);
    put(this.payout, {
      display: t >= CUE.payout && t < CUE.landed + 0.02 ? "block" : "none",
      transform: `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${(p.s * Math.min(1, pop)).toFixed(4)}) translate(-50%, -50%)`,
    });
    const open = ease.outCubic(seg(t, CUE.row, CUE.row + 0.18));
    put(this.list, { opacity: open, transform: `translateY(${lerp(-12, 0, open).toFixed(1)}px) scaleY(${lerp(0.9, 1, open).toFixed(3)})` });
    const fresh = ease.outCubic(seg(t, CUE.row + 0.08, CUE.row + 0.3));
    put(this.rows[0], { "--fresh": fresh.toFixed(3) });

    // The words.
    const caption = (el, start, exit) => {
      [...el.querySelectorAll(".word")].forEach((word, i) => {
        const rise = ease.outCubic(seg(t, start + i * 0.035, start + 0.22 + i * 0.035));
        const fall = ease.inCubic(seg(t, exit, exit + 0.1));
        put(word, { opacity: rise * (1 - fall), transform: `translateY(${(lerp(34, 0, rise) - fall * 20).toFixed(1)}px)`, filter: rise < 1 || fall > 0 ? `blur(${((1 - rise) * 8 + fall * 8).toFixed(1)}px)` : "none" });
      });
      put(el, { display: t >= start && t < exit + 0.1 ? "block" : "none" });
    };
    caption(this.aiLine, CUE.product, LINES.ai.to);
    caption(this.halfLine, CUE.card, LINES.half.to);
  },
};
