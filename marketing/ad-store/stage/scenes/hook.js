/**
 * 0–2.1 s. The hook, finished on frame 0: a feed shows the first frame as the thumbnail, so
 * the offer is already on screen, readable and sharp, before anything moves.
 *
 * "Get paid to code." in heavy type, "paid" in money light. Under it a rule draws itself in
 * green with a spark at its tip, the reference's glowing line. A slow push the whole time;
 * then the line punches through the camera into the flash that opens the next scene.
 */
import { CUE, LINES } from "../cues.js";
import { ease, h, lerp, put, seg } from "../shared/engine.js";
import { drift } from "../fx.js";

export const hook = {
  id: "hook",
  from: 0,
  to: CUE.flash1 + 0.08,
  mount(root) {
    const words = LINES.hook.text.split(" "); // Get paid to code.
    this.title = h("div", { class: "hook-title" },
      h("span", { text: `${words[0]} ` }), h("span", { class: "money", text: words[1] }), h("br"),
      h("span", { text: `${words[2]} ${words[3]}` }));
    this.kicker = h("div", { class: "kicker" }, h("i"), h("span", { text: LINES.kicker.text }));
    this.fill = h("div", { class: "fill" });
    this.spark = h("div", { class: "spark" });
    this.rule = h("div", { class: "hook-rule" }, h("div", { class: "track" }), this.fill, this.spark);
    this.group = h("div", { class: "layer hook" }, this.kicker, this.title, this.rule);
    root.append(h("div", { class: "center" }, this.group));
  },
  draw(t) {
    const d = drift(t, 1, 3);
    // The push: gentle while it reads, then a punch through the lens into the flash.
    const push = 1 + 0.05 * ease.outCubic(seg(t, 0, CUE.hookOut));
    const punch = ease.inExpo(seg(t, CUE.hookOut, CUE.flash1));
    const scale = push * lerp(1, 2.4, punch);
    put(this.group, {
      transform: `translate(${d.x.toFixed(2)}px, ${d.y.toFixed(2)}px) rotate(${d.r.toFixed(3)}deg) scale(${scale.toFixed(4)})`,
      opacity: 1 - seg(t, CUE.flash1 - 0.12, CUE.flash1 + 0.04),
      filter: punch > 0.02 ? `blur(${(punch * 18).toFixed(1)}px)` : "none",
    });

    // The rule draws itself; the spark rides its tip and fades when it lands.
    const draw = ease.inOutCubic(seg(t, CUE.hookLine[0], CUE.hookLine[1]));
    put(this.fill, { transform: `scaleX(${draw.toFixed(4)})` });
    const width = this.rule.offsetWidth || 900;
    put(this.spark, {
      left: `${(draw * width).toFixed(1)}px`,
      opacity: (1 - seg(t, CUE.hookLine[1], CUE.hookLine[1] + 0.35)) * Math.min(1, draw * 8),
      transform: `scale(${(1 + 0.25 * Math.sin(t * 40)).toFixed(3)})`,
    });
  },
};
