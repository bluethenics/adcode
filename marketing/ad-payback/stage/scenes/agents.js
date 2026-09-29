/**
 * 8–12 s. "Agents take the rest."
 *
 * The 2.1 Agents board, in the app's own column order: WORKING, NEEDS YOU, READY. Three
 * starter agents take the habit tracker's follow-up work. Boxes glide on the beat, one
 * needs a click, and each lands in Ready with its proof of work.
 */
import { CUE } from "../cues.js";
import { aim, camera, ease, h, lerp, put, seg, tf } from "../engine.js";
import { icon, markInline, mascot, pointer } from "../ui.js";

const COLUMNS = ["Working", "Needs you", "Ready"];
const COLUMN_X = [28, 336, 644];
const SLOT_Y = (slot) => 214 + slot * 150;
const MOVE = 0.5;

const RUNS = [
  {
    name: "Reviewer", shape: "hexagon", task: "Review the streak logic", doing: "Reading 4 files…", proof: ["types ✓", "lint ✓"],
    keys: [{ at: 0, col: 0, slot: 0, state: "working" }, { at: CUE.moves.reviewer, col: 2, slot: 2, state: "ready", mood: "proud" }],
  },
  {
    name: "Tester", shape: "capsule", task: "Test habits.js", doing: "Running 12 tests…", proof: ["tests ✓", "types ✓"],
    keys: [{ at: 0, col: 0, slot: 1, state: "working" }, { at: CUE.moves.tester, col: 2, slot: 0, state: "ready", mood: "proud" }],
  },
  {
    name: "Bug fixer", shape: "drop", task: "Fix the date bug", doing: "Reproducing…", proof: ["tests ✓", "types ✓"],
    keys: [
      { at: 0, col: 0, slot: 2, state: "working" },
      { at: CUE.moves.tester, col: 0, slot: 1, state: "working" },
      { at: CUE.moves.fixerNeeds, col: 1, slot: 0, state: "needs", mood: "alert" },
      { at: CUE.moves.fixerReady, col: 2, slot: 1, state: "ready", mood: "happy" },
    ],
  },
];

/** Where a run is at `t`: its keyframes, with a glide between them. */
function placement(run, t) {
  let index = 0;
  for (let i = 1; i < run.keys.length; i += 1) if (t >= run.keys[i].at) index = i;
  const key = run.keys[index];
  const from = run.keys[Math.max(0, index - 1)];
  const p = index === 0 ? 1 : ease.inOutCubic(seg(t, key.at, key.at + MOVE));
  const arrived = p >= 0.5;
  return {
    x: lerp(COLUMN_X[from.col], COLUMN_X[key.col], p),
    y: lerp(SLOT_Y(from.slot), SLOT_Y(key.slot), p),
    lift: index === 0 ? 0 : Math.sin(Math.PI * p),
    state: arrived ? key.state : from.state,
    mood: (arrived ? key.mood : from.mood) ?? "thinking",
    landedAt: key.state === "ready" ? key.at + MOVE : null,
  };
}

const SHOTS = [
  { at: 0, cx: 480, cy: 404, s: 1.12 },
  { at: CUE.moves.fixerNeeds + 0.05, cx: 470, cy: 318, s: 1.3, move: 0.4 },
  { at: CUE.moves.fixerReady + 0.05, cx: 480, cy: 404, s: 1.12, move: 0.45 },
];

export const agents = {
  id: "agents",
  from: CUE.toAgents,
  to: CUE.montage[0],
  mount(root) {
    this.caption = h("div", { class: "caption" },
      "Agents take the rest.".split(" ").flatMap((word, i) => [i ? " " : null, h("span", { class: "word", text: word })]).filter(Boolean));

    this.subtitle = h("span", { class: "board-subtitle" });
    const header = h("div", { class: "board-header" },
      h("div", {}, h("div", { class: "board-title", text: "Agents" }), this.subtitle),
      h("div", { class: "board-new" }, icon("plus", 16), h("span", { text: "New task" })));
    this.counts = COLUMNS.map(() => h("span", { class: "column-count", text: "0" }));
    const columns = COLUMNS.map((label, i) =>
      h("div", { class: "board-column", style: { left: `${COLUMN_X[i]}px` } },
        h("div", { class: "column-head" }, h("span", { text: label.toUpperCase() }), this.counts[i])));

    this.cards = RUNS.map((run) => {
      const face = mascot(run.shape, 46);
      const ring = h("span", { class: "card-ring" });
      const dots = Array.from({ length: 8 }, () => h("span", { class: "card-dot" }));
      const status = h("div", { class: "card-status" }, h("span", { class: "card-doing", text: run.doing }), h("span", { class: "card-bar" }, h("span", { class: "card-bar-fill" })));
      const needs = h("div", { class: "card-needs" }, h("span", { text: "Approve the fix?" }), h("span", { class: "card-approve", text: "Approve" }));
      const proof = h("div", { class: "card-proof" }, run.proof.map((chip) => h("span", { class: "proof-chip", text: chip })));
      const element = h("div", { class: "run-card" },
        h("div", { class: "card-face" }, ring, dots, face.element),
        h("div", { class: "card-name", text: run.name }),
        h("div", { class: "card-task", text: run.task }),
        status, needs, proof);
      return { run, element, face, ring, dots, status, needs, proof, fill: status.querySelector(".card-bar-fill"), approve: needs.querySelector(".card-approve") };
    });

    this.cursor = h("div", { class: "board-cursor" }, pointer());
    this.board = h("div", { class: "app-window board-window" },
      h("div", { class: "win-titlebar" }, markInline(18), h("span", { class: "win-brand", text: "ADCode" }),
        ["Chat", "Agents", "Tools"].map((page) => h("span", { class: `win-page${page === "Agents" ? " current" : ""}`, text: page }))),
      header, columns, this.cards.map(({ element }) => element), this.cursor);
    this.camera = h("div", { class: "camera" }, this.board);
    this.layer = h("div", { class: "scene-layer" }, this.caption, h("div", { class: "viewport" }, this.camera));
    root.append(this.layer);
  },
  draw(t) {
    const enter = ease.inOutCubic(seg(t, CUE.toAgents, CUE.toAgents + 0.5));
    put(this.layer, { transform: tf({ x: lerp(1180, 0, enter) }) });
    put(this.camera, { transform: aim(camera(t, SHOTS), 1080, 866) });
    [...this.caption.querySelectorAll(".word")].forEach((word, i) => {
      const rise = ease.outCubic(seg(t, CUE.agents + 0.1 + i * 0.08, CUE.agents + 0.5 + i * 0.08));
      put(word, { transform: tf({ y: lerp(50, 0, rise) }), opacity: rise });
    });

    const tally = [0, 0, 0];
    for (const card of this.cards) {
      const at = placement(card.run, t);
      tally[{ working: 0, needs: 1, ready: 2 }[at.state]] += 1;
      put(card.element, {
        transform: tf({ x: at.x, y: at.y - at.lift * 18, s: 1 + at.lift * 0.05 }),
        zIndex: at.lift > 0 ? 3 : 1,
        boxShadow: `0 ${(8 + at.lift * 30).toFixed(1)}px ${(24 + at.lift * 50).toFixed(1)}px rgba(0,0,0,${(0.35 + at.lift * 0.35).toFixed(2)})`,
      });
      card.element.dataset.state = at.state;
      card.face.setMood(at.mood);
      // Working boxes show a live bar; each run its own pace.
      const pace = { Reviewer: 0.22, Tester: 0.5, "Bug fixer": 0.36 }[card.run.name];
      put(card.fill, { transform: `scaleX(${(0.15 + ((t * pace) % 0.8)).toFixed(4)})` });

      // Landing in Ready: a ring and a burst of dots around the mascot.
      const since = at.landedAt === null ? -1 : t - at.landedAt;
      const burst = since >= 0 ? seg(since, 0, 0.6) : 0;
      put(card.ring, { transform: tf({ s: lerp(0.7, 1.9, ease.outCubic(burst)) }), opacity: since >= 0 ? 1 - burst : 0 });
      card.dots.forEach((dot, i) => {
        const angle = (i / card.dots.length) * Math.PI * 2;
        const reach = ease.outCubic(burst) * 46;
        put(dot, { transform: tf({ x: Math.cos(angle) * reach, y: Math.sin(angle) * reach }), opacity: since >= 0 ? 1 - burst : 0 });
      });
    }
    tally.forEach((count, i) => { this.counts[i].textContent = String(count); });
    this.subtitle.textContent = tally[2] === 3 ? "All done · 3 ready to apply" : `${tally[0]} running${tally[1] ? " · 1 needs you" : ""}`;

    // The one click: in, press Approve, out.
    const fixer = this.cards[2];
    const press = seg(t, CUE.moves.approve, CUE.moves.approve + 0.14);
    put(fixer.approve, { transform: tf({ s: 1 - 0.1 * Math.sin(press * Math.PI) }) });
    const approach = ease.inOutCubic(seg(t, CUE.moves.fixerNeeds + 0.2, CUE.moves.approve - 0.05));
    const leave = ease.inCubic(seg(t, CUE.moves.approve + 0.15, CUE.moves.fixerReady + 0.3));
    const target = { x: COLUMN_X[1] + 214, y: SLOT_Y(0) + 104 };
    put(this.cursor, {
      transform: tf({ x: lerp(target.x + 260, target.x, approach) + leave * 300, y: lerp(target.y + 300, target.y, approach) + leave * 220, s: 1 - 0.12 * Math.sin(press * Math.PI) }),
      opacity: t > CUE.moves.fixerNeeds + 0.2 && t < CUE.moves.fixerReady + 0.3 ? 1 : 0,
    });
  },
};
