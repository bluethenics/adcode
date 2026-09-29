/**
 * 2–4 s. "Time it paid you back."
 *
 * The brackets slide in from the edges, the $ drops between them and lands on the
 * downbeat at 3.0 - the first colour in the film, because it is money. At 3.6 the brackets
 * part like curtains and the $ flies at the camera, revealing the Vibe window.
 */
import { CUE } from "../cues.js";
import { ease, h, lerp, put, seg, tf } from "../engine.js";
import { markParts } from "../ui.js";

export const flip = {
  id: "flip",
  from: 1.95,
  to: 4.35,
  mount(root) {
    const parts = markParts();
    this.left = parts.left;
    this.right = parts.right;
    this.dollar = parts.dollar;
    this.glow = h("div", { class: "flip-glow" });
    this.ring = h("div", { class: "flip-ring" });
    this.mark = h("div", { class: "flip-mark" }, this.glow, this.ring, this.left, this.right, this.dollar);
    this.words = ["Time", "it", "paid", "you", "back."].map((text) => h("span", { class: "word", text }));
    this.text = h("div", { class: "flip-text" }, this.words.flatMap((word, i) => (i === 0 ? [word] : [" ", word])));
    root.append(this.mark, this.text);
  },
  draw(t) {
    const enter = ease.outExpo(seg(t, CUE.bracketsIn, CUE.bracketsIn + 0.45));
    const part = ease.inOutCubic(seg(t, CUE.toVibe, CUE.vibe + 0.25));
    const shown = seg(t, CUE.bracketsIn, CUE.bracketsIn + 0.08);
    put(this.left, { transform: tf({ x: lerp(-760, 0, enter) - part * 700 }), opacity: shown });
    put(this.right, { transform: tf({ x: lerp(760, 0, enter) + part * 700 }), opacity: shown });

    // The drop accelerates like a real fall and lands exactly on the beat.
    const fall = ease.inCubic(seg(t, CUE.dollarDrop, CUE.dollarLand));
    const since = t - CUE.dollarLand;
    const squash = since > 0 ? 1 - 0.16 * Math.exp(-since * 9) * Math.cos(since * 24) : 1;
    const landed = since >= 0;
    this.dollar.classList.toggle("money", landed);
    put(this.dollar, {
      transform: tf({ y: lerp(-820, 0, fall) + (1 - squash) * 60, sx: 2 - squash, sy: squash, s: 1 }) + ` scale(${(1 + ease.inCubic(seg(t, CUE.toVibe, CUE.toVibe + 0.25)) * 1.8).toFixed(4)})`,
      // Flies at the camera and is gone before the window behind it is solid.
      opacity: (t >= CUE.dollarDrop ? 1 : 0) * (1 - ease.outCubic(seg(t, CUE.toVibe, CUE.toVibe + 0.25))),
    });

    // Landing: a green bloom and a shock ring.
    const ring = seg(t, CUE.dollarLand, CUE.dollarLand + 0.7);
    put(this.ring, {
      transform: tf({ s: lerp(0.6, 1.9, ease.outCubic(ring)) }),
      opacity: landed ? (1 - ring) * 0.9 * seg(t, CUE.dollarLand, CUE.dollarLand + 0.06) : 0,
    });
    put(this.glow, { opacity: landed ? Math.exp(-since * 3.2) * (1 - part) : 0 });

    put(this.mark, { transform: tf({ y: -60 }) });
    this.words.forEach((word, i) => {
      const rise = ease.outCubic(seg(t, CUE.flipText + i * 0.07, CUE.flipText + i * 0.07 + 0.4));
      put(word, { transform: tf({ y: lerp(46, 0, rise) }), opacity: rise * (1 - seg(t, CUE.toVibe, CUE.toVibe + 0.25)) });
    });
  },
};
