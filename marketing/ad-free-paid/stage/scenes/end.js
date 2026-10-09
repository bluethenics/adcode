/**
 * 13–16.5 s. The mark, and the end card.
 *
 * The point of money-light the dive left rises and swells into the `$`; the brackets race in
 * from both sides and clamp around it on CUE.dollar - a ring of light, a jolt. "ADCode"
 * gathers from wide-spaced letters, then "Get paid to wait." Then the lockup rises and the
 * end card settles under it, and holds: the offer, the platforms, the address, and the one
 * line that says where the AI comes from.
 */
import { CUE, DURATION, LINES } from "../cues.js";
import { ease, h, lerp, put, seg, spring } from "../shared/engine.js";
import { icon, markParts } from "../shared/ui.js";
import { Dust, letterSpans, noise1 } from "../fx.js";

/** Where the mark's centre sits before the lockup rises: the point travels up to it. */
const MARK_Y = 342;

export const end = {
  id: "end",
  from: CUE.mark,
  to: DURATION,
  mount(root, settings) {
    root.append(h("div", { class: "mark-bg" }));
    this.dust = new Dust(root, 90, 31);
    this.point = h("div", { class: "money-point" });
    this.parts = markParts();
    this.parts.dollar.classList.add("money");
    this.ring = h("div", { class: "mark-ring" });
    this.bloom = h("div", { class: "mark-bloom" });
    this.markBox = h("div", { class: "mark-box" }, this.bloom, this.ring, this.parts.left, this.parts.right, this.parts.dollar);
    this.letters = letterSpans(LINES.brand.text, "brand-letter");
    this.brand = h("div", { class: "brand" }, this.letters);
    // "Get paid to wait." - with "paid" in money green, as it slammed in earlier.
    this.tagline = h("div", { class: "tagline" }, LINES.tagline.text.split(" ").flatMap((word, i) => [i ? " " : null, h("span", { class: word === "paid" ? "money" : "", text: word })]).filter(Boolean));
    this.lockup = h("div", { class: "lockup" }, this.markBox, this.brand, this.tagline);
    this.free = h("div", { class: "end-free", text: LINES.free.text });
    this.platforms = h("div", { class: "end-platforms", text: LINES.platforms.text });
    this.url = h("div", { class: "end-url" }, icon("download", 28), h("span", { text: settings.url }));
    this.key = h("div", { class: "end-key", text: LINES.key.text });
    this.end = h("div", { class: "end" }, this.free, this.platforms, this.url, this.key);
    root.append(this.lockup, this.point, this.end, h("div", { class: "vignette" }));
  },

  draw(t) {
    this.dust.draw(t, { focus: 1.2, alpha: 0.45 * seg(t, CUE.mark, CUE.mark + 0.6), pan: { x: t * 6, y: 0 } });

    // The point rises to where the mark will be and swells into the $.
    const travel = ease.inOutCubic(seg(t, CUE.mark, CUE.mark + 0.3));
    const pointOn = 1 - seg(t, CUE.dollar - 0.12, CUE.dollar + 0.04);
    put(this.point, { opacity: pointOn, top: `${lerp(540, MARK_Y, travel).toFixed(1)}px`, transform: `scale(${lerp(1, 1.7, seg(t, CUE.mark, CUE.dollar)).toFixed(3)})` });
    const swell = t < CUE.mark + 0.14 ? 0 : spring(t - CUE.mark - 0.14, 220, 15);
    put(this.parts.dollar, { opacity: seg(t, CUE.mark + 0.14, CUE.mark + 0.2), transform: `scale(${swell.toFixed(4)})` });

    // The brackets race in and land on the beat.
    const race = ease.inCubic(seg(t, CUE.dollar - 0.26, CUE.dollar));
    const settle = t < CUE.dollar ? 0 : Math.exp(-(t - CUE.dollar) * 9) * Math.sin((t - CUE.dollar) * 40);
    const gap = lerp(800, 0, race) - settle * 16;
    put(this.parts.left, { opacity: seg(t, CUE.dollar - 0.26, CUE.dollar - 0.2), transform: `translateX(${(-gap).toFixed(1)}px)` });
    put(this.parts.right, { opacity: seg(t, CUE.dollar - 0.26, CUE.dollar - 0.2), transform: `translateX(${gap.toFixed(1)}px)` });
    const hit = seg(t, CUE.dollar, CUE.dollar + 0.7);
    put(this.ring, { opacity: t < CUE.dollar ? 0 : (1 - hit) * 0.9, transform: `scale(${(0.6 + ease.outCubic(hit) * 2.4).toFixed(3)})` });
    const bloom = t < CUE.dollar ? 0.25 * seg(t, CUE.mark + 0.14, CUE.dollar) : Math.max(0.35, 1.2 * Math.exp(-(t - CUE.dollar) * 3));
    put(this.bloom, { opacity: bloom });
    const jolt = t < CUE.dollar ? 0 : Math.exp(-(t - CUE.dollar) * 12);

    // "ADCode" gathers from wide-spaced letters; then the line under it.
    const gather = ease.outExpo(seg(t, CUE.wordmark, CUE.wordmark + 0.5));
    const n = this.letters.length;
    this.letters.forEach((letter, i) => {
      const off = (i - (n - 1) / 2) * lerp(120, 0, gather);
      const on = seg(t, CUE.wordmark + i * 0.03, CUE.wordmark + 0.15 + i * 0.03);
      put(letter, { opacity: on, transform: `translateX(${off.toFixed(1)}px)`, filter: gather < 0.98 ? `blur(${((1 - gather) * 14).toFixed(1)}px)` : "none" });
    });
    const tag = ease.outCubic(seg(t, CUE.tagline, CUE.tagline + 0.3));
    put(this.tagline, { opacity: tag, transform: `translateY(${lerp(20, 0, tag).toFixed(1)}px)` });

    // The lockup rises and steps back; the end card settles in under it.
    const rise = ease.inOutCubic(seg(t, CUE.end, CUE.end + 0.4));
    const push = 1 + 0.03 * seg(t, CUE.end, DURATION);
    put(this.lockup, {
      transform: `translate(${(noise1(t * 30, 3) * 10 * jolt).toFixed(1)}px, ${(lerp(0, -140, rise) + noise1(t * 30, 4) * 8 * jolt).toFixed(1)}px) scale(${(lerp(1, 0.76, rise) * push).toFixed(4)})`,
    });
    const line = (el, from) => {
      const p = ease.outCubic(seg(t, from - 0.3, from));
      put(el, { opacity: p, transform: `translateY(${lerp(24, 0, p).toFixed(1)}px)` });
    };
    line(this.free, LINES.free.from);
    line(this.platforms, LINES.platforms.from);
    line(this.url, LINES.url.from);
    line(this.key, LINES.key.from);
    put(this.end, { transform: `scale(${push.toFixed(4)})` });
  },
};
