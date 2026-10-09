/**
 * 18.1–22.5 s. The mark, and the end card.
 *
 * The green 50% collapses to a point of money-light; the point swells into the `$`, and the
 * brackets race in from both sides and clamp around it on CUE.dollar - a ring of light, a
 * jolt. "ADCode" gathers from wide-spaced letters beneath it, the way the reference builds
 * its logotype, then "Earn while you code." Then the lockup rises and the end card
 * settles: "Free. No subscription." · Windows & Linux · the address. Held to the end.
 */
import { CUE, DURATION, LINES } from "../cues.js";
import { ease, h, lerp, put, seg, spring } from "../shared/engine.js";
import { icon, markParts } from "../shared/ui.js";
import { Dust, letterSpans, noise1, wordSpans } from "../fx.js";

const MARK = 300;

export const mark = {
  id: "mark",
  from: CUE.mark,
  to: DURATION,
  mount(root, settings) {
    root.append(h("div", { class: "mark-bg" }));
    this.dust = new Dust(root, 90, 31);
    // The card's back, as the flip left it, so the cut into this scene does not jump.
    this.cardBack = h("div", { class: "mark-card" });
    // And the line under it, and the glow behind it, fading as the money collapses.
    this.halfLine = h("div", { class: "p-line half" }, wordSpans(LINES.half.text));
    this.fromGlow = h("div", { class: "product-bg" });
    this.fifty = h("div", { class: "mark-fifty fifty", text: LINES.fifty.text });
    this.point = h("div", { class: "money-point" });
    this.parts = markParts();
    this.parts.dollar.classList.add("money");
    this.ring = h("div", { class: "mark-ring" });
    this.bloom = h("div", { class: "mark-bloom" });
    this.markBox = h("div", { class: "mark-box" }, this.bloom, this.ring, this.parts.left, this.parts.right, this.parts.dollar);
    this.letters = letterSpans(LINES.brand.text, "brand-letter");
    this.brand = h("div", { class: "brand" }, this.letters);
    this.tagline = h("div", { class: "tagline", text: LINES.tagline.text });
    this.lockup = h("div", { class: "lockup" }, this.markBox, this.brand, this.tagline);
    this.free = h("div", { class: "end-free", text: LINES.free.text });
    this.platforms = h("div", { class: "end-platforms", text: LINES.platforms.text });
    this.url = h("div", { class: "end-url" }, icon("download", 26), h("span", { text: settings.url }));
    this.end = h("div", { class: "end" }, this.free, this.platforms, this.url);
    root.insertBefore(this.fromGlow, this.dust.canvas);
    root.append(this.halfLine, this.cardBack, this.fifty, this.point, this.lockup, this.end, h("div", { class: "vignette" }));
  },

  draw(t) {
    this.dust.draw(t, { focus: 1.2, alpha: 0.45 * seg(t, CUE.mark, CUE.mark + 0.6), pan: { x: t * 6, y: 0 } });

    // The 50% collapses into a point of green light.
    const collapse = ease.inExpo(seg(t, CUE.mark, CUE.mark + 0.14));
    put(this.fifty, { opacity: 1 - seg(t, CUE.mark + 0.1, CUE.mark + 0.14), transform: `translate(-50%, -50%) scale(${lerp(2.39, 0.05, collapse).toFixed(4)})` });
    put(this.fromGlow, { opacity: 1 - seg(t, CUE.mark, CUE.mark + 0.6) });
    put(this.halfLine, { opacity: 1 - seg(t, CUE.mark, CUE.mark + 0.15), filter: `blur(${(seg(t, CUE.mark, CUE.mark + 0.15) * 10).toFixed(1)}px)` });
    put(this.cardBack, { opacity: 1 - seg(t, CUE.mark, CUE.mark + 0.1), transform: `translate(-50%, -50%) scale(${lerp(1, 0.2, collapse).toFixed(4)})` });
    const pointOn = seg(t, CUE.mark + 0.08, CUE.mark + 0.13) * (1 - seg(t, CUE.dollar - 0.1, CUE.dollar + 0.05));
    put(this.point, { opacity: pointOn, transform: `translate(-50%, -50%) scale(${lerp(0.4, 1.6, seg(t, CUE.mark + 0.1, CUE.dollar)).toFixed(3)})` });

    // The $ swells from the point; the brackets race in and land on CUE.dollar.
    const swell = t < CUE.mark + 0.14 ? 0 : spring(t - CUE.mark - 0.14, 220, 15);
    put(this.parts.dollar, { opacity: seg(t, CUE.mark + 0.14, CUE.mark + 0.2), transform: `scale(${swell.toFixed(4)})` });
    const race = ease.inCubic(seg(t, CUE.dollar - 0.26, CUE.dollar));
    const settle = t < CUE.dollar ? 0 : Math.exp(-(t - CUE.dollar) * 9) * Math.sin((t - CUE.dollar) * 40);
    const gap = lerp(1100, 0, race) - settle * 18;
    put(this.parts.left, { opacity: seg(t, CUE.dollar - 0.26, CUE.dollar - 0.2), transform: `translateX(${(-gap).toFixed(1)}px)` });
    put(this.parts.right, { opacity: seg(t, CUE.dollar - 0.26, CUE.dollar - 0.2), transform: `translateX(${gap.toFixed(1)}px)` });
    const hit = seg(t, CUE.dollar, CUE.dollar + 0.7);
    put(this.ring, { opacity: t < CUE.dollar ? 0 : (1 - hit) * 0.9, transform: `scale(${(0.6 + ease.outCubic(hit) * 2.4).toFixed(3)})` });
    const bloom = t < CUE.dollar ? 0.25 * seg(t, CUE.mark + 0.14, CUE.dollar) : Math.max(0.35, 1.2 * Math.exp(-(t - CUE.dollar) * 3));
    put(this.bloom, { opacity: bloom });
    const jolt = t < CUE.dollar ? 0 : Math.exp(-(t - CUE.dollar) * 12);

    // "ADCode", gathering from wide-spaced letters; then the line under it.
    const gather = ease.outExpo(seg(t, CUE.wordmark, CUE.wordmark + 0.55));
    const n = this.letters.length;
    this.letters.forEach((letter, i) => {
      const off = (i - (n - 1) / 2) * lerp(150, 0, gather);
      const on = seg(t, CUE.wordmark + i * 0.03, CUE.wordmark + 0.15 + i * 0.03);
      put(letter, { opacity: on, transform: `translateX(${off.toFixed(1)}px)`, filter: gather < 0.98 ? `blur(${((1 - gather) * 14).toFixed(1)}px)` : "none" });
    });
    const tag = ease.outCubic(seg(t, CUE.tagline, CUE.tagline + 0.35));
    put(this.tagline, { opacity: tag, transform: `translateY(${lerp(20, 0, tag).toFixed(1)}px)` });

    // The lockup rises to make room; the end card settles in under it.
    const rise = ease.inOutCubic(seg(t, CUE.end, CUE.end + 0.4));
    const push = 1 + 0.035 * seg(t, CUE.end, DURATION);
    put(this.lockup, {
      transform: `translate(${(noise1(t * 30, 3) * 10 * jolt).toFixed(1)}px, ${(lerp(0, -205, rise) + noise1(t * 30, 4) * 8 * jolt).toFixed(1)}px) scale(${(lerp(1, 0.74, rise) * push).toFixed(4)})`,
    });
    const line = (el, at) => {
      const p = ease.outCubic(seg(t, at, at + 0.35));
      put(el, { opacity: p, transform: `translateY(${lerp(26, 0, p).toFixed(1)}px)` });
    };
    line(this.free, LINES.free.from - 0.35);
    line(this.platforms, LINES.platforms.from - 0.35);
    line(this.url, LINES.url.from - 0.35);
    put(this.end, { transform: `scale(${push.toFixed(4)})` });
  },
};
