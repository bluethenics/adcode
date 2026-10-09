/**
 * 0–16.5 s. The small print, over every frame: every money claim in the spot needs it, and
 * a claim is on screen from the first second.
 */
import { DURATION, LINES } from "../cues.js";
import { h } from "../shared/engine.js";

export const hud = {
  id: "hud",
  from: 0,
  to: DURATION,
  mount(root) {
    root.append(h("div", { class: "small", text: LINES.small.text }));
  },
  draw() {},
};
