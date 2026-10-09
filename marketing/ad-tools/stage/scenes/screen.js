/**
 * 7.0–10.6 s. The screen.
 *
 * A hard cut to silence: one aluminium display turning in the dark, lit from the side. On
 * the beat, discs of light burst out behind it - four of them, largest and brightest first,
 * each with a ring that races off - while it swings round to face us. The discs fall away,
 * the camera pushes into the glass, the glass burns white, and on the white:
 * "Your code lives in too many tools."
 */
import { CUE, LINES } from "../cues.js";
import { clamp, ease, h, lerp, put, seg, spring } from "../shared/engine.js";
import { inBack, shake, view, wordSpans } from "../fx.js";

const M = { w: 1000, h: 580, d: 30 };
const DISCS = [
  { r: 620, fill: "#efeeea" },
  { r: 470, fill: "#b9b8b3" },
  { r: 330, fill: "#76756f" },
  { r: 200, fill: "#34332f" },
];

/** A light from the front left, a little above: how lit a face with normal n is. */
function lit([nx, ny, nz]) {
  const [lx, ly, lz] = [-0.55, -0.35, 0.76];
  return clamp(nx * lx + ny * ly + nz * lz);
}

function rotateY([x, y, z], deg) {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
}

export const screen = {
  id: "screen",
  from: CUE.silence,
  to: CUE.zero,
  mount(root) {
    this.floor = h("div", { class: "screen-floor" });
    this.discs = DISCS.map(({ r, fill }) => {
      const disc = h("div", { class: "disc", style: { width: `${r * 2}px`, height: `${r * 2}px`, marginLeft: `${-r}px`, marginTop: `${-r}px`, background: fill } });
      const ring = h("div", { class: "disc-ring", style: { width: `${r * 2}px`, height: `${r * 2}px`, marginLeft: `${-r}px`, marginTop: `${-r}px` } });
      return { disc, ring, r };
    });
    this.discLayer = h("div", { class: "disc-layer" }, this.discs.flatMap(({ ring, disc }) => [ring, disc]));

    // The display: a box of six faces, and a stand.
    const face = (cls, w, hgt, transform) => h("div", { class: `m-face ${cls}`, style: { width: `${w}px`, height: `${hgt}px`, transform } },
      h("div", { class: "m-shade" }));
    const half = M.d / 2;
    // On the glass, dimmed: the pile of windows from the loop, shrunk to a thumbnail.
    this.glass = h("div", { class: "m-glass" }, h("div", { class: "m-mosaic" },
      [[40, 60, 300, 190], [300, 30, 320, 210], [590, 90, 300, 200], [120, 250, 330, 200], [420, 270, 300, 190], [700, 300, 230, 170]].map(([x, y, w, hh]) =>
        h("i", { style: { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hh}px` } }))));
    this.faces = {
      front: face("m-front", M.w, M.h, `translate(${-M.w / 2}px, ${-M.h / 2}px) translateZ(${half}px)`),
      back: face("m-back", M.w, M.h, `translate(${-M.w / 2}px, ${-M.h / 2}px) translateZ(${-half}px) rotateY(180deg)`),
      left: face("m-edge", M.d, M.h, `translate(${-M.w / 2 - half}px, ${-M.h / 2}px) rotateY(-90deg)`),
      right: face("m-edge", M.d, M.h, `translate(${M.w / 2 - half}px, ${-M.h / 2}px) rotateY(90deg)`),
      top: face("m-edge", M.w, M.d, `translate(${-M.w / 2}px, ${-M.h / 2 - half}px) rotateX(90deg)`),
      bottom: face("m-edge", M.w, M.d, `translate(${-M.w / 2}px, ${M.h / 2 - half}px) rotateX(-90deg)`),
    };
    this.faces.front.append(this.glass);
    const arm = h("div", { class: "m-face m-arm", style: { width: "200px", height: "330px", transform: `translate(-100px, 150px) translateZ(${-half - 40}px) rotateX(-16deg)` } }, h("div", { class: "m-shade" }));
    const base = h("div", { class: "m-face m-base", style: { width: "420px", height: "250px", transform: `translate(-210px, 330px) translateZ(${-half - 140}px) rotateX(90deg)` } }, h("div", { class: "m-shade" }));
    this.stand = [arm, base];
    this.monitor = h("div", { class: "monitor" }, arm, base, Object.values(this.faces));
    this.world = h("div", { class: "world" }, this.monitor);
    this.viewport = h("div", { class: "viewport" }, this.world);

    this.white = h("div", { class: "screen-white" });
    this.line = h("div", { class: "tools-line" }, wordSpans(LINES.tools.text));
    this.words = [...this.line.querySelectorAll(".word")];
    this.vignette = h("div", { class: "vignette soft" });
    root.append(this.floor, this.discLayer, this.viewport, this.white, this.line, this.vignette);
  },

  draw(t) {
    // The turn: from nearly edge-on, in the silence, round to face us by CUE.front.
    const turn = ease.inOutCubic(seg(t, CUE.silence, CUE.front));
    const ry = lerp(128, 0, turn);
    const rx = lerp(10, 0, turn);
    // The push: into the glass, until it is the whole frame.
    const push = ease.inExpo(seg(t, CUE.front - 0.02, CUE.white));
    const d = Math.exp(lerp(Math.log(lerp(2050, 1700, seg(t, CUE.silence, CUE.front))), Math.log(70), push));
    const hand = shake(t, 0.25 * (1 - push));
    put(this.world, { transform: view({ x: hand.x, y: hand.y - 20 * (1 - push), d, rx: hand.rx, ry: hand.ry, rz: hand.rz }) });
    put(this.monitor, { transform: `rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg)` });

    // Shade each face from the light, as the display turns.
    const normals = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, -1, 0], bottom: [0, 1, 0] };
    for (const [name, n] of Object.entries(normals)) {
      const light = lit(rotateY(n, ry));
      this.faces[name].firstChild.style.opacity = String((0.72 - light * 0.72).toFixed(3));
    }
    const standLight = lit(rotateY([0, 0, -1], ry));
    for (const part of this.stand) part.firstChild.style.opacity = String((0.55 - standLight * 0.4).toFixed(3));
    // A sheen crossing the glass as it turns, then the glass burning white.
    const burn = ease.inOutCubic(seg(t, CUE.front + 0.08, CUE.white - 0.1));
    put(this.glass, { "--sheen": `${lerp(-60, 160, turn).toFixed(1)}%`, "--burn": burn.toFixed(3) });

    // The discs, one on each beat, then gone as the push starts.
    const gone = inBack(seg(t, CUE.front - 0.05, CUE.front + 0.3));
    this.discs.forEach(({ disc, ring }, i) => {
      const at = CUE.discs[i];
      const since = t - at;
      const grow = since <= 0 ? 0 : spring(since, 240, 17);
      put(disc, { transform: `scale(${(grow * (1 - gone)).toFixed(4)})`, opacity: since <= 0 ? 0 : 1 });
      const wave = seg(since, 0, 0.6);
      put(ring, { transform: `scale(${(0.9 + wave * 0.7).toFixed(4)})`, opacity: since <= 0 ? 0 : (1 - wave) * 0.9 * (1 - gone) });
    });
    put(this.discLayer, { transform: `translate(${(hand.x * 0.6).toFixed(1)}px, ${(hand.y * 0.6).toFixed(1)}px)` });
    // A pool of light on the floor, so the dark before the first disc is never black.
    put(this.floor, { opacity: 0.55 + 0.45 * seg(t, CUE.silence, CUE.silence + 0.4) - 0.5 * push });

    // White, then the line, word by word.
    put(this.white, { opacity: seg(t, CUE.white - 0.1, CUE.white) });
    put(this.vignette, { opacity: 1 - 0.85 * seg(t, CUE.white - 0.2, CUE.white) });
    const drift = seg(t, CUE.white, CUE.zero);
    put(this.line, { display: t >= CUE.headline ? "block" : "none", transform: `translate(-50%, -50%) scale(${lerp(1, 1.045, drift).toFixed(4)})` });
    this.words.forEach((word, i) => {
      const rise = ease.outCubic(seg(t, CUE.headline + i * 0.05, CUE.headline + 0.28 + i * 0.05));
      put(word, { opacity: rise, transform: `translateY(${lerp(46, 0, rise).toFixed(1)}px)`, filter: rise < 1 ? `blur(${((1 - rise) * 12).toFixed(1)}px)` : "none" });
    });
  },
};

