/** The film, in running order. Later scenes draw on top of earlier ones. */
import { agents } from "./agents.js";
import { flip } from "./flip.js";
import { hook } from "./hook.js";
import { vibe } from "./vibe.js";

export const SCENES = [hook, flip, vibe, agents];
