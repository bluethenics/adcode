/**
 * 0–4 s. The wait, as a run of hard cuts that get faster.
 *
 * Frame 0 already reads in full - it is the thumbnail, and a feed decides in a second: a
 * frozen spinner, "You're waiting.", and green money ticking up. Then the story in
 * one-second beats and shorter: the prompt, the spinner, a build stuck at 97%, a clock,
 * and "You wait." slammed three times, black then white. The last three cuts are a sixth
 * of a second each - "Every. Single. Build." - and the film goes dark on the fourth second.
 */
import { CUE, PROMPT, SHOTS } from "../cues.js";
import { ease, h, lerp, put, seg, tf, typed } from "../shared/engine.js";
import { icon, markInline } from "../shared/ui.js";

const range = Object.fromEntries(SHOTS.map((shot) => [shot.id, shot]));

/** A hit that rings out: x and y offsets, `amp` pixels at first, gone in a fraction of a second. */
export function shake(t, at, amp = 10, decay = 16) {
  if (t < at) return { x: 0, y: 0 };
  const k = Math.exp(-(t - at) * decay);
  return { x: Math.sin((t - at) * 97) * amp * k, y: Math.cos((t - at) * 83) * amp * k };
}

const minutes = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const caption = (text) => h("div", { class: "caption", text });

function ringSvg(className, arc, dash) {
  return h("svg", { class: className, viewBox: "0 0 880 880" },
    h("circle", { cx: 440, cy: 440, r: 420, class: "track" }),
    h("circle", { cx: 440, cy: 440, r: 420, class: "arc", "stroke-dasharray": dash, "stroke-dashoffset": 0, style: { transformOrigin: "440px 440px", transform: `rotate(${arc}deg)` } }));
}

const hook = {
  ...range.hook,
  mount(el) {
    this.ring = ringSvg("ring", -80, "760 1900");
    this.money = h("div", { class: "money-big", text: "+$0.01" });
    this.first = caption("You're waiting.");
    this.second = caption("It's paying.");
    el.append(this.ring, this.money, this.first, this.second,
      h("div", { class: "corner" }, markInline(46), h("span", { text: "ADCode" })),
      h("div", { class: "print", text: "Example amounts. Earnings vary." }));
  },
  draw(t) {
    const steps = CUE.ticks.filter((tick) => t >= tick).length;
    const since = t - CUE.ticks[Math.max(0, steps - 1)];
    this.money.textContent = `+$0.0${steps}`;
    const shove = shake(t, CUE.ticks[Math.max(0, steps - 1)], 7, 20);
    put(this.money, { transform: tf({ x: shove.x, y: shove.y, s: 1 + 0.13 * Math.exp(-since * 13) * Math.cos(since * 30) }) });
    put(this.ring, { transform: tf({ r: Math.sin(t * 61) * 0.7 }) });
    const swap = t >= 0.5;
    const rise = ease.outExpo(seg(t, 0.5, 0.64));
    put(this.first, { opacity: swap ? 0 : 1 });
    put(this.second, { opacity: swap ? 1 : 0, transform: tf({ y: lerp(34, 0, rise) }) });
  },
};

const prompt = {
  ...range.prompt,
  mount(el) {
    this.text = h("span", { text: "" });
    this.caret = h("span", { class: "composer-caret" });
    this.send = h("div", { class: "composer-send" }, icon("arrowUp", 46));
    el.append(caption("You hit enter."), h("div", { class: "composer" }, h("div", { class: "composer-text" }, this.text, this.caret), this.send));
  },
  draw(t) {
    this.text.textContent = typed(PROMPT, t, CUE.typeStart, PROMPT.length / (CUE.typeEnd - CUE.typeStart));
    put(this.caret, { opacity: t < CUE.send ? 1 : 0 });
    const sent = t >= CUE.send;
    const since = t - CUE.send;
    put(this.send, {
      background: sent ? "#fff" : "#2b2b2b",
      color: sent ? "#050505" : "#777",
      transform: tf({ s: sent ? 1 + 0.22 * Math.exp(-since * 16) * Math.cos(since * 30) : 1 }),
    });
  },
};

const think = {
  ...range.think,
  mount(el) {
    this.spinner = ringSvg("spinner", 0, "700 1940");
    this.time = h("div", { class: "spin-time", text: "0:12" });
    this.label = h("div", { class: "spin-label", text: "Thinking..." });
    el.append(caption("Then you wait."), this.spinner, this.time, this.label);
    this.arc = this.spinner.querySelector(".arc");
  },
  draw(t) {
    const local = t - this.from;
    this.arc.style.transform = `rotate(${(local * 760).toFixed(2)}deg)`;
    this.time.textContent = minutes(12 + Math.floor(local * 16));
    this.label.textContent = `Thinking${".".repeat(1 + (Math.floor(local * 9) % 3))}`;
  },
};

const bar = {
  ...range.bar,
  mount(el) {
    this.label = h("div", { class: "build-label", text: "Building... 58%" });
    this.fill = h("div", { class: "build-fill" });
    el.append(caption("Still waiting."), this.label, h("div", { class: "build-track" }, this.fill));
  },
  draw(t) {
    const local = t - this.from;
    const pct = Math.round(lerp(58, 97, ease.outCubic(seg(local, 0, 0.22))));
    const stuck = local > 0.24;
    put(this.fill, { transform: `scaleX(${(pct / 100).toFixed(3)})` });
    // Stuck: the number stutters, as if it is about to move and never does.
    this.label.textContent = `Building... ${pct}%`;
    put(this.label, { opacity: stuck && Math.floor(local * 20) % 2 === 1 ? 0.35 : 1 });
  },
};

const clock = {
  ...range.clock,
  mount(el) {
    this.clock = h("div", { class: "clock", text: "1:47" });
    el.append(caption("Again."), this.clock);
  },
  draw(t) {
    this.clock.textContent = minutes(107 + (t - this.from) * 420);
  },
};

/** A word or two, huge, on a black or a white card. */
function slam(id, className, lines, light = false) {
  return {
    ...range[id],
    light,
    mount(el) {
      this.word = h("div", { class: `slam ${className}` }, lines.map((line, i) => [i > 0 && h("br"), line]));
      el.append(this.word);
    },
    draw() {},
  };
}

const wait1 = slam("wait1", "w1", ["You wait."], true);
const wait2 = slam("wait2", "w2", ["You", "wait."]);
const wait3 = slam("wait3", "w3", ["wait."], true);
const every = slam("every", "word", ["Every."]);
const single = slam("single", "word", ["Single."], true);
const build = slam("build", "word", ["Build."]);

const SEQUENCE = [hook, prompt, think, bar, clock, wait1, wait2, wait3, every, single, build];

export const cuts = {
  id: "cuts",
  from: 0,
  to: CUE.silence,
  mount(root) {
    for (const shot of SEQUENCE) {
      shot.el = h("div", { class: `shot${shot.light ? " light" : ""}` });
      root.append(shot.el);
      shot.mount(shot.el);
    }
  },
  draw(t) {
    for (const shot of SEQUENCE) {
      const live = t >= shot.from && t < shot.to;
      shot.el.style.display = live ? "block" : "none";
      if (!live) continue;
      shot.draw(t);
      // Every cut lands with a small push, harder the shorter and blacker the shot.
      const local = t - shot.from;
      const punch = shot.id === "hook" ? 0 : 0.05 * Math.exp(-local * 30);
      put(shot.el, { transform: tf({ s: 1 + punch }) });
    }
  },
};
