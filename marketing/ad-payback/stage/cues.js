/**
 * Every moment the picture and the sound both care about, in seconds, on a 120 BPM grid
 * (a beat is 0.5 s, a bar 2 s). Scenes and the soundtrack read the same numbers, so a
 * cut and its hit can never drift apart.
 */
export const BPM = 120;
export const BEAT = 60 / BPM;
export const BAR = 4 * BEAT;
export const DURATION = 30;

export const PROMPT = "Build a habit tracker with streaks";

export const CUE = {
  hookPulse: 1.0,
  fold: 2.0,
  bracketsIn: 2.15,
  dollarDrop: 2.6,
  dollarLand: 3.0,
  flipText: 3.05,
  toVibe: 3.6,
  vibe: 4.0,
  typeStart: 4.4,
  typeRate: PROMPT.length / 1.1,
  send: 5.75,
  builds: 6.0,
  files: [6.2, 6.32, 6.44],
  preview: 6.5,
  checks: [7.0, 7.25, 7.5],
  toAgents: 7.7,
  agents: 8.0,
  moves: { tester: 8.5, fixerNeeds: 9.0, approve: 9.55, fixerReady: 10.0, reviewer: 10.5 },
  allDone: 11.0,
  montage: [12.0, 12.5, 13.0, 13.5],
  adcard: 14.0,
  cardIn: 14.5,
  pushIn: 15.5,
  earn: 16.0,
  flow: 16.3,
  split: 16.6,
  fifty: 17.0,
  itemized: 18.2,
  implode: 20.0,
  silence: 21.75,
  logo: 22.0,
  wordmark: 22.45,
  tagline: 23.2,
  settle: 23.6,
  end: 24.0,
  endLines: [24.3, 24.6, 25.0, 25.6, 26.0],
  click: 25.35,
  outro: 28.0,
  fadeOut: 29.0,
};
