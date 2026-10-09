/**
 * 6.5–10 s. The call to action, held.
 *
 * The mark lands on the downbeat - brackets in from the sides, the $ in money green - and
 * "ADCode" gathers under it, then the claims, then the address in a pill you could tap. The
 * chip keeps ticking underneath, so the frame is never dead while it holds. The last frame
 * cuts straight back to the hook.
 */
import { CUE, DURATION, LINES } from "../cues.js";
import { ease, h, lerp, put, seg, spring } from "../shared/engine.js";
import { icon, markParts } from "../shared/ui.js";
import { Dust, letterSpans } from "../fx.js";
import { earningsChip } from "./chip.js";

export const end = {
  id: "end",
  from: CUE.end,
  to: DURATION,
  mount(root, settings) {
    root.append(h("div", { class: "end-bg" }));
    this.dust = new Dust(root, 60, 41);
    this.parts = markParts();
    this.parts.dollar.classList.add("money");
    this.ring = h("div", { class: "end-ring" });
    this.mark = h("div", { class: "end-mark" }, h("div", { class: "end-bloom" }), this.ring, this.parts.left, this.parts.right, this.parts.dollar);
    this.letters = letterSpans(LINES.brand.text, "brand-letter");
    this.brand = h("div", { class: "end-brand" }, this.letters);
    this.claims = h("div", { class: "end-claims", text: LINES.claims.text });
    this.url = h("div", { class: "end-url" }, icon("download", 30), h("span", { text: settings.url }));
    this.chip = earningsChip();
    this.chipWrap = h("div", { class: "end-chip" }, this.chip.el);
    root.append(h("div", { class: "end-stack" }, this.mark, this.brand, this.claims, this.url, this.chipWrap));
  },

  draw(t) {
    const local = t - CUE.end;
    this.dust.draw(t, { focus: 1.2, alpha: 0.5 });
    // The mark: brackets race in and clamp on the downbeat, the $ drops in green.
    const race = ease.outExpo(seg(t, CUE.end, CUE.end + 0.22));
    put(this.parts.left, { transform: `translateX(${lerp(-560, 0, race).toFixed(1)}px)`, opacity: seg(t, CUE.end, CUE.end + 0.04) });
    put(this.parts.right, { transform: `translateX(${lerp(560, 0, race).toFixed(1)}px)`, opacity: seg(t, CUE.end, CUE.end + 0.04) });
    const drop = local < 0.1 ? 0 : spring(local - 0.1, 260, 13);
    put(this.parts.dollar, { transform: `translateY(${lerp(-90, 0, Math.min(1, drop)).toFixed(1)}px) scale(${(0.6 + 0.4 * drop).toFixed(4)})`, opacity: seg(t, CUE.end + 0.1, CUE.end + 0.14) });
    const hit = seg(local, 0.18, 0.8);
    put(this.ring, { opacity: local < 0.18 ? 0 : (1 - hit) * 0.85, transform: `scale(${(0.7 + ease.outCubic(hit) * 1.8).toFixed(3)})` });
    // ADCode gathers; the claims and the address rise in after it.
    const gather = ease.outExpo(seg(t, CUE.end + 0.12, CUE.end + 0.5));
    const n = this.letters.length;
    this.letters.forEach((letter, i) => {
      put(letter, {
        opacity: seg(t, CUE.end + 0.12 + i * 0.02, CUE.end + 0.22 + i * 0.02),
        transform: `translateX(${((i - (n - 1) / 2) * lerp(110, 0, gather)).toFixed(1)}px)`,
        filter: gather < 0.98 ? `blur(${((1 - gather) * 10).toFixed(1)}px)` : "none",
      });
    });
    const rise = (el, at) => {
      const p = ease.outCubic(seg(t, at, at + 0.25));
      put(el, { opacity: p, transform: `translateY(${lerp(24, 0, p).toFixed(1)}px)` });
    };
    rise(this.claims, LINES.claims.from - 0.25);
    rise(this.url, LINES.url.from - 0.25);
    rise(this.chipWrap, LINES.url.from - 0.15);
    this.chip.draw(t);
    // A slow push while it holds, so it never sits dead.
    put(this.mark.parentElement, { transform: `scale(${(1 + 0.03 * seg(t, CUE.end + 0.5, DURATION)).toFixed(4)})` });
  },
};

/** Always on top: the small print (amounts on screen are examples), and the vignette. */
export const overlay = {
  id: "overlay",
  from: 0,
  to: DURATION,
  mount(root) {
    root.append(h("div", { class: "vignette" }), h("div", { class: "small-print", text: LINES.smallPrint.text }));
  },
  draw() {},
};
