/** The film, in running order. Later scenes draw on top of earlier ones. */
import { brand } from "./brand.js";
import { cuts } from "./cuts.js";
import { finish } from "./finish.js";
import { hit } from "./hit.js";

export const SCENES = [cuts, hit, brand, finish];
