/**
 * 6.95–10.6 s. The 50%, as the reference does its big numbers: a monospaced figure over a
 * ruler, glowing where the value has reached.
 *
 * It arrives on the whip from the window. "Your share of every ad" over a counter running
 * 00% → 50% while a green fill races along the ruler with a spark at its tip; at 50 the
 * figure turns money-green. On 8.5 the ruler breaks at its middle into two bars that spring
 * apart - YOU 50% in green, ADCODE 50% in grey - and "Half the ad money is yours." lands
 * under them. Then the camera pushes into the light of the next flash.
 */
import { CUE, LINES } from "../cues.js";
import { ease, h, lerp, put, seg, spring } from "../shared/engine.js";
import { drift, SIZE, SQUARE, wordSpans } from "../fx.js";

const RULER = SQUARE ? 900 : 1300;

export const fifty = {
  id: "fifty",
  from: CUE.whip + 0.08,
  to: CUE.flash2 + 0.08,
  mount(root) {
    this.label = h("div", { class: "share-label", text: LINES.share.text });
    this.counter = h("div", { class: "counter", text: "00%" });
    const ticks = [];
    for (let v = 0; v <= 100; v += 5) {
      const x = (v / 100) * RULER;
      ticks.push(h("div", { class: `tick${v % 10 === 0 ? " major" : ""}`, style: { left: `${x}px` } }));
      if (v % 10 === 0) ticks.push(h("div", { class: "num", text: String(v), style: { left: `${x}px` } }));
    }
    this.fill = h("div", { class: "fill", style: { width: `${RULER}px` } });
    this.spark = h("div", { class: "spark" });
    this.ruler = h("div", { class: "ruler" }, h("div", { class: "base" }), ...ticks, this.fill, this.spark);
    this.you = h("div", { class: "half you" });
    this.us = h("div", { class: "half us" });
    this.youLabel = h("div", { class: "half-label you", text: "YOU · 50%" });
    this.usLabel = h("div", { class: "half-label us", text: "ADCODE · 50%" });
    this.halves = h("div", { class: "halves" }, this.you, this.us, this.youLabel, this.usLabel);
    this.halfLine = h("div", { class: "half-line" }, wordSpans(LINES.half.text));
    this.group = h("div", { class: "layer" }, this.label, this.counter, this.ruler, this.halves, this.halfLine);
    root.append(h("div", { class: "center" }, this.group));
  },
  draw(t) {
    // Arrive on the whip, drift, then push into the flash.
    const arrive = ease.outExpo(seg(t, CUE.whip + 0.08, CUE.fifty + 0.3));
    const push = ease.inCubic(seg(t, CUE.flash2 - 0.35, CUE.flash2));
    const d = drift(t, 1, 21);
    const scale = (1 + 0.04 * seg(t, CUE.fifty, CUE.flash2 - 0.35)) * lerp(1, 1.35, push);
    put(this.group, {
      transform: `translate(${(lerp(SIZE.w * 1.3, 0, arrive) + d.x).toFixed(1)}px, ${d.y.toFixed(1)}px) rotate(${d.r.toFixed(3)}deg) scale(${scale.toFixed(4)})`,
      opacity: 1 - seg(t, CUE.flash2 - 0.06, CUE.flash2 + 0.04),
    });

    // The count, eased so it slows into the 50.
    const p = ease.outCubic(seg(t, CUE.count[0], CUE.count[1]));
    const value = Math.round(50 * p);
    this.counter.textContent = `${String(value).padStart(2, "0")}%`;
    const reached = t >= CUE.count[1];
    const ring = reached ? Math.exp(-(t - CUE.count[1]) * 2.5) : 0;
    put(this.counter, {
      color: reached ? "var(--money)" : "var(--text)",
      textShadow: reached ? `0 0 ${(40 + 80 * ring).toFixed(0)}px var(--money-glow)` : "none",
      transform: `translate(-50%, -54%) scale(${(1 + 0.06 * ring).toFixed(4)})`,
    });
    put(this.label, { opacity: seg(t, CUE.fifty, CUE.fifty + 0.25), transform: "translate(-50%, " + (SQUARE ? -320 : -330) + "px)" });

    // The ruler fills with the count; at the split it hands over to the two bars.
    const handover = seg(t, CUE.split, CUE.split + 0.12);
    put(this.fill, { transform: `scaleX(${(value / 100).toFixed(4)})` });
    put(this.spark, { left: `${((value / 100) * RULER).toFixed(1)}px`, opacity: (1 - seg(t, CUE.count[1], CUE.count[1] + 0.4)) * (p > 0 ? 1 : 0) });
    put(this.ruler, { opacity: 1 - handover });
    const apart = t < CUE.split ? 0 : spring(t - CUE.split, 160, 13);
    const gap = 26 * apart;
    put(this.halves, { opacity: handover });
    put(this.you, { transform: `translateX(${(-gap).toFixed(1)}px) scaleY(${lerp(0.18, 1, Math.min(1, apart)).toFixed(3)})` });
    put(this.us, { transform: `translateX(${gap.toFixed(1)}px) scaleY(${lerp(0.18, 1, Math.min(1, apart)).toFixed(3)})` });
    const labels = ease.outCubic(seg(t, CUE.split + 0.1, CUE.split + 0.4));
    put(this.youLabel, { opacity: labels, transform: `translate(${(-gap).toFixed(1)}px, ${lerp(14, 0, labels).toFixed(1)}px)` });
    put(this.usLabel, { opacity: labels, transform: `translate(${gap.toFixed(1)}px, ${lerp(14, 0, labels).toFixed(1)}px)` });

    this.halfLine.querySelectorAll(".word").forEach((word, i) => {
      const at = LINES.half.from - 0.3 + i * 0.05;
      const q = ease.outCubic(seg(t, at, at + 0.35));
      put(word, { opacity: q, transform: `translateY(${lerp(34, 0, q).toFixed(1)}px)`, filter: q < 0.98 ? `blur(${((1 - q) * 10).toFixed(1)}px)` : "none" });
    });
  },
};
