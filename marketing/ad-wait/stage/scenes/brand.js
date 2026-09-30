/**
 * 6–8 s. "ADCode - Get paid to wait."
 *
 * The mark bursts in on the downbeat with a white flash, its $ in green. The wordmark
 * rises letter by letter, the tag lands with "paid" in green - the money - then the
 * free line and the address. The last frame is a held end card; the film loops from
 * there straight back into the hook.
 */
import { CUE, DURATION } from "../cues.js";
import { ease, h, lerp, put, seg, spring, tf } from "../shared/engine.js";
import { markParts } from "../shared/ui.js";
import { shake } from "./cuts.js";

export const brand = {
  id: "brand",
  from: CUE.logo,
  to: DURATION + 0.1,
  mount(root, settings) {
    const parts = markParts();
    parts.dollar.classList.add("money");
    this.bloom = h("div", { class: "brand-bloom" });
    this.ring = h("div", { class: "brand-ring" });
    this.mark = h("div", { class: "brand-mark" }, this.bloom, this.ring, parts.left, parts.right, parts.dollar);
    this.letters = [..."ADCode"].map((letter) => h("span", { class: "word", text: letter }));
    this.word = h("div", { class: "brand-word" }, this.letters);
    this.tag = h("div", { class: "brand-tag" }, "Get ", h("span", { class: "money", text: "paid" }), " to wait.");
    this.free = h("div", { class: "brand-free", text: "Free. Windows & Linux." });
    this.url = h("div", { class: "brand-url", text: settings.url });
    this.flash = h("div", { class: "flash" });
    root.append(this.mark, this.word, this.tag, this.free, this.url, this.flash);
  },
  draw(t) {
    const since = t - CUE.logo;
    const pop = spring(since, 240, 13);
    const rock = shake(t, CUE.logo, 9, 18);
    // Once it has landed the mark breathes, so the hold at the end is never dead.
    const breath = t > CUE.url ? 0.5 + 0.5 * Math.sin((t - CUE.url) * 5) : 0;
    put(this.mark, {
      transform: tf({ x: rock.x, y: rock.y, s: lerp(0.45, 1, pop) * (1 + 0.015 * breath) }),
      filter: `drop-shadow(0 0 ${(10 + breath * 26).toFixed(1)}px rgba(255, 255, 255, ${(0.1 + breath * 0.16).toFixed(3)}))`,
    });
    const flare = seg(since, 0, 0.8);
    put(this.bloom, { transform: tf({ s: lerp(0.6, 1.7, ease.outCubic(flare)) }), opacity: 1 - flare });
    const ring = seg(since, 0, 0.7);
    put(this.ring, { transform: tf({ s: lerp(0.5, 2.6, ease.outCubic(ring)) }), opacity: 0.85 * (1 - ring) });
    put(this.flash, { opacity: 0.95 * Math.exp(-since * 26) });

    this.letters.forEach((letter, i) => {
      const rise = ease.outExpo(seg(t, CUE.wordmark + i * 0.045, CUE.wordmark + i * 0.045 + 0.22));
      put(letter, { transform: tf({ y: lerp(60, 0, rise) }), opacity: rise });
    });
    const tag = spring(t - CUE.tagline, 260, 15);
    put(this.tag, { transform: tf({ y: lerp(50, 0, tag), s: lerp(0.9, 1, tag) }), opacity: t >= CUE.tagline ? 1 : 0 });
    const free = ease.outExpo(seg(t, CUE.free, CUE.free + 0.3));
    put(this.free, { transform: tf({ y: lerp(30, 0, free) }), opacity: free });
    const url = spring(t - CUE.url, 260, 16);
    put(this.url, { transform: tf({ s: lerp(0.8, 1, url) }), opacity: t >= CUE.url ? 1 : 0 });
  },
};
