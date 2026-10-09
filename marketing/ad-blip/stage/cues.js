/**
 * "Blip" — the one timing table. The picture, the soundtrack and verify.mjs all read it, so a
 * hit lands on its frame and a line is checked against the window it is actually up for.
 *
 * Every cut sits on a 0.1 s boundary, which at 30 fps is always a frame boundary: the shutter
 * opens forward from each frame, so no frame's motion blur ever straddles a cut.
 *
 * Story, in eight beats (README.md has the full storyboard):
 *   0.0  hook      Blip holds up a "Thinking… 99%" card, straining. The hook is up in frame 0.
 *   2.0  the wait  cold coffee, a spinning clock, a doomscroll; "(it's trying its best)"
 *   5.4  fact      Stack Overflow: developers using AI agents, 31% → 59%
 *   8.4  twist     "What if the wait… paid you?" A sponsored card, a coin split in half.
 *  11.2  drop      "Get paid to wait." Night turns gold; the groove starts on this downbeat.
 *  13.2  build     "Build with AI." The crew is introduced by name and builds a page.
 *  19.2  news      New in ADCode: open source, three agents at once, race mode.
 *  23.7  close     Done, 100%. "Thanks for waiting." Then the end card and a scroll back to 0.
 */
export const W = 1080;
export const H = 1920;
export const FPS = 30;
export const DURATION = 29;

/** The groove is 120 BPM, counted from the drop. */
export const BEAT = 0.5;
export const DROP = 11.2;

/** The only text that differs between the two Trial Reels: frame 0 and the scroll back to it. */
export const HOOKS = {
  1: ["POV: your AI is", "still thinking…"],
  2: ["Your AI is slow.", "Make it pay you."],
};

export const CUE = {
  mug: 2.0,
  clock: 2.7,
  phone: 3.4,
  best: 4.0,
  fact: 5.4,
  factLand: 5.65,
  count: 6.0,
  countEnd: 6.9,
  lot: 7.1,
  gate: 8.2,
  badge: 8.4,
  ask: 8.6,
  card: 10.3,
  coin: 10.55,
  split: 10.85,
  gold: 10.8,
  drop: DROP,
  build: 13.2,
  /** Blip first, then the five starter agents, half a second each. */
  intro: [13.2, 13.7, 14.2, 14.7, 15.2, 15.7],
  work: 16.2,
  /** Each agent's contribution to the page: Blip, Hex, Pip, Bloom, Patch, Quill. */
  acts: [16.25, 16.45, 16.7, 16.95, 17.2, 17.45],
  works: 17.7,
  news: 19.2,
  cards: [19.2, 20.7, 22.2],
  close: 23.7,
  done: 23.9,
  thanks: 24.1,
  end: 25.7,
  scroll: 28.5,
};

/** The cast. Shapes and colours are the app's own (starterAgents.ts, agents.css, dark theme). */
export const CAST = {
  blip: { name: "Blip", role: "your AI", shape: "circle", color: "#5a92f0", voice: 520 },
  hex: { name: "Hex", role: "Reviewer", shape: "hexagon", color: "#9076ec", voice: 330 },
  pip: { name: "Pip", role: "Tester", shape: "capsule", color: "#3fb173", voice: 660 },
  bloom: { name: "Bloom", role: "UI polish", shape: "cloud", color: "#e25c9f", voice: 780 },
  patch: { name: "Patch", role: "Bug fixer", shape: "drop", color: "#ea6c62", voice: 440 },
  quill: { name: "Quill", role: "Docs writer", shape: "egg", color: "#e09a22", voice: 370 },
};
/** Intro order; also the order of CUE.intro and CUE.acts. */
export const ORDER = ["blip", "hex", "pip", "bloom", "patch", "quill"];

/**
 * Where critical copy may sit. Instagram lays its own header over the top of a Reel, the
 * caption and account over the bottom, and the like/comment/share rail down the right.
 * The 3:4 rectangle is what the profile grid shows of the cover.
 */
export const SAFE = { x0: 64, x1: 1016, y0: 220, y1: 1410 };
export const RAIL = { x0: 960, y0: 1000 };
export const GRID_CROP = { y0: 240, y1: 1680 };

/* ── Speech: babble syllables the soundtrack sings and the mouths move to ── */

const VOWEL = { a: "a", e: "e", i: "i", y: "i", o: "o", u: "u" };
const syllableCount = (word) => Math.max(1, (word.toLowerCase().match(/[aeiouy]+/g) ?? []).length - (/[^aeiou]e$/i.test(word) ? 1 : 0));

/**
 * A spoken line: one babble syllable per vowel group, a pause after punctuation, the pitch
 * rising on a question. `reveal` is when each word appears in the speech bubble.
 */
function say(who, start, text, { rate = 0.12, semi = 0, gain = 1 } = {}) {
  const words = text.split(" ");
  const syllables = [];
  const reveal = [];
  let t = start;
  words.forEach((word, w) => {
    reveal.push({ word, t });
    const vowels = (word.toLowerCase().match(/[aeiouy]/g) ?? ["a"]).map((v) => VOWEL[v]);
    const n = syllableCount(word);
    for (let k = 0; k < n; k += 1) {
      const last = w === words.length - 1 && k === n - 1;
      const question = last && text.endsWith("?");
      const wiggle = ((w * 7 + k * 3) % 5) - 2;
      syllables.push({
        who, t, d: question ? rate * 1.6 : rate * 0.82,
        semi: semi + wiggle + (question ? 6 : last ? -2 : 0),
        vowel: vowels[Math.min(k, vowels.length - 1)], gain,
      });
      t += question ? rate * 1.6 : rate;
    }
    if (/[….,!?]$/.test(word) && w < words.length - 1) t += rate * 2.2;
  });
  return { who, text, start, end: t, syllables, reveal };
}

/** A single sound: a grunt, a gasp, a "yay". */
const blip = (who, t, vowel, semi = 0, d = 0.14, gain = 1) => ({ who, t, d, semi, vowel, gain });

export const LINES = {
  ask: say("blip", 8.65, "What if the wait… paid you?", { rate: 0.1 }),
  thanks: say("blip", 24.15, "Thanks for waiting.", { rate: 0.14, semi: -1, gain: 0.85 }),
};

export const SYLLABLES = [
  // The strain under the card, and trying its best.
  blip("blip", 0.35, "u", -5, 0.22, 0.7), blip("blip", 1.05, "u", -4, 0.2, 0.7), blip("blip", 1.7, "u", -6, 0.24, 0.7),
  blip("blip", 4.3, "u", -3, 0.16, 0.8), blip("blip", 4.62, "u", -1, 0.14, 0.8), blip("blip", 5.05, "a", 2, 0.12, 0.9),
  // The number climbs.
  blip("blip", 6.7, "o", 0, 0.32, 0.9),
  // The idea.
  blip("blip", 8.42, "a", 7, 0.1, 1),
  ...LINES.ask.syllables,
  blip("blip", 11.22, "a", 7, 0.12), blip("blip", 11.36, "i", 9, 0.16),
  // Each one says hi as it lands.
  ...ORDER.map((who, i) => blip(who, CUE.intro[i] + 0.06, "a", 4, 0.1)),
  ...ORDER.map((who, i) => blip(who, CUE.intro[i] + 0.17, "i", 7, 0.12)),
  // Each one's "hup!" as it does its part.
  ...ORDER.map((who, i) => blip(who, CUE.acts[i], i % 2 ? "u" : "o", 3, 0.1, 0.8)),
  // It works.
  ...ORDER.map((who, i) => blip(who, CUE.works + 0.04 + i * 0.045, "a", 6, 0.12, 0.75)),
  ...ORDER.map((who, i) => blip(who, CUE.works + 0.2 + i * 0.045, "i", 9, 0.16, 0.75)),
  // The cards.
  blip("quill", CUE.cards[0] + 0.12, "a", 5, 0.12), blip("quill", CUE.cards[0] + 0.26, "a", 9, 0.16),
  blip("hex", CUE.cards[1] + 0.15, "o", 0, 0.1, 0.8), blip("pip", CUE.cards[1] + 0.25, "o", 3, 0.1, 0.8), blip("bloom", CUE.cards[1] + 0.35, "o", 5, 0.1, 0.8),
  blip("patch", CUE.cards[2] + 0.1, "o", 2, 0.1), blip("patch", CUE.cards[2] + 1.05, "a", 7, 0.12), blip("patch", CUE.cards[2] + 1.19, "i", 10, 0.16),
  ...LINES.thanks.syllables,
  // The crew on the end card.
  ...["hex", "pip", "bloom", "patch", "quill"].map((who, i) => blip(who, CUE.end + 0.25 + i * 0.06, "a", 5, 0.1, 0.6)),
];

/** How open `who`'s mouth is at `t`, 0 to 1. */
export function talk(who, t) {
  let open = 0;
  for (const s of SYLLABLES) {
    if (s.who !== who || t < s.t || t > s.t + s.d) continue;
    open = Math.max(open, Math.sin(Math.PI * ((t - s.t) / s.d)));
  }
  return open;
}

/** The words of a line that have been said by `t`. */
export function said(line, t) {
  return line.reveal.filter((r) => r.t <= t).map((r) => r.word).join(" ");
}
