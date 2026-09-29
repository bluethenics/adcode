/**
 * The drawing kit: the <$> mark in movable parts, the agents' mascots, line icons, a
 * pointer. Shapes are ADCode's own - the mark's paths from build/icon.svg, the mascots'
 * bodies and faces from apps/desktop/src/renderer/agents/agentMascot.ts - drawn here in
 * monochrome, because in this film the only colour is money.
 */
import { h } from "./engine.js";

const MARK = {
  left: { d: "M320 348L140 512L320 676", width: 96 },
  right: { d: "M704 348L884 512L704 676", width: 96 },
  dollar: [
    { d: "M512 296V388", width: 64 },
    { d: "M512 636V728", width: 64 },
    { d: "M584 405C563 374 531 356 494 356C446 356 413 383 413 423C413 463 444 484 505 500C569 517 606 541 606 590C606 641 565 671 511 671C466 671 429 651 405 619", width: 92 },
  ],
};

function markSvg(strokes) {
  return h("svg", { viewBox: "0 0 1024 1024", class: "mark-svg" },
    h("g", { fill: "none", stroke: "currentColor", "stroke-linecap": "round", "stroke-linejoin": "round" },
      strokes.map(({ d, width }) => h("path", { d, "stroke-width": width }))));
}

/** The three parts of the mark, each a full-size layer so they can move independently. */
export function markParts() {
  return {
    left: h("div", { class: "mark-part mark-left" }, markSvg([MARK.left])),
    right: h("div", { class: "mark-part mark-right" }, markSvg([MARK.right])),
    dollar: h("div", { class: "mark-part mark-dollar" }, markSvg(MARK.dollar)),
  };
}

/** The whole mark as one small inline element (title bars, the ADCode node). */
export function markInline(size, className = "") {
  const svg = markSvg([MARK.left, MARK.right, ...MARK.dollar]);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  return h("span", { class: `mark-inline ${className}` }, svg);
}

const SHAPES = {
  circle: "M24 5a19 19 0 1 1 0 38a19 19 0 1 1 0-38z",
  capsule: "M15 9h18a15 15 0 0 1 0 30H15a15 15 0 0 1 0-30z",
  drop: "M24 4c6 8 17 15.5 17 25a17 17 0 0 1-34 0c0-9.5 11-17 17-25z",
  hexagon: "M21 5.2a6 6 0 0 1 6 0l12 7a6 6 0 0 1 3 5.2v13.2a6 6 0 0 1-3 5.2l-12 7a6 6 0 0 1-6 0l-12-7a6 6 0 0 1-3-5.2V17.4a6 6 0 0 1 3-5.2z",
  egg: "M24 4c9.5 0 16.5 13.5 16.5 23.5a16.5 16.5 0 0 1-33 0C7.5 17.5 14.5 4 24 4z",
  cloud: "M15 39a10 10 0 0 1-2.5-19.7A12 12 0 0 1 35.3 17 9.5 9.5 0 0 1 37 39z",
};

const FACES = {
  thinking: [
    { d: "M17.5 20.5a2 2.6 0 1 1 0 .01z", fill: true },
    { d: "M28.5 20.5a2 2.6 0 1 1 0 .01z", fill: true },
    { d: "M21 31.5h6" },
  ],
  alert: [
    { d: "M18.5 21a2.6 3 0 1 1 0 .01z", fill: true },
    { d: "M29.5 21a2.6 3 0 1 1 0 .01z", fill: true },
    { d: "M24 30.5a2 2 0 1 1 0 .01z", fill: true },
  ],
  proud: [
    { d: "M15.5 25q3-3 6 0" },
    { d: "M26.5 25q3-3 6 0" },
    { d: "M19.5 30.5q4.5 3.5 9 0" },
  ],
  happy: [
    { d: "M18.5 22.5a2.2 2.8 0 1 1 0 .01z", fill: true },
    { d: "M29.5 22.5a2.2 2.8 0 1 1 0 .01z", fill: true },
    { d: "M18 29.5q6 6 12 0" },
  ],
};

/** A monochrome agent mascot whose face can change. */
export function mascot(shape, size) {
  const face = h("g", { class: "mascot-face" });
  const svg = h("svg", { viewBox: "0 0 48 48", width: size, height: size, class: "mascot" },
    h("path", { d: SHAPES[shape], class: "mascot-body" }), face);
  let mood = null;
  const setMood = (next) => {
    if (next === mood) return;
    mood = next;
    face.replaceChildren(...FACES[next].map(({ d, fill }) => h("path", { d, class: fill ? "fill" : "stroke" })));
  };
  setMood("thinking");
  return { element: svg, setMood };
}

/** The chat assistant: bloub's round body with two pill eyes, as in the app. */
export function assistantFace(size) {
  const eye = "M-9.3 -11.3A9.3 9.3 0 0 1 0 -20.6L0 -20.6A9.3 9.3 0 0 1 9.3 -11.3L9.3 11.3A9.3 9.3 0 0 1 0 20.6L0 20.6A9.3 9.3 0 0 1 -9.3 11.3Z";
  return h("svg", { viewBox: "-125 -125 250 250", width: size, height: size, class: "assistant-face" },
    h("circle", { r: 100, class: "mascot-body" }),
    h("path", { d: eye, transform: "translate(-27,-44) rotate(8) scale(1.12)", class: "fill" }),
    h("path", { d: eye, transform: "translate(27,-44) rotate(-8) scale(1.12)", class: "fill" }));
}

const ICONS = {
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  file: "M7 3h7l5 5v13H7zM14 3v5h5",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  terminal: "M5 7l5 5-5 5M12 17h7",
  git: "M6 4v10M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 10c0 5-12 3-12 6",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4",
  chat: "M4 5h16v11H9l-5 4z",
  agents: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6M3 19c0-3 3-5 6-5s6 2 6 5M17 14c2 0 4 2 4 5",
  tools: "M14.5 4.5a4 4 0 0 0-5 5L4 15v5h5l5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-3-3z",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  refresh: "M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  flame: "M12 3c3.5 4 6 6.5 6 11a6 6 0 0 1-12 0c0-3 1.7-4.8 3-6 .2 2 1 3 2.2 3.2C10.5 8 11 5.5 12 3z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  play: "M8 5v14l11-7z",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
};

export function icon(name, size = 20, className = "") {
  return h("svg", { viewBox: "0 0 24 24", width: size, height: size, class: `icon ${className}` }, h("path", { d: ICONS[name] }));
}

/** The pointer, drawn like the system's: white with a dark edge. */
export function pointer() {
  return h("svg", { viewBox: "0 0 24 24", width: 44, height: 44, class: "pointer" },
    h("path", { d: "M5 3l14 9.5-6.2 1.3 3.7 6.8-2.6 1.4-3.7-6.9L5 19.5z" }));
}
