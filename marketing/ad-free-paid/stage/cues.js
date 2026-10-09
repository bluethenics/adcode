/**
 * The cue sheet for "Free, then Paid": every time the spot uses, in one place. The picture,
 * the soundtrack and verify.mjs all read it, so a moved cut moves its sound and its checks.
 * Plain data: no DOM, so Node can import it too.
 *
 * 120 BPM, one beat = 0.5 s, a bar = 2 s. Scene changes sit on beats.
 */
export const W = 1080;
export const H = 1080;
export const BPM = 120;
export const BEAT = 60 / BPM;
export const DURATION = 16.5;

export const CUE = {
  // 1 · The hook, finished on frame 0; then the camera punches through it.
  sheen: [0.3, 1.2],
  underline: [0.45, 0.85],
  punch: [1.45, 2.0],
  // 2 · Build: a prompt, typed and sent; the agent works and the clock runs.
  app: 2.0,
  type: [2.15, 2.85],
  send: 2.95,
  work: 3.2,
  steps: [3.45, 3.85, 4.25],
  // 3 · Paid to wait: the card, the money, the line.
  wide: 4.35,
  card: 4.5,
  earn: 4.75,
  fly: [5.05, 5.45],
  slam: [4.95, 5.2, 5.45, 5.7],
  done: 6.25,
  // 4 · The split: the card lifts, flips, cracks, and halves.
  lift: 6.9,
  flip: [6.95, 7.3],
  crack: 7.8,
  split: 8.0,
  // 5 · The montage: three whips across the app.
  whipOut: 10.3,
  whips: [10.5, 11.25, 12.0],
  dive: 12.75,
  // 6 · The mark, and the end card.
  mark: 13.0,
  dollar: 13.5,
  wordmark: 13.7,
  tagline: 14.0,
  end: 14.3,
};

/**
 * Every line of copy the spot puts on screen, with the stretch where it is fully readable.
 * Scenes take their words from here, and verify.mjs checks the list against the approved
 * copy and each line's reading time (0.2 s + 0.12 s a word).
 */
export const LINES = {
  kicker: { text: "ADCode", from: 0, to: 1.45 },
  hook: { text: "The free AI code editor.", from: 0, to: 1.45 },
  prompt: { text: "Build me a habit tracker", from: 2.85, to: 4.4 },
  working: { text: "Your AI is working…", from: 3.45, to: 4.4 },
  earned: { text: "+$0.04", from: 4.85, to: 5.3 },
  paid: { text: "Get paid to wait.", from: 5.9, to: 6.95 },
  cost: { text: "$0.08", from: 7.3, to: 7.95 },
  costLabel: { text: "This ad paid", from: 7.3, to: 7.95 },
  you: { text: "You", from: 8.3, to: 10.3 },
  youShare: { text: "+$0.04", from: 8.3, to: 10.3 },
  us: { text: "ADCode", from: 8.3, to: 10.3 },
  fifty: { text: "50%", from: 8.3, to: 10.3 },
  half: { text: "Half the ad money is yours.", from: 8.6, to: 10.3 },
  both: { text: "Vibe or Code. Earn in both.", from: 10.8, to: 12.75 },
  vibe: { text: "Vibe", from: 10.55, to: 11.2 },
  code: { text: "Code", from: 11.3, to: 11.95 },
  earnings: { text: "Earnings", from: 12.05, to: 12.75 },
  brand: { text: "ADCode", from: 14.0, to: DURATION },
  tagline: { text: "Get paid to wait.", from: 14.3, to: DURATION },
  free: { text: "Free. Half the ad money is yours.", from: 14.85, to: DURATION },
  platforms: { text: "Windows & Linux", from: 14.95, to: DURATION },
  url: { text: "adcode.bluethenics.com", from: 15.05, to: DURATION },
  key: { text: "Use your own AI key or a local model.", from: 15.15, to: DURATION },
  small: { text: "Example amounts. Earnings vary. Sponsored cards are occasional.", from: 0, to: DURATION },
};

/** The example amounts the spot shows: both halves of one sponsored card, and a balance. */
export const EXAMPLE = { cost: "$0.08", share: "+$0.04", balance: [0.04, 0.36] };

/** The agent's clock: it races while you wait, and stops at this many seconds. */
export const WORKED = 42;

/** Where money green is allowed on screen: from the first +$0.04 to the end. */
export const MONEY_FROM = CUE.earn - 0.05;
