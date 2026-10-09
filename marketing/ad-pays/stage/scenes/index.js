/** The ad, in order. Scenes may overlap; later ones draw on top. */
import { cuts } from "./cuts.js";
import { end, overlay } from "./end.js";
import { hook } from "./hook.js";
import { product } from "./product.js";

export const SCENES = [hook, product, cuts, end, overlay];
