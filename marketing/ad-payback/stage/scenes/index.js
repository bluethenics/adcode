/** The film, in running order. Later scenes draw on top of earlier ones. */
import { adcard } from "./adcard.js";
import { agents } from "./agents.js";
import { earn } from "./earn.js";
import { endcard } from "./endcard.js";
import { flip } from "./flip.js";
import { hook } from "./hook.js";
import { logo } from "./logo.js";
import { montage } from "./montage.js";
import { vibe } from "./vibe.js";

export const SCENES = [hook, flip, vibe, agents, montage, adcard, earn, logo, endcard];
