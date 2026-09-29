/**
 * 16–20 s. "Half the ad money is yours."
 *
 * The card, and a line of green light running out of it: the money. It splits in two -
 * half to ADCode, half to you - and on the downbeat at 17.0 the 50% that is yours counts
 * up, huge and green. No amounts: the promise is the share, not a number.
 */
import { CUE } from "../cues.js";
import { ease, h, lerp, put, seg, tf } from "../engine.js";
import { markInline } from "../ui.js";
import { sponsoredCard } from "./adcard.js";

const TRUNK = "M540 452 V540";
const LEFT = "M540 540 C540 604 290 588 290 660";
const RIGHT = "M540 540 C540 604 790 588 790 660";

export const earn = {
  id: "earn",
  from: CUE.earn,
  to: CUE.implode + 0.25,
  mount(root) {
    this.lines = ["Half the ad money", "is yours."].map((text) => h("div", { class: "montage-line", text }));
    this.card = sponsoredCard();
    this.card.classList.add("earn-card");
    const path = (d) => h("path", { d, class: "flow-line" });
    this.paths = [path(TRUNK), path(LEFT), path(RIGHT)];
    this.heads = [0, 1].map(() => h("circle", { r: 9, class: "flow-head" }));
    const svg = h("svg", { class: "flow", viewBox: "0 0 1080 1080", width: 1080, height: 1080 }, this.paths, this.heads);

    this.leftShare = h("div", { class: "share share-left" },
      h("div", { class: "share-who" }, markInline(40), h("span", { text: "ADCode" })),
      h("div", { class: "share-pct", text: "50%" }));
    this.yours = h("span", { text: "0" });
    this.rightShare = h("div", { class: "share share-right" },
      h("div", { class: "share-who" }, h("span", { class: "share-avatar" }), h("span", { text: "You" })),
      h("div", { class: "share-pct money" }, this.yours, "%"));
    this.itemized = h("div", { class: "earn-itemized", text: "Every view itemized." });
    this.layer = h("div", { class: "scene-layer earn-layer" }, svg, this.card, this.leftShare, this.rightShare, this.itemized);
    root.append(h("div", { class: "montage-caption" }, this.lines), this.layer);
    this.lengths = this.paths.map((one) => one.getTotalLength());
  },
  draw(t) {
    // Everything is drawn into the centre as the logo gathers.
    const gather = ease.inExpo(seg(t, CUE.implode - 0.35, CUE.implode + 0.25));
    this.lines.forEach((line, i) => {
      const rise = ease.outExpo(seg(t, CUE.earn + 0.15 + i * 0.25, CUE.earn + 0.55 + i * 0.25));
      put(line, { transform: tf({ y: lerp(40, 0, rise) }), opacity: rise * (1 - gather) });
    });
    const arrive = ease.outExpo(seg(t, CUE.earn, CUE.earn + 0.4));
    put(this.card, { transform: tf({ y: lerp(80, 0, arrive), s: lerp(1.5, 1.28, arrive) }), opacity: seg(t, CUE.earn, CUE.earn + 0.08) });

    // The money runs: down the trunk, then both branches at once.
    const trunk = ease.inOutCubic(seg(t, CUE.flow, CUE.split));
    const branch = ease.outCubic(seg(t, CUE.split, CUE.fifty));
    const drawn = [trunk, branch, branch];
    this.paths.forEach((one, i) => put(one, { strokeDasharray: `${this.lengths[i]}`, strokeDashoffset: `${(1 - drawn[i]) * this.lengths[i]}` }));
    this.heads.forEach((head, i) => {
      const onBranch = t >= CUE.split;
      const one = onBranch ? this.paths[i + 1] : this.paths[0];
      const point = one.getPointAtLength((onBranch ? branch : trunk) * this.lengths[onBranch ? i + 1 : 0]);
      head.setAttribute("cx", point.x.toFixed(2));
      head.setAttribute("cy", point.y.toFixed(2));
      put(head, { opacity: t >= CUE.flow && t < CUE.fifty + 0.15 ? 1 : 0 });
    });

    // The shares: grey for ADCode, green and counting for you, landing on the beat.
    const reveal = ease.outCubic(seg(t, CUE.fifty - 0.12, CUE.fifty + 0.25));
    put(this.leftShare, { transform: tf({ y: lerp(30, 0, reveal) }), opacity: reveal });
    const since = t - CUE.fifty;
    const pop = since >= 0 ? 1 + 0.12 * Math.exp(-since * 6) * Math.cos(since * 18) : 0.9;
    put(this.rightShare, { transform: tf({ y: lerp(30, 0, reveal), s: pop }), opacity: reveal });
    // Counts up through the build and lands on 50 exactly on the downbeat.
    this.yours.textContent = String(Math.round(50 * ease.outCubic(seg(t, CUE.split, CUE.fifty))));
    put(this.itemized, { transform: tf({ y: lerp(20, 0, ease.outCubic(seg(t, CUE.itemized, CUE.itemized + 0.4))) }), opacity: seg(t, CUE.itemized, CUE.itemized + 0.3) });

    put(this.layer, { transform: tf({ s: lerp(1, 0.35, gather) }), opacity: 1 - gather });
  },
};
