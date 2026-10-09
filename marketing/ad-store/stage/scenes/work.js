/**
 * 2.0–7.05 s. One continuous take inside an ADCode window.
 *
 * It opens out of the flash already close on the composer, where "ADCode, build me a habit
 * tracker" types itself. Enter: the message rises into the conversation, the camera follows
 * it up, and the agent's steps tick in. Then the camera pulls all the way back - the whole
 * window, the sidebar, the project - and an occasional sponsored card slides into the
 * corner. It pays: a "+$0.04" chip pops over the card and the earnings in the sidebar turn
 * green. On 6.85 the world whips left into the 50%.
 */
import { CUE, EXAMPLE, LINES } from "../cues.js";
import { camera, ease, h, lerp, put, seg, spring, typed } from "../shared/engine.js";
import { icon, markInline } from "../shared/ui.js";
import { drift, SIZE, SQUARE, wordSpans } from "../fx.js";

const GEOMETRY = SQUARE ? { w: 960, h: 660, cy: 40 } : { w: 1240, h: 700, cy: 40 };

/** An element's offset from `ancestor`, ignoring transforms - layout coordinates. */
function offset(element, ancestor) {
  let x = 0;
  let y = 0;
  for (let node = element; node && node !== ancestor; node = node.offsetParent) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y, w: element.offsetWidth, h: element.offsetHeight };
}

const centre = (box) => ({ cx: box.x + box.w / 2, cy: box.y + box.h / 2 });

export const work = {
  id: "work",
  from: CUE.build,
  to: CUE.fifty + 0.05,
  mount(root) {
    // The window, built like the Vibe window: sidebar, conversation, composer.
    this.earnings = h("span", { class: "earnings", text: "$0.00" });
    const side = h("div", { class: "win-side" },
      h("div", { class: "new", text: "+  New conversation" }),
      h("div", { class: "proj" }, h("b", { text: "habit-tracker" }), h("small", { text: "main · 6 changed" })),
      h("div", { class: "nav on" }, h("span", { text: "Chat" })),
      h("div", { class: "nav" }, h("span", { text: "Agents" })),
      h("div", { class: "nav" }, h("span", { text: "Changes" }), h("span", { text: "6" })),
      h("div", { class: "nav" }, h("span", { text: "Preview" })),
      h("div", { class: "foot" }, h("span", { text: "Earnings" }), this.earnings));
    this.bubble = h("div", { class: "bubble", text: LINES.prompt.text });
    this.stepRows = [
      ["Read", "src/habits.ts", ""],
      ["Edited", "HabitCard.tsx", "+24 −3"],
      ["Ran", "npm test", "12 passed"],
    ].map(([verb, what, note]) => h("div", { class: "step" },
      h("span", { class: "tick" }, icon("check", 18)), h("span", { text: verb }), h("b", { text: what }), h("small", { text: note })));
    this.worked = h("div", { class: "worked" },
      h("div", { class: "steps-head" }, markInline(26), h("span", { text: "Worked for 4s" })), ...this.stepRows);
    this.reply = h("div", { class: "reply", text: "Done. Your habit tracker is running in Preview." });
    this.typedText = h("span", { class: "prompt-text-inner" });
    this.caret = h("span", { class: "caret" });
    this.enterKey = h("span", { class: "enter", text: "↵" });
    this.composer = h("div", { class: "composer prompt-like" },
      h("span", { class: "prompt-chevron", text: "›" }), h("span", { class: "prompt-text" }, this.typedText, this.caret), this.enterKey);
    this.sponsor = h("div", { class: "sponsor" },
      h("div", { class: "sponsor-tag", text: "Sponsored" }),
      h("div", { class: "sponsor-logo" }, h("i"), h("span", { text: "Acme Cloud" })),
      h("p", { text: "Deploy anything in one command." }));
    this.chip = h("div", { class: "chip", text: EXAMPLE.share });
    this.chat = h("div", { class: "win-chat" }, this.bubble, this.worked, this.reply, this.composer);
    this.win = h("div", { class: "win" },
      h("div", { class: "win-bar" }, h("span", { class: "dots" }, h("i"), h("i"), h("i")), h("span", { text: "ADCode · habit-tracker" })),
      h("div", { class: "win-body" }, side, this.chat));
    this.win.style.width = `${GEOMETRY.w}px`;
    this.win.style.height = `${GEOMETRY.h}px`;
    this.cam = h("div", { class: "cam" }, this.win, this.sponsor, this.chip);
    this.world = h("div", { class: "layer" }, this.cam);

    this.buildLine = h("div", { class: "build-line" }, wordSpans(LINES.build.text));
    this.adLine = h("div", { class: "ad-line" }, wordSpans(LINES.ad.text));
    this.readout = h("div", { class: "readout" },
      h("div", {}, h("span", { text: "MODEL" }), h("b", { text: "your key" })),
      h("div", {}, h("span", { text: "AGENT" }), h("b", { text: "build" })),
      h("div", {}, h("span", { text: "STEPS" }), h("b", {}, h("span", { class: "steps-count", text: "0/3" }))));
    this.stepsCount = this.readout.querySelector(".steps-count");
    root.append(h("div", { class: "center" }, this.world), h("div", { class: "center" }, this.readout, this.buildLine, this.adLine));
    this.layout = null;
  },

  /** Layout coordinates inside the window, measured once the fonts are in. */
  measure() {
    const box = (element) => offset(element, this.win);
    const composer = box(this.composer);
    const bubble = box(this.bubble);
    const worked = box(this.worked);
    const chat = box(this.chat);
    const foot = box(this.earnings);
    // The sponsored card sits in the conversation's bottom-right corner, over the composer.
    const card = { w: 340, h: 150 };
    card.x = chat.x + chat.w - card.w - (SQUARE ? 34 : 60);
    card.y = composer.y - card.h - 22;
    return { composer, bubble, worked, chat, foot, card };
  },

  draw(t) {
    if (this.layout === null) this.layout = this.measure();
    const L = this.layout;
    const W = GEOMETRY.w;
    const H = GEOMETRY.h;

    // ── The camera, in window coordinates ──
    const close = SQUARE ? 1.5 : 2.0;
    const conv = { cx: L.chat.x + L.chat.w / 2, cy: (L.bubble.y + L.worked.y + L.worked.h) / 2 };
    const shots = [
      { at: CUE.build, ...centre(L.composer), s: close },
      { at: CUE.enter + 0.05, ...conv, s: close * 0.86, move: 0.5 },
      { at: CUE.dock, cx: W / 2, cy: H / 2 + 10, s: 1, move: 0.6 },
      { at: CUE.card + 0.4, cx: W / 2 + 30, cy: H / 2 + 10, s: 1.05, move: 2.0 },
    ];
    const shot = camera(t, shots);
    // Landing out of the flash: a touch of extra scale that settles.
    const land = 1 + 0.14 * (1 - ease.outExpo(seg(t, CUE.build, CUE.build + 0.5)));
    const whip = ease.inExpo(seg(t, CUE.whip, CUE.fifty));
    const d = drift(t, 0.8, 11);
    const s = shot.s * land;
    put(this.cam, {
      transform: `translate(${(-shot.cx * s + d.x - whip * SIZE.w * 1.4).toFixed(2)}px, ${(-shot.cy * s + GEOMETRY.cy + d.y).toFixed(2)}px) scale(${s.toFixed(4)})`,
    });
    put(this.world, { transform: `rotate(${d.r.toFixed(3)}deg)` });

    // ── Typing in the composer, then the send ──
    const text = LINES.prompt.text;
    const shown = t < CUE.enter ? typed(text, t, CUE.type[0], text.length / (CUE.type[1] - CUE.type[0])) : "";
    this.typedText.textContent = shown;
    const typing = t >= CUE.type[0] && t < CUE.type[1];
    put(this.caret, { opacity: typing || Math.floor(t * 2.5) % 2 === 0 ? 1 : 0 });
    const press = t >= CUE.enter - 0.04 && t < CUE.enter + 0.1;
    put(this.enterKey, { transform: press ? "translateY(3px)" : "none", color: press ? "var(--text)" : "" });

    const sent = ease.outCubic(seg(t, CUE.enter, CUE.enter + 0.35));
    put(this.bubble, { opacity: sent, transform: `translateY(${lerp(L.composer.y - L.bubble.y, 0, sent).toFixed(1)}px) scale(${lerp(0.9, 1, sent).toFixed(3)})` });

    // ── The agent's steps, one a beat ──
    put(this.worked, { opacity: seg(t, CUE.steps[0] - 0.12, CUE.steps[0] + 0.05) });
    let done = 0;
    this.stepRows.forEach((row, i) => {
      const p = ease.outCubic(seg(t, CUE.steps[i], CUE.steps[i] + 0.25));
      if (t >= CUE.steps[i]) done += 1;
      put(row, { opacity: p, transform: `translateX(${lerp(-24, 0, p).toFixed(1)}px)` });
      const pop = t < CUE.steps[i] ? 0 : spring(t - CUE.steps[i], 320, 16);
      put(row.firstChild, { transform: `scale(${pop.toFixed(3)})` });
    });
    this.stepsCount.textContent = `${done}/3`;
    const reply = ease.outCubic(seg(t, CUE.steps[2] + 0.2, CUE.steps[2] + 0.5));
    put(this.reply, { opacity: reply, transform: `translateY(${lerp(14, 0, reply).toFixed(1)}px)` });

    // ── The sponsored card arrives; it pays ──
    const cardIn = t < CUE.card ? 0 : spring(t - CUE.card, 200, 18);
    put(this.sponsor, {
      left: `${L.card.x}px`, top: `${L.card.y}px`,
      opacity: seg(t, CUE.card, CUE.card + 0.12),
      transform: `translateX(${lerp(80, 0, cardIn).toFixed(1)}px) scale(${lerp(0.92, 1, cardIn).toFixed(3)})`,
    });
    const chipPop = t < CUE.earn ? 0 : spring(t - CUE.earn, 260, 13);
    put(this.chip, {
      left: `${L.card.x + L.card.w - 50}px`, top: `${L.card.y - (SQUARE ? 2 : 40)}px`,
      opacity: seg(t, CUE.earn, CUE.earn + 0.06),
      transform: `translate(-50%, -50%) translateY(${lerp(30, -10, chipPop).toFixed(1)}px) scale(${lerp(0.4, 1, chipPop).toFixed(3)})`,
    });
    const paid = t >= CUE.earn + 0.1;
    this.earnings.textContent = paid ? "$0.04" : "$0.00";
    put(this.earnings, { color: paid ? "var(--money)" : "", textShadow: paid ? "0 0 24px var(--money-glow)" : "none" });

    // ── The lines, in screen space ──
    this.buildLine.querySelectorAll(".word").forEach((word, i) => {
      const at = CUE.build + 0.15 + i * 0.08;
      const p = ease.outCubic(seg(t, at, at + 0.35));
      const out = seg(t, LINES.build.to, LINES.build.to + 0.2);
      put(word, { opacity: p * (1 - out), transform: `translateY(${lerp(30, 0, p) - out * 20}px)`, filter: p < 0.98 ? `blur(${((1 - p) * 10).toFixed(1)}px)` : "none" });
    });
    put(this.readout, { opacity: SQUARE ? 0 : seg(t, CUE.build + 0.3, CUE.build + 0.5) * (1 - seg(t, CUE.dock - 0.1, CUE.dock + 0.1)) });
    this.adLine.querySelectorAll(".word").forEach((word, i) => {
      const at = LINES.ad.from - 0.3 + i * 0.06;
      const p = ease.outCubic(seg(t, at, at + 0.35));
      put(word, { opacity: p, transform: `translateY(${lerp(30, 0, p)}px)`, filter: p < 0.98 ? `blur(${((1 - p) * 10).toFixed(1)}px)` : "none" });
    });
    put(this.adLine, { transform: `translate(calc(-50% - ${(whip * SIZE.w * 1.4).toFixed(1)}px), ${SQUARE ? -440 : -455}px)` });
  },
};
