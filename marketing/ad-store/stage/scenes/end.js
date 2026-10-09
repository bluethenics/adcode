/**
 * 16.0–20.0 s. Out of the dive, the end card.
 *
 * The cream plate that filled the frame is the app icon, pulling back: it shrinks to a
 * 220 px tile with the <$> mark. Its brackets ease apart and clamp back on 16.5 - a ring of
 * money light, a jolt. The tile rises; "ADCode" gathers from wide-spaced letters; "Get paid
 * to code." Then the call to action settles and holds: Free. No subscription. · the official
 * Get it from Microsoft badge · the address.
 */
import { CUE, DURATION, LINES } from "../cues.js";
import { ease, h, lerp, put, seg, spring } from "../shared/engine.js";
import { markParts } from "../shared/ui.js";
import { letterSpans, noise1, SQUARE } from "../fx.js";
import { DIVE, ICON } from "./store.js";

const PLATE = 220;

export const end = {
  id: "end",
  from: CUE.mark,
  to: DURATION,
  mount(root, settings) {
    this.parts = markParts();
    this.ring = h("div", { class: "ring" });
    this.bloom = h("div", { class: "bloom" });
    this.plate = h("div", { class: "end-plate" }, h("div", { class: "mark-box" }, this.parts.left, this.parts.right, this.parts.dollar));
    this.letters = letterSpans(LINES.brand.text, "letter");
    this.brand = h("div", { class: "brand" }, this.letters);
    const words = LINES.tagline.text.split(" "); // Get paid to code.
    this.tagline = h("div", { class: "tagline" }, h("span", { text: `${words[0]} ` }), h("span", { class: "money", text: words[1] }), h("span", { text: ` ${words[2]} ${words[3]}` }));
    const [freeWord, ...halfWords] = LINES.free.text.split(" "); // Free. Half the ad money is yours.
    this.free = h("div", { class: "end-free" }, h("span", { text: `${freeWord} ` }), h("span", { class: "money", text: halfWords.join(" ") }));
    this.badge = h("img", { class: "badge", src: "/assets/ms-badge-dark.svg", alt: "Get it from Microsoft" });
    this.url = h("div", { class: "end-url", text: settings.url });
    this.cta = h("div", { class: "end-cta" }, this.badge, this.url);
    this.group = h("div", { class: "layer" }, this.bloom, this.ring, this.plate, this.brand, this.tagline, this.free, this.cta);
    root.append(h("div", { class: "center" }, this.group));
  },
  draw(t) {
    // The plate pulls back from filling the frame to the tile.
    const start = (ICON * DIVE) / PLATE;
    const back = ease.outExpo(seg(t, CUE.mark, CUE.mark + 0.5));
    const size = Math.exp(lerp(Math.log(start), 0, back));
    const lift = ease.inOutCubic(seg(t, CUE.dollar + 0.1, CUE.dollar + 0.55));
    const plateY = lerp(0, SQUARE ? -320 : -300, lift);
    const jolt = t < CUE.dollar ? 0 : Math.exp(-(t - CUE.dollar) * 12);
    const settle = 1 + 0.03 * seg(t, CUE.end, DURATION);
    put(this.group, { transform: `translate(${(noise1(t * 30, 3) * 8 * jolt).toFixed(1)}px, ${(noise1(t * 30, 4) * 6 * jolt).toFixed(1)}px) scale(${settle.toFixed(4)})` });
    put(this.plate, { transform: `translate(-50%, calc(-50% + ${plateY.toFixed(1)}px)) scale(${size.toFixed(4)})` });

    // The brackets ease apart, then clamp onto the $ on the beat.
    const open = ease.outCubic(seg(t, CUE.mark + 0.15, CUE.dollar - 0.18));
    const shut = ease.inCubic(seg(t, CUE.dollar - 0.18, CUE.dollar));
    const recoil = t < CUE.dollar ? 0 : Math.exp(-(t - CUE.dollar) * 9) * Math.sin((t - CUE.dollar) * 40);
    const gap = 70 * open * (1 - shut) - recoil * 10;
    put(this.parts.left, { transform: `translateX(${(-gap).toFixed(1)}px)` });
    put(this.parts.right, { transform: `translateX(${gap.toFixed(1)}px)` });
    const hit = seg(t, CUE.dollar, CUE.dollar + 0.5);
    put(this.ring, { opacity: t < CUE.dollar ? 0 : (1 - hit) ** 2 * 0.9, transform: `translateY(${plateY.toFixed(1)}px) scale(${(0.85 + ease.outCubic(hit) * 1.1).toFixed(3)})` });
    put(this.bloom, { opacity: t < CUE.dollar ? 0 : 0.25 + 0.6 * Math.exp(-(t - CUE.dollar) * 2.5), transform: `translateY(${plateY.toFixed(1)}px)` });

    // ADCode, gathering; the tagline under it.
    const gather = ease.outExpo(seg(t, CUE.wordmark, CUE.wordmark + 0.55));
    const n = this.letters.length;
    this.letters.forEach((letter, i) => {
      const off = (i - (n - 1) / 2) * lerp(120, 0, gather);
      const on = seg(t, CUE.wordmark + i * 0.03, CUE.wordmark + 0.15 + i * 0.03);
      put(letter, { opacity: on, transform: `translateX(${off.toFixed(1)}px)`, filter: gather < 0.98 ? `blur(${((1 - gather) * 14).toFixed(1)}px)` : "none" });
    });
    put(this.brand, { transform: `translate(-50%, ${SQUARE ? -185 : -170}px)` });
    const tag = ease.outCubic(seg(t, CUE.tagline, CUE.tagline + 0.4));
    put(this.tagline, { opacity: tag, transform: `translate(-50%, ${(lerp(30, 0, tag) + (SQUARE ? -20 : 0)).toFixed(1)}px)`, filter: tag < 0.98 ? `blur(${((1 - tag) * 10).toFixed(1)}px)` : "none" });

    // The call to action settles and holds.
    const line = (element, at, y) => {
      const p = ease.outCubic(seg(t, at, at + 0.4));
      put(element, { opacity: p, transform: `translate(-50%, ${(y + lerp(26, 0, p)).toFixed(1)}px)` });
    };
    line(this.free, LINES.free.from - 0.35, SQUARE ? 85 : 100);
    line(this.cta, CUE.end + 0.15, SQUARE ? 160 : 175);
    const badgePop = t < CUE.end + 0.15 ? 0 : spring(t - CUE.end - 0.15, 220, 16);
    put(this.badge, { transform: `scale(${lerp(0.85, 1, badgePop).toFixed(4)})` });
  },
};
