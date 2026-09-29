/**
 * 4–8 s. "Describe it." → "ADCode builds it."
 *
 * ADCode 2.1's Vibe window, rebuilt from the real layout: sidebar with Chat, Agents and
 * Tools, a conversation, the composer. A prompt types itself, is sent, the assistant
 * answers with the three files it made, and Preview slides in on the working app.
 */
import { CUE, PROMPT } from "../cues.js";
import { aim, camera, ease, h, lerp, put, seg, tf, typed } from "../engine.js";
import { assistantFace, icon, markInline } from "../ui.js";

const FILES = [
  { name: "index.html", lines: "+48" },
  { name: "habits.js", lines: "+62" },
  { name: "streaks.css", lines: "+24" },
];
const HABITS = [
  { name: "Drink water", streak: 12 },
  { name: "Read 20 minutes", streak: 5 },
  { name: "Ship something", streak: 29 },
];

/** Window-space points to look at: whole window, composer, the answer, the preview. */
const SHOTS = [
  { at: 0, cx: 480, cy: 388, s: 1 },
  { at: CUE.typeStart - 0.25, cx: 590, cy: 686, s: 1.42, move: 0.5 },
  { at: CUE.send + 0.05, cx: 560, cy: 236, s: 1.4, move: 0.4 },
  { at: CUE.preview + 0.05, cx: 748, cy: 300, s: 1.72, move: 0.45 },
];

function words(text) {
  return text.split(" ").flatMap((word, i) => [i === 0 ? null : " ", h("span", { class: "word", text: word })]).filter(Boolean);
}

export const vibe = {
  id: "vibe",
  from: 3.6,
  to: 8.4,
  mount(root) {
    this.captionA = h("div", { class: "caption" }, words("Describe it."));
    this.captionB = h("div", { class: "caption" }, words("ADCode builds it."));

    const menu = ["File", "Edit", "Selection", "View", "Go", "Run", "Git", "Terminal", "Help"];
    const titlebar = h("div", { class: "win-titlebar" },
      markInline(18), h("span", { class: "win-brand", text: "ADCode" }),
      menu.map((item) => h("span", { class: "win-menu", text: item })));

    const nav = (name, label, selected = false) =>
      h("div", { class: `side-item${selected ? " selected" : ""}` }, icon(name, 17), h("span", { text: label }));
    const sidebar = h("div", { class: "vibe-side" },
      h("div", { class: "side-new" }, icon("plus", 16), h("span", { text: "New conversation" })),
      h("div", { class: "side-search" }, icon("search", 16), h("span", { text: "Search" }), h("kbd", { text: "Ctrl+P" })),
      h("div", { class: "side-project" }, icon("folder", 17), h("div", {}, h("b", { text: "habits" }), h("small", { text: "~/code/habits" }))),
      nav("chat", "Chat", true), nav("agents", "Agents"), nav("tools", "Tools"),
      h("div", { class: "side-rule" }),
      nav("file", "Changes"), nav("eye", "Preview"));

    this.typedText = h("span", { class: "composer-typed" });
    this.caret = h("span", { class: "composer-caret" });
    this.placeholder = h("span", { class: "composer-placeholder", text: "Plan, Build, / for skills, @ for context…" });
    this.send = h("div", { class: "composer-send" }, icon("arrowUp", 20));
    const composer = h("div", { class: "composer" },
      h("div", { class: "composer-input" }, this.placeholder, this.typedText, this.caret),
      h("div", { class: "composer-footer" },
        h("span", { class: "composer-chip", text: "+ Attach" }), h("span", { class: "composer-chip", text: "@ Files" }),
        h("span", { class: "composer-spacer" }),
        h("span", { class: "composer-pill", text: "Auto" }), h("span", { class: "composer-context", text: "Context 3%" }),
        this.send));

    this.bubble = h("div", { class: "msg-user", text: PROMPT });
    this.answer = h("div", { class: "msg-answer" },
      h("div", { class: "msg-face" }, assistantFace(30)),
      h("div", { class: "msg-body" },
        this.answerText = h("p", { text: "On it - three files, with streaks that count back from today." }),
        this.chips = FILES.map(({ name, lines }) =>
          h("div", { class: "file-chip" }, icon("file", 16), h("span", { class: "file-name", text: name }), h("span", { class: "file-lines", text: lines })))));
    const main = h("div", { class: "vibe-main" },
      h("div", { class: "vibe-header" }, h("span", { text: "Habit tracker" })),
      h("div", { class: "vibe-thread" }, this.bubble, this.answer),
      composer);

    this.rows = HABITS.map((habit) => {
      const box = h("span", { class: "habit-box" }, icon("check", 18));
      const count = h("span", { class: "habit-count", text: String(habit.streak) });
      const row = h("div", { class: "habit-row" }, box, h("span", { class: "habit-name", text: habit.name }),
        h("span", { class: "habit-streak" }, icon("flame", 18), count));
      return { row, box, count, streak: habit.streak };
    });
    this.preview = h("div", { class: "vibe-preview" },
      h("div", { class: "preview-bar" }, h("span", { class: "preview-title", text: "Preview" }), h("span", { class: "preview-url", text: "localhost:5173" })),
      h("div", { class: "habit-app" },
        h("div", { class: "habit-head" }, h("b", { text: "Habits" }), h("small", { text: "Tuesday" })),
        this.rows.map(({ row }) => row)));

    this.window = h("div", { class: "app-window vibe-window" }, titlebar,
      h("div", { class: "vibe-body" }, sidebar, main, this.preview));
    this.camera = h("div", { class: "camera" }, this.window);
    this.layer = h("div", { class: "scene-layer" }, this.captionA, this.captionB, h("div", { class: "viewport" }, this.camera));
    root.append(this.layer);
  },
  draw(t) {
    // In as the brackets part; out to the left as the board pushes in.
    const enter = ease.outExpo(seg(t, CUE.toVibe, CUE.toVibe + 0.7));
    const exit = ease.inOutCubic(seg(t, CUE.toAgents, CUE.toAgents + 0.5));
    put(this.layer, { transform: tf({ x: -1180 * exit }) });
    // The camera: the whole window, then close on the composer, the answer, the preview -
    // UI type is 15 px, and a phone shows this frame at a third of its size.
    const shot = camera(t, SHOTS);
    put(this.camera, { transform: aim({ ...shot, s: shot.s * lerp(0.84, 1, enter) }, 1080, 866) + ` translateY(${lerp(60, 0, enter).toFixed(2)}px)` });
    put(this.window, { opacity: seg(t, CUE.toVibe + 0.1, CUE.toVibe + 0.35) });

    // Caption: "Describe it." until the files arrive, then "ADCode builds it."
    const swap = seg(t, CUE.builds - 0.12, CUE.builds + 0.12);
    [...this.captionA.querySelectorAll(".word")].forEach((word, i) => {
      const rise = ease.outCubic(seg(t, CUE.vibe + 0.05 + i * 0.08, CUE.vibe + 0.45 + i * 0.08));
      put(word, { transform: tf({ y: lerp(50, 0, rise) - swap * 30 }), opacity: rise * (1 - swap) });
    });
    [...this.captionB.querySelectorAll(".word")].forEach((word, i) => {
      const rise = ease.outCubic(seg(t, CUE.builds + i * 0.07, CUE.builds + 0.4 + i * 0.07));
      put(word, { transform: tf({ y: lerp(50, 0, rise) }), opacity: rise });
    });

    // Typing, then the send.
    const sent = t >= CUE.send + 0.05;
    const text = sent ? "" : typed(PROMPT, t, CUE.typeStart, CUE.typeRate);
    this.typedText.textContent = text;
    this.placeholder.style.display = text.length === 0 && (t < CUE.typeStart || sent) ? "inline" : "none";
    const typing = t >= CUE.typeStart && t < CUE.typeStart + PROMPT.length / CUE.typeRate + 0.05;
    put(this.caret, { opacity: sent ? 0 : typing || Math.floor(t * 2.4) % 2 === 0 ? 1 : 0 });
    const press = seg(t, CUE.send, CUE.send + 0.16);
    put(this.send, { transform: tf({ s: 1 - 0.14 * Math.sin(press * Math.PI) }) });

    const bubbleIn = ease.outCubic(seg(t, CUE.send + 0.06, CUE.send + 0.4));
    put(this.bubble, { transform: tf({ y: lerp(24, 0, bubbleIn) }), opacity: bubbleIn });
    const answerIn = ease.outCubic(seg(t, CUE.send + 0.2, CUE.send + 0.55));
    put(this.answer, { transform: tf({ y: lerp(24, 0, answerIn) }), opacity: answerIn });
    this.chips.forEach((chip, i) => {
      const pop = seg(t, CUE.files[i], CUE.files[i] + 0.3);
      put(chip, { transform: tf({ s: lerp(0.8, 1, ease.outBack(pop)) }), opacity: seg(t, CUE.files[i], CUE.files[i] + 0.1) });
    });

    // Preview slides in over the thread; each habit ticks on its beat.
    const slide = ease.outExpo(seg(t, CUE.preview, CUE.preview + 0.6));
    put(this.preview, { transform: tf({ x: lerp(460, 0, slide) }), opacity: seg(t, CUE.preview, CUE.preview + 0.12) });
    this.rows.forEach(({ box, count, streak }, i) => {
      const since = t - CUE.checks[i];
      const done = since >= 0;
      box.classList.toggle("done", done);
      count.textContent = String(done ? streak + 1 : streak);
      const pop = done ? 1 + 0.25 * Math.exp(-since * 9) * Math.cos(since * 20) : 1;
      put(box, { transform: tf({ s: pop }) });
      put(count, { transform: tf({ s: pop }) });
    });
  },
};
