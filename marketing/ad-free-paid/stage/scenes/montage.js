/**
 * 10.5–13 s. The montage: three whips across the app. "Vibe or Code. Earn in both."
 *
 * The camera comes out of the split's whip onto Vibe's agents at work - three of them,
 * their bars filling, ticking to done. Whip: Code, the same project in the full IDE, a
 * line typing itself under the floating assistant, the tests passing. Whip: Earnings, the
 * balance counting up in green. Then the camera dives into the figure, and the money
 * shrinks to a point of light for the mark.
 */
import { CUE, EXAMPLE, LINES } from "../cues.js";
import { ease, h, lerp, put, seg, spring, typed } from "../shared/engine.js";
import { icon, mascot } from "../shared/ui.js";
import { Dust, LENS, mixCam, shake, view, wordSpans } from "../fx.js";

const PANEL = { w: 860, h: 600 };
const GAP = 1500;
const RY = [-8, 8, -6];
/** The balance figure, relative to the Earnings panel's centre: the dive's target. */
const FIGURE = { x: -250, y: -118 };

const at = (i) => ({ x: i * GAP + 10, y: 24, z: 0, d: 1800, rx: 3, ry: RY[i] * 0.45 });
function camAt(t) {
  let cam = { ...at(0), x: -1100, ry: -14 };
  cam = mixCam(cam, at(0), ease.outExpo(seg(t, CUE.whips[0], CUE.whips[0] + 0.32)));
  cam = mixCam(cam, { ...at(0), d: 1680 }, ease.linear(seg(t, CUE.whips[0] + 0.32, CUE.whips[1] - 0.1)));
  cam = mixCam(cam, at(1), ease.inOutExpo(seg(t, CUE.whips[1] - 0.1, CUE.whips[1] + 0.18)));
  cam = mixCam(cam, { ...at(1), d: 1680 }, ease.linear(seg(t, CUE.whips[1] + 0.18, CUE.whips[2] - 0.1)));
  cam = mixCam(cam, at(2), ease.inOutExpo(seg(t, CUE.whips[2] - 0.1, CUE.whips[2] + 0.18)));
  cam = mixCam(cam, { ...at(2), d: 1640 }, ease.linear(seg(t, CUE.whips[2] + 0.18, CUE.dive - 0.2)));
  // The dive: first square up on the figure, then fall into it.
  const onFigure = { x: 2 * GAP + FIGURE.x, y: FIGURE.y, z: 0, d: 1150, rx: 0, ry: RY[2] * 0.3 };
  cam = mixCam(cam, onFigure, ease.inOutCubic(seg(t, CUE.dive - 0.2, CUE.dive + 0.1)));
  return mixCam(cam, { ...onFigure, d: 150 }, ease.inExpo(seg(t, CUE.dive + 0.05, CUE.mark)));
}

const tok = (kind, text) => h("span", { class: `t-${kind}`, text });
const row = (n, parts, cls = "") => h("div", { class: `cd-row ${cls}` }, h("span", { class: "ln", text: String(n) }), parts);

export const montage = {
  id: "montage",
  from: CUE.whips[0],
  to: CUE.mark,
  mount(root) {
    root.append(h("div", { class: "app-bg" }));
    this.dust = new Dust(root, 110, 29);
    this.world = h("div", { class: "world" });
    root.append(h("div", { class: "viewport" }, this.world));

    // 1 · Vibe: the agents at work.
    this.agents = [["hexagon", "Reviewer", 0.55], ["capsule", "Tester", 0.75], ["egg", "UI polish", 0.62], ["drop", "Bug fixer", 0.7]].map(([shape, name, speed]) => {
      const m = mascot(shape, 62);
      const bar = h("i");
      const state = h("span", { class: "ag-state" }, icon("check", 16));
      const status = h("small", { text: "Working" });
      const card = h("div", { class: "ag-card" }, m.element, h("div", { class: "ag-meta" }, h("div", {}, h("b", { text: name }), status), h("div", { class: "ag-bar" }, bar)), state);
      return { ...m, card, bar, state, status, speed };
    });
    this.agentsCount = h("small", { text: "4 working" });
    const vibe = h("div", { class: "panel" },
      h("div", { class: "pn-head" }, h("span", { text: "✦" }), h("span", { text: "Agents" }), this.agentsCount),
      h("div", { class: "ag-body" }, this.agents.map((a) => a.card)));

    // 2 · Code: the same project in the IDE.
    this.typedEl = h("span", { class: "t-p" });
    this.termPass = h("div", { class: "pass", text: "✓ 12 passed" });
    const code = h("div", { class: "panel" },
      h("div", { class: "cd-tabs" }, h("div", { class: "cd-tab on" }, icon("file", 14), h("span", { text: "HabitCard.tsx" })), h("div", { class: "cd-tab" }, icon("file", 14), h("span", { text: "habits.ts" }))),
      h("div", { class: "cd-code" },
        row(1, [tok("k", "export function "), tok("f", "HabitCard"), tok("p", "({ habit }) {")]),
        row(2, [tok("p", "  "), tok("k", "const "), tok("n", "streak"), tok("p", " = currentStreak(habit.days);")]),
        row(3, [tok("p", "  "), tok("k", "return "), tok("p", "(")]),
        row(4, [tok("p", "    <"), tok("f", "Card"), tok("p", " title={habit.name}>")]),
        row(5, [tok("p", "      <"), tok("f", "Streak"), tok("p", " days={streak} />")], "sel"),
        row(6, [tok("p", "      "), this.typedEl], "sel"),
        row(7, [tok("p", "    </"), tok("f", "Card"), tok("p", ">")]),
        row(8, [tok("p", "  );")]),
        row(9, [tok("p", "}")])),
      h("div", { class: "cd-float" }, h("b", {}, h("span", { text: "Assistant" }), h("small", { text: "Ctrl+I" })),
        h("p", { text: "Show a flame once a streak passes seven days." }),
        h("div", { class: "cd-acts" }, h("i", { text: "Explain" }), h("i", { text: "Refactor" }), h("i", { text: "Write tests" }))),
      h("div", { class: "cd-term" }, h("div", { text: "❯ npm test" }), this.termPass));

    // 3 · Earnings: the balance, counting up in green.
    this.figure = h("div", { class: "er-figure", text: "$0.04" });
    this.lifetime = h("b", { class: "money", text: "$0.04" });
    const earnings = h("div", { class: "panel" },
      h("div", { class: "pn-head" }, h("span", { text: "$" }), h("span", { text: "Earnings" })),
      h("div", { class: "er-body" },
        h("div", { class: "er-balance" }, h("small", { text: "Your balance" }), this.figure, h("p", { text: "Available to withdraw · just now" })),
        h("div", { class: "er-rows" },
          h("div", { class: "er-row" }, h("span", { text: "Lifetime earned" }), this.lifetime),
          h("div", { class: "er-row" }, h("span", { text: "Ads" }), h("b", { text: "On" })),
          h("div", { class: "er-row" }, h("span", { text: "Frequency" }), h("b", { text: "Standard · up to 8 a day" })))));

    this.panels = [vibe, code, earnings];
    this.panels.forEach((panel, i) => {
      panel.style.transform = `translate3d(${i * GAP}px, 0, 0) rotateY(${RY[i]}deg) translate(${-PANEL.w / 2}px, ${-PANEL.h / 2}px)`;
      this.world.append(panel);
    });
    this.chips = [
      h("div", { class: "chip" }, h("span", { text: "✦" }), h("span", { text: LINES.vibe.text })),
      h("div", { class: "chip" }, h("span", { text: "</>" }), h("span", { text: LINES.code.text })),
      h("div", { class: "chip money-chip" }, h("span", { text: "$" }), h("span", { text: LINES.earnings.text })),
    ];
    this.chips.forEach((chip) => this.world.append(chip));

    this.topScrim = h("div", { class: "top-scrim" });
    this.line = h("div", { class: "s-line" }, wordSpans(LINES.both.text));
    this.dark = h("div", { class: "flash", style: { background: "#050505" } });
    this.point = h("div", { class: "dive-point" });
    root.append(this.topScrim, this.line, h("div", { class: "vignette" }), this.dark, this.point);
  },

  draw(t) {
    const base = camAt(t);
    const hand = shake(t, 0.18, 21);
    const cam = { ...base, x: base.x + hand.x, y: base.y + hand.y, rz: hand.rz * 0.5 };
    put(this.world, { transform: view(cam) });
    this.dust.draw(t, { focus: 1.2, alpha: 0.45, zoom: LENS / cam.d, pan: { x: cam.x * 0.3, y: 0 } });

    // Vibe: bars fill at their own pace; each agent ticks to done.
    let working = 0;
    this.agents.forEach((agent, i) => {
      const p = seg(t, CUE.whips[0] - 0.3 + i * 0.05, CUE.whips[0] - 0.3 + i * 0.05 + agent.speed);
      const done = p >= 1;
      if (!done) working += 1;
      put(agent.bar, { transform: `scaleX(${ease.inOutCubic(p).toFixed(4)})` });
      agent.state.classList.toggle("on", done);
      agent.status.textContent = done ? "Done" : "Working";
      agent.setMood(done ? "happy" : "thinking");
      put(agent.element, { transform: `translateY(${(Math.sin(t * 9 + i) * (done ? 0 : 3)).toFixed(2)}px)` });
    });
    this.agentsCount.textContent = working ? `${working} working` : `${this.agents.length} done`;

    // Code: the line types itself; the tests pass.
    this.typedEl.textContent = typed("{streak >= 7 && <Flame />}", t, CUE.whips[1] + 0.05, 48);
    put(this.termPass, { opacity: seg(t, CUE.whips[1] + 0.55, CUE.whips[1] + 0.6) });

    // Earnings: the balance counts up.
    const [low, high] = EXAMPLE.balance;
    const value = lerp(low, high, ease.outCubic(seg(t, CUE.whips[2] + 0.1, CUE.whips[2] + 0.6)));
    const text = `$${value.toFixed(2)}`;
    this.figure.textContent = text;
    this.lifetime.textContent = text;

    // Chips under each panel, springing up as the camera arrives.
    this.chips.forEach((chip, i) => {
      const since = t - CUE.whips[i] + 0.02;
      const s = since < 0 ? 0 : spring(since, 300, 17);
      chip.style.transform = `translate3d(${i * GAP}px, ${PANEL.h / 2 + 52}px, 60px) rotateY(${RY[i]}deg) scale(${s.toFixed(4)}) translate(-50%, -50%)`;
    });

    // The line holds across the whips; the dive takes it and the frame down to a point.
    const words = [...this.line.querySelectorAll(".word")];
    words.forEach((word, i) => {
      const up = ease.outCubic(seg(t, CUE.whips[0] + 0.05 + i * 0.04, CUE.whips[0] + 0.3 + i * 0.04));
      const fall = ease.inCubic(seg(t, CUE.dive, CUE.dive + 0.15));
      put(word, { opacity: up * (1 - fall), transform: `translateY(${(lerp(40, 0, up) - fall * 24).toFixed(1)}px)`, filter: up < 1 || fall > 0 ? `blur(${((1 - up) * 10 + fall * 10).toFixed(1)}px)` : "none" });
    });
    put(this.topScrim, { opacity: 1 - seg(t, CUE.dive, CUE.dive + 0.15) });
    put(this.dark, { opacity: ease.inCubic(seg(t, CUE.mark - 0.16, CUE.mark - 0.02)) });
    const grow = ease.outCubic(seg(t, CUE.mark - 0.16, CUE.mark - 0.02));
    put(this.point, { opacity: grow, transform: `scale(${lerp(3, 1, grow).toFixed(3)})` });
  },
};
