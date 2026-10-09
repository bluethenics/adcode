/**
 * 10.45–12.55 s. The ledger, on paper - the reference's light interlude, a form filled in
 * by a typewriter and stamped.
 *
 * Out of the flash a cream sheet settles toward the camera: LEDGER ENTRY, the event, what
 * the advertiser paid, your share. The figures type themselves in; on 11.5 a green stamp
 * slams down - 50% YOURS - the sheet jolts, and "Credited" is crossed. Signed at the foot:
 * "On a ledger you can audit." Then the whole sheet whips up and out of frame as Windows
 * rises in from below.
 */
import { CUE, EXAMPLE, LINES } from "../cues.js";
import { ease, h, lerp, put, seg, typed } from "../shared/engine.js";
import { drift, noise1, SIZE, SQUARE, wordSpans } from "../fx.js";

const FIELDS = [
  { label: "1 · Event", value: "Sponsored card · Acme Cloud", at: 0 },
  { label: "2 · Advertiser paid", value: EXAMPLE.cost, at: 1 },
  { label: "3 · Your share (50%)", value: EXAMPLE.share, at: 2, money: true },
];

export const ledger = {
  id: "ledger",
  from: CUE.flash2 - 0.05,
  to: CUE.desktop + 0.1,
  mount(root) {
    this.values = FIELDS.map((field) => h("b", { class: field.money ? "money-ink" : "" }));
    const fields = FIELDS.map((field, i) => h("div", { class: "field" }, h("span", { text: field.label }), this.values[i]));
    this.crossed = h("i", { text: "" });
    this.stamp = h("div", { class: "stamp", text: LINES.stamp.text });
    this.sign = h("div", { class: "sign" }, wordSpans(LINES.audit.text));
    this.paper = h("div", { class: "paper" },
      h("div", { class: "form-head" },
        h("div", { class: "form-title", text: "Ledger entry" }),
        h("div", { class: "form-meta" }, h("div", { text: "Form AD-50" }), h("div", { text: "Issued by ADCode" }), h("div", { text: "Append-only" }))),
      ...fields,
      h("div", { class: "boxes" }, h("span", {}, h("i"), h("span", { text: "Pending" })), h("span", {}, this.crossed, h("span", { text: "Credited to you" }))),
      this.sign, this.stamp);
    this.plate = h("div", { class: "backdrop" });
    this.group = h("div", { class: "layer" }, this.paper);
    this.wrap = h("div", { class: "layer-wrap", style: { position: "absolute", inset: "0" } }, this.plate, h("div", { class: "center" }, this.group));
    root.append(this.wrap);
  },
  draw(t) {
    const pw = SQUARE ? 940 : 1180;
    const ph = SQUARE ? 820 : 760;
    // Settle toward the camera out of the flash; a slow drift while it is read.
    const settle = ease.outExpo(seg(t, CUE.form, CUE.form + 0.7));
    const d = drift(t, 1, 41);
    const jolt = t < CUE.stamp ? 0 : Math.exp(-(t - CUE.stamp) * 14);
    const shakeX = noise1(t * 40, 2) * 9 * jolt;
    const shakeY = noise1(t * 40, 5) * 7 * jolt;
    const rx = lerp(26, 6, settle);
    const rz = lerp(-5, -1.2, settle);
    const s = lerp(0.82, SQUARE ? 0.98 : 1, settle) * (1 + 0.025 * seg(t, CUE.form + 0.7, CUE.desktop));
    put(this.paper, {
      transform: `translate(${(-pw / 2 + d.x + shakeX).toFixed(1)}px, ${(-ph / 2 + d.y + shakeY + lerp(120, 0, settle)).toFixed(1)}px) perspective(1800px) rotateX(${rx.toFixed(2)}deg) rotateZ(${rz.toFixed(3)}deg) scale(${(s * (1 - 0.012 * jolt)).toFixed(4)})`,
    });

    // The typewriter: each figure in its turn.
    FIELDS.forEach((field, i) => {
      const at = CUE.rows[field.at];
      this.values[i].textContent = typed(field.value, t, at, 48);
    });
    this.crossed.textContent = t >= CUE.stamp ? "×" : "";

    // The stamp: from above the sheet, hard down on the beat, then a little ink bleed.
    const fall = ease.inExpo(seg(t, CUE.stamp - 0.14, CUE.stamp));
    put(this.stamp, {
      opacity: seg(t, CUE.stamp - 0.14, CUE.stamp - 0.1),
      transform: `rotate(-9deg) scale(${lerp(2.4, 1, fall).toFixed(4)})`,
      filter: t < CUE.stamp ? `blur(${((1 - fall) * 6).toFixed(1)}px)` : "none",
    });

    this.sign.querySelectorAll(".word").forEach((word, i) => {
      const at = LINES.audit.from - 0.35 + i * 0.06;
      const q = ease.outCubic(seg(t, at, at + 0.35));
      put(word, { opacity: q, transform: `translateY(${lerp(18, 0, q).toFixed(1)}px)` });
    });

    // Out: the whole sheet whips up and away as the desktop rises.
    const out = ease.inExpo(seg(t, CUE.desktop - 0.22, CUE.desktop + 0.02));
    put(this.wrap, { transform: `translateY(${(-out * SIZE.h * 1.25).toFixed(1)}px)` });
  },
};
