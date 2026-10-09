/** The spot, in order. Scenes may overlap; later ones draw on top. */
import { app } from "./app.js";
import { end } from "./end.js";
import { hook } from "./hook.js";
import { hud } from "./hud.js";
import { montage } from "./montage.js";

export const SCENES = [hook, app, montage, end, hud];
