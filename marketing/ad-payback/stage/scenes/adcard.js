/**
 * 14–16 s. "An occasional ad keeps it free."
 *
 * A calm IDE, and ADCode's sponsored card sliding into the corner the way it does in the
 * app: logo tile, "Sponsored", advertiser and headline, a close button. The advertiser is
 * the fictional Acme Cloud - no real company is shown advertising. At 15.5 the camera
 * pushes into the card, into the next scene's money.
 */
import { CUE } from "../cues.js";
import { codeRows, HABITS_JS } from "../code.js";
import { aim, camera, ease, h, lerp, put, seg, tf } from "../engine.js";
import { icon, markInline } from "../ui.js";

/** The sponsored card, shared with the earn scene so the two are the same object. */
export function sponsoredCard() {
  return h("div", { class: "sponsored" },
    h("div", { class: "sponsored-logo", text: "A" }),
    h("div", { class: "sponsored-copy" },
      h("div", { class: "sponsored-label", text: "SPONSORED" }),
      h("div", { class: "sponsored-title" }, h("b", { text: "Acme Cloud" }), " Deploy previews in one click"),
      h("div", { class: "sponsored-body", text: "Free for open source." })),
    h("div", { class: "sponsored-close" }, icon("close", 16)));
}

const CARD = { x: 960 - 24 - 430, y: 776 - 38 - 124, w: 430, h: 124 };
const SHOTS = [
  { at: 0, cx: 480, cy: 388, s: 1.02 },
  { at: CUE.pushIn, cx: CARD.x + CARD.w / 2, cy: CARD.y + CARD.h / 2, s: 2.2, move: 0.5 },
];

export const adcard = {
  id: "adcard",
  from: CUE.adcard,
  to: CUE.earn,
  mount(root) {
    this.lines = ["An occasional ad", "keeps it free."].map((text) => h("div", { class: "montage-line", text }));
    const activity = h("div", { class: "ide-activity" }, ["file", "search", "git", "terminal", "agents"].map((name, i) =>
      h("span", { class: i === 0 ? "current" : "" }, icon(name, 22))));
    const editor = h("div", { class: "ide-editor" },
      h("div", { class: "editor-tabs" }, h("span", { class: "editor-tab current", text: "habits.js" })),
      h("div", { class: "ide-code" }, codeRows(HABITS_JS.split("\n").slice(0, 22).join("\n"), 1)));
    this.card = sponsoredCard();
    put(this.card, { left: `${CARD.x}px`, top: `${CARD.y}px`, width: `${CARD.w}px`, height: `${CARD.h}px` });
    this.dim = h("div", { class: "ide-dim" });
    const window = h("div", { class: "app-window ide-window" },
      h("div", { class: "win-titlebar" }, markInline(18), h("span", { class: "win-brand", text: "ADCode" }),
        ["File", "Edit", "Selection", "View", "Go", "Run", "Git", "Terminal", "Help"].map((item) => h("span", { class: "win-menu", text: item }))),
      h("div", { class: "ide-body" }, activity, editor),
      h("div", { class: "ide-status" }, h("span", { text: "~/code/habits" }), h("span", { text: "main" }), h("span", { class: "ide-status-gap" }), h("span", { text: "Ln 14, Col 3" }), h("span", { text: "JavaScript" })),
      this.dim, this.card);
    this.camera = h("div", { class: "camera" }, window);
    root.append(h("div", { class: "montage-caption" }, this.lines), h("div", { class: "viewport ad-viewport" }, this.camera));
  },
  draw(t) {
    put(this.camera, { transform: aim(camera(t, SHOTS), 1080, 866) });
    this.lines.forEach((line, i) => {
      const rise = ease.outExpo(seg(t, CUE.adcard + 0.12 + i * 0.22, CUE.adcard + 0.5 + i * 0.22));
      put(line, { transform: tf({ y: lerp(40, 0, rise) }), opacity: rise * (1 - seg(t, CUE.pushIn + 0.2, CUE.pushIn + 0.45)) });
    });
    const slide = ease.outExpo(seg(t, CUE.cardIn, CUE.cardIn + 0.55));
    put(this.card, { transform: tf({ x: lerp(480, 0, slide) }), opacity: seg(t, CUE.cardIn, CUE.cardIn + 0.1) });
    put(this.dim, { opacity: 0.7 * ease.inOutCubic(seg(t, CUE.pushIn, CUE.pushIn + 0.45)) });
  },
};
