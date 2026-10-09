/**
 * The cue sheet for "Pays You": every time the ad uses, in one place. The picture, the
 * soundtrack and verify.mjs all read it. Plain data: no DOM, so Node can import it too.
 *
 * 120 BPM, one beat = 0.5 s, five bars of two seconds. Every cut sits on a beat; the counter
 * ticks on the eighth notes. The hook is the only thing that changes between the three
 * files, and nothing after CUE.product reads it.
 */
export const W = 1080;
export const H = 1080;
export const BPM = 120;
export const BEAT = 60 / BPM;
export const DURATION = 10;

export const CUE = {
  // The hook: finished at frame 0 - it is the poster - then out through the camera.
  flyOut: 1.32,
  product: 1.5,
  // AI writes the code.
  prompt: 1.62,
  send: 1.9,
  stream: [2.0, 2.95],
  // The money.
  card: 3.0,
  payout: 3.5,
  landed: 3.85,
  row: 3.95,
  // A real IDE: four cuts on the beat.
  cuts: [4.5, 5.0, 5.5, 6.0],
  // The end card, held to the end.
  end: 6.5,
};

/**
 * The three openings. Each is an array of lines, set as large as the frame allows; the line
 * at `money` is the money - it is set in money green.
 */
export const HOOKS = [
  { id: "H1", lines: ["This code editor", "pays you."], money: 1 },
  { id: "H2", lines: ["Get paid", "to code."], money: 0 },
  { id: "H3", lines: ["Your IDE shows ads.", "You keep half."], money: 1 },
];

/** The counter in the earnings chip: example amounts, ticking on the eighth notes. */
export const COUNTER = { start: 12.4, step: 0.02, payout: 0.04, every: BEAT / 2 };

/** The counter's value at time t, in dollars. Deterministic, so stills match the video. */
export function counterAt(t) {
  const ticks = Math.max(0, Math.floor(t / COUNTER.every));
  return COUNTER.start + ticks * COUNTER.step + (t >= CUE.landed ? COUNTER.payout : 0);
}

/**
 * Every line of copy the ad puts on screen, with the stretch where it is fully readable.
 * `hook` lines come from HOOKS. Scenes take their words from here; verify.mjs checks the
 * list against the approved copy and each line's reading time.
 */
export const LINES = {
  ai: { text: "AI writes your code.", from: 1.83, to: 2.88 },
  half: { text: "Half the ad money is yours.", from: 3.4, to: 4.45 },
  agents: { text: "Agents", from: 4.58, to: 5.0 },
  terminal: { text: "Terminal", from: 5.08, to: 5.5 },
  git: { text: "Git", from: 5.58, to: 6.0 },
  preview: { text: "Preview", from: 6.08, to: 6.5 },
  brand: { text: "ADCode", from: 6.84, to: DURATION },
  claims: { text: "Free · Open source · Windows & Linux", from: 6.85, to: DURATION },
  url: { text: "adcode.bluethenics.com", from: 6.95, to: DURATION },
  smallPrint: { text: "Example amounts. Earnings vary.", from: 0, to: DURATION },
};

/** When each hook is readable: from frame 0 until it flies out. */
export const HOOK_WINDOW = { from: 0, to: CUE.flyOut };

/** Money green is the hook: it may be on screen from frame 0. */
export const MONEY_FROM = 0;
