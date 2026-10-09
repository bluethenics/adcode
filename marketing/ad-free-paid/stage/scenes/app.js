/**
 * 2–10.5 s. The app: you ask, you wait, you get paid, and the money splits.
 *
 * Out of the white, ADCode's Vibe window, turned in space and drawn from its real layout
 * (the sidebar, the worked-for block, the Undo card, Preview). "Build me a habit tracker"
 * types itself and goes; the agent starts, its clock racing - "Your AI is working…". The
 * camera pulls back: a sponsored card slides into the corner, "+$0.04" pops off it and flies
 * into the sidebar's earnings, which turn green, while "Get paid to wait." slams in word by
 * word. The agent finishes and the habit tracker appears in Preview.
 *
 * Then the card lifts out of the window and flips toward us. Its back reads what the ad
 * paid. A crack runs down it and it breaks in two: YOU · 50% · +$0.04 in green, ADCODE ·
 * 50% in grey. "Half the ad money is yours." The camera whips away into the montage.
 */
import { CUE, EXAMPLE, LINES, WORKED } from "../cues.js";
import { ease, h, lerp, put, rng, seg, spring, typed } from "../shared/engine.js";
import { assistantFace, icon, markInline } from "../shared/ui.js";
import { Dust, LENS, mixCam, shake, view, wordSpans } from "../fx.js";

const APP = { w: 1200, h: 800 };
/** The card, in window pixels: over the bottom-right of Preview, where the app puts it. */
const CARD = { w: 360, h: 112, x: 828, y: 670 };
const CORNER = { x: CARD.x + CARD.w / 2 - APP.w / 2, y: CARD.y + CARD.h / 2 - APP.h / 2 };
/** Where the sidebar's earnings sit, in world pixels: the +$0.04 flies home to it. */
const EARN = { x: 178 - APP.w / 2, y: 768 - APP.h / 2 };
const CENTRE = { x: 0, y: -14 };
const GROW = 2.05;

/** A camera on window point (wx, wy): the window's centre is the world's origin. */
const on = (wx, wy, d, ry = 0, rx = 0) => ({ x: wx - APP.w / 2, y: wy - APP.h / 2, z: 0, d, rx, ry });
const CAM = {
  arrive: on(470, 728, 470, -22, 9),
  composer: on(470, 728, 640, -10, 5),
  thread: on(470, 198, 850, -10, 3),
  wide: { x: 40, y: -100, z: 0, d: 2300, rx: 7, ry: -12 },
  corner: on(840, 430, 1720, -10, 4),
  flip: { x: 0, y: 30, z: 0, d: 2200, rx: 0, ry: 0 },
  whip: { x: 1700, y: 30, z: 0, d: 2200, rx: 0, ry: 16 },
};
const MOVES = [
  [CUE.app, 0.5, "composer", ease.outCubic],
  [CUE.send - 0.1, 0.5, "thread"],
  [CUE.wide, 0.5, "wide", ease.inOutExpo],
  [5.85, 1.0, "corner", ease.inOutCubic],
  [CUE.lift - 0.05, 0.55, "flip", ease.inOutCubic],
  [CUE.whipOut, 0.2, "whip", ease.inExpo],
];

function camAt(t) {
  let cam = CAM.arrive;
  for (const [at, len, name, curve = ease.inOutCubic] of MOVES) cam = mixCam(cam, CAM[name], curve(seg(t, at, at + len)));
  return cam;
}

const PROMPT = LINES.prompt.text;
const clock = (s) => `0:${String(Math.floor(s)).padStart(2, "0")}`;
const money = (v) => `$${v.toFixed(2)}`;

export const app = {
  id: "app",
  from: CUE.app,
  to: CUE.whips[0],
  mount(root) {
    root.append(h("div", { class: "app-bg" }));
    this.dust = new Dust(root, 100, 17);
    this.world = h("div", { class: "world" });
    root.append(h("div", { class: "viewport" }, this.world));

    // ── The Vibe window ──
    const title = h("div", { class: "vw-title" }, markInline(18), h("b", { text: "ADCode" }), h("span", { text: "habit-tracker" }),
      h("i", { class: "vw-spacer" }),
      h("div", { class: "vw-switch" }, h("span", { class: "on", text: "✦ Vibe" }), h("span", { text: "</> Code" })),
      h("i", { class: "vw-spacer" }), h("div", { class: "vw-ctl" }, h("span", { text: "—" }), h("span", { text: "▢" }), h("span", { text: "✕" })));

    this.agentsEm = h("em", { text: "" });
    this.changesEm = h("em", { text: "0" });
    this.earn = h("span", { class: "vw-earn", text: money(0) });
    const side = h("div", { class: "vw-side" },
      h("div", { class: "vw-new", text: "＋ New conversation" }),
      h("div", { class: "vw-proj" }, h("b", { text: "habit-tracker" }), h("small", { text: "main" })),
      h("div", { class: "vw-nav on" }, icon("chat", 16), h("span", { text: "Chat" })),
      h("div", { class: "vw-nav" }, icon("agents", 16), h("span", { text: "Agents" }), this.agentsEm),
      h("div", { class: "vw-nav" }, icon("tools", 16), h("span", { text: "Tools" })),
      h("div", { class: "vw-nav" }, icon("git", 16), h("span", { text: "Changes" }), this.changesEm),
      h("div", { class: "vw-nav" }, icon("eye", 16), h("span", { text: "Preview" })),
      h("div", { class: "vw-label", text: "Today" }),
      h("div", { class: "vw-convo on", text: "Build a habit tracker" }),
      h("div", { class: "vw-convo", text: "Dark mode toggle" }),
      h("div", { class: "vw-foot" }, h("span", { text: "Open IDE" }), this.earn));

    // Chat: the ask, the work, the answer.
    this.bubble = h("div", { class: "vc-me", text: PROMPT });
    this.spin = h("span", { class: "vc-spin" });
    this.headText = h("span", { text: "Working…" });
    this.clock = h("span", { class: "vc-clock", text: clock(0) });
    this.testNote = h("small", { text: "running…" });
    this.steps = [
      h("div", { class: "vc-step" }, h("i", {}, icon("check", 12)), h("span", { text: "Planned" }), h("code", { text: "4 files" })),
      h("div", { class: "vc-step" }, h("i", {}, icon("check", 12)), h("span", { text: "Wrote" }), h("code", { text: "HabitList.tsx" }), h("small", { text: "+212" })),
      h("div", { class: "vc-step" }, h("i", {}, icon("check", 12)), h("span", { text: "Ran" }), h("code", { text: "npm test" }), this.testNote),
    ];
    this.worked = h("div", { class: "vc-worked" }, h("div", { class: "vc-head" }, this.spin, markInline(16), this.headText, this.clock), this.steps);
    this.reply = h("div", { class: "vc-reply" }, assistantFace(26), h("p", { text: "Done. Your habit tracker is running in Preview." }));
    this.undo = h("div", { class: "vc-undo" }, h("span", {}, "4 files changed", h("small", { text: "+212 −0" })), h("b", { text: "Undo" }));
    this.typedEl = h("span");
    this.placeholder = h("span", { class: "vc-placeholder", text: "Describe what to build or change…" });
    this.caret = h("span", { class: "vc-caret" });
    const chat = h("div", { class: "vw-chat" },
      h("div", { class: "vc-thread" }, this.bubble, this.worked, this.reply, this.undo),
      h("div", { class: "vc-composer" }, h("div", { class: "vc-input" }, this.placeholder, this.typedEl, this.caret),
        h("div", { class: "vc-foot" }, h("span", { text: "+ Attach" }), h("span", { text: "@ Files" }), h("i"), h("span", { class: "vc-pill", text: "Agent" }), h("b", { class: "vc-send" }, icon("arrowUp", 16)))));

    // Preview: a skeleton while it builds, then the app.
    this.skel = h("div", { class: "vp-skel" }, h("i", { class: "title" }), h("i"), h("i"), h("i"), h("i"), h("span", { text: "Building…" }));
    const habits = [["Drink water", 7, 6], ["Read 20 pages", 3, 3], ["Walk 8,000 steps", 12, 7], ["Write code", 5, 5]];
    this.checks = [];
    this.appUi = h("div", { class: "vp-app" },
      h("div", { class: "ha-title" }, h("b", { text: "Habits" }), h("small", { text: "This week" })),
      habits.map(([name, streak, days]) => {
        const check = h("span", { class: "ha-check" }, icon("check", 14));
        this.checks.push(check);
        return h("div", { class: "ha-row" }, check, h("span", { class: "ha-name", text: name }),
          h("span", { class: "ha-days" }, Array.from({ length: 7 }, (_, i) => h("i", { class: i < days ? "on" : "" }))),
          h("span", { class: "ha-streak", text: `${streak} days` }));
      }));
    const prev = h("div", { class: "vw-prev" },
      h("div", { class: "vp-head" }, icon("eye", 15), h("span", { text: "Preview" }), h("span", { class: "vp-url", text: "localhost:5173" }), icon("refresh", 15)),
      h("div", { class: "vp-body" }, this.skel, this.appUi));

    this.win = h("div", { class: "vw" }, title, side, chat, prev);
    this.world.append(this.win);

    // ── The card: an Acme Cloud ad on the front; on the back, what it paid, then the split ──
    this.cost = h("div", { class: "cost" }, h("small", { text: LINES.costLabel.text }), h("b", { text: LINES.cost.text }));
    this.halfL = h("div", { class: "half l" }, this.inL = h("div", { class: "half-in" },
      h("small", { text: LINES.you.text }), h("span", { class: "pct", text: LINES.fifty.text }), h("span", { class: "amt", text: LINES.youShare.text })));
    this.halfR = h("div", { class: "half r" }, this.inR = h("div", { class: "half-in" },
      h("small", { text: LINES.us.text }), h("span", { class: "pct", text: LINES.fifty.text })));
    this.crackPath = h("path", { d: "M8 0L4 18L11 34L5 52L12 70L6 88L10 106L7 124", "stroke-dasharray": "140", "stroke-dashoffset": "140" });
    this.crack = h("svg", { class: "crack", viewBox: "0 0 16 124" }, this.crackPath);
    this.front = h("div", { class: "ad-front" },
      h("div", { class: "ad-logo", text: "A" }),
      h("div", { class: "ad-copy" }, h("small", { text: "SPONSORED" }), h("b", { text: "Acme Cloud" }), h("p", { text: "Deploy previews in one click. Free for open source." })));
    this.back = h("div", { class: "ad-back" }, this.halfL, this.halfR, this.cost, this.crack);
    this.card = h("div", { class: "ad-card" }, this.front, this.back);
    this.world.append(this.card);

    this.plus = h("div", { class: "plus", text: LINES.earned.text });
    this.world.append(this.plus);

    const random = rng(80);
    this.sparks = Array.from({ length: 30 }, () => {
      const el = h("div", { class: "spark" });
      this.world.append(el);
      return { el, a: random() * Math.PI * 2, v: 260 + random() * 640, s: 0.4 + random() * 0.9, delay: random() * 0.1 };
    });

    // ── Words, in screen space ──
    this.topScrim = h("div", { class: "top-scrim" });
    this.bottomScrim = h("div", { class: "bottom-scrim" });
    this.workingLine = h("div", { class: "s-line" }, wordSpans(LINES.working.text));
    const paidWords = LINES.paid.text.split(" ").map((word) => h("span", { class: `word${word === "paid" ? " money" : ""}`, text: word }));
    this.paidWords = paidWords;
    this.paidLine = h("div", { class: "s-line big" }, paidWords.flatMap((word, i) => (i ? [" ", word] : [word])));
    this.halfLine = h("div", { class: "s-line low" }, wordSpans(LINES.half.text));
    this.flash = h("div", { class: "flash" });
    root.append(this.topScrim, this.bottomScrim, this.workingLine, this.paidLine, this.halfLine, h("div", { class: "vignette" }), this.flash);
  },

  draw(t) {
    // The camera, a light hand on it, and a jolt for every slammed word.
    const base = camAt(t);
    const jolt = CUE.slam.reduce((sum, at) => sum + (t >= at ? Math.exp(-(t - at) * 14) : 0), 0) + (t >= CUE.split ? Math.exp(-(t - CUE.split) * 10) * 1.4 : 0);
    const hand = shake(t, 0.16 + 1.6 * jolt, 11);
    const cam = { ...base, x: base.x + hand.x, y: base.y + hand.y, rx: base.rx + hand.rx * 0.4, ry: base.ry + hand.ry * 0.4, rz: hand.rz * 0.5 };
    put(this.world, { transform: view(cam) });
    this.dust.draw(t, { focus: 1.3, alpha: 0.4, zoom: LENS / cam.d, pan: { x: cam.x * 0.4, y: cam.y * 0.4 } });
    put(this.flash, { opacity: 1 - ease.outCubic(seg(t, CUE.app, CUE.app + 0.3)) });
    put(this.win, { transform: `translate(${-APP.w / 2}px, ${-APP.h / 2}px)` });

    // The prompt: typed, sent, risen into the thread.
    const text = typed(PROMPT, t, CUE.type[0], PROMPT.length / (CUE.type[1] - CUE.type[0]));
    const sent = t >= CUE.send;
    this.typedEl.textContent = sent ? "" : text;
    put(this.placeholder, { display: text.length === 0 || sent ? "inline" : "none" });
    put(this.caret, { opacity: !sent && Math.floor(t * 4) % 2 === 0 ? 1 : 0 });
    const rise = ease.outCubic(seg(t, CUE.send, CUE.send + 0.22));
    put(this.bubble, { opacity: rise, transform: `translateY(${lerp(40, 0, rise).toFixed(1)}px)` });

    // The agent works; its clock races; the steps tick in.
    const doneNow = t >= CUE.done;
    const workIn = ease.outCubic(seg(t, CUE.work, CUE.work + 0.22));
    put(this.worked, { opacity: workIn, transform: `translateY(${lerp(24, 0, workIn).toFixed(1)}px)` });
    const elapsed = WORKED * seg(t, CUE.work, CUE.done);
    this.clock.textContent = clock(elapsed);
    this.headText.textContent = doneNow ? `Worked for ${WORKED}s` : "Working…";
    put(this.clock, { display: doneNow ? "none" : "inline-block" });
    put(this.spin, { display: doneNow ? "none" : "inline-block", transform: `rotate(${(t * 720).toFixed(1)}deg)` });
    this.steps.forEach((step, i) => {
      const p = ease.outCubic(seg(t, CUE.steps[i], CUE.steps[i] + 0.18));
      put(step, { opacity: p, transform: `translateX(${lerp(-16, 0, p).toFixed(1)}px)` });
    });
    this.testNote.textContent = doneNow ? "12 passed" : "running…";
    this.agentsEm.textContent = t >= CUE.work && !doneNow ? "1 working" : "";
    this.changesEm.textContent = doneNow ? "4" : t >= CUE.steps[1] ? "3" : "0";
    const replyIn = ease.outCubic(seg(t, CUE.done + 0.05, CUE.done + 0.25));
    put(this.reply, { opacity: replyIn, transform: `translateY(${lerp(18, 0, replyIn).toFixed(1)}px)` });
    const undoIn = ease.outCubic(seg(t, CUE.done + 0.2, CUE.done + 0.4));
    put(this.undo, { opacity: undoIn, transform: `translateY(${lerp(18, 0, undoIn).toFixed(1)}px)` });

    // Preview: a shimmer while it builds, then the habit tracker springs in.
    put(this.skel, { opacity: 1 - seg(t, CUE.done, CUE.done + 0.1), "--shim": `${(((t * 90) % 160) - 30).toFixed(1)}%` });
    const pop = t < CUE.done ? 0 : spring(t - CUE.done, 260, 18);
    put(this.appUi, { opacity: seg(t, CUE.done, CUE.done + 0.08), transform: `scale(${lerp(0.9, 1, pop).toFixed(4)})` });
    this.checks.forEach((check, i) => check.classList.toggle("on", t >= CUE.done + 0.2 + i * 0.12 && i !== 1));

    // The card slides in; the money pops off it and flies home to the sidebar.
    const slide = t < CUE.card ? 0 : spring(t - CUE.card, 240, 21);
    const ping = seg(t, CUE.earn, CUE.earn + 0.05) * (1 - seg(t, CUE.earn + 0.05, CUE.earn + 0.4));
    put(this.front, { "--ping": ping.toFixed(3) });
    const popIn = t < CUE.earn ? 0 : spring(t - CUE.earn, 340, 16);
    const fly = ease.inOutCubic(seg(t, CUE.fly[0], CUE.fly[1]));
    const from = { x: CORNER.x - 70, y: CORNER.y - 120, z: 40 };
    const px = lerp(from.x, EARN.x, fly);
    const py = lerp(from.y, EARN.y, fly) - 240 * Math.sin(Math.PI * fly);
    const pz = lerp(from.z, 12, fly) + 120 * Math.sin(Math.PI * fly);
    put(this.plus, {
      display: t >= CUE.earn && t < CUE.fly[1] + 0.04 ? "block" : "none",
      opacity: 1 - seg(t, CUE.fly[1] - 0.06, CUE.fly[1]),
      transform: `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, ${pz.toFixed(1)}px) scale(${(popIn * lerp(1, 0.35, fly)).toFixed(4)}) translate(-50%, -50%)`,
    });
    const landed = t >= CUE.fly[1];
    this.earn.textContent = money(landed ? 0.04 : 0);
    this.earn.classList.toggle("money", landed);
    put(this.earn, { "--hit": landed ? Math.exp(-(t - CUE.fly[1]) * 4).toFixed(3) : "0", transform: `scale(${landed ? (1 + 0.25 * Math.exp(-(t - CUE.fly[1]) * 7)).toFixed(4) : 1})` });

    // The lift and the flip; the crack; the split.
    const lift = ease.inOutCubic(seg(t, CUE.lift, CUE.lift + 0.45));
    const cx = lerp(CORNER.x + 460 * (1 - slide), CENTRE.x, lift);
    const cy = lerp(CORNER.y, CENTRE.y, lift);
    const cz = lerp(4, 600, lift);
    const flip = lerp(0, 180, ease.inOutCubic(seg(t, CUE.flip[0], CUE.flip[1])));
    const grow = lerp(1, GROW, lift) * (1 + 0.04 * seg(t, CUE.split, CUE.whipOut));
    put(this.card, {
      display: t >= CUE.card ? "block" : "none",
      opacity: seg(t, CUE.card, CUE.card + 0.06),
      transform: `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, ${cz.toFixed(1)}px) rotateY(${flip.toFixed(2)}deg) rotateX(${(lift * (1 - lift) * 34).toFixed(2)}deg) scale(${grow.toFixed(4)}) translate(${-CARD.w / 2}px, ${-CARD.h / 2}px)`,
    });
    put(this.crackPath, { "stroke-dashoffset": (140 * (1 - ease.outCubic(seg(t, CUE.crack, CUE.split)))).toFixed(1) });
    put(this.crack, { opacity: 1 - seg(t, CUE.split, CUE.split + 0.06) });
    put(this.cost, { opacity: 1 - seg(t, CUE.split - 0.04, CUE.split + 0.04), transform: `scale(${(1 + 0.15 * seg(t, CUE.split - 0.04, CUE.split + 0.04)).toFixed(3)})` });
    const apart = t < CUE.split ? 0 : spring(t - CUE.split, 210, 15);
    const split = t >= CUE.split;
    this.halfL.classList.toggle("split", split);
    this.halfR.classList.toggle("split", split);
    put(this.halfL, { transform: `translate3d(${(-34 * apart).toFixed(2)}px, 0, ${(10 * apart).toFixed(2)}px) rotateY(${(9 * apart).toFixed(2)}deg)` });
    put(this.halfR, { transform: `translate3d(${(34 * apart).toFixed(2)}px, 0, ${(-6 * apart).toFixed(2)}px) rotateY(${(-9 * apart).toFixed(2)}deg)` });
    const contents = ease.outCubic(seg(t, CUE.split + 0.04, CUE.split + 0.24));
    for (const el of [this.inL, this.inR]) put(el, { opacity: contents, transform: `scale(${lerp(0.7, 1, contents).toFixed(4)})` });

    // The window steps back into the dark as the money comes forward.
    put(this.win, { filter: lift > 0 ? `brightness(${lerp(1, 0.26, lift).toFixed(3)}) blur(${(lift * 5).toFixed(1)}px)` : "none" });
    for (const spark of this.sparks) {
      const since = t - CUE.split - spark.delay;
      const life = seg(since, 0, 0.9);
      const d = spark.v * ease.outCubic(life);
      put(spark.el, {
        display: since > 0 && life < 1 ? "block" : "none",
        opacity: 1 - life,
        transform: `translate3d(${(CENTRE.x + Math.cos(spark.a) * d).toFixed(1)}px, ${(CENTRE.y + Math.sin(spark.a) * d * 0.7).toFixed(1)}px, ${(cz + 40).toFixed(1)}px) scale(${spark.s.toFixed(3)})`,
      });
    }

    // The words.
    const lineIn = (el, from, exitAt, exitLen = 0.18) => {
      const words = [...el.querySelectorAll(".word")];
      words.forEach((word, i) => {
        const up = ease.outCubic(seg(t, from + i * 0.04, from + 0.24 + i * 0.04));
        const fall = ease.inCubic(seg(t, exitAt, exitAt + exitLen));
        put(word, { opacity: up * (1 - fall), transform: `translateY(${(lerp(40, 0, up) - fall * 24).toFixed(1)}px)`, filter: up < 1 || fall > 0 ? `blur(${((1 - up) * 10 + fall * 10).toFixed(1)}px)` : "none" });
      });
      put(el, { display: t >= from && t < exitAt + exitLen ? "block" : "none" });
    };
    lineIn(this.workingLine, CUE.work + 0.05, LINES.working.to, 0.15);
    lineIn(this.halfLine, CUE.split + 0.25, CUE.whipOut, 0.15);
    // "Get paid to wait." - each word slams down out of the lens.
    this.paidWords.forEach((word, i) => {
      const at = CUE.slam[i];
      const since = t - at;
      const land = since < 0 ? 0 : spring(since, 420, 24);
      const exit = ease.inCubic(seg(t, LINES.paid.to, LINES.paid.to + 0.2));
      put(word, {
        opacity: seg(t, at, at + 0.04) * (1 - exit),
        transform: `translateY(${(-exit * 30).toFixed(1)}px) scale(${lerp(2.2, 1, land).toFixed(4)})`,
        filter: since < 0.12 || exit > 0 ? `blur(${((1 - seg(since, 0, 0.12)) * 14 + exit * 12).toFixed(1)}px)` : "none",
      });
    });
    put(this.paidLine, { display: t >= CUE.slam[0] && t < LINES.paid.to + 0.2 ? "block" : "none" });
    put(this.topScrim, { opacity: Math.max(seg(t, CUE.work, CUE.work + 0.2) * (1 - seg(t, CUE.wide, CUE.wide + 0.3)), seg(t, CUE.slam[0] - 0.1, CUE.slam[0]) * (1 - seg(t, LINES.paid.to, LINES.paid.to + 0.3))) });
    put(this.bottomScrim, { opacity: seg(t, CUE.split, CUE.split + 0.3) });
  },
};
