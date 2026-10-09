/**
 * The cue sheet for "Now on the Microsoft Store": every time the film uses, in one place.
 * The picture, the soundtrack and verify.mjs all read it, so a moved cut moves its sound
 * and its checks with it. Plain data: no DOM, so Node imports it too.
 *
 * 120 BPM, one beat = 0.5 s, a bar = 2 s. Every scene change sits on a beat.
 */
export const BPM = 120;
export const BEAT = 60 / BPM;
export const DURATION = 20;

/** Two cuts from one timeline. Everything that matters sits in the centred square. */
export const FORMATS = {
  wide: { w: 1920, h: 1080 },
  square: { w: 1080, h: 1080 },
};

export const CUE = {
  // 1 · The hook, finished on frame 0.
  hookLine: [0.05, 1.3],
  hookOut: 1.7,
  flash1: 2.0,
  // 2 · Build: a prompt, typed; the agent works.
  build: 2.0,
  type: [2.2, 3.2],
  enter: 3.25,
  steps: [3.5, 3.75, 4.0],
  // 3 · The ad: the prompt docks into the window, a sponsored card arrives, you earn.
  dock: 4.25,
  card: 4.5,
  earn: 5.25,
  // 4 · 50%: a whip to the counter; the ruler splits.
  whip: 6.85,
  fifty: 7.0,
  count: [7.05, 7.9],
  split: 8.5,
  // 5 · The ledger, on paper; the stamp.
  flash2: 10.5,
  form: 10.5,
  rows: [10.7, 10.95, 11.2],
  stamp: 11.5,
  // 6 · Windows: the Store opens on ADCode, Get, installed, Open.
  desktop: 12.5,
  store: 12.75,
  pointer: [13.25, 13.95],
  click: 14.0,
  install: [14.05, 14.9],
  open: 15.0,
  pinned: 15.05,
  // 7 · Through the icon into the mark; the end card holds.
  dive: [15.55, 16.0],
  mark: 16.0,
  dollar: 16.5,
  wordmark: 16.75,
  tagline: 17.1,
  end: 17.5,
};

/**
 * Every line of copy the film puts on screen, with the stretch where it is fully readable.
 * Scenes take their words from here, and verify.mjs checks them against the approved copy
 * and each line's reading time (0.2 s + 0.12 s a word).
 */
export const LINES = {
  kicker: { text: "Now on the Microsoft Store", from: 0, to: 1.7 },
  hook: { text: "Get paid to code.", from: 0, to: 1.7 },
  build: { text: "You build with AI.", from: 2.35, to: 4.4 },
  prompt: { text: "ADCode, build me a habit tracker", from: 3.2, to: 4.4 },
  ad: { text: "An occasional ad keeps it free.", from: 4.75, to: 6.8 },
  earned: { text: "+$0.04", from: 5.35, to: 6.8 },
  fifty: { text: "50%", from: 7.9, to: 10.45 },
  share: { text: "Your share of every ad", from: 7.1, to: 10.45 },
  half: { text: "Half the ad money is yours.", from: 8.75, to: 10.45 },
  audit: { text: "On a ledger you can audit.", from: 10.95, to: 12.45 },
  stamp: { text: "50% yours", from: 11.55, to: 12.45 },
  store: { text: "Now on the Microsoft Store.", from: 13.1, to: 15.9 },
  brand: { text: "ADCode", from: 17.0, to: DURATION },
  tagline: { text: "Get paid to code.", from: 17.4, to: DURATION },
  free: { text: "Free. Half the ad money is yours.", from: 17.85, to: DURATION },
  url: { text: "adcode.bluethenics.com", from: 18.0, to: DURATION },
  small: { text: "Example amounts. Earnings vary. Sponsored cards are occasional.", from: 0, to: DURATION },
};

/** The example amounts the film shows. Both halves of one sponsored card. */
export const EXAMPLE = { cost: "$0.08", share: "+$0.04" };
