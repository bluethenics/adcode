/** The film, in order. Scenes may overlap; later ones draw on top. */
import { mark } from "./mark.js";
import { product } from "./product.js";
import { screen } from "./screen.js";
import { world } from "./world.js";
import { zero } from "./zero.js";

export const SCENES = [world, screen, zero, product, mark];
