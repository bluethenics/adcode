/**
 * 12–14 s. "Real terminals. Real git."
 *
 * Four hard cuts on the beat - a terminal running the tests, the Changes panel committing
 * and pushing, a split editor, the Tools page - each pushing in slowly, with a flash on
 * the cut. The things an AI editor still needs to be an editor.
 */
import { CUE } from "../cues.js";
import { codeRows, HABITS_JS, STREAKS_CSS } from "../code.js";
import { ease, h, lerp, put, seg, tf, typed } from "../engine.js";
import { icon } from "../ui.js";

const [TERMINAL, GIT, EDITOR, TOOLS] = CUE.montage;

const TERMINAL_LINES = [
  { at: TERMINAL + 0.17, text: " RUN  v4.1  ~/habits", dim: true },
  { at: TERMINAL + 0.2, text: " ✓ tests/streaks.test.js (8)" },
  { at: TERMINAL + 0.23, text: " ✓ tests/habits.test.js (34)" },
  { at: TERMINAL + 0.26, text: "" },
  { at: TERMINAL + 0.28, text: " Test Files  2 passed (2)", dim: true },
  { at: TERMINAL + 0.3, text: "      Tests  42 passed (42)", strong: true },
  { at: TERMINAL + 0.32, text: "   Duration  1.21s", dim: true },
];

function panel(className, ...children) {
  return h("div", { class: `montage-panel ${className}` }, children);
}

export const montage = {
  id: "montage",
  from: TERMINAL,
  to: TOOLS + 0.5,
  mount(root) {
    this.lineA = h("div", { class: "montage-line", text: "Real terminals." });
    this.lineB = h("div", { class: "montage-line", text: "Real git." });

    this.command = h("span", {});
    this.termLines = TERMINAL_LINES.map((line) =>
      h("div", { class: `term-line${line.dim ? " dim" : ""}${line.strong ? " strong" : ""}`, text: line.text || " " }));
    const terminal = panel("montage-terminal",
      h("div", { class: "term-tabs" }, h("span", { class: "term-tab current" }, icon("terminal", 18), "Terminal 1"),
        h("span", { class: "term-tab" }, icon("plus", 16)), h("span", { class: "term-shell", text: "bash" })),
      h("div", { class: "term-body" }, h("div", { class: "term-line" }, h("span", { class: "term-prompt", text: "~/habits $ " }), this.command), this.termLines));

    this.message = h("span", {});
    this.commitButton = h("div", { class: "git-commit", text: "Commit & Push" });
    this.newCommit = h("div", { class: "git-node fresh" }, h("span", { class: "git-dot" }), h("b", { text: "feat: habit streaks" }), h("small", { text: "just now" }));
    const file = (letter, name, delta) => h("div", { class: "git-file" }, h("span", { class: "git-letter", text: letter }), h("span", { text: name }), h("span", { class: "git-delta", text: delta }));
    const git = panel("montage-git",
      h("div", { class: "git-side" },
        h("div", { class: "git-head" }, h("b", { text: "Changes" }), h("span", { class: "git-branch" }, icon("git", 16), "main")),
        file("M", "habits.js", "+62 −4"), file("A", "streaks.css", "+24"), file("A", "index.html", "+48"),
        h("div", { class: "git-message" }, this.message, h("span", { class: "git-caret" })),
        this.commitButton),
      h("div", { class: "git-graph" },
        h("div", { class: "git-rail" }),
        this.newCommit,
        h("div", { class: "git-node" }, h("span", { class: "git-dot" }), h("b", { text: "fix: date rollover" }), h("small", { text: "2 hours ago" })),
        h("div", { class: "git-node" }, h("span", { class: "git-dot" }), h("b", { text: "feat: habit list" }), h("small", { text: "yesterday" })),
        h("div", { class: "git-node" }, h("span", { class: "git-dot" }), h("b", { text: "init" }), h("small", { text: "yesterday" }))));

    this.cursorLine = h("div", { class: "editor-cursorline" });
    const editor = panel("montage-editor",
      h("div", { class: "editor-tabs" }, h("span", { class: "editor-tab current", text: "habits.js" }), h("span", { class: "editor-tab", text: "streaks.css" })),
      h("div", { class: "editor-split" },
        h("div", { class: "editor-pane" }, this.cursorLine, codeRows(HABITS_JS.split("\n").slice(2, 22).join("\n"), 3)),
        h("div", { class: "editor-pane" }, codeRows(STREAKS_CSS.split("\n").slice(0, 20).join("\n"), 1))));

    const tool = (name, label, text) => h("div", { class: "tool-card" }, h("div", { class: "tool-icon" }, icon(name, 24)),
      h("b", { text: label }), h("small", { text }), h("span", { class: "tool-switch" }, h("span", {})));
    const tools = panel("montage-tools",
      h("div", { class: "tools-head" }, h("b", { text: "Tools" }),
        h("div", { class: "tools-tabs" }, ["Built in", "MCP servers", "Skills", "Memory"].map((tab, i) => h("span", { class: i === 0 ? "current" : "", text: tab })))),
      h("div", { class: "tools-grid" },
        tool("file", "Files", "Read and edit the project"), tool("terminal", "Terminal", "Run commands and tests"),
        tool("search", "Search", "Find across every file"), tool("git", "Git", "Stage, commit, push"),
        tool("eye", "Preview", "See the running app"), tool("globe", "Browser", "Fetch documentation")));

    this.panels = [terminal, git, editor, tools];
    this.flash = h("div", { class: "montage-flash" });
    root.append(h("div", { class: "montage-caption" }, this.lineA, this.lineB), ...this.panels, this.flash);
  },
  draw(t) {
    const cut = CUE.montage.filter((at) => t >= at).length - 1;
    this.panels.forEach((element, i) => {
      const live = i === cut;
      element.style.display = live ? "block" : "none";
      if (live) put(element, { transform: tf({ s: lerp(1.06, 1, ease.outCubic(seg(t, CUE.montage[i], CUE.montage[i] + 0.5))) }) });
    });
    put(this.flash, { opacity: 0.32 * (1 - seg(t - CUE.montage[cut], 0, 0.1)) });

    [this.lineA, this.lineB].forEach((line, i) => {
      const rise = ease.outExpo(seg(t, CUE.montage[i], CUE.montage[i] + 0.3));
      put(line, { transform: tf({ y: lerp(40, 0, rise) }), opacity: rise });
    });

    this.command.textContent = typed("npm test", t, TERMINAL + 0.02, 60);
    TERMINAL_LINES.forEach((line, i) => put(this.termLines[i], { opacity: t >= line.at ? 1 : 0 }));

    this.message.textContent = typed("feat: habit streaks", t, GIT + 0.02, 150);
    const press = seg(t, GIT + 0.22, GIT + 0.34);
    put(this.commitButton, { transform: tf({ s: 1 - 0.06 * Math.sin(press * Math.PI) }) });
    this.commitButton.textContent = t >= GIT + 0.3 ? "Pushed ✓" : "Commit & Push";
    const pop = ease.outBack(seg(t, GIT + 0.3, GIT + 0.5));
    put(this.newCommit, { transform: tf({ s: lerp(0.6, 1, pop), x: lerp(-20, 0, pop) }), opacity: seg(t, GIT + 0.3, GIT + 0.36) });

    put(this.cursorLine, { transform: tf({ y: 30 * (4 + Math.floor(seg(t, EDITOR, EDITOR + 0.5) * 6)) }) });
  },
};
