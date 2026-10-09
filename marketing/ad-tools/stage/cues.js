/**
 * The cue sheet for "Too Many Tools": every time the film uses, in one place. The picture,
 * the soundtrack and verify.mjs all read it, so a moved cut moves its sound and its checks.
 * Plain data: no DOM, so Node can import it too.
 *
 * 120 BPM, one beat = 0.5 s. Cues sit on the quarter-second grid unless the edit needs a
 * frame of its own (the loop's shots shrink by a ratio, not by the grid).
 */
export const W = 1920;
export const H = 1080;
export const BPM = 120;
export const BEAT = 60 / BPM;
export const DURATION = 22.5;

export const CUE = {
  // Calm: the idea, the light.
  decode: [-0.3, 0.9],
  ideaOut: [1.9, 2.3],
  orbs: 1.55,
  tiles: 2.5,
  dock: 3.0,
  pointer: 3.1,
  // The loop, then the pile.
  loop: 3.5,
  pile: 6.43,
  // The screen.
  silence: 7.0,
  discs: [7.5, 7.75, 8.0, 8.25],
  front: 8.4,
  white: 8.8,
  headline: 8.8,
  // Zero.
  zero: 10.6,
  zeroCopy: 11.05,
  zeroTabs: 11.75,
  shrink: 12.45,
  // One editor.
  one: 12.6,
  snaps: [12.85, 12.95, 13.05, 13.15, 13.25],
  oneTitle: 13.0,
  prompt: 13.35,
  edit: 13.95,
  passed: 14.5,
  // The flip.
  card: 15.1,
  split: 16.45,
  fifty: 16.6,
  // The mark and the end card.
  mark: 18.1,
  dollar: 18.6,
  wordmark: 18.85,
  tagline: 19.25,
  end: 19.6,
};

/**
 * The loop: each shot whips to a window and does the one thing people do there all day.
 * Shots shrink by about a fifth each time, so the edit accelerates into the pile.
 */
const SHOTS = [
  { app: "chat", keys: ["Ctrl", "C"], dur: 0.8 },
  { app: "editor", keys: ["Ctrl", "V"], dur: 0.55 },
  { app: "browser", keys: ["F5"], dur: 0.42 },
  { app: "terminal", keys: ["Ctrl", "C"], dur: 0.34 },
  { app: "chat", keys: ["Ctrl", "V"], dur: 0.27 },
  { app: "editor", keys: ["Ctrl", "V"], dur: 0.22 },
  { app: "browser", keys: ["F5"], dur: 0.18 },
  { app: "terminal", keys: ["Ctrl", "C"], dur: 0.15 },
];
export const LOOP = (() => {
  let at = CUE.loop;
  return SHOTS.map((shot) => {
    const one = { ...shot, at };
    at += shot.dur;
    return one;
  });
})();

/**
 * Every line of copy the film puts on screen, with the stretch where it is fully readable.
 * Scenes take their words from here, and verify.mjs checks the list against the approved
 * copy and each line's reading time.
 */
export const LINES = {
  idea: { text: "You had one idea.", from: 0.9, to: 1.9 },
  tools: { text: "Your code lives in too many tools.", from: 9.4, to: 10.6 },
  zero: { text: "Zero", from: 10.65, to: 11.05 },
  copyPaste: { text: "Zero copy‑paste.", from: 11.25, to: 11.75 },
  tabs: { text: "Zero tab‑switching.", from: 11.85, to: 12.33 },
  one: { text: "One editor. Everything in it.", from: 13.35, to: 14.9 },
  parts: { text: "AI · Editor · Terminal · Git · Agents", from: 13.4, to: 14.9 },
  ad: { text: "An occasional ad keeps it free.", from: 15.45, to: 16.45 },
  half: { text: "Half the ad money is yours.", from: 16.92, to: 18.1 },
  fifty: { text: "50%", from: 16.7, to: 18.1 },
  brand: { text: "ADCode", from: 19.2, to: DURATION },
  tagline: { text: "Earn while you code.", from: 19.6, to: DURATION },
  free: { text: "Free. No subscription.", from: 20.15, to: DURATION },
  platforms: { text: "Windows & Linux", from: 20.25, to: DURATION },
  url: { text: "adcode.bluethenics.com", from: 20.35, to: DURATION },
};

/** Where money green is allowed on screen: from the 50% to the end. */
export const MONEY_FROM = CUE.fifty - 0.05;
