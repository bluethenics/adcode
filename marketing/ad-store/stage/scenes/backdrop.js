/**
 * 0–20 s, under everything. A floor of grid lines running away into the dark, the way the
 * reference sets its technical scenes, drifting toward the camera at a constant speed so
 * cuts between scenes never stop the world moving. A breath of money light sits behind the
 * centre and swells on the money beats.
 */
import { CUE, DURATION } from "../cues.js";
import { h, put } from "../shared/engine.js";

const pulse = (t, at, width = 0.6) => (t < at ? 0 : Math.exp(-(t - at) / width));

export const backdrop = {
  id: "backdrop",
  from: 0,
  to: DURATION,
  mount(root) {
    this.floor = h("div", { class: "floor" });
    this.glow = h("div", { class: "glow" });
    root.append(h("div", { class: "backdrop" }), this.glow, this.floor);
  },
  draw(t) {
    // 120 px a cell, one cell a beat: the floor moves on the music.
    put(this.floor, {
      transform: `perspective(900px) rotateX(74deg) translateY(${((t * 240) % 120).toFixed(2)}px)`,
      opacity: 0.55,
    });
    const money = Math.max(pulse(t, CUE.earn), pulse(t, CUE.count[1], 0.9), pulse(t, CUE.split, 1.2), pulse(t, CUE.dollar, 1.4));
    put(this.glow, { opacity: 0.1 + 0.35 * money, transform: `scale(${(1 + 0.15 * money).toFixed(3)})` });
  },
};
