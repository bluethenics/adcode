/** The film, in running order. Later scenes draw on top of earlier ones. */
import { flip } from "./flip.js";
import { hook } from "./hook.js";

export const SCENES = [hook, flip];
