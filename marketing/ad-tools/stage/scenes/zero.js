/**
 * 10.6–12.6 s. Zero.
 *
 * On the white, a giant cropped "Zero" slams in - out of focus to sharp in a quarter
 * second - over graphite smoke that drifts along the bottom of the frame. It shrinks into a
 * line and the second word rolls up like a slot machine: "Zero copy‑paste." then
 * "Zero tab‑switching." The white stays; the next scene takes it over.
 */
import { CUE, H, LINES, W } from "../cues.js";
import { ease, h, lerp, put, rng, seg } from "../shared/engine.js";
import { noise1 } from "../fx.js";

const BIG = 780;
const SMALL = 150;

export const zero = {
  id: "zero",
  from: CUE.zero,
  to: CUE.one,
  mount(root) {
    this.canvas = h("canvas", { width: W, height: H, class: "smoke" });
    this.ctx = this.canvas.getContext("2d");
    const random = rng(404);
    this.blobs = Array.from({ length: 9 }, (_, i) => ({
      x: (i / 8) * W + (random() - 0.5) * 200, y: H * (0.78 + random() * 0.3), r: 320 + random() * 360,
      tone: [34, 70, 110, 150][i % 4], alpha: 0.28 + random() * 0.25, seed: 30 + i,
    }));
    this.big = h("div", { class: "zero-big", text: LINES.zero.text });
    const [first, second] = [LINES.copyPaste.text, LINES.tabs.text].map((text) => text.replace(/^Zero /, ""));
    this.wordA = h("div", { class: "zero-word", text: first });
    this.wordB = h("div", { class: "zero-word", text: second });
    this.stack = h("div", { class: "zero-stack" }, this.wordA, this.wordB);
    this.slot = h("div", { class: "zero-slot" }, this.stack);
    this.line = h("div", { class: "zero-line" }, this.big, this.slot);
    root.append(h("div", { class: "zero-bg" }), this.canvas, this.line);
  },

  draw(t) {
    if (this.bigW === undefined) {
      this.bigW = this.big.offsetWidth;
      this.bigH = this.big.offsetHeight;
      this.wA = this.wordA.offsetWidth;
      this.wB = this.wordB.offsetWidth;
    }
    // Smoke: soft graphite blooms, stirred harder by the slam.
    const { ctx } = this;
    ctx.clearRect(0, 0, W, H);
    const kick = Math.exp(-Math.max(0, t - CUE.zero) * 3);
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 1 - seg(t, CUE.shrink - 0.25, CUE.shrink - 0.02);
    for (const blob of this.blobs) {
      const x = blob.x + noise1(t * 0.35, blob.seed) * 160 + (t - CUE.zero) * 30;
      const y = blob.y + noise1(t * 0.3, blob.seed + 9) * 70 - kick * 40;
      const r = blob.r * (1 + 0.18 * kick + 0.08 * noise1(t * 0.5, blob.seed + 3));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const c = blob.tone;
      g.addColorStop(0, `rgba(${c},${c},${c - 2},${blob.alpha})`);
      g.addColorStop(0.55, `rgba(${c},${c},${c - 2},${(blob.alpha * 0.4).toFixed(3)})`);
      g.addColorStop(1, `rgba(${c},${c},${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // "Zero": the slam, the hold, then down into the line.
    const slam = ease.outExpo(seg(t, CUE.zero, CUE.zero + 0.28));
    const focus = ease.outCubic(seg(t, CUE.zero, CUE.zero + 0.2));
    const hold = seg(t, CUE.zero + 0.2, CUE.zeroCopy);
    const shrink = ease.inOutExpo(seg(t, CUE.zeroCopy, CUE.zeroCopy + 0.2));
    const roll = ease.inOutCubic(seg(t, CUE.zeroTabs, CUE.zeroTabs + 0.1));
    const small = SMALL / BIG;
    const zeroSmallW = this.bigW * small;
    const gap = SMALL * 0.26;
    const wordW = lerp(this.wA, this.wB, roll);
    const lineLeft = W / 2 - (zeroSmallW + gap + wordW) / 2;
    // Big: centred a little right, so the "o" runs off the frame.
    const bigCx = W / 2 + 330;
    const smallCx = lineLeft + zeroSmallW / 2;
    const cx = lerp(bigCx, smallCx, shrink);
    const s = lerp(lerp(1.32, 1, slam) * (1 + 0.035 * hold), small, shrink);
    const shakeX = kick * 14 * noise1(t * 40, 5);
    const shakeY = kick * 10 * noise1(t * 40, 6);
    put(this.big, {
      opacity: seg(t, CUE.zero, CUE.zero + 0.04),
      filter: focus < 1 ? `blur(${((1 - focus) * 28).toFixed(1)}px)` : "none",
      transform: `translate(${(cx - this.bigW / 2 + shakeX).toFixed(1)}px, ${(H / 2 - this.bigH / 2 + shakeY).toFixed(1)}px) scale(${s.toFixed(4)})`,
      "--sheen": `${lerp(-30, 130, ease.inOutCubic(seg(t, CUE.zero + 0.15, CUE.zeroCopy))).toFixed(1)}%`,
    });

    // The slot: the word rolls up into place, then rolls on to the next.
    const enter = ease.outCubic(seg(t, CUE.zeroCopy + 0.05, CUE.zeroCopy + 0.2));
    const lineH = SMALL * 1.12;
    put(this.slot, {
      opacity: seg(t, CUE.zeroCopy + 0.04, CUE.zeroCopy + 0.09),
      transform: `translate(${(lineLeft + zeroSmallW + gap).toFixed(1)}px, ${(H / 2 - lineH / 2).toFixed(1)}px)`,
      width: `${Math.max(this.wA, this.wB) + 20}px`,
    });
    const rolling = roll > 0 && roll < 1;
    put(this.stack, {
      transform: `translateY(${((1 - enter) * lineH - roll * lineH).toFixed(1)}px)`,
      filter: (enter > 0 && enter < 1) || rolling ? `blur(${(10 * Math.sin(Math.PI * (rolling ? roll : enter))).toFixed(1)}px)` : "none",
    });

    // Out, fast, and the smoke with it: the last frame is the plain white the next scene
    // opens on.
    const out = seg(t, CUE.shrink - 0.12, CUE.shrink - 0.02);
    put(this.line, { opacity: 1 - out, transform: `scale(${lerp(1, 1.08, out).toFixed(4)})` });
  },
};

