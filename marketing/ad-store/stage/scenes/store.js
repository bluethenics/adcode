/**
 * 12.3–16.05 s. Windows, and the launch itself.
 *
 * The desktop rises in from below as the ledger whips away: a warm wallpaper, a centred
 * taskbar. The Microsoft Store opens on ADCode's listing - the icon, bluethenics, Developer
 * tools, "An AI code editor that pays you to build." - while "Now on the Microsoft
 * Store." sets beside it. The pointer glides to Get and clicks; a progress bar fills; Open.
 * ADCode pins itself to the taskbar. Then the camera dives into the app icon, and its cream
 * plate becomes the end card's.
 *
 * Drawn in ADCode's palette rather than as a copy of Windows: no Windows or Store logos, just
 * the shapes anyone recognises - a centred taskbar, a store window, a Get button.
 */
import { CUE, LINES } from "../cues.js";
import { ease, h, lerp, put, seg, spring } from "../shared/engine.js";
import { icon, markInline, pointer } from "../shared/ui.js";
import { drift, SIZE, SQUARE, wordSpans } from "../fx.js";

const WIN = SQUARE ? { w: 980, h: 600, cx: 0, cy: 50 } : { w: 1060, h: 690, cx: 360, cy: -30 };
/** How far the dive zooms: the 150 px icon ends wider than the frame, all cream plate. */
export const DIVE = 15;
export const ICON = 150;

function offset(element, ancestor) {
  let x = 0;
  let y = 0;
  for (let node = element; node && node !== ancestor; node = node.offsetParent) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y, w: element.offsetWidth, h: element.offsetHeight };
}

function bag(size) {
  return h("svg", { viewBox: "0 0 24 24", width: size, height: size, class: "icon" },
    h("path", { d: "M5 8h14l-1.2 12H6.2zM9 8V7a3 3 0 0 1 6 0v1" }));
}

export const store = {
  id: "store",
  from: CUE.desktop - 0.2,
  to: CUE.mark + 0.05,
  mount(root) {
    this.pin = h("div", { class: "tb-icon app ad" }, markInline(28), h("span", { class: "pip" }));
    const taskbar = h("div", { class: "taskbar" },
      h("div", { class: "tb-search" }, icon("search", 20), h("span", { text: "Search" })),
      h("div", { class: "tb-icon" }, icon("folder", 26)),
      h("div", { class: "tb-icon" }, icon("globe", 26)),
      h("div", { class: "tb-icon" }, bag(26)),
      this.pin);
    const tray = h("div", { class: "tray" }, h("span", { text: "10:42 AM" }), h("small", { text: "10/2/2026" }));

    this.appIcon = h("div", { class: "app-icon" }, markInline(114));
    this.get = h("div", { class: "get", text: "Get" });
    this.free = h("span", { class: "get-free", text: "Free" });
    this.bar = h("div", { class: "bar" });
    this.percent = h("span", { text: "Installing…" });
    this.progress = h("div", { class: "progress" }, h("div", { class: "track" }, this.bar), this.percent);
    const listing = h("div", { class: "listing" }, this.appIcon,
      h("div", {},
        h("div", { class: "app-name", text: "ADCode" }),
        h("div", { class: "app-by", text: "bluethenics" }),
        h("div", { class: "app-cat", text: "Developer tools" }),
        h("div", { class: "app-desc", text: "An AI code editor that pays you to build." }),
        h("div", { class: "get-row" }, this.get, this.free, this.progress)));
    const shots = h("div", { class: "shots" }, [0, 1, 2].map(() =>
      h("div", { class: "shot" }, h("i", { class: "w60" }), h("i", { class: "w80" }), h("i", { class: "acc" }), h("i", { class: "w40" }), h("i", { class: "w60" }))));
    this.window = h("div", { class: "store" },
      h("div", { class: "store-bar" }, bag(18), h("span", { text: "Microsoft Store" }),
        h("div", { class: "ctl" }, h("span", { text: "—" }), h("span", { text: "▢" }), h("span", { text: "✕" }))),
      h("div", { class: "store-body" },
        h("div", { class: "store-rail" }, h("span", { class: "on" }, icon("globe", 24)), icon("tools", 24), icon("folder", 24), icon("download", 24)),
        h("div", { class: "store-main" }, h("div", { class: "banner" }), listing, shots)));
    this.window.style.width = `${WIN.w}px`;
    this.window.style.height = `${WIN.h}px`;
    this.pointer = pointer();
    this.line = h("div", { class: "store-line" }, wordSpans(LINES.store.text));
    this.desk = h("div", { class: "desk" },
      h("div", { class: "ribbon", style: { top: "62%", transform: "rotate(-8deg)" } }),
      h("div", { class: "ribbon", style: { top: "70%", transform: "rotate(-5deg)", opacity: "0.6" } }));
    this.scene = h("div", { class: "layer-wrap", style: { position: "absolute", inset: "0", transformOrigin: "0 0" } },
      this.desk, h("div", { class: "center" }, this.window, this.line, this.pointer), taskbar, tray);
    root.append(this.scene);
    this.layout = null;
  },

  measure() {
    const get = offset(this.get, this.window);
    const appIcon = offset(this.appIcon, this.window);
    const left = WIN.cx - WIN.w / 2;
    const top = WIN.cy - WIN.h / 2;
    // Screen coordinates from the frame's centre.
    return {
      get: { x: left + get.x + get.w / 2, y: top + get.y + get.h / 2 },
      icon: { x: left + appIcon.x + appIcon.w / 2, y: top + appIcon.y + appIcon.h / 2, w: appIcon.w },
      left, top,
    };
  },

  draw(t) {
    if (this.layout === null) this.layout = this.measure();
    const L = this.layout;

    // In from below on the ledger's whip; a slow push; then the dive into the icon.
    const rise = ease.outExpo(seg(t, CUE.desktop - 0.18, CUE.desktop + 0.25));
    const push = 1 + 0.035 * seg(t, CUE.desktop, CUE.dive[0]);
    const dive = ease.inCubic(seg(t, CUE.dive[0], CUE.dive[1]));
    // Zoom grows geometrically, so the dive reads as one even rush rather than a lurch.
    const zoom = push * DIVE ** dive;
    // The icon is the focus: it stays where the push put it, then slides to the centre.
    const P = { x: SIZE.w / 2 + L.icon.x, y: SIZE.h / 2 + L.icon.y };
    const S = { x: lerp(SIZE.w / 2 + push * L.icon.x, SIZE.w / 2, dive), y: lerp(SIZE.h / 2 + push * L.icon.y, SIZE.h / 2, dive) };
    const d = drift(t, 0.6, 51);
    put(this.scene, {
      transform: `translate(${(S.x - zoom * P.x + d.x * (1 - dive)).toFixed(2)}px, ${(S.y - zoom * P.y + lerp(SIZE.h * 1.25, 0, rise) + d.y * (1 - dive)).toFixed(2)}px) scale(${zoom.toFixed(4)})`,
    });

    // The Store window opens the way Windows opens windows: up a little, scaling in.
    const open = ease.outExpo(seg(t, CUE.store, CUE.store + 0.45));
    put(this.window, {
      opacity: seg(t, CUE.store, CUE.store + 0.15),
      transform: `translate(${L.left}px, ${(L.top + lerp(30, 0, open)).toFixed(1)}px) scale(${lerp(0.94, 1, open).toFixed(4)})`,
    });

    // The pointer, to Get; the click; the install; Open.
    const glide = ease.inOutCubic(seg(t, CUE.pointer[0], CUE.pointer[1]));
    const from = { x: L.get.x + 420, y: L.get.y + 380 };
    const press = t >= CUE.click && t < CUE.click + 0.12;
    put(this.pointer, {
      opacity: seg(t, CUE.pointer[0], CUE.pointer[0] + 0.1) * (1 - seg(t, CUE.dive[0], CUE.dive[0] + 0.1)),
      transform: `translate(${lerp(from.x, L.get.x + 18, glide).toFixed(1)}px, ${lerp(from.y, L.get.y + 6, glide).toFixed(1)}px) scale(${press ? 0.88 : 1})`,
    });
    const installing = t >= CUE.install[0] && t < CUE.open;
    const opened = t >= CUE.open;
    const popOpen = opened ? spring(t - CUE.open, 300, 15) : 1;
    put(this.get, {
      display: installing ? "none" : "grid",
      transform: `scale(${press ? 0.95 : opened ? lerp(0.8, 1, popOpen).toFixed(4) : 1})`,
      background: press ? "#c9c7c0" : "",
    });
    this.get.textContent = opened ? "Open" : "Get";
    put(this.free, { display: installing ? "none" : "inline" });
    put(this.progress, { display: installing ? "flex" : "none" });
    const fill = ease.inOutCubic(seg(t, CUE.install[0], CUE.install[1]));
    put(this.bar, { transform: `scaleX(${fill.toFixed(4)})` });
    this.percent.textContent = `Installing… ${Math.round(fill * 100)}%`;
    const pinned = t < CUE.pinned ? 0 : spring(t - CUE.pinned, 260, 14);
    put(this.pin, { opacity: t >= CUE.pinned ? 1 : 0, transform: `scale(${pinned.toFixed(4)})`, width: `${(44 * Math.min(1, pinned * 1.5)).toFixed(1)}px` });

    // The line, a word at a time; gone before the dive.
    this.line.querySelectorAll(".word").forEach((word, i) => {
      const at = LINES.store.from - 0.3 + i * 0.07;
      const q = ease.outCubic(seg(t, at, at + 0.4));
      put(word, { opacity: q, transform: `translateY(${lerp(40, 0, q).toFixed(1)}px)`, filter: q < 0.98 ? `blur(${((1 - q) * 12).toFixed(1)}px)` : "none" });
    });
    put(this.line, { opacity: 1 - seg(t, CUE.dive[0] - 0.1, CUE.dive[0] + 0.1) });
  },
};
