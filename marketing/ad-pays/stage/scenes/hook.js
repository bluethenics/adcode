/**
 * 0–1.5 s. The hook - the only part of the ad that differs between the three files.
 *
 * Frame 0 is the poster X shows before anything plays, so the hook is already finished
 * there: the line set as large as the square allows, its money words in money green, and
 * under it the earnings chip, ticking. Nothing is revealed; things only move. At CUE.flyOut
 * the words rush past the camera and the chip flies up into the title bar of the next shot,
 * where the product scene picks it up at exactly that size and place.
 */
import { CUE, HOOKS, W } from "../cues.js";
import { ease, h, lerp, put, seg } from "../shared/engine.js";
import { markInline } from "../shared/ui.js";
import { Dust, noise1 } from "../fx.js";
import { earningsChip } from "./chip.js";
import { CHIP_LANDING } from "./product.js";

/** Widest the hook may be: at its fullest push it still clears the 5% safe margin. */
const MAX_TEXT = 900;
const BIG = 2.6;

export const hook = {
  id: "hook",
  from: 0,
  to: CUE.product,
  mount(root, settings) {
    const spec = HOOKS[settings.hook - 1];
    root.append(h("div", { class: "hook-bg" }));
    this.dust = new Dust(root, 70, 5);
    this.lines = spec.lines.map((line, i) => h("div", { class: `hook-line${i === spec.money ? " money" : ""}`, text: line }));
    this.text = h("div", { class: "hook-text" }, this.lines);
    this.chip = earningsChip();
    this.chipWrap = h("div", { class: "hook-chip" }, this.chip.el);
    this.brand = h("div", { class: "hook-brand" }, markInline(30), h("span", { text: "ADCode" }));
    root.append(this.text, this.chipWrap, this.brand);
  },

  draw(t) {
    if (this.size === undefined) {
      // One size for every line - the largest at which the longest line still fits.
      const probe = 170;
      for (const line of this.lines) line.style.fontSize = `${probe}px`;
      const widest = Math.max(...this.lines.map((line) => line.offsetWidth));
      this.size = Math.min(probe, Math.floor((probe * MAX_TEXT) / widest));
      for (const line of this.lines) line.style.fontSize = `${this.size}px`;
      this.chipW = this.chip.el.offsetWidth;
      this.chipH = this.chip.el.offsetHeight;
    }
    this.dust.draw(t, { focus: 1.3, alpha: 0.6 });

    // The words: a slow push, a breath of drift, then out through the lens.
    const push = 1 + 0.045 * seg(t, 0, CUE.flyOut);
    const out = ease.inExpo(seg(t, CUE.flyOut, CUE.product));
    put(this.text, {
      transform: `translate(${(noise1(t * 0.7, 2) * 4).toFixed(1)}px, ${(-60 + noise1(t * 0.6, 3) * 3).toFixed(1)}px) scale(${(push * lerp(1, 3.4, out)).toFixed(4)})`,
      opacity: 1 - seg(t, CUE.flyOut + 0.08, CUE.product - 0.02),
      filter: out > 0.01 ? `blur(${(out * 22).toFixed(1)}px)` : "none",
    });
    put(this.brand, { opacity: 1 - seg(t, CUE.flyOut, CUE.flyOut + 0.1) });

    // The chip: ticking under the words, then up into the title bar.
    this.chip.draw(t);
    const fly = ease.inOutCubic(seg(t, CUE.flyOut, CUE.product));
    const from = { x: W / 2, y: 790, s: BIG };
    const x = lerp(from.x, CHIP_LANDING.x, fly);
    const y = lerp(from.y, CHIP_LANDING.y, fly) - Math.sin(fly * Math.PI) * 60;
    const s = Math.exp(lerp(Math.log(from.s), Math.log(CHIP_LANDING.s), fly));
    put(this.chipWrap, { transform: `translate(${(x - this.chipW / 2).toFixed(1)}px, ${(y - this.chipH / 2).toFixed(1)}px) scale(${s.toFixed(4)})` });
  },
};
