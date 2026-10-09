// Exact ADCode original agent geometry and moods, copied from apps/desktop/src/renderer/agents/agentMascot.ts.
export const BODIES = {
  circle: "M24 5a19 19 0 1 1 0 38a19 19 0 1 1 0-38z",
  capsule: "M15 9h18a15 15 0 0 1 0 30H15a15 15 0 0 1 0-30z",
  pebble: "M8 23c0-10 8-17 17-17 9.5 0 16 6.5 16 16 0 11-7.5 20-17 20S8 33.5 8 23z",
  drop: "M24 4c6 8 17 15.5 17 25a17 17 0 0 1-34 0c0-9.5 11-17 17-25z",
  hexagon: "M21 5.2a6 6 0 0 1 6 0l12 7a6 6 0 0 1 3 5.2v13.2a6 6 0 0 1-3 5.2l-12 7a6 6 0 0 1-6 0l-12-7a6 6 0 0 1-3-5.2V17.4a6 6 0 0 1 3-5.2z",
  cloud: "M15 39a10 10 0 0 1-2.5-19.7A12 12 0 0 1 35.3 17 9.5 9.5 0 0 1 37 39z",
  squircle: "M24 5c15.5 0 19 3.5 19 19s-3.5 19-19 19S5 39.5 5 24 8.5 5 24 5z",
  egg: "M24 4c9.5 0 16.5 13.5 16.5 23.5a16.5 16.5 0 0 1-33 0C7.5 17.5 14.5 4 24 4z",
};
export const FACES = {
  sleepy: [
    { d: "M15.5 25.5q3 2.2 6 0", part: "eye" },
    { d: "M26.5 25.5q3 2.2 6 0", part: "eye" },
    { d: "M22 32.5h4", part: "mouth" },
  ],
  thinking: [
    { d: "M17.5 20.5a2 2.6 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M28.5 20.5a2 2.6 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M21 31.5h6", part: "mouth" },
  ],
  alert: [
    { d: "M18.5 21a2.6 3 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M29.5 21a2.6 3 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M24 30.5a2 2 0 1 1 0 .01z", fill: true, part: "mouth" },
  ],
  proud: [
    { d: "M15.5 25q3-3 6 0", part: "eye" },
    { d: "M26.5 25q3-3 6 0", part: "eye" },
    { d: "M19.5 30.5q4.5 3.5 9 0", part: "mouth" },
  ],
  happy: [
    { d: "M18.5 22.5a2.2 2.8 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M29.5 22.5a2.2 2.8 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M18 29.5q6 6 12 0", part: "mouth" },
  ],
  confused: [
    { d: "M18.5 22.5a2.2 2.8 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M29.5 23a1.6 2 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M19 32q2.5-2 5 0t5 0", part: "mouth" },
  ],
};
