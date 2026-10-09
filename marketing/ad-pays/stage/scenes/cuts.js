/**
 * 4.5–6.5 s. A real IDE, in four cuts on the beat.
 *
 * Each cut is one huge word over one piece of the app doing its job: the agents board moving
 * a task to Ready, the tests passing, a commit going in, the new sign-in page running in
 * Preview. Each arrives with a whip from the side the last one left by, and pushes in while
 * it holds. Half a second each - enough for one word.
 */
import { CUE, LINES } from "../cues.js";
import { ease, h, lerp, put, seg, spring } from "../shared/engine.js";
import { icon, mascot } from "../shared/ui.js";

function agentsShot() {
  const lanes = ["Working", "Needs you", "Ready"].map((name) => h("div", { class: "ag-lane" }, h("div", { class: "ag-lane-head", text: name })));
  const cards = [["hexagon", "Reviewer", "Review the sign-in flow"], ["capsule", "Tester", "Test the magic link"], ["drop", "Bug fixer", "Expired tokens"]].map(([shape, name, task]) => {
    const m = mascot(shape, 34);
    const el = h("div", { class: "ag-card" }, m.element, h("div", {}, h("b", { text: name }), h("small", { text: task })));
    return { ...m, el };
  });
  lanes[0].append(cards[0].el, cards[1].el);
  lanes[2].append(cards[2].el);
  const mover = cards[1];
  return {
    el: h("div", { class: "shot-ui ag-board" }, h("div", { class: "ag-head" }, icon("agents", 18), h("b", { text: "Agents" }), h("small", { text: "3 running" })), h("div", { class: "ag-lanes" }, lanes)),
    draw(local) {
      // The tester finishes: it glides from Working to Ready and smiles.
      const go = ease.inOutCubic(seg(local, 0.25, 0.75));
      // Measured, not assumed: the lanes shrink to fit the panel.
      const across = lanes[2].offsetLeft - lanes[0].offsetLeft;
      put(mover.el, { transform: `translateX(${(go * across).toFixed(1)}px)` });
      mover.setMood(go > 0.9 ? "happy" : "thinking");
      cards[2].setMood("proud");
      cards[0].setMood("thinking");
    },
  };
}

function terminalShot() {
  const rows = ["$ npm test", " ✓ tests/auth.test.ts (14)", " ✓ tests/sign-in.test.ts (28)", ""].map((text) => h("div", { class: "tm-row", text: text || " " }));
  const pass = h("div", { class: "tm-pass" }, icon("check", 44), h("span", { text: "42 passed" }));
  return {
    el: h("div", { class: "shot-ui tm" }, h("div", { class: "tm-head" }, icon("terminal", 16), h("span", { text: "Terminal 1" })), h("div", { class: "tm-body" }, rows, pass)),
    draw(local) {
      rows.forEach((row, i) => put(row, { opacity: seg(local, i * 0.1, i * 0.1 + 0.05) }));
      const s = local < 0.4 ? 0 : spring((local - 0.4) * 0.5, 300, 14);
      put(pass, { opacity: seg(local, 0.4, 0.45), transform: `scale(${(0.7 + 0.3 * s).toFixed(3)})` });
    },
  };
}

function gitShot() {
  const button = h("div", { class: "gt-commit" }, h("span", { text: "Commit" }));
  const done = h("div", { class: "gt-done" }, icon("check", 22), h("span", { text: "Committed to main" }));
  return {
    el: h("div", { class: "shot-ui gt" },
      h("div", { class: "gt-head" }, icon("git", 16), h("b", { text: "Changes" }), h("small", { text: "2" })),
      h("div", { class: "gt-file" }, icon("file", 15), h("span", { text: "auth.ts" }), h("b", { text: "A" })),
      h("div", { class: "gt-file" }, icon("file", 15), h("span", { text: "SignIn.tsx" }), h("b", { text: "A" })),
      h("div", { class: "gt-msg", text: "Add sign-in with email" }), button, done),
    draw(local) {
      const press = seg(local, 0.3, 0.36) * (1 - seg(local, 0.4, 0.5));
      put(button, { transform: `scale(${(1 - 0.06 * press).toFixed(3)})`, opacity: 1 - seg(local, 0.45, 0.55) });
      put(done, { opacity: seg(local, 0.48, 0.58), transform: `translateY(${lerp(10, 0, seg(local, 0.48, 0.62)).toFixed(1)}px)` });
    },
  };
}

function previewShot() {
  const field = h("div", { class: "pv-field" }, h("span", { class: "pv-typed" }));
  const typedEl = field.firstChild;
  return {
    el: h("div", { class: "shot-ui pv" },
      h("div", { class: "pv-bar" }, h("span", { text: "Preview" }), h("div", { class: "pv-url" }, icon("globe", 13), h("span", { text: "localhost:5173" }))),
      h("div", { class: "pv-page" },
        h("div", { class: "pv-card" }, h("b", { text: "Sign in" }), h("p", { text: "We'll email you a link." }), field, h("div", { class: "pv-button", text: "Send link" })))),
    draw(local) {
      const email = "you@example.com";
      typedEl.textContent = email.slice(0, Math.floor(seg(local, 0.15, 0.7) * email.length));
    },
  };
}

const SHOTS = [
  { line: LINES.agents, make: agentsShot },
  { line: LINES.terminal, make: terminalShot },
  { line: LINES.git, make: gitShot },
  { line: LINES.preview, make: previewShot },
];

export const cuts = {
  id: "cuts",
  from: CUE.cuts[0],
  to: CUE.end,
  mount(root) {
    root.append(h("div", { class: "cuts-bg" }));
    this.shots = SHOTS.map(({ line, make }, i) => {
      const shot = make();
      const word = h("div", { class: "cut-word", text: line.text });
      const frame = h("div", { class: "cut-frame" }, shot.el);
      const layer = h("div", { class: "cut-layer" }, frame, word);
      root.append(layer);
      return { ...shot, word, frame, layer, at: CUE.cuts[i], until: CUE.cuts[i + 1] ?? CUE.end, dir: i % 2 ? -1 : 1 };
    });
  },
  draw(t) {
    for (const shot of this.shots) {
      const live = t >= shot.at && t < shot.until;
      put(shot.layer, { display: live ? "block" : "none" });
      if (!live) continue;
      const local = seg(t, shot.at, shot.until);
      shot.draw(local);
      // In on a whip from the side, then a slow push while it holds.
      const whip = ease.outExpo(seg(t, shot.at, shot.at + 0.14));
      const push = 1 + 0.06 * local;
      put(shot.frame, { transform: `translateX(${((1 - whip) * 700 * shot.dir).toFixed(1)}px) scale(${push.toFixed(4)}) rotate(${((1 - whip) * 4 * shot.dir).toFixed(2)}deg)` });
      const slam = t < shot.at ? 0 : spring(t - shot.at, 420, 20);
      put(shot.word, { opacity: seg(t, shot.at, shot.at + 0.04), transform: `scale(${lerp(1.35, 1, Math.min(1, slam)).toFixed(4)})` });
    }
  },
};
