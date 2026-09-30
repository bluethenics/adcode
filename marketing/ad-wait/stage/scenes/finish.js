/** The last layer, over everything: a soft vignette that makes the frame feel filmed. */
import { DURATION } from "../cues.js";
import { h } from "../shared/engine.js";

export const finish = {
  id: "finish",
  from: 0,
  to: DURATION + 0.1,
  mount(root) {
    root.append(h("div", { class: "vignette" }));
  },
  draw() {},
};
