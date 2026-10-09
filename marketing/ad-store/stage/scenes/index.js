/**
 * The film, in order. Scenes may overlap; later ones draw on top - so the ledger sits over
 * the desktop it whips away from, and the HUD over everything.
 */
import { backdrop } from "./backdrop.js";
import { end } from "./end.js";
import { fifty } from "./fifty.js";
import { hook } from "./hook.js";
import { hud } from "./hud.js";
import { ledger } from "./ledger.js";
import { store } from "./store.js";
import { work } from "./work.js";

export const SCENES = [backdrop, hook, work, fifty, store, ledger, end, hud];
