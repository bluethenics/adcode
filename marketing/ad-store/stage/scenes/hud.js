/**
 * 0–20 s, over everything: the frame the reference films through. Crop marks, telemetry in
 * the corners - a running timecode, the build, the share, the Store ID - an earnings readout
 * that turns green when the card pays, the small print that every money claim needs, and
 * the light: the flashes that open scenes, and a vignette.
 */
import { CUE, DURATION, EXAMPLE, LINES } from "../cues.js";
import { ease, h, put, seg } from "../shared/engine.js";
import { timecode } from "../fx.js";

/** A flash: up fast, down slower, peaking at `at`. */
function flash(t, at, rise = 0.12, fall = 0.4) {
  if (t < at - rise || t > at + fall) return 0;
  return t < at ? seg(t, at - rise, at) ** 2 : (1 - seg(t, at, at + fall)) ** 1.6;
}

export const hud = {
  id: "hud",
  from: 0,
  to: DURATION,
  mount(root) {
    this.code = h("b", { text: "T+00:00.00" });
    this.earned = h("span", { text: "$0.00" });
    this.flash = h("div", { class: "flash" });
    this.bottom = h("div", { class: "hud-bottom", style: { position: "absolute", inset: "0" } },
      h("div", { class: "crop bl" }), h("div", { class: "crop br" }),
      h("div", { class: "tele bl" }, h("span", { text: "Rev share " }), h("b", { text: "50 / 50" })),
      h("div", { class: "tele br" }, h("span", { text: "Store ID " }), h("b", { text: "9MSW2N027GJX" })),
      h("div", { class: "small", text: LINES.small.text }));
    root.append(h("div", { class: "hud" },
      this.flash,
      h("div", { class: "vignette" }),
      h("div", { class: "crop tl" }), h("div", { class: "crop tr" }),
      h("div", { class: "tele tl" }, h("span", { text: "ADCode 2.1.1 ▸ " }), h("b", { text: "Microsoft Store" })),
      h("div", { class: "tele tr" }, this.code, h("br"), h("span", { text: "Earned " }), this.earned),
      this.bottom));
  },
  draw(t) {
    this.code.textContent = timecode(t);
    const paid = t >= CUE.earn + 0.1;
    this.earned.textContent = paid ? EXAMPLE.share.replace("+", "") : "$0.00";
    this.earned.className = paid ? "money" : "";
    const light = Math.max(
      flash(t, CUE.flash1, 0.14, 0.42),
      flash(t, CUE.flash2, 0.14, 0.5),
      0.32 * flash(t, CUE.count[1], 0.03, 0.3),
      0.9 * flash(t, CUE.mark, 0.08, 0.35),
    );
    put(this.flash, { opacity: light });
    // Over the desktop, the bottom of the frame belongs to the taskbar: the small print and
    // the bottom telemetry ride up above it, and settle back when the dive leaves Windows.
    const lift = ease.outExpo(seg(t, CUE.desktop - 0.18, CUE.desktop + 0.25)) * (1 - ease.inOutCubic(seg(t, CUE.dive[0], CUE.mark)));
    put(this.bottom, { transform: `translateY(${(-80 * lift).toFixed(1)}px)` });
  },
};
