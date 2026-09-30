/**
 * Every moment the picture and the sound both care about, in seconds, on a 120 BPM grid
 * (a beat is 0.5 s, a bar 2 s, a triplet eighth a sixth of a second). Scenes and the
 * soundtrack read the same numbers, so a cut and its hit can never drift apart.
 *
 * The film is built for a feed where most people leave early: the money is on screen in
 * frame 0, something changes at least once a second, and the last frame cuts back into the
 * first so a replay is seamless.
 */
export const BPM = 120;
export const BEAT = 60 / BPM;
export const BAR = 4 * BEAT;
export const DURATION = 8;

export const PROMPT = "Build a habit tracker with streaks";

/** Half the film is cuts, and they get faster: 1 s, then 0.5, 0.375, and down to a sixth. */
export const SHOTS = [
  { id: "hook", from: 0, to: 1.0 },
  { id: "prompt", from: 1.0, to: 1.5 },
  { id: "think", from: 1.5, to: 2.0 },
  { id: "bar", from: 2.0, to: 2.375 },
  { id: "clock", from: 2.375, to: 2.75 },
  { id: "wait1", from: 2.75, to: 3.0 },
  { id: "wait2", from: 3.0, to: 3.25 },
  { id: "wait3", from: 3.25, to: 3.5 },
  { id: "every", from: 3.5, to: 3.5 + 1 / 6 },
  { id: "single", from: 3.5 + 1 / 6, to: 3.5 + 2 / 6 },
  { id: "build", from: 3.5 + 2 / 6, to: 4.0 },
];

export const CUE = {
  /** The money ticks in the hook: four steps, $0.01 to $0.04. */
  ticks: [0, 0.25, 0.5, 0.75],
  typeStart: 1.02,
  typeEnd: 1.34,
  send: 1.36,
  /** A quarter-second of nothing, so the hit lands on a held breath. */
  silence: 4.0,
  hit: 4.25,
  fly: 4.62,
  landed: 4.85,
  split: 5.0,
  bar: 5.15,
  logo: 6.0,
  wordmark: 6.18,
  tagline: 6.48,
  free: 6.9,
  url: 7.2,
};
