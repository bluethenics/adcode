/**
 * 20–24 s, and the brand block to the end. "ADCode — Earn while you code."
 *
 * Fragments of everything just shown - a few of them green, the money - rush into the
 * centre and vanish; a quarter-second of black; then the mark bursts in on the downbeat at
 * 22.0 with its $ in green. The wordmark types on, the tagline rises, and the whole block
 * settles upward into the end card, where it stays, breathing, to the last frame.
 */
import { CUE } from "../cues.js";
import { ease, h, lerp, put, rng, seg, spring, tf } from "../engine.js";
import { markParts } from "../ui.js";

const CENTER = { x: 540, y: 430 };

export const logo = {
  id: "logo",
  from: CUE.implode,
  to: 30.1,
  mount(root) {
    const random = rng(2026);
    this.shards = Array.from({ length: 52 }, (_, i) => {
      const angle = random() * Math.PI * 2;
      const distance = 380 + random() * 520;
      const money = i % 11 === 0;
      const element = h("div", { class: `shard${money ? " money" : ""}` });
      put(element, { width: `${Math.round(24 + random() * 150)}px`, height: `${Math.round(8 + random() * 30)}px`, opacity: 0 });
      return {
        element,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        spin: (random() < 0.5 ? -1 : 1) * (180 + random() * 360),
        start: CUE.implode + random() * 0.3,
        end: CUE.silence - 0.2 + random() * 0.18,
      };
    });

    const parts = markParts();
    parts.dollar.classList.add("money");
    this.bloom = h("div", { class: "logo-bloom" });
    this.ring = h("div", { class: "logo-ring" });
    this.mark = h("div", { class: "logo-mark" }, this.bloom, this.ring, parts.left, parts.right, parts.dollar);
    this.letters = [..."ADCode"].map((letter) => h("span", { class: "word", text: letter }));
    this.wordmark = h("div", { class: "logo-wordmark" }, this.letters);
    this.tagline = h("div", { class: "logo-tagline", text: "Earn while you code." });
    this.brand = h("div", { class: "logo-brand" }, this.mark, this.wordmark, this.tagline);
    root.append(h("div", { class: "shards" }, this.shards.map(({ element }) => element)), this.brand);
  },
  draw(t) {
    for (const shard of this.shards) {
      const p = seg(t, shard.start, shard.end);
      const pull = ease.inExpo(p);
      put(shard.element, {
        transform: `translate(${CENTER.x}px, ${CENTER.y}px) ` + tf({ x: shard.x * (1 - pull), y: shard.y * (1 - pull), r: shard.spin * pull, s: lerp(1, 0.12, pull) }),
        opacity: t < shard.start || p >= 1 ? 0 : Math.min(1, seg(t, shard.start, shard.start + 0.15)),
      });
    }

    const since = t - CUE.logo;
    const shown = since >= 0;
    const pop = shown ? spring(since, 230, 13) : 0;
    put(this.mark, { transform: tf({ s: lerp(0.5, 1, pop) }), opacity: shown ? 1 : 0 });
    const flash = seg(since, 0, 0.9);
    put(this.bloom, { transform: tf({ s: lerp(0.6, 1.7, ease.outCubic(flash)) }), opacity: shown ? 1 - flash : 0 });
    const ring = seg(since, 0, 0.8);
    put(this.ring, { transform: tf({ s: lerp(0.5, 2.5, ease.outCubic(ring)) }), opacity: shown ? 0.85 * (1 - ring) : 0 });

    this.letters.forEach((letter, i) => {
      const rise = ease.outCubic(seg(t, CUE.wordmark + i * 0.1, CUE.wordmark + i * 0.1 + 0.3));
      put(letter, { transform: tf({ y: lerp(34, 0, rise) }), opacity: rise });
    });
    const tag = ease.outCubic(seg(t, CUE.tagline, CUE.tagline + 0.45));
    put(this.tagline, { transform: tf({ y: lerp(26, 0, tag) }), opacity: tag });

    // Settle into the end card; then breathe.
    const settle = ease.inOutCubic(seg(t, CUE.settle, CUE.settle + 0.6));
    put(this.brand, { transform: tf({ y: -70 * settle, s: lerp(1, 0.56, settle) }) });
    const breath = t > CUE.end ? 0.5 + 0.5 * Math.sin((t - CUE.end) * 2.2) : 0;
    put(this.mark, { filter: `drop-shadow(0 0 ${(16 + breath * 22).toFixed(1)}px rgba(255, 255, 255, ${(0.18 + breath * 0.12).toFixed(3)}))` });
  },
};
