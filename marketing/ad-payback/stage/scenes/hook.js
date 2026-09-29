/**
 * 0–2 s. "8 hours a day in your editor."
 *
 * Frame 0 already reads in full - it is the thumbnail, and a feed decides in a second.
 * Behind it a workday of code races past and a clock runs 09:00 to 17:00. At 2.0 the whole
 * layer tips away like a page, handing over to the flip.
 */
import { CUE } from "../cues.js";
import { codeRows, HABITS_JS } from "../code.js";
import { ease, h, lerp, put, seg, tf } from "../engine.js";

const LINE_HEIGHT = 36;

export const hook = {
  id: "hook",
  from: 0,
  to: 2.4,
  mount(root) {
    const lines = HABITS_JS.split("\n").length;
    this.blockHeight = lines * LINE_HEIGHT;
    this.river = h("div", { class: "hook-river" },
      [0, 1, 2, 3].map((copy) => codeRows(HABITS_JS, 1204 + copy * lines)));
    this.time = h("span", { class: "hook-time", text: "09:00" });
    this.fill = h("span", { class: "hook-fill" });
    this.lines = ["8 hours", "a day in", "your editor."].map((text) => h("div", { class: "hook-line", text }));
    this.title = h("div", { class: "hook-title" }, this.lines);
    this.layer = h("div", { class: "hook-layer" },
      this.river,
      h("div", { class: "hook-shade" }),
      h("div", { class: "hook-clock" }, this.time, h("span", { class: "hook-bar" }, this.fill)),
      this.title);
    root.append(this.layer);
  },
  draw(t) {
    // A workday of code: fast, and getting faster.
    const scroll = (t * 560 + t * t * 160) % this.blockHeight;
    put(this.river, { transform: tf({ y: -scroll }) });

    const day = ease.inOutCubic(seg(t, 0, 1.85));
    const minutes = Math.round(lerp(9 * 60, 17 * 60, day));
    this.time.textContent = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    put(this.fill, { transform: `scaleX(${day.toFixed(4)})` });

    // The headline pushes in slowly; "8 hours" kicks on the beat.
    put(this.title, { transform: tf({ s: lerp(1, 1.045, ease.outCubic(seg(t, 0, 2))) }) });
    const since = t - CUE.hookPulse;
    const kick = since < 0 ? 1 : 1 + 0.07 * Math.exp(-since * 7) * Math.cos(since * 16);
    put(this.lines[0], { transform: tf({ s: kick }) });

    // Tip away from the bottom edge, like a page turning back - gone by the time the
    // brackets arrive, starting a touch early so the whoosh on 2.0 lands mid-turn.
    const fold = ease.inCubic(seg(t, CUE.fold - 0.1, CUE.fold + 0.18));
    put(this.layer, {
      transform: `perspective(1400px) rotateX(${(fold * 86).toFixed(2)}deg) translateZ(${(-fold * 240).toFixed(1)}px)`,
      opacity: 1 - fold * 0.85,
    });
  },
};
