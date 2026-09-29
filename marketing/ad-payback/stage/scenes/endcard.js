/**
 * 24–30 s. The end card, held long enough to read on a phone.
 *
 *   Free. No subscription.
 *   Windows & Linux
 *   [ adcode.bluethenics.com ]      - clicked, so it reads as the thing to do
 *   ──────────────
 *   ↻ Already have ADCode? Update to 2.1.1
 *
 * The URL and version come from render.mjs, so re-rendering for a new release is one flag.
 */
import { CUE } from "../cues.js";
import { ease, h, lerp, put, seg, tf } from "../engine.js";
import { icon, pointer } from "../ui.js";

export const endcard = {
  id: "endcard",
  from: CUE.end,
  to: 30.1,
  mount(root, settings) {
    this.free = h("div", { class: "end-free", text: "Free. No subscription." });
    this.platforms = h("div", { class: "end-platforms", text: "Windows & Linux" });
    this.shine = h("span", { class: "end-shine" });
    this.pill = h("div", { class: "end-pill" }, this.shine, icon("download", 30), h("span", { text: settings.url }));
    this.rule = h("div", { class: "end-rule" });
    this.spinner = h("span", { class: "end-refresh" }, icon("refresh", 30));
    this.update = h("div", { class: "end-update" }, this.spinner,
      h("span", { class: "end-update-ask", text: "Already have ADCode?" }),
      h("b", { text: `Update to ${settings.version}` }));
    this.cursor = h("div", { class: "end-cursor" }, pointer());
    this.items = [this.free, this.platforms, this.pill, this.rule, this.update];
    root.append(...this.items, this.cursor);
  },
  draw(t) {
    this.items.forEach((item, i) => {
      const rise = ease.outCubic(seg(t, CUE.endLines[i], CUE.endLines[i] + 0.45));
      if (item === this.rule) put(item, { transform: `scaleX(${ease.inOutCubic(seg(t, CUE.endLines[i], CUE.endLines[i] + 0.5)).toFixed(4)})` });
      else put(item, { transform: tf({ y: lerp(30, 0, rise) }), opacity: rise });
    });

    // The URL is the thing to do: a shine across it, then a click.
    const sweep = seg(t, CUE.endLines[2] + 0.1, CUE.endLines[2] + 0.75);
    put(this.shine, { transform: tf({ x: lerp(-260, 820, ease.inOutCubic(sweep)) }), opacity: sweep > 0 && sweep < 1 ? 1 : 0 });
    const press = seg(t, CUE.click, CUE.click + 0.16);
    const pressed = Math.sin(press * Math.PI);
    put(this.pill, { "--press": pressed.toFixed(3) });
    put(this.pill, { transform: tf({ y: lerp(30, 0, ease.outCubic(seg(t, CUE.endLines[2], CUE.endLines[2] + 0.45))), s: 1 - 0.035 * pressed }) });

    const approach = ease.inOutCubic(seg(t, CUE.endLines[2] - 0.05, CUE.click - 0.04));
    const leave = ease.inCubic(seg(t, CUE.click + 0.2, CUE.click + 0.8));
    const target = { x: 690, y: 760 };
    put(this.cursor, {
      transform: tf({ x: lerp(target.x + 300, target.x, approach) + 320 * leave, y: lerp(target.y + 260, target.y, approach) + 300 * leave, s: 1 - 0.12 * pressed }),
      opacity: t > CUE.endLines[2] - 0.05 && t < CUE.click + 0.8 ? 1 : 0,
    });

    put(this.spinner, { transform: `rotate(${(360 * ease.inOutCubic(seg(t, CUE.endLines[4], CUE.endLines[4] + 0.9))).toFixed(2)}deg)` });
  },
};
