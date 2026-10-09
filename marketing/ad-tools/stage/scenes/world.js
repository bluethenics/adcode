/**
 * 0–7 s. One idea, then too many tools.
 *
 * One continuous 3D space filmed by one camera. "You had one idea." resolves out of code
 * glyphs in a shaft of light; its full stop is the idea - it glows, the words fall away, and
 * it splits into six points of light that streak down and crystallise into the tiles of a
 * glass dock. A pointer clicks the chat tile and the loop starts: the camera whips from app
 * to app - copy from the chat, paste in the editor, refresh the browser, copy the error from
 * the terminal, paste it back into the chat - every round faster, the tabs multiplying, the
 * hand getting shakier, until it pulls back on a pile of windows. Hard cut at 7.0.
 */
import { CUE, LINES, LOOP } from "../cues.js";
import { clamp, ease, h, lerp, put, rng, seg, spring, tf } from "../shared/engine.js";
import { Dust, LENS, Streak, decode, mixCam, shake, view } from "../fx.js";
import { pointer } from "../shared/ui.js";
import { CLICK, WIN, browserApp, chatApp, docsApp, editorApp, gitApp, keycaps, popKeys, terminalApp } from "./apps.js";

const TILE = 132;
const DOCK_Y = 330;
const ORDER = ["editor", "chat", "terminal", "browser", "git", "docs"];
const tileX = (i) => (i - 2.5) * 160;

const GLYPH = {
  editor: "M9 7l-5 5 5 5M15 7l5 5-5 5",
  chat: "M4 5h16v11H9l-5 4z",
  terminal: "M5 7l5 5-5 5M12 17h7",
  browser: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  git: "M6 4v10M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 10c0 5-12 3-12 6",
  docs: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
};

/** Where each app's window hangs in the world, and how it is turned. */
const PLACE = {
  chat: { x: -520, y: -60, z: -150, ry: 14 },
  editor: { x: 430, y: -150, z: -60, ry: -12 },
  browser: { x: -80, y: -470, z: -520, ry: 4 },
  terminal: { x: 660, y: 250, z: -380, ry: -18 },
  git: { x: -900, y: 330, z: -760, ry: 22 },
  docs: { x: 200, y: 560, z: -980, ry: -7 },
};

const place = ({ x, y, z, ry = 0, rx = 0 }, s = 1, w = 0, hgt = 0) =>
  `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateY(${ry.toFixed(3)}deg) rotateX(${rx.toFixed(3)}deg) scale(${s.toFixed(4)}) translate(${-w / 2}px, ${-hgt / 2}px)`;

/** The camera, before the hand shakes it. */
function baseCam(t) {
  const open = { x: 0, y: -20, z: 0, d: lerp(1780, 1620, ease.outCubic(seg(t, 0, 2))), rx: 0, ry: 0 };
  if (t < 2.0) return open;
  const dock = { x: 0, y: 250, z: 0, d: 1180, rx: 12, ry: 0 };
  let cam = mixCam(open, dock, ease.inOutCubic(seg(t, 2.0, 3.0)));
  const chatTile = { x: tileX(1) * 0.6, y: DOCK_Y - 10, z: 0, d: 980, rx: 14, ry: 0 };
  cam = mixCam(cam, chatTile, ease.inOutCubic(seg(t, 3.15, 3.6)));
  for (let i = 0; i < LOOP.length; i += 1) {
    const shot = LOOP[i];
    if (t < shot.at) break;
    const p = PLACE[shot.app];
    const whip = Math.min(0.2, shot.dur * 0.42);
    const target = { x: p.x, y: p.y, z: p.z, d: 1240 - 60 * seg(t, shot.at, shot.at + shot.dur), rx: 0, ry: p.ry * 0.8 };
    cam = mixCam(cam, target, ease.inOutQuint(seg(t, shot.at, shot.at + whip)));
  }
  const pile = { x: -40, y: 20, z: -420, d: lerp(3200, 3500, seg(t, CUE.pile + 0.5, CUE.silence)), rx: 7, ry: -5 };
  return mixCam(cam, pile, ease.inOutCubic(seg(t, CUE.pile, CUE.pile + 0.48)));
}

function screenSpeed(t) {
  const dt = 1 / 480;
  const [a, b] = [baseCam(t - dt), baseCam(t + dt)];
  const scale = LENS / ((a.d + b.d) / 2);
  const rad = Math.PI / 180;
  return {
    x: ((b.x - a.x) * scale + (b.ry - a.ry) * rad * LENS) / (2 * dt),
    y: ((b.y - a.y) * scale - (b.rx - a.rx) * rad * LENS) / (2 * dt),
    zoom: Math.abs(Math.log(a.d / b.d)) / (2 * dt),
  };
}

/** A point along a cubic Bézier. */
function bez(p0, p1, p2, p3, u) {
  const v = 1 - u;
  return v * v * v * p0 + 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u * p3;
}

export const world = {
  id: "world",
  from: 0,
  to: CUE.silence,
  mount(root) {
    const random = rng(2026);
    this.bg = h("div", { class: "world-bg" });
    this.shaft = h("div", { class: "shaft" });
    root.append(this.bg, this.shaft);
    this.dust = new Dust(root, 160, 17);
    this.streak = new Streak("world-streak");
    this.worldEl = h("div", { class: "world" });
    this.wrap = h("div", { class: "wrap" }, this.streak.svg, h("div", { class: "viewport" }, this.worldEl));
    root.append(this.wrap, h("div", { class: "vignette" }));

    // The line, and its full stop as a separate dot of light.
    const text = LINES.idea.text.slice(0, -1);
    this.titleText = h("span", { class: "title-text" });
    this.dot = h("span", { class: "idea-dot" });
    this.titleLine = h("div", { class: "idea" }, this.titleText, this.dot);
    this.titleWords = text;
    this.worldEl.append(this.titleLine);
    this.light = h("div", { class: "idea-light" });
    this.flare = h("div", { class: "flare" });
    this.worldEl.append(this.light, this.flare);

    // The dock and its tiles.
    this.tray = h("div", { class: "dock-tray" });
    this.worldEl.append(this.tray);
    this.tiles = ORDER.map((app) => {
      const el = h("div", { class: "tile" },
        h("svg", { viewBox: "0 0 24 24", width: 54, height: 54, class: "tile-glyph" }, h("path", { d: GLYPH[app] })),
        h("div", { class: "tile-sheen" }));
      this.worldEl.append(el);
      return el;
    });
    this.dockPointer = pointer();
    this.worldEl.append(this.dockPointer);
    this.orbs = ORDER.map(() => {
      const trail = Array.from({ length: 6 }, () => h("div", { class: "orb ghost" }));
      const core = h("div", { class: "orb" });
      trail.forEach((ghost) => this.worldEl.append(ghost));
      this.worldEl.append(core);
      return { core, trail };
    });

    // The apps.
    const builders = { chat: chatApp, editor: editorApp, browser: browserApp, terminal: terminalApp, git: gitApp, docs: docsApp };
    this.apps = Object.fromEntries(ORDER.map((app) => {
      const one = builders[app]();
      this.worldEl.append(one.el);
      return [app, one];
    }));
    this.firstVisit = {};
    this.visits = LOOP.map((shot, i) => {
      const n = LOOP.slice(0, i).filter((other) => other.app === shot.app).length;
      if (n === 0) this.firstVisit[shot.app] = shot.at;
      return n;
    });
    this.keys = LOOP.map((shot) => {
      const el = keycaps(shot.keys);
      this.worldEl.append(el);
      return el;
    });

    // The pile: more of the same windows, and more keys, everywhere.
    const kinds = ["chat", "terminal", "editor", "browser", "chat", "docs", "terminal", "editor", "git", "chat", "browser", "terminal"];
    // Cloned in their resting state - no pointer, nothing pressed.
    for (const app of ORDER) this.apps[app].step(0, 0);
    this.ghosts = kinds.map((kind, i) => {
      const el = this.apps[kind].el.cloneNode(true);
      el.classList.add("ghost-win");
      this.worldEl.insertBefore(el, this.worldEl.firstChild);
      return {
        el,
        at: CUE.pile + 0.03 + i * 0.035,
        pos: { x: (random() - 0.5) * 3000, y: (random() - 0.5) * 1700, z: -500 - random() * 1500, ry: (random() - 0.5) * 50, rx: (random() - 0.5) * 16 },
      };
    });
    this.flying = Array.from({ length: 9 }, (_, i) => {
      const el = keycaps([["Ctrl", "C"], ["Ctrl", "V"], ["F5"], ["Alt", "Tab"]][i % 4]);
      this.worldEl.append(el);
      return { el, at: CUE.pile + 0.08 + i * 0.045, pos: { x: (random() - 0.5) * 2600, y: (random() - 0.5) * 1400, z: 200 + random() * 600, ry: (random() - 0.5) * 30 } };
    });
  },

  draw(t) {
    const base = baseCam(t);
    const hand = shake(t, t < CUE.loop ? 0.25 : lerp(0.4, 2.2, ease.inCubic(seg(t, CUE.loop, CUE.silence))));
    const cam = { ...base, x: base.x + hand.x, y: base.y + hand.y, rx: base.rx + hand.rx, ry: base.ry + hand.ry, rz: hand.rz };
    put(this.worldEl, { transform: view(cam) });

    // The whip: a smear along the camera's travel, about a fifth of a 180° shutter's length.
    const speed = screenSpeed(t);
    const smear = (v) => Math.min(70, Math.abs(v) / 120 / 5);
    put(this.wrap, { filter: this.streak.set(smear(speed.x), smear(speed.y)) });

    // Light, dust, the shaft.
    const loopDim = seg(t, CUE.loop - 0.2, CUE.loop + 0.3);
    put(this.shaft, { opacity: lerp(1, 0.35, loopDim), transform: `translateX(${(t * 10).toFixed(1)}px) rotate(${(22 + t * 0.6).toFixed(2)}deg)` });
    put(this.bg, { opacity: lerp(1, 0.6, loopDim) });
    this.dust.draw(t, { focus: t < 2.2 ? 1.0 : 1.6, pan: { x: cam.x * 0.3, y: cam.y * 0.3 }, alpha: lerp(1, 0.45, loopDim), zoom: LENS / cam.d });

    this.drawIdea(t);
    this.drawDock(t);
    this.drawLoop(t, cam);
  },

  drawIdea(t) {
    if (this.dotAt === undefined) {
      // Measured once fonts are in, from layout (transforms do not move offsets). Each
      // letter keeps its final width while glyphs flicker through it, so nothing shifts;
      // the dot's centre is taken relative to the line's centre, 30 px above the origin.
      this.letters = [...this.titleWords].map((char) => h("span", { class: "idea-letter", text: char === " " ? " " : char }));
      this.titleText.replaceChildren(...this.letters);
      for (const letter of this.letters) letter.style.width = `${letter.offsetWidth}px`;
      this.dotAt = {
        x: this.dot.offsetLeft + this.dot.offsetWidth / 2 - this.titleLine.offsetWidth / 2,
        y: this.dot.offsetTop + this.dot.offsetHeight / 2 - this.titleLine.offsetHeight / 2 - 30,
      };
    }
    const p = seg(t, CUE.decode[0], CUE.decode[1]);
    const shown = decode(this.titleWords, p, t);
    this.letters.forEach((letter, i) => { letter.textContent = shown[i] === " " ? " " : shown[i]; });
    const fall = ease.inCubic(seg(t, CUE.ideaOut[0], CUE.ideaOut[1]));
    put(this.titleText, { opacity: 1 - fall, filter: `blur(${(fall * 18).toFixed(1)}px)` });
    put(this.titleLine, { transform: `translate3d(-50%, -50%, 0) translate3d(0px, -30px, ${(-fall * 420).toFixed(1)}px)` });
    // The dot: arrives last, glows, and stays behind when the words go.
    const dotIn = seg(t, 0.72, 0.9);
    const glow = ease.inOutCubic(seg(t, 1.2, 2.0));
    const split = seg(t, 2.02, 2.1);
    put(this.dot, { opacity: dotIn * (1 - split), transform: `translateZ(${(fall * 420).toFixed(1)}px) scale(${(1 + glow * 0.5).toFixed(3)})` });
    const lightOn = dotIn * (0.25 + 0.75 * glow) * (1 - seg(t, 2.05, 2.4));
    put(this.light, {
      opacity: lightOn,
      transform: `translate3d(${this.dotAt.x.toFixed(1)}px, ${this.dotAt.y.toFixed(1)}px, 2px) scale(${(0.6 + glow * 1.1 + split * 0.8).toFixed(3)}) translate(-50%, -50%)`,
    });
    // The anamorphic streak: a lens's horizontal flare, as the idea burns brightest.
    const flare = ease.inOutCubic(seg(t, 1.45, 2.0)) * (1 - ease.inCubic(seg(t, 2.02, 2.3)));
    put(this.flare, {
      opacity: flare,
      transform: `translate3d(${this.dotAt.x.toFixed(1)}px, ${this.dotAt.y.toFixed(1)}px, 3px) scale(${(0.4 + 0.8 * flare + seg(t, 2.02, 2.3)).toFixed(3)}, 1) translate(-50%, -50%)`,
    });
  },

  drawDock(t) {
    // The dock steps out of the way while the loop runs, and is back, small, in the pile.
    const dockShown = 1 - seg(t, CUE.loop + 0.1, CUE.loop + 0.25) + seg(t, CUE.pile, CUE.pile + 0.2);
    const from = { x: this.dotAt.x, y: this.dotAt.y };
    this.tiles.forEach((tile, i) => {
      const leave = 2.04 + i * 0.035;
      const arrive = 2.42 + i * 0.05;
      const orb = this.orbs[i];
      const to = { x: tileX(i), y: DOCK_Y };
      const c1 = { x: from.x + (i - 2.5) * 360, y: from.y - 240 - (i % 2) * 90 };
      const c2 = { x: to.x + (i - 2.5) * 60, y: to.y - 420 };
      const at = (u) => ({ x: bez(from.x, c1.x, c2.x, to.x, u), y: bez(from.y, c1.y, c2.y, to.y, u) });
      const u = ease.inOutCubic(seg(t, leave, arrive));
      const flying = t >= leave && t < arrive + 0.2;
      const flash = seg(t, arrive, arrive + 0.05) * (1 - seg(t, arrive + 0.05, arrive + 0.3));
      const pos = at(u);
      put(orb.core, {
        display: flying ? "block" : "none",
        opacity: t < arrive ? 1 : 1 - seg(t, arrive, arrive + 0.2),
        transform: `translate3d(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px, 6px) scale(${(1 + flash * 0.9).toFixed(3)}) translate(-50%, -50%)`,
      });
      orb.trail.forEach((ghost, k) => {
        const back = ease.inOutCubic(seg(t - (k + 1) * 0.018, leave, arrive));
        const g = at(back);
        put(ghost, {
          display: t >= leave && t < arrive ? "block" : "none",
          opacity: (0.55 - k * 0.08) * (u > 0.02 ? 1 : 0),
          transform: `translate3d(${g.x.toFixed(1)}px, ${g.y.toFixed(1)}px, 5px) scale(${(1 - k * 0.12).toFixed(3)}) translate(-50%, -50%)`,
        });
      });
      // The tile crystallises where its light lands, then is pressed if it is the chat.
      const since = t - arrive;
      const grow = since <= 0 ? 0 : spring(since, 260, 15);
      const pressed = i === 1 ? seg(t, 3.42, 3.47) * (1 - seg(t, 3.5, 3.62)) : 0;
      put(tile, {
        opacity: clamp(since / 0.08) * dockShown,
        filter: since < 0.22 ? `blur(${((1 - since / 0.22) * 10).toFixed(1)}px)` : "none",
        transform: place({ x: to.x, y: to.y, z: 0 }, (0.3 + 0.7 * grow) * (1 - 0.1 * pressed), TILE, TILE),
        "--sheen": `${lerp(-120, 220, ease.inOutCubic(seg(t, arrive + 0.15, arrive + 0.75))).toFixed(1)}%`,
      });
    });
    // The pointer comes up from below and clicks the chat tile at 3.42.
    const reach = ease.inOutCubic(seg(t, CUE.pointer, 3.4));
    const click = seg(t, 3.42, 3.46) * (1 - seg(t, 3.5, 3.6));
    put(this.dockPointer, {
      display: t >= CUE.pointer && t < CUE.loop + 0.15 ? "block" : "none",
      opacity: seg(t, CUE.pointer, CUE.pointer + 0.08) * (1 - seg(t, CUE.loop, CUE.loop + 0.12)),
      transform: `translate3d(${lerp(420, tileX(1) + 18, reach).toFixed(1)}px, ${lerp(640, DOCK_Y + 12, reach).toFixed(1)}px, 12px) scale(${(1.5 * (1 - 0.15 * click)).toFixed(3)})`,
    });
    const tray = ease.outCubic(seg(t, 2.7, 3.1));
    put(this.tray, { opacity: tray * dockShown, transform: place({ x: 0, y: DOCK_Y, z: -8 }, 0.94 + 0.06 * tray, 1000, 176) });
  },

  drawLoop(t, cam) {
    // Which shot is live, and how far into it.
    let live = -1;
    LOOP.forEach((shot, i) => { if (t >= shot.at) live = i; });
    const inPile = t >= CUE.pile;
    const pileP = ease.inOutCubic(seg(t, CUE.pile, CUE.pile + 0.48));

    for (const app of ORDER) {
      const one = this.apps[app];
      const p = PLACE[app];
      const first = this.firstVisit[app] ?? (CUE.pile + (app === "git" ? 0.02 : 0.1));
      const since = t - first;
      const tile = { x: tileX(ORDER.indexOf(app)), y: DOCK_Y, z: 0, ry: 0 };
      const out = ease.outExpo(clamp(since / 0.3));
      const pos = { x: lerp(tile.x, p.x, out), y: lerp(tile.y, p.y, out), z: lerp(tile.z, p.z, out), ry: lerp(0, p.ry, out) };
      // Depth of field: sharp on the window the camera is on, soft elsewhere.
      const focused = live >= 0 && LOOP[live].app === app && !inPile;
      const far = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
      const blur = focused ? 0 : inPile ? lerp(Math.min(10, far / 160), 1.5, pileP) : Math.min(12, far / 110);
      put(one.el, {
        display: since >= 0 ? "block" : "none",
        opacity: clamp(since / 0.08),
        filter: blur > 0.4 ? `blur(${blur.toFixed(1)}px)` : "none",
        transform: place(pos, lerp(TILE / WIN.w, 1, out), WIN.w, WIN.h),
      });
    }
    // Every app is drawn in the state of its own latest shot (finished shots at their end),
    // so a frame looks the same whether it is rendered in order or on its own as a still.
    for (const app of ORDER) {
      let latest = -1;
      LOOP.forEach((shot, i) => { if (shot.app === app && i <= live) latest = i; });
      if (latest < 0) this.apps[app].step(0, 0);
      else this.apps[app].step(this.visits[latest], latest === live && !inPile ? clamp((t - LOOP[latest].at) / LOOP[latest].dur) : 1);
    }
    LOOP.forEach((shot, i) => {
      const local = clamp((t - shot.at) / shot.dur);
      const key = this.keys[i];
      const p = PLACE[shot.app];
      const on = t >= shot.at && (i === live || i === live - 1) && !inPile;
      put(key, { display: on ? "flex" : "none" });
      if (on) {
        popKeys(key, i === live ? local : 1, shot.dur);
        key.style.transform = `${place({ ...p, x: p.x + 250, y: p.y + 170 })} translate(-50%, -50%) ${key.style.transform}`;
        if (i === live - 1) key.style.opacity = String(Number(key.style.opacity) * (1 - seg(t, LOOP[live].at, LOOP[live].at + 0.08)));
      }
    });

    // The pile.
    for (const ghost of this.ghosts) {
      const since = t - ghost.at;
      const grow = since <= 0 ? 0 : spring(since, 200, 14);
      put(ghost.el, {
        display: since >= 0 ? "block" : "none",
        opacity: clamp(since / 0.06),
        filter: `blur(${(2 + Math.abs(ghost.pos.z + 900) / 260).toFixed(1)}px)`,
        transform: place(ghost.pos, 0.6 + 0.4 * grow, WIN.w, WIN.h),
      });
    }
    for (const key of this.flying) {
      const since = t - key.at;
      const grow = since <= 0 ? 0 : spring(since, 300, 12);
      put(key.el, {
        display: since >= 0 ? "flex" : "none",
        opacity: clamp(since / 0.05),
        transform: `${place(key.pos)} scale(${(1.6 * grow).toFixed(3)}) translate(-50%, -50%)`,
      });
    }
  },
};
