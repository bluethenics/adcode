/**
 * 4.25–6 s. The notification, and what it pays.
 *
 * A quarter-second of black, then the ad lands on the beat: ADCode's sponsored card
 * slamming in with a white flash. The advertiser is the fictional Acme Cloud - no real
 * company is shown advertising. A green "+$0.04" leaves the card, and on 5.0 the answer
 * slams up: 50%, "Half the ad money is yours", the bar splitting in two. The amounts are
 * examples, and the small print says so.
 */
import { CUE } from "../cues.js";
import { ease, h, lerp, put, seg, tf } from "../shared/engine.js";
import { icon } from "../shared/ui.js";
import { shake } from "./cuts.js";

const CARD_CENTER = 400;
const CARD_DOCKED = 150;

export const hit = {
  id: "hit",
  from: CUE.hit,
  to: CUE.logo,
  mount(root) {
    this.caption = h("div", { class: "caption", text: "An ad shows up." });
    this.card = h("div", { class: "note" },
      h("div", { class: "note-logo", text: "A" }),
      h("div", { class: "note-copy" },
        h("div", { class: "note-label", text: "SPONSORED" }),
        h("div", { class: "note-title" }, h("b", { text: "Acme Cloud" }), " Deploy previews in one click"),
        h("div", { class: "note-body", text: "Free for open source." })),
      h("div", { class: "note-close" }, icon("close", 40)));
    this.chip = h("div", { class: "chip", text: "+$0.04" });

    this.fifty = h("div", { class: "fifty", text: "50%" });
    this.lines = ["Half the ad money", "is yours."].map((text) => h("div", { text }));
    this.share = h("div", { class: "share-line" }, this.lines);
    this.you = h("div", { class: "split-you" });
    this.them = h("div", { class: "split-them" });
    this.tags = [
      h("div", { class: "split-tag you", text: "You 50%" }),
      h("div", { class: "split-tag them", text: "ADCode 50%" }),
    ];
    this.splitBar = h("div", { class: "split" }, this.you, this.them, this.tags);
    this.flash = h("div", { class: "flash" });
    root.append(h("div", { class: "hit-bg" }), this.caption, this.card, this.chip,
      this.fifty, this.share, this.splitBar,
      h("div", { class: "print", text: "Example amounts. Earnings vary." }), this.flash);
  },
  draw(t) {
    const since = t - CUE.hit;
    const split = t >= CUE.split;

    // The card slams in from above, rings, then docks at the top for the answer.
    const drop = ease.outExpo(seg(since, 0, 0.2));
    const ring = shake(t, CUE.hit + 0.11, 15, 15);
    const dock = ease.inOutCubic(seg(t, CUE.split - 0.12, CUE.split + 0.06));
    put(this.card, {
      transform: tf({
        x: ring.x, y: lerp(-560, 0, drop) + ring.y + (CARD_DOCKED - CARD_CENTER) * dock,
        s: lerp(1.3, 1, drop) * lerp(1, 0.5, dock),
      }),
    });
    // The card lights green as it lands - the money is coming - and cools by the split.
    const glow = split ? 0 : 1 - seg(since, 0.1, 0.8);
    put(this.card, {
      borderColor: `rgba(48, 209, 88, ${(0.85 * glow + 0.24 * (1 - glow)).toFixed(3)})`,
      boxShadow: `0 0 ${(90 * glow).toFixed(1)}px rgba(48, 209, 88, ${(0.5 * glow).toFixed(3)}), 0 40px 100px rgba(0, 0, 0, 0.7)`,
    });
    put(this.flash, { opacity: Math.max(0.95 * Math.exp(-since * 26), split ? 0.55 * Math.exp(-(t - CUE.split) * 26) : 0) });

    put(this.caption, { opacity: split ? 0 : 1, transform: tf({ y: lerp(30, 0, ease.outExpo(seg(since, 0.1, 0.3))) }) });

    // +$0.04 leaves the card and lands in front of you.
    const fly = seg(t, CUE.fly, CUE.landed);
    const landed = t - CUE.landed;
    const chipScale = fly < 1 ? lerp(0.35, 1, ease.outBack(fly)) : 1 + 0.06 * Math.exp(-landed * 10) * Math.cos(landed * 24);
    put(this.chip, {
      opacity: t >= CUE.fly && !split ? Math.min(1, fly * 6) : 0,
      transform: tf({ y: lerp(-260, 0, ease.outExpo(fly)), s: chipScale }),
    });

    // 50%: the answer, slammed on the downbeat.
    const slamIn = t - CUE.split;
    put(this.fifty, {
      opacity: split ? 1 : 0,
      transform: tf({ s: split ? lerp(1.5, 1, ease.outExpo(seg(slamIn, 0, 0.18))) : 1.5 }),
    });
    this.lines.forEach((line, i) => {
      const rise = ease.outExpo(seg(slamIn, 0.1 + i * 0.09, 0.3 + i * 0.09));
      put(line, { opacity: split ? rise : 0, transform: tf({ y: lerp(44, 0, rise) }) });
    });

    // The bar is all yours, then opens: half stays with ADCode.
    const open = ease.outExpo(seg(t, CUE.bar, CUE.bar + 0.32));
    const width = 840;
    put(this.you, { width: `${lerp(width, width / 2 - 8, open)}px`, opacity: split ? 1 : 0 });
    put(this.them, { width: `${lerp(0, width / 2 - 8, open)}px`, opacity: split ? 1 : 0 });
    const tags = ease.outCubic(seg(t, CUE.bar + 0.12, CUE.bar + 0.32));
    for (const tag of this.tags) put(tag, { opacity: tags, transform: tf({ y: lerp(14, 0, tags) }) });
  },
};
