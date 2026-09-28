/**
 * Agent mascots: a small coloured body with a face that shows how its run is doing.
 *
 * Each saved agent has its own shape and colour (see `mascotStyle.ts`), so a Reviewer and a
 * Tester are told apart at a glance on a busy board. The face follows the run: thinking while
 * it works, alert when it needs you, proud when its work is ready, happy once it has landed,
 * confused when it failed, sleepy when it is waiting or done for the day.
 *
 * The drawings are ADCode's own. The idea of a blob whose expression carries state follows
 * bloub (https://bloub.vercel.app); no bloub artwork or code is used.
 *
 * Decorative by contract: the box's text already says the status, so the mascot is
 * `aria-hidden`. Motion is CSS-only and switched off for reduced-motion users.
 */
import type { BoxStatus } from "./agentBoardModel.ts";
import type { MascotLook, MascotShape } from "./mascotStyle.ts";

export const AGENT_MOODS = ["sleepy", "thinking", "alert", "proud", "happy", "confused"] as const;
export type AgentMood = (typeof AGENT_MOODS)[number];

const MOOD: Readonly<Record<BoxStatus, AgentMood>> = {
  queued: "sleepy",
  running: "thinking",
  merging: "thinking",
  configured: "alert",
  conflict: "alert",
  budget: "alert",
  paused: "alert",
  ready: "proud",
  applied: "happy",
  completed: "happy",
  failed: "confused",
  cancelled: "sleepy",
  discarded: "sleepy",
  "rolled-back": "sleepy",
};

export function mascotMoodForStatus(status: BoxStatus): AgentMood {
  return MOOD[status];
}

/** Bodies on a 48-unit grid, each leaving the middle band (y 18-34) clear for the face. */
export const MASCOT_BODIES: Readonly<Record<MascotShape, string>> = {
  circle: "M24 5a19 19 0 1 1 0 38a19 19 0 1 1 0-38z",
  capsule: "M15 9h18a15 15 0 0 1 0 30H15a15 15 0 0 1 0-30z",
  pebble: "M8 23c0-10 8-17 17-17 9.5 0 16 6.5 16 16 0 11-7.5 20-17 20S8 33.5 8 23z",
  drop: "M24 4c6 8 17 15.5 17 25a17 17 0 0 1-34 0c0-9.5 11-17 17-25z",
  hexagon: "M21 5.2a6 6 0 0 1 6 0l12 7a6 6 0 0 1 3 5.2v13.2a6 6 0 0 1-3 5.2l-12 7a6 6 0 0 1-6 0l-12-7a6 6 0 0 1-3-5.2V17.4a6 6 0 0 1 3-5.2z",
  cloud: "M15 39a10 10 0 0 1-2.5-19.7A12 12 0 0 1 35.3 17 9.5 9.5 0 0 1 37 39z",
  squircle: "M24 5c15.5 0 19 3.5 19 19s-3.5 19-19 19S5 39.5 5 24 8.5 5 24 5z",
  egg: "M24 4c9.5 0 16.5 13.5 16.5 23.5a16.5 16.5 0 0 1-33 0C7.5 17.5 14.5 4 24 4z",
};

/** Faces: eyes and a mouth, drawn in the face colour over the body. */
export const MASCOT_FACES: Readonly<Record<AgentMood, readonly { readonly d: string; readonly fill?: boolean; readonly part: "eye" | "mouth" }[]>> = {
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

const SVG_NS = "http://www.w3.org/2000/svg";

export interface AgentMascot {
  readonly element: HTMLElement;
  setMood(mood: AgentMood): void;
  setLook(look: MascotLook): void;
}

export function createAgentMascot(options: { readonly look: MascotLook; readonly mood: AgentMood; readonly size?: number }): AgentMascot {
  const element = document.createElement("span");
  element.className = "agent-mascot";
  element.setAttribute("aria-hidden", "true");
  const size = options.size ?? 40;
  element.style.setProperty("--mascot-size", `${size}px`);
  // Each mascot blinks on its own clock, so a full board never blinks in unison.
  element.style.setProperty("--mascot-blink-delay", `-${(Math.random() * 5).toFixed(2)}s`);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  const body = document.createElementNS(SVG_NS, "path");
  body.setAttribute("class", "agent-mascot-body");
  const face = document.createElementNS(SVG_NS, "g");
  face.setAttribute("class", "agent-mascot-face");
  // The "!" that pops above an agent that needs you.
  const badge = document.createElementNS(SVG_NS, "g");
  badge.setAttribute("class", "agent-mascot-badge");
  const badgeDot = document.createElementNS(SVG_NS, "circle");
  badgeDot.setAttribute("cx", "40");
  badgeDot.setAttribute("cy", "8");
  badgeDot.setAttribute("r", "6.5");
  const badgeMark = document.createElementNS(SVG_NS, "path");
  badgeMark.setAttribute("d", "M40 4.8v3.8M40 11.2v.1");
  badge.append(badgeDot, badgeMark);
  svg.append(body, face, badge);
  element.append(svg);

  function setLook(look: MascotLook): void {
    element.dataset["shape"] = look.shape;
    element.dataset["color"] = look.color;
    body.setAttribute("d", MASCOT_BODIES[look.shape]);
  }

  function setMood(mood: AgentMood): void {
    if (element.dataset["mood"] === mood) return;
    element.dataset["mood"] = mood;
    face.replaceChildren(...MASCOT_FACES[mood].map((part) => {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", part.d);
      // Eyes blink (motion.css); mouths do not.
      path.setAttribute("data-part", part.part);
      if (part.fill === true) path.setAttribute("class", "agent-mascot-solid");
      return path;
    }));
  }

  setLook(options.look);
  setMood(options.mood);
  return { element, setMood, setLook };
}
