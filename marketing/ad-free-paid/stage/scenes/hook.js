/**
 * 0–2 s. The hook, finished on frame 0.
 *
 * The mark and "ADCode" over the two-line hook in a shaft of dust-lit light. Nothing has to
 * arrive - the thumbnail is the offer. The camera breathes in, a chrome sheen crosses the
 * words, a stroke of light underlines "free". Then the camera punches through the line, the
 * glyphs swell past the lens, and the frame whites out into the app.
 */
import { CUE, LINES } from "../cues.js";
import { ease, h, lerp, put, seg } from "../shared/engine.js";
import { markInline } from "../shared/ui.js";
import { Dust, LENS, mixCam, shake, view } from "../fx.js";

/** The headline, split where the eye breaks it: after its third word. */
const [FIRST, SECOND] = (() => {
  const words = LINES.hook.text.split(" ");
  return [words.slice(0, 3), words.slice(3)];
})();

function camAt(t) {
  const rest = { x: 0, y: 0, z: 0, d: LENS, rx: 2.5, ry: -5 };
  const breathe = { x: 0, y: -6, z: 0, d: 1470, rx: 1, ry: -1.5 };
  let cam = mixCam(rest, breathe, ease.inOutCubic(seg(t, 0, CUE.punch[0])));
  // Through the line: aimed between the two lines, so the gap opens around the lens.
  const through = { x: 30, y: 8, z: 0, d: 150, rx: 0, ry: 2, rz: -3 };
  cam = mixCam(cam, through, ease.inExpo(seg(t, CUE.punch[0], CUE.punch[1])));
  return cam;
}

export const hook = {
  id: "hook",
  from: 0,
  to: CUE.app,
  mount(root) {
    root.append(h("div", { class: "hook-bg" }), h("div", { class: "shaft" }));
    this.dust = new Dust(root, 130, 5);
    this.world = h("div", { class: "world" });
    root.append(h("div", { class: "viewport" }, this.world));

    this.under = h("i", { class: "hook-under" });
    const free = h("span", { class: "hook-free" }, FIRST[1], this.under);
    this.lines = [
      h("span", { class: "hook-line" }, FIRST[0], " ", free, " ", FIRST[2]),
      h("span", { class: "hook-line" }, SECOND.join(" ")),
    ];
    this.kicker = h("div", { class: "hook-kicker" }, markInline(54), h("span", { text: LINES.kicker.text }));
    this.rule = h("div", { class: "hook-rule" });
    this.hook = h("div", { class: "hook" }, this.kicker, h("div", { class: "hook-lines" }, this.lines), this.rule);
    this.world.append(this.hook);

    this.vignette = h("div", { class: "vignette" });
    this.flash = h("div", { class: "flash" });
    root.append(this.vignette, this.flash);
  },

  draw(t) {
    const base = camAt(t);
    const hand = shake(t, 0.12);
    const cam = { ...base, x: base.x + hand.x, y: base.y + hand.y, rz: (base.rz ?? 0) + hand.rz };
    put(this.world, { transform: view(cam) });
    const punch = seg(t, CUE.punch[0], CUE.punch[1]);
    this.dust.draw(t, { focus: lerp(1.1, 0.4, punch), alpha: 0.55, zoom: LENS / cam.d, pan: { x: t * 8, y: 0 } });

    // A sheen of white light crosses the chrome; the stroke underlines "free".
    const sheen = lerp(-40, 140, ease.inOutCubic(seg(t, CUE.sheen[0], CUE.sheen[1])));
    for (const line of this.lines) put(line, { "--sheen": `${sheen.toFixed(1)}%` });
    put(this.under, { transform: `scaleX(${ease.outExpo(seg(t, CUE.underline[0], CUE.underline[1])).toFixed(4)})` });
    put(this.rule, { opacity: 0.4 + 0.6 * seg(t, 0.2, 0.8) });

    // As the camera dives, the words lose focus and the frame whites out on the beat.
    const near = seg(t, CUE.punch[1] - 0.22, CUE.punch[1]);
    put(this.hook, { opacity: 1 - 0.7 * near, filter: punch > 0.3 ? `blur(${(near * 18).toFixed(1)}px)` : "none" });
    put(this.flash, { opacity: ease.inCubic(seg(t, CUE.punch[1] - 0.12, CUE.punch[1])) });
  },
};
